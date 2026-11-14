import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/json-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function pipelineDir() {
  return process.env.SIGNALWEB_PIPELINE_DIR
    ? path.resolve(process.env.SIGNALWEB_PIPELINE_DIR)
    : path.resolve(process.cwd(), "../pipeline");
}

function configPath() {
  return path.join(pipelineDir(), "data", "config.json");
}

type RssFeed = { name: string; url: string; enabled: boolean; profile: string };

const SECTION_KEYWORDS = [
  { profile: "ai-news", name: "Google News AI" },
  { profile: "finance-news", name: "Google News 财经" },
  { profile: "world-news", name: "Google News 世界大事" },
  { profile: "solopreneur", name: "Google News 创业" },
  { profile: "cross-border", name: "Google News 跨境" },
] as const;

function isGoogleNewsSearchUrl(value: string) {
  try {
    const url = new URL(value);
    return url.hostname === "news.google.com" && url.pathname === "/rss/search";
  } catch {
    return false;
  }
}

function googleNewsQuery(value: string) {
  try {
    return new URL(value).searchParams.get("q") || "";
  } catch {
    return "";
  }
}

function googleNewsUrl(query: string, template?: string) {
  const url = template
    ? new URL(template)
    : new URL("https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en");
  url.searchParams.set("q", query);
  return url.toString();
}

function sectionKeywords(
  googleNews: Record<string, unknown>,
  rss: Record<string, unknown>[],
) {
  const result: Record<string, string> = {};
  for (const section of SECTION_KEYWORDS) {
    if (section.profile === "ai-news") {
      result[section.profile] = String(googleNews.query ?? "");
      continue;
    }
    const feed = rss.find(
      (entry) =>
        String(entry.profile ?? "") === section.profile &&
        isGoogleNewsSearchUrl(String(entry.url ?? "")),
    );
    result[section.profile] = feed ? googleNewsQuery(String(feed.url ?? "")) : "";
  }
  return result;
}

function sectionThresholds(config: Record<string, unknown>) {
  const processing = (config.processing ?? {}) as Record<string, unknown>;
  const profileSettings = (processing.profile_settings ?? {}) as Record<string, unknown>;
  const result: Record<string, number | null> = {};
  for (const section of SECTION_KEYWORDS) {
    const settings = (profileSettings[section.profile] ?? {}) as Record<string, unknown>;
    const raw = settings.threshold;
    if (raw === null || raw === undefined || raw === "") {
      result[section.profile] = null;
      continue;
    }
    const threshold = Number(raw);
    result[section.profile] = Number.isFinite(threshold) ? threshold : null;
  }
  return result;
}

async function readConfig() {
  const raw = await readFile(configPath(), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

function summarize(config: Record<string, unknown>) {
  const sources = (config.sources ?? {}) as Record<string, unknown>;
  const hn = (sources.hackernews ?? {}) as Record<string, unknown>;
  const gn = (sources.google_news ?? {}) as Record<string, unknown>;
  const rss = Array.isArray(sources.rss) ? (sources.rss as Record<string, unknown>[]) : [];
  return {
    hackernews: {
      enabled: Boolean(hn.enabled),
      min_score: Number(hn.min_score ?? 50),
      fetch_top_stories: Number(hn.fetch_top_stories ?? 30),
    },
    google_news: {
      enabled: Boolean(gn.enabled),
      query: String(gn.query ?? ""),
      max_results: Number(gn.max_results ?? 30),
      language: String(gn.language ?? "en"),
      country: String(gn.country ?? "US"),
    },
    section_keywords: sectionKeywords(gn, rss),
    section_thresholds: sectionThresholds(config),
    rss: rss.map((feed) => ({
      name: String(feed.name ?? ""),
      url: String(feed.url ?? ""),
      enabled: Boolean(feed.enabled),
      profile: String(feed.profile ?? "ai-news"),
    })),
  };
}

export async function GET() {
  try {
    const config = await readConfig();
    return NextResponse.json({ ok: true, sources: summarize(config) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "读取配置失败：" + (error instanceof Error ? error.message : String(error)) },
      { status: 500 },
    );
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export async function POST(request: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = await readJsonObject(request);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "请求格式错误" },
      { status: 400 },
    );
  }

  const incomingHn = (payload.hackernews ?? {}) as Record<string, unknown>;
  const incomingGn = (payload.google_news ?? {}) as Record<string, unknown>;
  const incomingKeywords = (payload.section_keywords ?? {}) as Record<string, unknown>;
  const incomingThresholds = (payload.section_thresholds ?? {}) as Record<string, unknown>;
  const incomingRss = Array.isArray(payload.rss) ? (payload.rss as Record<string, unknown>[]) : null;
  if (!incomingRss) {
    return NextResponse.json({ ok: false, error: "rss 必须是数组" }, { status: 400 });
  }

  const query = String(incomingKeywords["ai-news"] ?? incomingGn.query ?? "").trim();
  const feeds: RssFeed[] = [];
  for (const feed of incomingRss) {
    const name = String(feed.name ?? "").trim();
    const url = String(feed.url ?? "").trim();
    if (!name || !url) {
      return NextResponse.json({ ok: false, error: "每条 RSS 都需要名称和地址" }, { status: 400 });
    }
    if (!/^https:\/\//.test(url)) {
      return NextResponse.json({ ok: false, error: "RSS 地址必须以 https:// 开头" }, { status: 400 });
    }
    const profile = String(feed.profile ?? "").trim() || "ai-news";
    feeds.push({ name, url, enabled: Boolean(feed.enabled), profile });
  }

  try {
    const config = await readConfig();
    const sources = (config.sources ?? {}) as Record<string, unknown>;
    const hn = (sources.hackernews ?? {}) as Record<string, unknown>;
    const gn = (sources.google_news ?? {}) as Record<string, unknown>;
    const existingRss = Array.isArray(sources.rss) ? (sources.rss as Record<string, unknown>[]) : [];
    const processing = (config.processing ?? {}) as Record<string, unknown>;
    const profileSettings = (processing.profile_settings ?? {}) as Record<string, unknown>;

    for (const section of SECTION_KEYWORDS) {
      if (!(section.profile in incomingThresholds)) continue;
      const raw = incomingThresholds[section.profile];
      const previous = (profileSettings[section.profile] ?? {}) as Record<string, unknown>;
      if (raw === null || raw === "") {
        profileSettings[section.profile] = { ...previous, threshold: null };
        continue;
      }
      const threshold = Number(raw);
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 10) {
        return NextResponse.json(
          { ok: false, error: `${section.profile} 的评分阈值必须在 0 到 10 之间` },
          { status: 400 },
        );
      }
      profileSettings[section.profile] = {
        ...previous,
        threshold: Math.round(threshold * 10) / 10,
      };
    }
    processing.profile_settings = profileSettings;
    config.processing = processing;

    sources.hackernews = {
      ...hn,
      enabled: Boolean(incomingHn.enabled),
      min_score: clampInt(incomingHn.min_score, 0, 10000, 50),
      fetch_top_stories: clampInt(incomingHn.fetch_top_stories, 1, 500, 30),
    };
    sources.google_news = {
      ...gn,
      enabled: Boolean(incomingGn.enabled),
      query,
      max_results: clampInt(incomingGn.max_results, 1, 100, 30),
      language: String(incomingGn.language ?? gn.language ?? "en"),
      country: String(incomingGn.country ?? gn.country ?? "US"),
    };
    sources.rss = feeds.map((feed) => {
      const previous = existingRss.find((entry) => String(entry.url ?? "") === feed.url);
      return {
        ...(previous ?? {}),
        name: feed.name,
        url: feed.url,
        enabled: feed.enabled,
        profile: feed.profile,
      };
    });

    const configuredFeeds = sources.rss as Record<string, unknown>[];
    for (const section of SECTION_KEYWORDS) {
      if (section.profile === "ai-news") continue;
      const keyword = String(incomingKeywords[section.profile] ?? "").trim();
      const index = configuredFeeds.findIndex(
        (entry) =>
          String(entry.profile ?? "") === section.profile &&
          isGoogleNewsSearchUrl(String(entry.url ?? "")),
      );
      if (!keyword) {
        if (index >= 0) configuredFeeds.splice(index, 1);
        continue;
      }
      if (index >= 0) {
        configuredFeeds[index] = {
          ...configuredFeeds[index],
          url: googleNewsUrl(keyword, String(configuredFeeds[index].url ?? "")),
          enabled: true,
          category: section.profile,
          profile: section.profile,
        };
      } else {
        configuredFeeds.push({
          name: section.name,
          url: googleNewsUrl(keyword),
          enabled: true,
          category: section.profile,
          profile: section.profile,
          content_extractor: "trafilatura",
          max_items: 8,
        });
      }
    }

    config.sources = sources;
    const file = configPath();
    const temp = file + ".tmp";
    await writeFile(temp, JSON.stringify(config, null, 2) + "\n", "utf8");
    await rename(temp, file);
    return NextResponse.json({ ok: true, sources: summarize(config) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "保存失败：" + (error instanceof Error ? error.message : String(error)) },
      { status: 500 },
    );
  }
}

