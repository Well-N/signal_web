const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const desktop = path.resolve(__dirname, "..");
const root = path.resolve(desktop, "..");
const staging = path.join(desktop, "staging");

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}

function resetGeneratedDirectory(name) {
  const target = path.resolve(staging, name);
  if (path.dirname(target) !== staging || !["web", "pipeline"].includes(name)) {
    throw new Error("Refusing to remove a path outside the build staging directory");
  }
  if (fs.existsSync(target)) {
    if (fs.lstatSync(target).isSymbolicLink() || fs.realpathSync(target) !== target) {
      throw new Error("Build staging directory must not be a link");
    }
    fs.rmSync(target, { recursive: true });
  }
  fs.mkdirSync(target, { recursive: true });
  return target;
}

try {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("This build requires Windows x64");
  }
  const web = path.join(root, "web");
  run(process.execPath, [path.join(web, "node_modules", "next", "dist", "bin", "next"), "build"], web);
  fs.mkdirSync(staging, { recursive: true });
  const webTarget = resetGeneratedDirectory("web");
  fs.cpSync(path.join(web, ".next", "standalone"), webTarget, {
    recursive: true,
    filter: (file) => !file.split(path.sep).includes("fixtures") && !path.basename(file).startsWith(".env"),
  });
  fs.cpSync(path.join(web, ".next", "static"), path.join(webTarget, ".next", "static"), { recursive: true });
  fs.cpSync(path.join(web, "public"), path.join(webTarget, "public"), { recursive: true });
  const pipelineTarget = resetGeneratedDirectory("pipeline");
  for (const folder of ["src", "profiles"]) {
    fs.cpSync(path.join(root, "pipeline", folder), path.join(pipelineTarget, folder), {
      recursive: true,
      filter: (file) => !file.split(path.sep).includes("__pycache__") && !file.endsWith(".pyc"),
    });
  }
  fs.mkdirSync(path.join(pipelineTarget, "scripts"));
  fs.copyFileSync(path.join(root, "pipeline", "scripts", "signalweb_runner.py"), path.join(pipelineTarget, "scripts", "signalweb_runner.py"));
  fs.mkdirSync(path.join(pipelineTarget, "data"));
  fs.copyFileSync(path.join(root, "pipeline", "data", "config.desktop.json"), path.join(pipelineTarget, "data", "config.json"));
  for (const name of ["LICENSE", "pyproject.toml", "README.md"]) {
    fs.copyFileSync(path.join(root, "pipeline", name), path.join(pipelineTarget, name));
  }
  fs.copyFileSync(path.join(root, "THIRD_PARTY_NOTICES.md"), path.join(pipelineTarget, "THIRD_PARTY_NOTICES.md"));
  const python = path.join(root, "pipeline", ".venv", "Scripts", "python.exe");
  run(python, [path.join(__dirname, "prepare-python.py")], root);
  // Only explicit resources are included: no local settings, credentials, cached news or demo fixtures.
  run(process.execPath, [path.join(desktop, "node_modules", "electron-builder", "cli.js"), "--win", "nsis", "--x64", "--publish", "never"], desktop);
  run(process.execPath, [path.join(__dirname, "smoke-package.cjs")], desktop);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
