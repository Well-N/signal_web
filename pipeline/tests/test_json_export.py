import json
from datetime import datetime, timezone

from src.export.json_export import export_brief_json
from src.models import (
    ClassificationResult,
    ContentAnalysis,
    ContentArtifact,
    ContentBlock,
    ContentItem,
    ProcessingResult,
    SourceType,
)


def _item() -> ContentItem:
    analysis = ContentAnalysis(
        score=8.4,
        reason="The announcement reports a concrete model release with availability details.",
        summary="A new model was released for developers.",
        tags=["models", "release"],
    )
    artifact = ContentArtifact(
        language="zh",
        title="模型更新",
        blocks=[
            ContentBlock(
                id="summary",
                title="摘要",
                content="模型发布了新的开发者版本。",
                primary=True,
            )
        ],
    )
    return ContentItem(
        id="rss:test:1",
        source_type=SourceType.RSS,
        title="A new developer model",
        url="https://example.com/article",
        content="Original article text.",
        author="Example Team",
        published_at=datetime(2026, 10, 27, tzinfo=timezone.utc),
        metadata={"feed_name": "Example Feed", "category": "ai-news"},
        processing=ProcessingResult(
            classification=ClassificationResult(
                profile="ai-news",
                method="source_override",
            ),
            analysis=analysis,
            artifacts={"zh": artifact},
        ),
    )


def test_export_writes_web_contract(tmp_path):
    result = export_brief_json(
        tmp_path,
        "2026-10-27",
        "zh",
        [_item()],
        "# 日报\n\n内容",
        fetch_report={"status": "success", "attempted": 1},
        is_primary=True,
    )

    data = json.loads(result.read_text(encoding="utf-8"))
    assert data["is_sample"] is False
    assert data["date"] == "2026-10-27"
    assert data["stories"][0]["source"] == "Example Feed"
    assert data["stories"][0]["score"] == 8.4
    assert data["stories"][0]["artifact"]["blocks"][0]["id"] == "summary"
    assert data["sections"][0]["id"] == "top3"
    assert (tmp_path / "export" / "latest.json").exists()
