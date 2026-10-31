"""Build the word cloud payload from the selected stories.

Weight of a term = sum over stories of (term frequency in that story x story score).
"""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

import jieba

STOPWORDS = {
    # Chinese
    "的", "了", "是", "在", "和", "与", "及", "或", "也", "就", "都", "而", "被", "把", "对",
    "一个", "一种", "我们", "他们", "它们", "这个", "那个", "这些", "那些", "自己", "因为",
    "所以", "但是", "如果", "没有", "什么", "怎么", "可以", "已经", "以及", "并且", "同时",
    "其中", "通过", "进行", "表示", "认为", "目前", "现在", "今天", "今年", "去年", "相关",
    "内容", "问题", "情况", "方面", "更多", "包括", "关于", "不是", "还是", "还有", "这样",
    "数据", "材料", "结果", "文章", "时间", "团队", "评论者", "快照", "渠道", "设计", "公司", "说明", "现有", "独立", "直接", "具体", "是否", "因此", "确认", "提供", "无法", "需要", "可能", "表示", "认为", "目前", "已经", "相关", "包括", "关于", "以下", "以上", "各种", "不同", "主要", "重要", "进行", "使用", "采用", "发布", "宣布", "报道", "指出", "提到", "显示", "根据", "方面", "情况",
    "那样", "需要", "可能", "应该", "已经", "正在", "将", "会", "要", "让", "从", "到", "向",
    # English
    "the", "and", "for", "with", "that", "this", "from", "are", "was", "were", "has", "have",
    "had", "been", "will", "would", "can", "could", "should", "its", "their", "they", "them",
    "you", "your", "our", "not", "but", "his", "her", "she", "him", "who", "what", "when",
    "where", "which", "into", "than", "then", "there", "these", "those", "such", "also", "more",
    "most", "some", "any", "all", "one", "two", "new", "now", "just", "about", "after", "over",
    "under", "between", "per", "via", "how", "why", "may", "might", "must", "say", "says",
    "said", "according", "report", "reports", "reported", "article", "news", "today", "week",
    "year", "first", "last", "next", "make", "made", "use", "used", "using", "get", "got",
}

TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9.+#-]{2,}|[\u4e00-\u9fff]{2,}")
URL_RE = re.compile(r"https?://\S+")
MARKUP_RE = re.compile(r"[*_#>`\[\]()]+")


def _story_text(story: dict[str, Any]) -> str:
    parts = [str(story.get("title") or ""), str(story.get("one_liner") or "")]
    artifact = story.get("artifact") or {}
    for block in artifact.get("blocks") or []:
        parts.append(str(block.get("content") or ""))
    parts.extend(str(tag) for tag in story.get("tags") or [])
    return " ".join(parts)


def _terms(text: str) -> list[str]:
    clean = URL_RE.sub(" ", text)
    clean = MARKUP_RE.sub(" ", clean)
    out: list[str] = []
    for chunk in clean.split():
        if TOKEN_RE.fullmatch(chunk):
            out.append(chunk)
            continue
        for piece in jieba.cut(chunk):
            piece = piece.strip()
            if piece and TOKEN_RE.fullmatch(piece):
                out.append(piece)
    result = []
    for term in out:
        if re.fullmatch(r"[A-Za-z][A-Za-z0-9.+#-]{2,}", term):
            term = term.rstrip(".")
        lower = term.lower()
        if lower in STOPWORDS or term in STOPWORDS:
            continue
        if len(term) > (24 if term[0].isascii() else 8):
            continue
        if len(term) >= 4 and term.endswith(("的", "了", "着", "把", "这", "那", "是")):
            continue
        if len(term) < 2 or term.isdigit():
            continue
        result.append(term)
    return result


def build_wordcloud(
    stories: list[dict[str, Any]], limit: int | None = None
) -> dict[str, Any]:
    scores: dict[str, float] = defaultdict(float)
    counts: dict[str, int] = defaultdict(int)
    display: dict[str, str] = {}

    for story in stories:
        weight = float(story.get("score") or 0)
        if weight <= 0:
            continue
        terms = _terms(_story_text(story))
        freq: dict[str, int] = defaultdict(int)
        for term in terms:
            key = term.lower()
            display.setdefault(key, term)
            freq[key] += 1
        for key, count in freq.items():
            scores[key] += count * weight
            counts[key] += count

    ranked = sorted(
        scores.items(), key=lambda item: (item[1], counts[item[0]], item[0]), reverse=True
    )
    if limit is not None:
        ranked = ranked[:limit]
    words = [
        {
            "text": display.get(key, key),
            "weight": round(value, 2),
            "count": counts[key],
        }
        for key, value in ranked
    ]
    return {"words": words, "stories": len(stories)}

