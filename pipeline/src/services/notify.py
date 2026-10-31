"""Send the daily signal summary to Feishu or WeCom robot webhooks."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import httpx


CATEGORY_ORDER = (
    ("ai-news", "AI 资讯"),
    ("finance-news", "财经"),
    ("world-news", "世界大事"),
    ("solopreneur", "创业"),
    ("cross-border", "跨境电商"),
)


def _title(raw: dict[str, Any]) -> str:
    artifact = raw.get("artifact") or {}
    value = str(artifact.get("title") or raw.get("title") or "未命名信号").strip()
    value = re.sub(r"\s+", " ", value)
    return value


def _summary(raw: dict[str, Any], limit: int = 190) -> str:
    artifact = raw.get("artifact") or {}
    blocks = artifact.get("blocks") or []
    primary = next(
        (block for block in blocks if block.get("primary") and block.get("content")), None
    )
    first = primary or next((block for block in blocks if block.get("content")), None)
    value = str(
        (first or {}).get("content")
        or raw.get("one_liner")
        or ""
    ).strip()
    value = re.sub(r"\s+", " ", value)
    value = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", value)
    value = re.sub(r"[#*_`>]", "", value).strip()
    if len(value) <= limit:
        return value
    window = value[: limit + 1]
    sentence_end = max(window.rfind(mark) for mark in "。！？!?")
    if sentence_end >= limit // 2:
        return window[: sentence_end + 1]
    return value[: limit - 1].rstrip(" ，,；;") + "…"


def _category_label(raw: dict[str, Any]) -> str:
    labels = dict(CATEGORY_ORDER)
    category = str(raw.get("category") or "")
    profile = str(raw.get("profile") or "")
    return labels.get(category) or labels.get(profile) or "其他动态"


def _digest_markdown(latest: dict[str, Any], pdf_path: Path) -> str:
    stories = sorted(
        latest.get("stories") or [],
        key=lambda item: float(item.get("score") or 0),
        reverse=True,
    )
    total = len(stories)
    sources = int((latest.get("stats") or {}).get("source_count") or 0)
    groups: dict[str, list[dict[str, Any]]] = {
        label: [] for _, label in CATEGORY_ORDER
    }
    groups["其他动态"] = []
    for story in stories:
        groups[_category_label(story)].append(story)

    overview = " · ".join(
        f"{label} {len(groups[label])}"
        for _, label in CATEGORY_ORDER
    )
    lines = [
        f"# 织讯日报 · {latest.get('date') or ''}",
        "",
        f"> 今日收录 **{total}** 条新闻，来自 **{sources}** 个来源。",
        f"> {overview}",
    ]
    for _, label in CATEGORY_ORDER:
        entries = groups[label]
        lines.extend(["", f"## {label} · {len(entries)} 条"])
        if not entries:
            lines.append("今日暂无入选新闻。")
            continue
        for story in entries:
            title = _title(story)
            url = str(story.get("url") or "").strip()
            score = float(story.get("score") or 0)
            heading = f"[{title}]({url})" if url else title
            lines.append(f"**{score:.1f} · {heading}**")
            summary = _summary(story)
            if summary:
                lines.append(summary)
    if groups["其他动态"]:
        lines.extend(["", f"## 其他动态 · {len(groups['其他动态'])} 条"])
        for story in groups["其他动态"]:
            url = str(story.get("url") or "").strip()
            heading = f"[{_title(story)}]({url})" if url else _title(story)
            lines.append(f"**{float(story.get('score') or 0):.1f} · {heading}**")
            summary = _summary(story)
            if summary:
                lines.append(summary)
    lines.extend(["", "---", f"PDF 已归档：{pdf_path.name}"])
    return "\n".join(lines)


def _message(latest: dict[str, Any], pdf_path: Path) -> tuple[dict[str, Any], str]:
    digest = _digest_markdown(latest, pdf_path)
    date = str(latest.get("date") or "")
    feishu_card = {
        "msg_type": "interactive",
        "card": {
            "schema": "2.0",
            "config": {"wide_screen_mode": True},
            "header": {
                "title": {"tag": "plain_text", "content": f"织讯日报 · {date}"},
                "template": "blue",
            },
            "body": {"elements": [{"tag": "markdown", "content": digest}]},
        },
    }
    return feishu_card, digest


def _success(channel: str, response: httpx.Response) -> bool:
    if response.status_code < 200 or response.status_code >= 300:
        return False
    try:
        payload = response.json()
    except (ValueError, json.JSONDecodeError):
        return True
    if not isinstance(payload, dict):
        return True
    if "code" in payload:
        return payload.get("code") == 0
    if "errcode" in payload:
        return payload.get("errcode") == 0
    return True


def send_daily(
    latest: dict[str, Any],
    pdf_path: Path,
    *,
    feishu_url: str | None,
    wecom_url: str | None,
    feishu_enabled: bool,
    wecom_enabled: bool,
) -> dict[str, Any]:
    """Send configured channels; one channel failing never discards the other."""
    feishu_card, wecom_markdown = _message(latest, pdf_path)
    result: dict[str, Any] = {}
    with httpx.Client(timeout=15.0) as client:
        if feishu_enabled:
            if not feishu_url:
                result["feishu"] = {"ok": False, "error": "未配置飞书 Webhook"}
            else:
                try:
                    response = client.post(
                        feishu_url,
                        json=feishu_card,
                    )
                    result["feishu"] = {
                        "ok": _success("feishu", response),
                        "status": response.status_code,
                        **({} if _success("feishu", response) else {"error": response.text[:300]}),
                    }
                except Exception as exc:
                    result["feishu"] = {"ok": False, "error": str(exc)}
        if wecom_enabled:
            if not wecom_url:
                result["wecom"] = {"ok": False, "error": "未配置企业微信 Webhook"}
            else:
                try:
                    response = client.post(
                        wecom_url,
                        json={"msgtype": "markdown", "markdown": {"content": wecom_markdown}},
                    )
                    result["wecom"] = {
                        "ok": _success("wecom", response),
                        "status": response.status_code,
                        **({} if _success("wecom", response) else {"error": response.text[:300]}),
                    }
                except Exception as exc:
                    result["wecom"] = {"ok": False, "error": str(exc)}
    return result
