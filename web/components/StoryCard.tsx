import Link from "next/link";
import { storyTitle } from "../lib/story-title";
import type { Story } from "../lib/types";

function shortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function summaryOf(story: Story, limit = 180) {
  const block =
    story.artifact?.blocks?.find((entry) => entry.id === "summary") ??
    story.artifact?.blocks?.[0];
  const text = block?.content?.trim();
  if (!text) return story.one_liner || "尚未生成摘要。";
  return text.length > limit ? text.slice(0, limit).trimEnd() + "…" : text;
}

export function StoryCard({
  story,
  featured = false,
  rank,
}: {
  story: Story;
  featured?: boolean;
  rank?: number;
}) {
  const summary = summaryOf(story);
  const rankLabel = rank === undefined ? "—" : String(rank).padStart(2, "0");
  const title = storyTitle(story);

  return (
    <Link
      href={"/stories/" + encodeURIComponent(story.id)}
      className={featured ? "story-row story-row--lead" : "story-row"}
    >
      <span className="story-row__rank">{rankLabel}</span>
      <span className="story-row__score">{story.score?.toFixed(1) ?? "—"}</span>
      <div className="story-row__body">
        <h3 className="story-row__title" lang="zh-CN">{title.zh}</h3>
        <p className="story-row__title-alt" lang="en">{title.en}</p>
        <p className="story-row__summary">{summary}</p>
        <div className="story-row__meta">
          <span>{story.source}</span>
          <span>{story.category || story.profile || "AI"}</span>
          <time dateTime={story.published_at}>{shortDate(story.published_at)}</time>
          {(story.tags || []).slice(0, 3).map((tag) => (
            <span className="tag" key={tag}>{tag}</span>
          ))}
        </div>
      </div>
      <span className="story-row__side">{featured ? "重点信号" : "阅读"}</span>
    </Link>
  );
}
