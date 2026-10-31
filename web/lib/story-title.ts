import type { Story } from "./types";

export function storyTitle(story: Story) {
  const title = story.bilingual?.title;
  if (!title?.zh?.trim() || !title?.en?.trim()) {
    throw new Error(`新闻双语标题不完整 / Incomplete bilingual title: ${story.id}`);
  }
  return title;
}
