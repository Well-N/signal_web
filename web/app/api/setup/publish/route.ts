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

function runPublish(input: unknown) {
  const root = pipelineDir();
  const runner = runnerCommand(root, "publish", pythonExecutable());
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(
      /*turbopackIgnore: true*/ runner.executable,
      runner.args,
      {
        cwd: root,
        env: {
          ...process.env,
          PYTHONUTF8: "1",
          PYTHONIOENCODING: "utf-8",
        },
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

export async function POST(request: Request) {
  const payload = (await request.json()) as Record<string, unknown>;
  const result = await runPublish(payload);
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  if (!parsed || result.code !== 0 || parsed.ok !== true) {
    return NextResponse.json(
      {
        error: parsed?.error || "PDF 导出失败",
        stderr: result.stderr.slice(0, 500),
      },
      { status: 400 },
    );
  }
  return NextResponse.json(parsed);
}
