import Link from "next/link";
import { storyTitle } from "../../lib/story-title";
import { AppHeader } from "../../components/AppHeader";
import { EmptyBrief } from "../../components/EmptyBrief";
import { ScoreBadge } from "../../components/ScoreBadge";
import { SignalGraph } from "../../components/SignalGraph";
import { loadBrief } from "../../lib/data";

export const dynamic = "force-dynamic";

export default async function NetworkPage() {
  const result = await loadBrief();
  if (!result.brief) {
    return (
      <div className="app-shell app-shell--warm">
        <AppHeader active="网络" themeSwitch />
        <EmptyBrief message={result.error || "没有可显示的数据。"} sourcePath={result.sourcePath} />
      </div>
    );
  }
  const brief = result.brief;

  return (
    <div className="app-shell app-shell--warm">
      <AppHeader
        date={brief.date}
        status={brief.is_sample ? "示例数据" : "真实抓取"}
        active="网络"
        themeSwitch
      />
      <main className="page">
        <header className="page-head">
          <div className="page-head__copy">
            <h1>信息网络</h1>
            <p>每个节点是一个事件簇，连线来自共享标签。点击节点查看事件，拖动和缩放查看局部关系。</p>
          </div>
          <Link href="/" className="text-link">返回简报</Link>
        </header>

        {brief.is_sample ? (
          <div className="sample-banner" style={{ marginTop: "var(--space-lg)" }}>
            当前为界面开发用示例数据。
          </div>
        ) : null}

        <div className="network-layout">
          <SignalGraph
            stories={brief.stories}
            edges={brief.edges}
            height={480}
            title="事件关系"
            caption="节点大小随评分变化。连线是共享标签，不是重复报道的断言。"
          />
          <aside className="panel">
            <div className="panel__head">
              <h2>事件列表</h2>
              <span>{brief.stories.length} 个</span>
            </div>
            <div className="network-list">
              {brief.stories.map((story) => (
                <Link className="network-list__item" key={story.id} href={"/stories/" + encodeURIComponent(story.id)}>
                  <div className="network-list__row">
                    <h3 className="network-list__title">
                      <span lang="zh-CN">{storyTitle(story).zh}</span>
                      <span className="bilingual-en" lang="en">{storyTitle(story).en}</span>
                    </h3>
                    <ScoreBadge score={story.score} />
                  </div>
                  <span className="network-list__source">{story.source}</span>
                </Link>
              ))}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
