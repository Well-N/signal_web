import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "../../../components/AppHeader";
import { EmptyBrief } from "../../../components/EmptyBrief";
import { ScoreBadge } from "../../../components/ScoreBadge";
import { loadBrief } from "../../../lib/data";

export const dynamic = "force-dynamic";

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

function Bilingual({ pair }: { pair?: { zh: string; en: string } }) {
  if (!pair?.zh || !pair?.en) throw new Error("新闻双语内容不完整 / Incomplete bilingual story content");
  return <><span lang="zh-CN">{pair.zh}</span><span className="bilingual-en" lang="en">{pair.en}</span></>;
}

export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadBrief();
  if (!result.brief) {
    return (
      <div className="app-shell app-shell--warm">
        <AppHeader active="简报" themeSwitch bilingual />
        <EmptyBrief message={result.error || "没有可显示的数据。"} sourcePath={result.sourcePath} />
      </div>
    );
  }
  const brief = result.brief;
  const story = brief.stories.find((entry) => entry.id === decodeURIComponent(id));
  if (!story) notFound();

  const relatedIds = brief.edges
    .filter((edge) => edge.source === story.id || edge.target === story.id)
    .map((edge) => (edge.source === story.id ? edge.target : edge.source));
  const related = brief.stories.filter((entry) => relatedIds.includes(entry.id)).slice(0, 4);

  return (
    <div className="app-shell app-shell--warm">
      <AppHeader
        date={brief.date}
        status={brief.is_sample ? "示例数据 / Sample data" : "真实抓取 / Live data"}
        active="简报"
        themeSwitch
        bilingual
      />
      <main className="page">
        <Link href="/" className="text-link">返回今日简报 / Back to today’s brief</Link>
        {brief.is_sample ? (
          <div className="sample-banner" style={{ marginTop: "var(--space-lg)" }}>
            当前为界面开发用示例数据。 / Sample data for interface development.
          </div>
        ) : null}

        <article className="article">
          <h1 className="article-title" style={{ marginTop: "var(--space-xl)" }}>
            <Bilingual pair={story.bilingual?.title} />
          </h1>
          <div className="article-meta">
            <span>{story.source}</span>
            <time dateTime={story.published_at}>{formatDate(story.published_at)}</time>
            <ScoreBadge score={story.score} bilingual />
          </div>
          {(story.tags || []).length ? (
            <div className="tag-list">
              {(story.tags || []).map((tag, index) => (
                <span className="tag" key={tag}><Bilingual pair={story.bilingual?.[`tag.${index}`]} /></span>
              ))}
            </div>
          ) : null}

          <div className="article-layout">
            <div className="article-body surface-marble">
              {story.artifact?.blocks?.length ? (
                story.artifact.blocks.map((block) => (
                  <section key={block.id}>
                    <h2><Bilingual pair={story.bilingual?.[`${block.id}.title`]} /></h2>
                    <p className="prose"><Bilingual pair={story.bilingual?.[`${block.id}.content`]} /></p>
                  </section>
                ))
              ) : (
                <section>
                  <h2>摘要 / Summary</h2>
                  <p className="prose">AI 摘要尚未生成，请阅读原文。 / The AI summary has not been generated. Please read the original article.</p>
                </section>
              )}
              {story.one_liner ? (
                <section>
                  <h2>编辑说明 / Editor’s note</h2>
                  <p className="prose"><Bilingual pair={story.bilingual?.one_liner} /></p>
                </section>
              ) : null}
              {story.reason ? (
                <details className="details">
                  <summary>查看评分理由 / View score rationale</summary>
                  <p className="prose"><Bilingual pair={story.bilingual?.reason} /></p>
                </details>
              ) : null}
            </div>

            <aside className="article-side">
              <section className="meta-block">
                <h2>原文 / Original article</h2>
                <a href={story.url} target="_blank" rel="noreferrer">阅读原文 / Read original</a>
                <p>{story.url}</p>
              </section>
              <section className="meta-block">
                <h2>来源与分类 / Source & category</h2>
                <p>{story.source}</p>
                <p>{story.category ? <Bilingual pair={story.bilingual?.category} /> : "分类 / Profile: " + (story.profile || "未分类 / Uncategorized")}</p>
              </section>
              <section className="meta-block">
                <h2>抓取时间 / Fetched at</h2>
                <p>{formatDate(story.fetched_at)}</p>
              </section>
            </aside>
          </div>
        </article>

        {related.length ? (
          <section className="section">
            <div className="section-head">
              <h2>相关事件 / Related stories</h2>
              <span>{related.length} 条 / stories</span>
            </div>
            <div className="related-list">
              {related.map((entry) => (
                <Link key={entry.id} href={"/stories/" + encodeURIComponent(entry.id)}>
                  <Bilingual pair={entry.bilingual?.title} />
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
