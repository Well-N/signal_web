import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Brief } from "./types";

export type BriefLoadResult = {
  brief: Brief | null;
  error: string | null;
  sourcePath: string;
};

export type CloudWord = { text: string; weight: number; count?: number };

export type WordCloudPayload = {
  words: CloudWord[];
  stories: number;
};

function dataPath(): string {
  if (process.env.SIGNALWEB_DATA_DIR) {
    return path.resolve(process.env.SIGNALWEB_DATA_DIR, "latest.json");
  }
  return path.resolve(process.cwd(), "../pipeline/data/export/latest.json");
}

function demoPath(): string {
  return path.resolve(process.cwd(), "fixtures/sample-brief.json");
}

function wordCloudPath(): string {
  if (process.env.SIGNALWEB_DATA_DIR) {
    return path.resolve(process.env.SIGNALWEB_DATA_DIR, "wordcloud.json");
  }
  return path.resolve(process.cwd(), "../pipeline/data/export/wordcloud.json");
}

export async function loadWordCloud(): Promise<WordCloudPayload | null> {
  try {
    const raw = await readFile(wordCloudPath(), "utf8");
    const parsed = JSON.parse(raw) as WordCloudPayload;
    if (!parsed || !Array.isArray(parsed.words) || !parsed.words.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function loadBrief(): Promise<BriefLoadResult> {
  const useDemo = process.env.SIGNALWEB_DEMO === "1";
  const sourcePath = useDemo ? demoPath() : dataPath();

  try {
    const raw = await readFile(sourcePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray((parsed as Brief).stories) ||
      !Array.isArray((parsed as Brief).sections)
    ) {
      return {
        brief: null,
        error: "数据格式不符合约定：" + sourcePath,
        sourcePath,
      };
    }
    return { brief: parsed as Brief, error: null, sourcePath };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return {
        brief: null,
        error: "今天的简报还没有生成。请先运行 Horizon 抓取与导出。",
        sourcePath,
      };
    }
    return {
      brief: null,
      error: "读取简报失败：" + (error instanceof Error ? error.message : String(error)),
      sourcePath,
    };
  }
}

export function storyById(brief: Brief, id: string) {
  return brief.stories.find((story) => story.id === id) ?? null;
}
