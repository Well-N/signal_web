const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const {
  existsSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  appendFileSync,
  writeFileSync,
} = require("node:fs");
const path = require("node:path");

app.setName("SignalWeb");

const isDev = !app.isPackaged;
const port = isDev ? 3001 : 31789;
const baseUrl = "http://127.0.0.1:" + port;
const webDir = isDev
  ? path.resolve(__dirname, "..", "web")
  : path.join(process.resourcesPath, "web");

let packagedPipelineDir;

function copyDirectory(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
    else throw new Error("安装资源包含不支持的文件类型：" + from);
  }
}

function prepareInstalledData() {
  const source = path.join(process.resourcesPath, "pipeline");
  const destination = path.join(app.getPath("userData"), "pipeline");
  mkdirSync(path.join(destination, "data"), { recursive: true });
  for (const folder of ["src", "scripts", "profiles"]) {
    copyDirectory(path.join(source, folder), path.join(destination, folder));
  }
  const config = path.join(destination, "data", "config.json");
  if (!existsSync(config)) {
    copyFileSync(path.join(source, "data", "config.json"), config);
  }
  return destination;
}

let serverProcess = null;
let mainWindow = null;

function startupArgs() {
  return process.platform === "win32" && isDev ? [path.resolve(__dirname)] : [];
}

function startupOptions() {
  return {
    path: process.execPath,
    args: startupArgs(),
  };
}

function normalizeStartupArg(value) {
  const normalized = String(value).replace(/^"|"$/g, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function sameStartupArgs(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  return actual.every(
    (value, index) => normalizeStartupArg(value) === normalizeStartupArg(expected[index]),
  );
}

ipcMain.handle("signalweb:select-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择日报保存位置",
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled ? null : result.filePaths[0] || null;
});

function startupEnabled() {
  if (process.platform !== "win32" && process.platform !== "darwin") return false;
  if (process.platform === "darwin") {
    return Boolean(app.getLoginItemSettings().openAtLogin);
  }

  const expected = startupOptions();
  const settings = app.getLoginItemSettings(expected);
  if (process.platform === "win32" && Array.isArray(settings.launchItems)) {
    return settings.launchItems.some(
      (item) =>
        item.enabled &&
        normalizeStartupArg(item.path) === normalizeStartupArg(expected.path) &&
        sameStartupArgs(item.args, expected.args),
    );
  }
  return Boolean(settings.openAtLogin);
}

ipcMain.handle("signalweb:get-startup", () => startupEnabled());

ipcMain.handle("signalweb:set-startup", (_event, enabled) => {
  if (process.platform !== "win32" && process.platform !== "darwin") return false;
  if (process.platform === "win32") {
    const expected = startupOptions();
    const matches = app.getLoginItemSettings(expected).launchItems.filter(
      (item) =>
        normalizeStartupArg(item.path) === normalizeStartupArg(expected.path) &&
        sameStartupArgs(item.args, expected.args),
    );
    for (const item of matches) {
      app.setLoginItemSettings({ ...expected, name: item.name, openAtLogin: false });
    }
    if (enabled) {
      app.setLoginItemSettings({ ...expected, name: "SignalWeb", openAtLogin: true });
    }
  } else {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled), openAsHidden: false });
  }
  const result = startupEnabled();
  if (result !== Boolean(enabled)) throw new Error("开机自启动设置没有生效，请检查系统启动项。");
  return result;
});

async function isServerReady() {
  try {
    const response = await fetch(baseUrl + "/api/setup", { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await isServerReady()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function startServer() {
  if (await isServerReady()) return;
  if (isDev) {
    const builtWeb = existsSync(path.join(webDir, ".next", "BUILD_ID"));
    const serveBuilt = builtWeb && process.env.SIGNALWEB_DEV_WEB !== "1";
    serverProcess = spawn(
      process.platform === "win32" ? "npm.cmd" : "npm",
      serveBuilt
        ? ["start", "--", "-p", String(port)]
        : ["run", "dev", "--", "--port", String(port)],
      {
        cwd: webDir,
        env: { ...process.env, SIGNALWEB_DEMO: process.env.SIGNALWEB_DEMO ?? "0" },
        windowsHide: true,
        stdio: "ignore",
        shell: process.platform === "win32",
      },
    );
  } else {
    packagedPipelineDir = prepareInstalledData();
    const standaloneDir = webDir;
    const python = process.platform === "darwin"
      ? path.join(process.resourcesPath, "python", "signalweb-runner", "signalweb-runner")
      : path.join(process.resourcesPath, "python", "python.exe");
    if (!existsSync(python) || !existsSync(path.join(standaloneDir, "server.js"))) {
      throw new Error("安装文件不完整，请重新安装织讯。");
    }
    const log = path.join(app.getPath("userData"), "startup.log");
    serverProcess = spawn(process.execPath, [path.join(standaloneDir, "server.js")], {
      cwd: standaloneDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: String(port),
        SIGNALWEB_PIPELINE_DIR: packagedPipelineDir,
        ...(process.platform === "darwin"
          ? { SIGNALWEB_RUNNER: python }
          : { SIGNALWEB_PYTHON: python }),
        SIGNALWEB_DATA_DIR: path.join(packagedPipelineDir, "data", "export"),
        SIGNALWEB_DEMO: "0",
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    serverProcess.stdout.on("data", (chunk) => appendFileSync(log, chunk));
    serverProcess.stderr.on("data", (chunk) => appendFileSync(log, chunk));
    serverProcess.on("error", (error) => appendFileSync(log, String(error) + "\n"));
  }
  if (!(await waitForServer())) {
    throw new Error("本地 Web 服务没有在 60 秒内启动");
  }
}

async function isConfigured() {
  try {
    const response = await fetch(baseUrl + "/api/setup", { cache: "no-store" });
    const payload = await response.json();
    return Boolean(payload.status && payload.status.settings);
  } catch {
    return false;
  }
}

async function createWindow() {
  const startPath =
    process.env.SIGNALWEB_START_PATH || ((await isConfigured()) ? "/" : "/setup");
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 960,
    minHeight: 700,
    backgroundColor: "#0b0d10",
    autoHideMenuBar: true,
    title: "织讯 · SignalWeb",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  const startupLog = path.join(app.getPath("userData"), "startup.log");
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) {
      appendFileSync(startupLog, `${new Date().toISOString()} 页面加载失败: ${code} ${description} ${url}\n`);
    }
  });
  await mainWindow.loadURL(baseUrl + startPath);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  const screenshotPath = process.env.SIGNALWEB_SCREENSHOT_PATH;
  if (screenshotPath) {
    await mainWindow.webContents.executeJavaScript(`
      Promise.all([
        document.fonts.ready,
        new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      ])
    `);
    await new Promise((resolve) => setTimeout(resolve, 750));
    const image = await mainWindow.webContents.capturePage();
    if (image.isEmpty()) throw new Error("应用窗口截图失败");
    mkdirSync(path.dirname(screenshotPath), { recursive: true });
    writeFileSync(screenshotPath, image.toPNG());
    const size = image.getSize();
    console.log(`Captured app screenshot: ${screenshotPath} (${size.width}x${size.height})`);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  if (!gotLock) return;
  app.setAppUserModelId("com.signalweb.desktop");
  try {
    await startServer();
    await createWindow();
  } catch (error) {
    dialog.showErrorBox(
      "织讯启动失败",
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
  }
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
});
