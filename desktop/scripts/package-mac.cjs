const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const desktop = path.resolve(__dirname, "..");
const root = path.resolve(desktop, "..");
const staging = path.join(desktop, "staging");

function run(command, args, cwd = root, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}

function freshDirectory(name) {
  const target = path.resolve(staging, name);
  if (path.dirname(target) !== staging || !["web", "pipeline", "python"].includes(name)) {
    throw new Error("Refusing to reset an unexpected staging directory");
  }
  if (fs.existsSync(target)) {
    if (fs.lstatSync(target).isSymbolicLink() || fs.realpathSync(target) !== target) {
      throw new Error("Staging directory must not be a link");
    }
    fs.rmSync(target, { recursive: true });
  }
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function stage() {
  const web = path.join(root, "web");
  run(process.execPath, [path.join(web, "node_modules", "next", "dist", "bin", "next"), "build"], web);
  fs.mkdirSync(staging, { recursive: true });
  const webTarget = freshDirectory("web");
  fs.cpSync(path.join(web, ".next", "standalone"), webTarget, {
    recursive: true,
    filter: (file) => !file.split(path.sep).includes("fixtures") && !path.basename(file).startsWith(".env"),
  });
  fs.cpSync(path.join(web, ".next", "static"), path.join(webTarget, ".next", "static"), { recursive: true });
  fs.cpSync(path.join(web, "public"), path.join(webTarget, "public"), { recursive: true });

  const pipelineTarget = freshDirectory("pipeline");
  for (const folder of ["src", "profiles"]) {
    fs.cpSync(path.join(root, "pipeline", folder), path.join(pipelineTarget, folder), {
      recursive: true,
      filter: (file) => !file.split(path.sep).includes("__pycache__") && !file.endsWith(".pyc"),
    });
  }
  fs.mkdirSync(path.join(pipelineTarget, "scripts"));
  fs.copyFileSync(path.join(root, "pipeline", "scripts", "signalweb_runner.py"),
    path.join(pipelineTarget, "scripts", "signalweb_runner.py"));
  fs.mkdirSync(path.join(pipelineTarget, "data"));
  fs.copyFileSync(path.join(root, "pipeline", "data", "config.desktop.json"),
    path.join(pipelineTarget, "data", "config.json"));
  for (const name of ["LICENSE", "pyproject.toml", "README.md"]) {
    fs.copyFileSync(path.join(root, "pipeline", name), path.join(pipelineTarget, name));
  }
  fs.copyFileSync(path.join(root, "THIRD_PARTY_NOTICES.md"),
    path.join(pipelineTarget, "THIRD_PARTY_NOTICES.md"));
  return pipelineTarget;
}

function main() {
  if (process.platform !== "darwin") throw new Error("The Mac package must be built on macOS");
  const arch = process.arch;
  if (!["arm64", "x64"].includes(arch)) throw new Error(`Unsupported Mac architecture: ${arch}`);
  const pipelineTarget = stage();
  const pythonTarget = freshDirectory("python");
  const python = process.env.SIGNALWEB_BUILD_PYTHON || "python3";
  run(python, ["-m", "PyInstaller", "--noconfirm", "--clean", "--onedir",
    "--name", "signalweb-runner", "--distpath", pythonTarget,
    "--workpath", path.join(desktop, ".build-cache", "pyinstaller"),
    "--specpath", path.join(desktop, ".build-cache"),
    "--paths", path.join(root, "pipeline"),
    "--collect-all", "jieba", "--collect-all", "reportlab", "--collect-all", "trafilatura",
    "--collect-submodules", "keyring.backends", "--collect-submodules", "src",
    path.join(pipelineTarget, "scripts", "signalweb_runner.py")]);
  const binary = path.join(pythonTarget, "signalweb-runner", "signalweb-runner");
  if (!fs.existsSync(binary)) throw new Error("Packaged Python runner is missing");
  const result = spawnSync(binary, ["status"], {
    cwd: pipelineTarget,
    env: { ...process.env, SIGNALWEB_PIPELINE_DIR: pipelineTarget },
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) throw new Error("Packaged runner status check failed: " + (result.error || result.stderr));
  const status = JSON.parse(result.stdout);
  if (status.ok !== true) throw new Error("Packaged runner did not return OK");
  run(process.execPath, [path.join(desktop, "node_modules", "electron-builder", "cli.js"),
    "--mac", "dmg", "zip", arch === "arm64" ? "--arm64" : "--x64", "--publish", "never"], desktop);
}

try { main(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
