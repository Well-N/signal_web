import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { runnerCommand } from "@/lib/runner-command";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let launchingRun = false;

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

function runnerEnvironment() {
  return {
    ...process.env,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
  };
}

function readStatus(root: string) {
  const runner = runnerCommand(root, "status", pythonExecutable());
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn(/*turbopackIgnore: true*/ runner.executable, runner.args, {
      cwd: root,
      env: runnerEnvironment(),
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), 15_000);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const payload = JSON.parse(stdout.trim()) as Record<string, unknown>;
        resolve({ ...payload, exit_code: code, stderr: stderr.slice(0, 500) });
      } catch {
        reject(new Error("运行器状态响应无效"));
      }
    });
    child.stdin.end();
  });
}

function launchRun(root: string) {
  const runner = runnerCommand(root, "run", pythonBackgroundExecutable());
  return new Promise<void>((resolve, reject) => {
    const child = spawn(/*turbopackIgnore: true*/ runner.executable, runner.args, {
      cwd: root,
      env: runnerEnvironment(),
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
    child.once("error", reject);
  });
}

export async function POST() {
  const root = pipelineDir();
  if (launchingRun) {
    return NextResponse.json({ error: "已有日报任务正在启动" }, { status: 409 });
  }
  launchingRun = true;
  try {
    const status = await readStatus(root);
    const state = status.status as {
      run_active?: boolean;
      settings?: Record<string, unknown> | null;
    } | undefined;
    if (status.ok !== true || !state) {
      return NextResponse.json(
        { error: String(status.error || "无法读取运行状态") },
        { status: 500 },
      );
    }
    if (!state.settings) {
      return NextResponse.json({ error: "请先完成 API 配置" }, { status: 400 });
    }
    if (state.run_active) {
      return NextResponse.json({ error: "已有日报任务正在运行" }, { status: 409 });
    }
    await launchRun(root);
    return NextResponse.json({ ok: true, started: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "启动日报失败" },
      { status: 500 },
    );
  } finally {
    launchingRun = false;
  }
}
