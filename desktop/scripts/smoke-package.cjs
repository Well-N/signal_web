const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const desktop = path.resolve(__dirname, "..");
const packaged = path.join(desktop, "dist", "win-unpacked");
const resources = path.join(packaged, "resources");
const testRoot = path.join(desktop, ".build-cache", "安装 测试");
const pipeline = path.join(testRoot, "pipeline");
const port = 31891;
let server;

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else fs.copyFileSync(from, to);
  }
}

async function main() {
  fs.mkdirSync(testRoot, { recursive: true });
  copyDirectory(path.join(resources, "pipeline"), pipeline);
  const windows = process.env.SystemRoot;
  const env = {
    ...process.env,
    PATH: `${windows}\\System32;${windows}`,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    APPDATA: path.join(testRoot, "AppData"),
    SIGNALWEB_PIPELINE_DIR: pipeline,
    SIGNALWEB_PYTHON: path.join(resources, "python", "python.exe"),
    SIGNALWEB_DATA_DIR: path.join(pipeline, "data", "export"),
    SIGNALWEB_DEMO: "0",
    SIGNALWEB_INSTANCE_TOKEN: "signalweb-package-smoke",
  };
  delete env.PYTHONPATH;
  delete env.PYTHONHOME;
  execFileSync(env.SIGNALWEB_PYTHON, ["-I", "-B", "-X", "utf8", "-c", `
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import src.orchestrator
from src.export.json_export import export_brief_json
from src.export.wordcloud import build_wordcloud
import jieba
assert list(jieba.cut("中文分词用于新闻词云"))
cloud = build_wordcloud([{"title": "人工智能模型", "score": 8,
    "one_liner": "中文分词支持新闻词云。", "tags": ["中文分词"]}])
assert cloud["stories"] == 1 and cloud["words"], cloud
assert all(".venv" not in entry.lower() for entry in sys.path), sys.path
print("Packaged collection imports and Chinese word cloud: passed")
`, pipeline], { cwd: pipeline, env, windowsHide: true, stdio: "inherit" });
  const web = path.join(resources, "web");
  let logs = "";
  server = spawn(path.join(packaged, "SignalWeb.exe"), [path.join(web, "server.js")], {
    cwd: web, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", chunk => { logs += chunk; });
  server.stderr.on("data", chunk => { logs += chunk; });
  server.on("error", error => { logs += String(error); });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error(`Packaged server exited: ${logs}`);
    try {
      const response = await fetch(base + "/api/setup");
      if (response.ok) { ready = true; break; }
    } catch { /* The child server has not started listening yet. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error(`Packaged setup did not become ready: ${logs}`);
  const health = await fetch(base + "/api/health", {
    headers: { "x-signalweb-instance-token": env.SIGNALWEB_INSTANCE_TOKEN },
  });
  if (health.status !== 204) throw new Error(`Packaged service identity failed: ${health.status}`);
  const denied = await fetch(base + "/api/setup/test", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://untrusted.example" },
    body: JSON.stringify({ endpoint: "https://example.invalid/v1", model: "" }),
  });
  if (denied.status !== 400 || !(await denied.json()).error.includes("只接受来自本机应用页面")) {
    throw new Error("Packaged server accepted a cross-origin settings request");
  }
  for (const route of ["/setup", "/api/setup", "/api/sources", "/api/crawl/events"]) {
    const response = await fetch(base + route);
    if (!response.ok) throw new Error(`${route} failed: ${response.status} ${await response.text()}`);
    const text = await response.text();
    if (route === "/api/setup") {
      const result = JSON.parse(text);
      if (result.status?.settings) throw new Error("Packaged app unexpectedly contains developer settings");
      if (!text.includes("安装 测试")) throw new Error("Packaged runner did not use the isolated user directory");
    }
    if (route === "/setup") {
      const assets = [...text.matchAll(/(?:src|href)="([^\"]*\/_next\/static\/[^\"]+)"/g)];
      if (!assets.length) throw new Error("No packaged static assets found");
      for (const [, asset] of assets) {
        const file = await fetch(new URL(asset.replaceAll("&amp;", "&"), base));
        if (!file.ok) throw new Error(`Static asset missing: ${asset}`);
      }
    }
    console.log(`${route}: passed`);
  }
  if (fs.existsSync(path.join(resources, "pipeline", "data", "export"))) throw new Error("Developer news must not ship");
  if (fs.existsSync(path.join(resources, "web", "fixtures"))) throw new Error("Demo fixtures must not ship");
  console.log("Packaged Node + Python, static assets and Unicode user directory passed without system developer tools.");
}

main().catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(() => { if (server) server.kill(); });
