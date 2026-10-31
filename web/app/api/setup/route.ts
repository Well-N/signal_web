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

function runRunner(command: string, input?: unknown) {
  const root = pipelineDir();
  const runner = runnerCommand(root, command, pythonExecutable());
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(/*turbopackIgnore: true*/ runner.executable, runner.args, {
      cwd: root,
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    if (input !== undefined) {
      child.stdin.write(JSON.stringify(input));
    }
    child.stdin.end();
  });
}

function spawnDailyRun() {
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
}

function parseRunnerOutput(stdout: string) {
  try {
    return JSON.parse(stdout.trim()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function GET() {
  const result = await runRunner("status");
  const payload = parseRunnerOutput(result.stdout);
  if (!payload) {
    return NextResponse.json(
      { error: "运行器没有返回 JSON", stderr: result.stderr.slice(0, 500) },
      { status: 500 },
    );
  }
  return NextResponse.json(payload, { status: result.code === 0 ? 200 : 500 });
}

export async function POST(request: Request) {
  const payload = (await request.json()) as Record<string, unknown>;
  const result = await runRunner("configure", payload);
  const response = parseRunnerOutput(result.stdout);
  if (!response || result.code !== 0 || response.ok !== true) {
    return NextResponse.json(
      {
        error: response?.error || "配置失败",
        stderr: result.stderr.slice(0, 500),
      },
      { status: 400 },
    );
  }
  spawnDailyRun();
  return NextResponse.json({ ...response, run_started: true });
}
