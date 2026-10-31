import Link from "next/link";
import { storyTitle } from "../lib/story-title";
import { AppHeader } from "../components/AppHeader";
import { HeroArt } from "../components/HeroArt";
import { EmptyBrief } from "../components/EmptyBrief";
import { SignalGraph } from "../components/SignalGraph";
import { StoryCard } from "../components/StoryCard";
import { loadBrief } from "../lib/data";
import type { Brief, Section, Story } from "../lib/types";

export const dynamic = "force-dynamic";

function storyLookup(brief: Brief) {
  return new Map(brief.stories.map((story) => [story.id, story]));
}

function sectionStories(section: Section, lookup: Map<string, Story>) {
  return section.story_ids
    .map((id) => lookup.get(id))
    .filter((story): story is Story => Boolean(story));
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function shortTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function sourceStatus(status?: string) {
  if (status === "success") return "正常";
  if (status === "partial_failure") return "部分失败";
  if (status === "failure") return "失败";
  return status || "未报告";
}

function summaryOf(story: Story, limit = 140) {
  const block =
    story.artifact?.blocks?.find((entry) => entry.id === "summary") ??
    story.artifact?.blocks?.[0];
  const text = block?.content?.trim();
  if (!text) return story.one_liner || "尚未生成摘要。";
  return text.length > limit ? text.slice(0, limit).trimEnd() + "…" : text;
}

export default async function Home() {
  const result = await loadBrief();
  if (!result.brief) {
    return (
      <div className="app-shell surface-cobalt">
        <AppHeader />
        <EmptyBrief message={result.error || "没有可显示的数据。"} sourcePath={result.sourcePath} />
      </div>
    );
  }

  const brief = result.brief;
  const lookup = storyLookup(brief);
  const topSection = brief.sections.find((section) => section.id === "top3");
  const topStories = topSection ? sectionStories(topSection, lookup) : brief.stories.slice(0, 3);
  const topIds = new Set(topStories.map((story) => story.id));
  const remainingSections = brief.sections
    .filter((section) => section.id !== "top3")
    .map((section) => ({
      ...section,
      stories: sectionStories(section, lookup).filter((story) => !topIds.has(story.id)),
    }))
    .filter((section) => section.stories.length > 0);

  const sources = brief.fetch_report?.sources ?? [];
  const healthy = sources.filter((source) => source.status === "success").length;
  const sourceTotal = sources.length || brief.stats.source_count;
  const topDate = brief.date || formatDate(brief.generated_at);

  return (
    <div className="app-shell surface-cobalt">
      <AppHeader
        date={brief.date}
        status={brief.is_sample ? "示例数据" : "真实抓取"}
        active="简报"
      />
      <main>
        {brief.is_sample ? (
          <p className="field-note">当前为界面开发用示例数据。运行 Horizon 后，页面会读取真实 JSON。</p>
        ) : null}

        <section className="hero">
          <div className="hero__copy">
            <h1 className="hero__headline">{brief.headline}</h1>
            <p className="hero__lede">
              {brief.stats.story_count} 个事件，来自 {brief.stats.source_count} 个来源。最后生成于 {formatDate(brief.generated_at)}。
            </p>
            <div className="hero__actions">
              <a className="btn btn--primary" href="#brief">打开今日信号</a>
              <Link className="btn" href="/network">查看关系网络</Link>
            </div>
          </div>
          <HeroArt />
                  </section>

        <section className="band surface-marble" id="brief" aria-label="今日信号">
          <div className="band__inner">
            <div className="band__intro">
              <h2>信号不是结论，是值得追的线索。</h2>
              <p className="band__aside">按评分排序，点开读完整判断。</p>
            </div>

            {topStories.map((story) => (
              (() => {
                const title = storyTitle(story);
                return (
                  <Link
                    key={story.id}
                    href={"/stories/" + encodeURIComponent(story.id)}
                    className="band__cell"
                  >
                    <span className="band__score">{story.score?.toFixed(1) ?? "—"}</span>
                    <h3 lang="zh-CN">{title.zh}</h3>
                    <span className="band__title-alt" lang="en">{title.en}</span>
                    <p className="band__summary">{summaryOf(story)}</p>
                    <span className="band__meta">
                      <span>{story.source}</span>
                      <time dateTime={story.published_at}>{shortTime(story.published_at)}</time>
                    </span>
                  </Link>
                );
              })()
            ))}

            <div className="band__stats">
              <div>
                <strong>{brief.stats.story_count}</strong>
                <span>个事件</span>
              </div>
              <p className="band__meta">
                抓取源 {healthy} / {sourceTotal} 正常
                <br />
                {topDate} 更新
              </p>
            </div>
          </div>
        </section>

        <div className="page">
          {remainingSections.map((section) => (
            <section className="section" key={section.id}>
              <div className="section-head">
                <h2>{section.title}</h2>
                <span>{section.stories.length} 条</span>
              </div>
              {section.stories.map((story, index) => (
                <StoryCard key={story.id} story={story} rank={topStories.length + index + 1} />
              ))}
            </section>
          ))}

          <div className="split">
            <SignalGraph
              stories={brief.stories.slice(0, 18)}
              edges={brief.edges}
              height={380}
              title="从故事里长出来的网络"
              caption="节点是事件簇，连线来自共享标签。点击节点查看故事。"
            />

            <section className="panel">
              <div className="panel__head">
                <h2>来源</h2>
                <span>{sources.length} 个来源有状态</span>
              </div>
              <div className="panel__body">
                {sources.length ? (
                  sources.map((source) => (
                    <div className="source-row" key={source.source}>
                      <span className="source-row__name">{source.source}</span>
                      <span className="source-row__count">{source.item_count}</span>
                      <span className="status-line">{sourceStatus(source.status)}</span>
                      {source.error ? <p className="source-row__error">{source.error}</p> : null}
                    </div>
                  ))
                ) : (
                  <p className="status-line">本次运行没有来源健康报告。</p>
                )}
              </div>
            </section>
          </div>

          {brief.summary_markdown ? (
            <details className="details">
              <summary>查看 Horizon 原始日报</summary>
              <pre>{brief.summary_markdown}</pre>
            </details>
          ) : null}
        </div>
      </main>
    </div>
  );
}

