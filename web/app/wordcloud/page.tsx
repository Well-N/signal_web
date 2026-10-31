import { AppHeader } from "../../components/AppHeader";
import { WordWall } from "../../components/WordWall";
import { loadBrief, loadWordCloud } from "../../lib/data";

export const dynamic = "force-dynamic";

export default async function WordCloudPage() {
  const [briefResult, cloud] = await Promise.all([loadBrief(), loadWordCloud()]);
  const brief = briefResult.brief;

  return (
    <div className="app-shell surface-cobalt word-wall-shell">
      <AppHeader
        date={brief?.date}
        status={brief ? (brief.is_sample ? "示例数据" : "真实抓取") : undefined}
      />
      <main className="word-wall-page">
        {cloud ? (
          <>
            <WordWall words={cloud.words} />
            <div className="wall-meta">
              <span>{cloud.stories} 篇文章</span>
              <span>{cloud.words.length} 个词</span>
              <span>悬停放大</span>
            </div>
          </>
        ) : (
          <p className="cloud-empty word-wall-empty">
            本次运行还没有生成词云。执行一次抓取后，这里会把全部入选词汇铺成词墙。
          </p>
        )}
      </main>
    </div>
  );
}

