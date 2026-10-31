"""Export Horizon results into the stable JSON consumed by the web app.

This adapter only reads Horizon's normalized ContentItem objects. It does not
invent articles, summaries, or source status.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from ..models import ContentItem
from .wordcloud import build_wordcloud


def _source_label(item: ContentItem) -> str:
    meta = item.metadata or {}
    for key in (
        "feed_name",
        "subreddit",
        "channel",
        "repo",
        "watchlist",
        "source_name",
        "gn_query",
        "domain",
    ):
        value = meta.get(key)
        if value:
            return str(value)
    return item.source_type.value


def _artifact_for(item: ContentItem, language: str) -> dict[str, Any] | None:
    if not item.processing:
        return None
    artifact = item.processing.artifacts.get(language)
    if artifact is None:
        return None
    return artifact.model_dump(mode="json")


def _story_for(item: ContentItem, language: str) -> dict[str, Any]:
    processing = item.processing
    analysis = processing.analysis if processing else None
    classification = processing.classification if processing else None
    meta = item.metadata or {}
    artifact = _artifact_for(item, language)
    return {
        "id": item.id,
        "title": item.title,
        "url": str(item.url),
        "source": _source_label(item),
        "source_type": item.source_type.value,
        "author": item.author,
        "published_at": item.published_at.isoformat(),
        "fetched_at": item.fetched_at.isoformat(),
        "category": meta.get("category"),
        "profile": classification.profile if classification else item.profile,
        "score": analysis.score if analysis else None,
        "reason": analysis.reason if analysis else None,
        "one_liner": analysis.summary if analysis else None,
        "tags": analysis.tags if analysis else [],
        "artifact": artifact,
        "bilingual": processing.bilingual if processing else {},
        "metadata": {
            key: value
            for key, value in meta.items()
            if key in {"feed_name", "subreddit", "channel", "repo", "source_name", "gn_query", "domain"}
        },
    }


def _section_for(stories: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not stories:
        return []
    top_ids = [story["id"] for story in stories[:3]]
    sections: list[dict[str, Any]] = [
        {"id": "top3", "title": "今日 Top 3", "story_ids": top_ids}
    ]
    grouped: dict[str, list[str]] = {}
    for story in stories:
        key = story.get("profile") or story.get("category") or "other"
        if isinstance(key, list):
            key = ",".join(str(part) for part in key)
        grouped.setdefault(str(key), []).append(story["id"])
    titles = {
        "ai-news": "AI 动态",
        "finance-news": "财经",
        "world-news": "世界大事",
        "startups": "创业",
        "cross-border": "跨境电商",
        "solopreneur": "创业",
        "research": "研究论文",
        "tooling": "工具与开源",
        "industry": "行业与政策",
    }
    for key, story_ids in grouped.items():
        sections.append(
            {
                "id": f"profile:{key}",
                "title": titles.get(key, key),
                "story_ids": story_ids,
            }
        )
    return sections


def _edges_for(stories: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Build explicit, explainable graph edges from shared tags."""
    tag_index: dict[str, list[str]] = {}
    for story in stories:
        for tag in story.get("tags") or []:
            normalized = str(tag).strip().lower()
            if normalized:
                tag_index.setdefault(normalized, []).append(story["id"])
    edges: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for tag, story_ids in tag_index.items():
        unique_ids = list(dict.fromkeys(story_ids))
        for index, source_id in enumerate(unique_ids):
            for target_id in unique_ids[index + 1 :]:
                key = (source_id, target_id, tag)
                if key in seen:
                    continue
                seen.add(key)
                edges.append(
                    {
                        "source": source_id,
                        "target": target_id,
                        "kind": "shared_tag",
                        "weight": 0.5,
                        "label": tag,
                    }
                )
                if len(edges) >= 200:
                    return edges
    return edges


def export_brief_json(
    data_dir: Path,
    date: str,
    language: str,
    items: Iterable[ContentItem],
    summary_markdown: str,
    fetch_report: dict[str, Any] | None = None,
    is_primary: bool = False,
    wordcloud_items: Iterable[ContentItem] | None = None,
) -> Path:
    """Write date-stamped and optionally latest JSON snapshots."""
    export_dir = Path(data_dir) / "export"
    export_dir.mkdir(parents=True, exist_ok=True)
    stories = [_story_for(item, language) for item in items]
    payload = {
        "version": 1,
        "is_sample": False,
        "date": date,
        "language": language,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "headline": f"AI 信号日报 · {date}",
        "summary_markdown": summary_markdown,
        "sections": _section_for(stories),
        "stories": stories,
        "edges": _edges_for(stories),
        "fetch_report": fetch_report or {},
        "stats": {
            "story_count": len(stories),
            "source_count": len({story["source"] for story in stories}),
        },
    }
    dated_path = export_dir / f"{date}-{language}.json"
    dated_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    if is_primary:
        (export_dir / "latest.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        cloud_stories = (
            [_story_for(item, language) for item in wordcloud_items]
            if wordcloud_items is not None
            else stories
        )
        cloud = build_wordcloud(cloud_stories, limit=4000)
        (export_dir / "wordcloud.json").write_text(
            json.dumps(cloud, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return dated_path
