import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { runnerCommand } from "@/lib/runner-command";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function pipelineDir() {
  return process.env.SIGNALWEB_PIPELINE_DIR
    ? path.resolve(process.env.SIGNALWEB_PIPELINE_DIR)
    : path.resolve(process.cwd(), "../pipeline");
}

function pythonExecutable() {
  if (process.env.SIGNALWEB_PYTHON) return process.env.SIGNALWEB_PYTHON;
  const root = pipelineDir();
  const candidates = [
    path.join(root, ".venv", "Scripts", "python.exe"),
    path.join(root, ".venv", "bin", "python"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || "python";
}

function pythonBackgroundExecutable() {
  const executable = pythonExecutable();
  if (process.platform !== "win32") return executable;
  const background = executable.replace(/python\.exe$/i, "pythonw.exe");
  return background !== executable && existsSync(background) ? background : executable;
}

export async function POST() {
  const root = pipelineDir();
  const runner = runnerCommand(root, "run", pythonBackgroundExecutable());
  const child = spawn(/*turbopackIgnore: true*/ runner.executable, runner.args, {
    cwd: root,
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
    },
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return NextResponse.json({ ok: true, started: true });
}
