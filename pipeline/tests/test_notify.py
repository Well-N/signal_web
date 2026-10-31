from pathlib import Path

from src.services.notify import _message


def test_feishu_message_summarizes_news_by_category() -> None:
    latest = {
        "date": "2026-10-29",
        "stats": {"source_count": 2},
        "stories": [
            {
                "title": "English AI title",
                "url": "https://example.com/ai",
                "profile": "ai-news",
                "score": 8,
                "artifact": {
                    "title": "AI 新闻标题",
                    "blocks": [
                        {
                            "id": "summary",
                            "primary": True,
                            "content": "这是 AI 新闻的中文摘要。",
                        }
                    ],
                },
            },
            {
                "title": "财经标题",
                "url": "https://example.com/finance",
                "category": "finance-news",
                "score": 7,
                "one_liner": "财经摘要。",
            },
        ],
    }

    card, markdown = _message(
        latest,
        Path("signalweb-2026-10-29-grid.pdf"),
    )

    assert card["msg_type"] == "interactive"
    assert "## AI 资讯 · 1 条" in markdown
    assert "## 财经 · 1 条" in markdown
    assert "这是 AI 新闻的中文摘要。" in markdown
    assert "财经摘要。" in markdown
    assert "PDF 已归档：signalweb-2026-10-29-grid.pdf" in markdown

