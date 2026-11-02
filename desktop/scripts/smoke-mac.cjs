const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

const desktop = path.resolve(__dirname, "..");
const dist = path.join(desktop, "dist");
const screenshot = path.join(dist, `SignalWeb-mac-${process.arch}-home.png`);
const bundles = fs.readdirSync(dist, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("mac"))
  .map((entry) => path.join(dist, entry.name, "SignalWeb.app", "Contents", "MacOS", "SignalWeb"))
  .filter((candidate) => fs.existsSync(candidate));
if (bundles.length !== 1) throw new Error(`Expected one macOS app bundle, found ${bundles.length}`);

async function main() {
  fs.rmSync(screenshot, { force: true });
  const app = spawn(bundles[0], [], {
    cwd: desktop,
    env: {
      ...process.env,
      SIGNALWEB_START_PATH: "/",
      SIGNALWEB_SCREENSHOT_PATH: screenshot,
      SIGNALWEB_DEMO: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let exited = false;
  let launchError = null;
  let log = "";
  app.on("exit", () => { exited = true; });
  app.on("error", (error) => { launchError = error; });
  app.stdout.on("data", (chunk) => { log = (log + chunk.toString()).slice(-4000); });
  app.stderr.on("data", (chunk) => { log = (log + chunk.toString()).slice(-4000); });
  try {
    const deadline = Date.now() + 120_000;
    let serviceReady = false;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (exited) throw new Error("Mac app exited before the local service became ready: " + log);
      try {
        const response = await fetch("http://127.0.0.1:31789/api/setup", {
          signal: AbortSignal.timeout(3000),
        });
        if (response.ok) {
          const body = await response.json();
          if (!body.status) throw new Error("Setup API returned no status");
          serviceReady = true;
        }
      } catch (error) {
        if (error.message === "Setup API returned no status") throw error;
      }
      if (fs.existsSync(screenshot)) {
        const image = fs.readFileSync(screenshot);
        if (image.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
          if (serviceReady) {
            console.log("Packaged Mac app opened the home page and captured a valid PNG");
            console.log(`Screenshot: ${screenshot}`);
            return;
          }
        } else {
          throw new Error("Captured file is not a valid PNG");
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const startupLog = path.join(os.homedir(), "Library", "Application Support", "SignalWeb", "startup.log");
    const detail = fs.existsSync(startupLog) ? fs.readFileSync(startupLog, "utf8").slice(-4000) : "No startup log";
    throw new Error("Packaged Mac app did not open and capture the home page within 120 seconds: " + log + "\n" + detail);
  } finally {
    app.kill("SIGKILL");
    app.stdout.destroy();
    app.stderr.destroy();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
