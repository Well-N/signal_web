import asyncio
import json
import pytest
from src.ai.bilingual import detail_fields, translate_detail


def test_translates_and_normalizes_both_languages():
    async def complete(**kwargs):
        return json.dumps({"title": {"zh": "新聞", "en": "News"}})
    result = asyncio.run(translate_detail(complete, {"title": "News"}))
    assert result == {"title": {"zh": "新闻", "en": "News"}}


@pytest.mark.parametrize("response", [{}, {"title": {"zh": "标题", "en": ""}},
    {"title": {"zh": "标题"}}, {"title": {"zh": "标题", "en": "Title"}, "extra": {}}])
def test_rejects_incomplete_or_unexpected_translations(response):
    async def complete(**kwargs):
        return json.dumps(response)
    with pytest.raises(ValueError):
        asyncio.run(translate_detail(complete, {"title": "Title"}))


def test_all_detail_fields_are_included():
    fields = detail_fields({"title": "Original", "reason": "Reason", "one_liner": "Note",
        "category": "ai-news", "tags": ["models"], "artifact": {"title": "标题",
        "blocks": [{"id": "summary", "title": "摘要", "content": "内容"}]}})
    assert set(fields) == {"title", "reason", "one_liner", "category", "tag.0",
        "summary.title", "summary.content"}
