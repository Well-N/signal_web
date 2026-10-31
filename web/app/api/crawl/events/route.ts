import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CrawlEvent = {
  kind?: string;
  at?: string;
  source?: string;
  items?: number;
  status?: string;
  seconds?: number;
  error?: string | null;
  stories?: number;
  stage?: string;
  percent?: number;
};

function pipelineDir() {
  return process.env.SIGNALWEB_PIPELINE_DIR
    ? path.resolve(process.env.SIGNALWEB_PIPELINE_DIR)
    : path.resolve(process.cwd(), "../pipeline");
}

export async function GET() {
  const file = path.join(pipelineDir(), "data", "state", "crawl-events.jsonl");
  let raw = "";
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return NextResponse.json({ state: "none", sources: [], events: 0 });
  }

  const events: CrawlEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as CrawlEvent;
      if (parsed && typeof parsed === "object") events.push(parsed);
    } catch {
      // A partially written last line is expected while a run appends.
    }
  }

  let state = "none";
  let startedAt: string | null = null;
  let finishedAt: string | null = null;
  let error: string | null = null;
  let stories = 0;
  let stage = "waiting";
  let percent = 0;
  const sources = new Map<string, { name: string; items: number; status: string; seconds: number; error: string | null }>();

  for (const event of events) {
    if (event.kind === "run_started") {
      state = "running";
      startedAt = event.at ?? null;
      finishedAt = null;
      error = null;
      stage = "starting";
      percent = 2;
    } else if (event.kind === "stage") {
      stage = event.stage ?? stage;
      percent = typeof event.percent === "number" ? event.percent : percent;
    } else if (event.kind === "run_finished") {
      state = "finished";
      finishedAt = event.at ?? null;
      stories = event.stories ?? 0;
      stage = "finished";
      percent = 100;
    } else if (event.kind === "run_failed") {
      state = "failed";
      finishedAt = event.at ?? null;
      error = event.error ?? null;
      stage = "failed";
      percent = 100;
    } else if (event.kind === "source_done" && event.source) {
      sources.set(event.source, {
        name: event.source,
        items: event.items ?? 0,
        status: event.status ?? "success",
        seconds: event.seconds ?? 0,
        error: event.error ?? null,
      });
    }
  }

  return NextResponse.json({
    state,
    started_at: startedAt,
    finished_at: finishedAt,
    error,
    stories,
    stage,
    percent,
    sources: [...sources.values()],
    events: events.length,
  });
}

