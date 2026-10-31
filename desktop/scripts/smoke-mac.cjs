const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const desktop = path.resolve(__dirname, "..");
const dist = path.join(desktop, "dist");
const bundles = fs.readdirSync(dist, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("mac"))
  .map((entry) => path.join(dist, entry.name, "SignalWeb.app", "Contents", "MacOS", "SignalWeb"))
  .filter((candidate) => fs.existsSync(candidate));
if (bundles.length !== 1) throw new Error(`Expected one macOS app bundle, found ${bundles.length}`);

async function main() {
  const app = spawn(bundles[0], [], {
    cwd: desktop,
    env: { ...process.env, SIGNALWEB_START_PATH: "/setup", SIGNALWEB_DEMO: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let exited = false;
  let log = "";
  app.on("exit", () => { exited = true; });
  app.stdout.on("data", (chunk) => { log = (log + chunk.toString()).slice(-4000); });
  app.stderr.on("data", (chunk) => { log = (log + chunk.toString()).slice(-4000); });
  try {
    for (let attempt = 0; attempt < 90; attempt++) {
      if (exited) throw new Error("Mac app exited before the local service became ready: " + log);
      try {
        const response = await fetch("http://127.0.0.1:31789/api/setup", {
          signal: AbortSignal.timeout(3000),
        });
        if (response.ok) {
          const body = await response.json();
          if (!body.status) throw new Error("Setup API returned no status");
          console.log("Packaged Mac app started and setup API responded");
          return;
        }
      } catch (error) {
        if (error.message === "Setup API returned no status") throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("Packaged Mac app did not start within 90 seconds: " + log);
  } finally {
    app.kill();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
