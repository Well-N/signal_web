"""Hallmark-styled daily report PDFs.

Token-led report design for SignalWeb. The three presets share the Cobalt
palette family and use only facts present in latest.json.
"""

from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    BaseDocTemplate,
    CondPageBreak,
    Flowable,
    Frame,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
)


# Hallmark palette tokens. The report keeps the app's cobalt, paper and mist
# roles instead of introducing a second brand system.
TOKENS = {
    "cobalt": "#1028F5",
    "cobalt_mid": "#0B1FBD",
    "cobalt_deep": "#07135F",
    "paper": "#FBFBF6",
    "marble": "#F7F2E9",
    "panel": "#FFFCF6",
    "mist": "#DBE4FF",
    "ink": "#07143E",
    "ink_warm": "#2B2723",
    "ink_muted": "#526078",
    "warm_muted": "#6B655C",
    "rule_cool": "#C7D1EB",
    "rule_warm": "#DDD4C6",
    "rule_dark": "#263777",
    "grid_ink": "#14213D",
    "grid_ink_2": "#26324A",
    "grid_muted": "#5B6478",
    "grid_rule": "#D9DCE4",
    "grid_blue": "#2337D8",
    "grid_red": "#D92D20",
    "dark_bg": "#17120F",
    "dark_panel": "#211A15",
    "dark_ink": "#F2E9DC",
    "dark_ink_2": "#D8CCBA",
    "dark_muted": "#9C8F7D",
    "dark_rule": "#3A3129",
    "dark_amber": "#F0A23C",
    "atelier_bg": "#F3EDE4",
    "atelier_ink": "#2D241E",
    "atelier_ink_2": "#4B3F35",
    "atelier_muted": "#7A6C5E",
    "atelier_rule": "#D8CCBD",
    "atelier_slate": "#6D7488",
    "atelier_card": "#FAF5EC",
    "riso_bg": "#FBF7EE",
    "riso_blue": "#2543B8",
    "riso_blue_2": "#3550C0",
    "riso_muted": "#6B76B0",
    "riso_rule": "#B9C1E8",
    "riso_pink": "#FF2F92",
    "riso_deep": "#1B2C78",
}


def _color(name: str) -> colors.Color:
    return colors.HexColor(TOKENS[name])


@dataclass(frozen=True)
class Palette:
    page_bg: str
    cover_bg: str
    cover_fg: str
    cover_muted: str
    ink: str
    ink_secondary: str
    ink_muted: str
    rule: str
    accent: str
    accent_ink: str
    score: str


@dataclass(frozen=True)
class PdfStyle:
    id: str
    name: str
    label: str
    description: str
    motif: str
    palette: Palette
    cover_rule: str
    serif: str
    serif_bold: str
    mono: str
    cjk_bold: str
    cjk_heading: str
    cover_title_size: float
    page_title_size: float


PDF_STYLES: dict[str, PdfStyle] = {
    "grid": PdfStyle(
        id="grid",
        name="网格档案",
        label="Grid",
        description="白纸、群青与瑞士红，像一张现代主义展册。",
        motif="grid",
        palette=Palette(
            page_bg="paper",
            cover_bg="paper",
            cover_fg="grid_ink",
            cover_muted="grid_muted",
            ink="grid_ink",
            ink_secondary="grid_ink_2",
            ink_muted="grid_muted",
            rule="grid_rule",
            accent="grid_blue",
            accent_ink="paper",
            score="grid_red",
        ),
        cover_rule="grid_rule",
        serif="Times-Roman",
        serif_bold="Times-Bold",
        mono="Courier",
        cjk_bold="CJK-Bold",
        cjk_heading="CJK-Bold",
        cover_title_size=58,
        page_title_size=20,
    ),
    "darkroom": PdfStyle(
        id="darkroom",
        name="暗房",
        label="Darkroom",
        description="暖黑纸、纤维白与一盏琥珀安全灯，安静而克制。",
        motif="darkroom",
        palette=Palette(
            page_bg="dark_bg",
            cover_bg="dark_bg",
            cover_fg="dark_ink",
            cover_muted="dark_muted",
            ink="dark_ink",
            ink_secondary="dark_ink_2",
            ink_muted="dark_muted",
            rule="dark_rule",
            accent="dark_amber",
            accent_ink="dark_bg",
            score="dark_amber",
        ),
        cover_rule="dark_rule",
        serif="Times-Roman",
        serif_bold="Times-Bold",
        mono="Courier",
        cjk_bold="CJK-Bold",
        cjk_heading="CJK-Bold",
        cover_title_size=62,
        page_title_size=20,
    ),
    "atelier": PdfStyle(
        id="atelier",
        name="手作工坊",
        label="Atelier",
        description="亚麻纸、深褐字与石板蓝，像一本安静的造物目录。",
        motif="atelier",
        palette=Palette(
            page_bg="atelier_bg",
            cover_bg="atelier_bg",
            cover_fg="atelier_ink",
            cover_muted="atelier_muted",
            ink="atelier_ink",
            ink_secondary="atelier_ink_2",
            ink_muted="atelier_muted",
            rule="atelier_rule",
            accent="atelier_slate",
            accent_ink="paper",
            score="atelier_slate",
        ),
        cover_rule="atelier_rule",
        serif="Times-Roman",
        serif_bold="Times-Bold",
        mono="Courier",
        cjk_bold="CJK-Bold",
        cjk_heading="CJK",
        cover_title_size=52,
        page_title_size=20,
    ),
    "riso": PdfStyle(
        id="riso",
        name="孔版印刷",
        label="Riso",
        description="蓝墨、荧光粉与错位套印，像一份小出版社的日报。",
        motif="riso",
        palette=Palette(
            page_bg="riso_bg",
            cover_bg="riso_bg",
            cover_fg="riso_blue",
            cover_muted="riso_muted",
            ink="riso_blue",
            ink_secondary="riso_blue_2",
            ink_muted="riso_muted",
            rule="riso_rule",
            accent="riso_pink",
            accent_ink="riso_deep",
            score="riso_deep",
        ),
        cover_rule="riso_rule",
        serif="Times-Roman",
        serif_bold="Times-Bold",
        mono="Courier",
        cjk_bold="CJK-Bold",
        cjk_heading="CJK-Bold",
        cover_title_size=60,
        page_title_size=20,
    ),
}


PROFILE_LABELS = {
    "ai-news": "AI 动态",
    "finance-news": "财经",
    "world-news": "世界大事",
    "solopreneur": "创业",
    "cross-border": "跨境电商",
    "research": "研究论文",
    "tooling": "工具与开源",
    "industry": "行业与政策",
}


def _register_fonts() -> None:
    """Register one CJK face and the Latin editorial faces once."""
    if "CJK" in pdfmetrics.getRegisteredFontNames():
        return

    candidates: list[tuple[Path, int]] = []
    if Path("C:\\Windows\\Fonts\\msyh.ttc").exists():
        candidates.append((Path("C:\\Windows\\Fonts\\msyh.ttc"), 0))
    if Path("/System/Library/Fonts/PingFang.ttc").exists():
        candidates.append((Path("/System/Library/Fonts/PingFang.ttc"), 0))
    if Path("/System/Library/Fonts/Hiragino Sans GB.ttc").exists():
        candidates.append((Path("/System/Library/Fonts/Hiragino Sans GB.ttc"), 0))
    if Path("/System/Library/Fonts/STHeiti Light.ttc").exists():
        candidates.append((Path("/System/Library/Fonts/STHeiti Light.ttc"), 0))
    for path in (
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    ):
        if Path(path).exists():
            candidates.append((Path(path), 0))

    regular: str | None = None
    for path, index in candidates:
        try:
            pdfmetrics.registerFont(TTFont("CJK", str(path), subfontIndex=index))
            regular = "CJK"
            break
        except Exception:
            continue
    if regular is None:
        # CID fallback is still a real CJK face, not invented data.
        pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
        regular = "STSong-Light"

    bold_path = Path("C:\\Windows\\Fonts\\msyhbd.ttc")
    if bold_path.exists():
        try:
            pdfmetrics.registerFont(TTFont("CJK-Bold", str(bold_path), subfontIndex=0))
        except Exception:
            pdfmetrics.registerFont(TTFont("CJK-Bold", str(bold_path)))
    elif candidates:
        pdfmetrics.registerFont(TTFont("CJK-Bold", str(candidates[0][0]), subfontIndex=candidates[0][1]))
    else:
        pdfmetrics.registerFont(UnicodeCIDFont("CJK-Bold"))
    pdfmetrics.registerFontFamily(
        "CJK", normal=regular, bold="CJK-Bold", italic=regular, boldItalic="CJK-Bold"
    )
    pdfmetrics.registerFontFamily(
        "EditorialSerif",
        normal="Times-Roman",
        bold="Times-Bold",
        italic="Times-Italic",
        boldItalic="Times-BoldItalic",
    )


def _clean(text: Any) -> str:
    value = re.sub(r"[`*_#>]+", "", str(text or ""))
    value = re.sub(r"\s+", " ", value).strip()
    return html.escape(value, quote=False)


def _plain(text: Any) -> str:
    return html.unescape(_clean(text))


def _canvas_trim(text: Any, limit: int) -> str:
    value = _plain(text)
    return value if len(value) <= limit else value[: limit - 1].rstrip() + "…"


def _trim(text: str, limit: int) -> str:
    clean = _clean(text)
    if len(clean) <= limit:
        return clean
    cut = clean[:limit].rstrip()
    sentence = max(cut.rfind("。"), cut.rfind("！"), cut.rfind("？"), cut.rfind("."))
    if sentence > int(limit * 0.55):
        cut = cut[: sentence + 1]
    return cut.rstrip("，,；; ") + "…"


def _has_cjk(text: str) -> bool:
    return bool(re.search(r"[\u3400-\u9fff]", text))


def _display_date(iso_value: str | None) -> tuple[str, str]:
    if not iso_value:
        return "", ""
    try:
        value = datetime.fromisoformat(iso_value.replace("Z", "+00:00"))
        if value.tzinfo is not None:
            value = value.astimezone()
        return value.strftime("%Y.%m.%d"), value.strftime("%Y 年 %m 月 %d 日")
    except ValueError:
        return iso_value[:10].replace("-", "."), iso_value[:10]


@dataclass
class Story:
    id: str
    title_zh: str
    title_en: str
    summary: str
    score: float | None
    source: str
    category: str
    tags: list[str]
    published: str


@dataclass
class Report:
    date: str
    date_long: str
    generated: str
    fetched: int | None
    source_count: int
    stories: list[Story]
    sections: list[tuple[str, list[Story]]]
    style: PdfStyle


def _story_for(raw: dict[str, Any]) -> Story:
    artifact = raw.get("artifact") or {}
    blocks = artifact.get("blocks") or []
    summary = next((b.get("content") for b in blocks if b.get("id") == "summary"), None)
    if not summary:
        summary = raw.get("one_liner") or ""
    raw_title = str(artifact.get("title") or "").strip()
    original = str(raw.get("title") or "").strip()
    title_zh = raw_title if raw_title and _has_cjk(raw_title) else original
    title_en = original if original and original != title_zh else ""
    category = PROFILE_LABELS.get(str(raw.get("profile") or ""), str(raw.get("profile") or "AI"))
    published = ""
    try:
        published = datetime.fromisoformat(str(raw.get("published_at") or "").replace("Z", "+00:00")).astimezone().strftime("%m/%d %H:%M")
    except ValueError:
        published = str(raw.get("published_at") or "")[:10]
    return Story(
        id=str(raw.get("id") or ""),
        title_zh=title_zh or "未命名信号",
        title_en=title_en,
        summary=str(summary),
        score=float(raw["score"]) if raw.get("score") is not None else None,
        source=str(raw.get("source") or "未知来源"),
        category=category,
        tags=[str(tag) for tag in (raw.get("tags") or [])[:3]],
        published=published,
    )


def load_report(latest_path: Path, style: PdfStyle) -> Report:
    payload = json.loads(latest_path.read_text(encoding="utf-8"))
    raw_stories = payload.get("stories") or []
    lookup = {str(raw.get("id")): _story_for(raw) for raw in raw_stories}
    date, date_long = _display_date(payload.get("date"))
    generated = ""
    if payload.get("generated_at"):
        try:
            generated = datetime.fromisoformat(str(payload["generated_at"]).replace("Z", "+00:00")).astimezone().strftime("%H:%M")
        except ValueError:
            generated = ""

    sections: list[tuple[str, list[Story]]] = []
    seen: set[str] = set()
    for section in payload.get("sections") or []:
        ids = [str(item) for item in section.get("story_ids") or []]
        group = [lookup[item] for item in ids if item in lookup and item not in seen]
        if not group:
            continue
        title = "今日重点" if section.get("id") == "top3" else str(section.get("title") or "更多信号")
        sections.append((title, group))
        seen.update(item.id for item in group)

    remaining = [story for story in lookup.values() if story.id not in seen]
    if remaining:
        remaining.sort(key=lambda story: story.score or 0, reverse=True)
        sections.append(("更多信号", remaining))

    source_count = int((payload.get("stats") or {}).get("source_count") or len({s.source for s in lookup.values()}))
    fetched = (payload.get("fetch_report") or {}).get("item_count")
    return Report(
        date=date,
        date_long=date_long,
        generated=generated,
        fetched=int(fetched) if isinstance(fetched, (int, float)) else None,
        source_count=source_count,
        stories=list(lookup.values()),
        sections=sections,
        style=style,
    )


def _style(s: PdfStyle, font: str, size: float, leading: float, color: colors.Color, *, bold: bool = False, space_after: float = 0, word_wrap: str = "CJK") -> ParagraphStyle:
    return ParagraphStyle(
        name=f"{s.id}-{font}-{size}-{id(color)}",
        fontName=font,
        fontSize=size,
        leading=leading,
        textColor=color,
        spaceAfter=space_after,
        alignment=TA_LEFT,
        wordWrap=word_wrap,
        splitLongWords=1,
        allowWidows=1,
        allowOrphans=1,
    )


class SectionRule(Flowable):
    def __init__(self, title: str, count: int, report: Report):
        super().__init__()
        self.title = title
        self.count = count
        self.report = report

    def wrap(self, availWidth: float, availHeight: float) -> tuple[float, float]:
        self.width = availWidth
        self.height = 34
        return availWidth, self.height

    def draw(self) -> None:
        s = self.report.style
        p = s.palette
        c = self.canv
        c.saveState()
        c.setFillColor(_color(p.accent))
        c.rect(0, self.height - 17, 36, 2, stroke=0, fill=1)
        c.setFillColor(_color(p.ink))
        c.setFont(s.cjk_heading, 15)
        c.drawString(46, self.height - 22, self.title)
        c.setFillColor(_color(p.ink_muted))
        c.setFont(s.mono, 8)
        c.drawRightString(self.width, self.height - 22, f"{self.count:02d}")
        c.setStrokeColor(_color(p.rule))
        c.setLineWidth(0.6)
        c.line(0, 0, self.width, 0)
        c.restoreState()


class StoryBlock(Flowable):
    def __init__(self, story: Story, report: Report, number: int, featured: bool):
        super().__init__()
        self.story = story
        self.report = report
        self.number = number
        self.featured = featured
        s = report.style
        p = s.palette
        self.title_p = Paragraph(
            _clean(story.title_zh),
            _style(s, s.cjk_heading, 16 if featured else 12.5, 22 if featured else 18, _color(p.ink)),
        )
        self.alt_p = (
            Paragraph(_clean(story.title_en), _style(s, "Times-Italic", 8.5, 11, _color(p.ink_muted), word_wrap="LTR"))
            if story.title_en
            else None
        )
        self.summary_p = Paragraph(
            _trim(story.summary, 620 if featured else 360),
            _style(s, "CJK", 10 if featured else 8.8, 16 if featured else 13.5, _color(p.ink_secondary)),
        )
        meta: list[str] = [f"来源 {story.source}", f"评分 {story.score:.1f}" if story.score is not None else "评分 -"]
        if story.category:
            meta.append(story.category)
        if story.published:
            meta.append(story.published)
        if story.tags:
            meta.append("  ".join(story.tags))
        self.meta_p = Paragraph(
            _clean("    ".join(meta)),
            _style(s, "CJK", 7.2, 10, _color(p.ink_muted)),
        )
        self.text_width = 0.0

    def wrap(self, availWidth: float, availHeight: float) -> tuple[float, float]:
        self.width = availWidth
        self.text_width = availWidth - 64
        parts: list[Paragraph] = [self.title_p]
        if self.alt_p:
            parts.append(self.alt_p)
        parts.extend([self.summary_p, self.meta_p])
        total = 10
        for index, part in enumerate(parts):
            _, height = part.wrap(self.text_width, availHeight)
            total += height + (5 if index in (0, 1) else 7)
        self.height = total
        return availWidth, self.height

    def draw(self) -> None:
        s = self.report.style
        p = s.palette
        c = self.canv
        c.saveState()
        c.setStrokeColor(_color(p.rule))
        c.setLineWidth(0.6)
        c.line(0, self.height - 1, self.width, self.height - 1)
        if self.featured:
            c.setFillColor(_color(p.accent))
            c.rect(0, 2, 3, self.height - 12, stroke=0, fill=1)
        c.setFillColor(_color(p.score))
        c.setFont(s.mono, 8)
        c.drawString(8, self.height - 19, f"{self.number:02d}")
        c.setFont("Times-Bold", 14)
        c.drawString(8, self.height - 38, f"{self.story.score:.1f}" if self.story.score is not None else "-")
        c.setFillColor(_color(p.ink_muted))
        c.setFont("CJK", 6.5)
        c.drawString(8, 18, "信号")
        c.setStrokeColor(_color(p.rule))
        c.line(44, 5, 44, self.height - 12)

        y = self.height - 4
        parts: list[Paragraph] = [self.title_p]
        if self.alt_p:
            parts.append(self.alt_p)
        parts.extend([self.summary_p, self.meta_p])
        for index, part in enumerate(parts):
            _, height = part.wrap(self.text_width, self.height)
            y -= height
            part.drawOn(c, 60, y)
            y -= 5 if index in (0, 1) else 7
        c.restoreState()


class ReportBuilder:
    def __init__(self, report: Report, output: Path):
        self.report = report
        self.output = output
        self.style = report.style
        self.palette = report.style.palette
        self.pagesize = A4
        self.width, self.height = self.pagesize

    def _cover_wordmark(self, canv: canvas.Canvas, fg: str, muted: str) -> None:
        w, h = self.pagesize
        canv.setFillColor(_color(fg))
        canv.setFont("CJK-Bold", 17)
        canv.drawString(48, h - 66, "织讯")
        canv.setFillColor(_color(muted))
        canv.setFont("Times-Roman", 10)
        canv.drawString(83, h - 65, "SignalWeb")
        canv.setFont("CJK", 8)
        canv.drawRightString(w - 48, h - 65, "每日信号")

    def _cover_lead(self, canv: canvas.Canvas, x: float, y: float, width: float, color: str, size: float = 11) -> float:
        lead = f"从 {self.report.fetched} 条抓取内容中筛选出 {len(self.report.stories)} 个信号，覆盖 {self.report.source_count} 个来源。" if self.report.fetched is not None else f"本期收录 {len(self.report.stories)} 个信号，来自 {self.report.source_count} 个来源。"
        style = ParagraphStyle(
            f"cover-lead-{self.style.id}-{x}-{y}",
            fontName="CJK",
            fontSize=size,
            leading=size * 1.55,
            textColor=_color(color),
            wordWrap="CJK",
        )
        paragraph = Paragraph(_clean(lead), style)
        _, height = paragraph.wrap(width, 120)
        paragraph.drawOn(canv, x, y - height)
        return height

    def _cover_top3(
        self,
        canv: canvas.Canvas,
        x: float,
        top: float,
        width: float,
        fg: str,
        muted: str,
        score: str,
        trim: int = 25,
    ) -> None:
        canv.setFillColor(_color(muted))
        canv.setFont("CJK", 8)
        canv.drawString(x, top, "本期重点")
        canv.setStrokeColor(_color(muted))
        canv.setLineWidth(0.6)
        canv.line(x, top - 8, x + width, top - 8)
        for index, story in enumerate(self.report.stories[:3]):
            row_y = top - 30 - index * 29
            canv.setFillColor(_color(muted))
            canv.setFont("Courier", 8)
            canv.drawString(x, row_y, f"{index + 1:02d}")
            canv.setFillColor(_color(fg))
            canv.setFont("CJK-Bold", 10.5)
            canv.drawString(x + 28, row_y, _canvas_trim(story.title_zh, trim))
            canv.setFont("Times-Bold", 9)
            canv.setFillColor(_color(score))
            canv.drawRightString(x + width, row_y, f"{story.score:.1f}" if story.score is not None else "-")

    def _draw_cover(self, canv: canvas.Canvas, _doc: BaseDocTemplate) -> None:
        s = self.report.style
        p = s.palette
        w, h = self.pagesize
        canv.saveState()
        canv.setTitle(f"织讯 · {self.report.date} · AI 信号日报")
        canv.setAuthor("SignalWeb")
        canv.setSubject("每日 AI 信号日报")
        canv.setFillColor(_color(p.cover_bg))
        canv.rect(0, 0, w, h, stroke=0, fill=1)

        if s.motif == "grid":
            field_x = w * 0.58
            canv.setFillColor(_color(p.accent))
            canv.rect(field_x, 0, w - field_x, h, stroke=0, fill=1)
            canv.setFillColor(_color(p.score))
            canv.rect(48, h - 148, 13, 13, stroke=0, fill=1)
            canv.setFillColor(_color(p.cover_fg))
            canv.setFont("Times-Bold", 58)
            canv.drawString(48, h - 292, self.report.date)
            canv.setFont("CJK-Bold", 24)
            canv.drawString(50, h - 336, "AI 信号日报")
            canv.setFillColor(_color(p.cover_muted))
            canv.setFont("CJK", 10)
            canv.drawString(50, h - 360, self.report.date_long)
            self._cover_wordmark(canv, p.cover_fg, p.cover_muted)
            canv.setFillColor(_color(p.accent_ink))
            canv.setFont("CJK", 8)
            canv.drawRightString(w - 48, h - 65, "每日信号")
            self._cover_lead(canv, 50, h - 398, 238, p.cover_muted, 9.5)
            canv.setFillColor(_color(p.accent_ink))
            canv.setFont("CJK", 8)
            canv.setFont("CJK", 8)
            canv.drawString(field_x + 24, h - 66, "本期")
            canv.setFont("Times-Bold", 40)
            canv.drawString(field_x + 24, h - 130, f"{len(self.report.stories):02d}")
            canv.setFont("CJK", 9)
            canv.drawString(field_x + 24, h - 154, "个信号")
            self._cover_top3(
                canv,
                field_x + 24,
                h - 225,
                w - field_x - 48,
                p.accent_ink,
                p.accent_ink,
                p.accent_ink,
                14,
            )
            canv.setFillColor(_color(p.accent_ink))
            canv.setFont("CJK", 8)
            canv.drawString(field_x + 24, 170, f"{self.report.source_count} 个来源")
            canv.drawString(field_x + 24, 154, f"{self.report.generated or '--:--'} 抓取")
        elif s.motif == "darkroom":
            self._cover_wordmark(canv, p.cover_fg, p.cover_muted)
            canv.setFillColor(_color(p.cover_fg))
            canv.setFont("Times-Bold", 62)
            canv.drawString(48, h - 280, self.report.date)
            canv.setFont("CJK-Bold", 22)
            canv.drawString(50, h - 322, "AI 信号日报")
            canv.setFillColor(_color(p.accent))
            canv.rect(48, h - 344, 42, 3, stroke=0, fill=1)
            canv.setFillColor(_color(p.cover_muted))
            canv.setFont("CJK", 9.5)
            canv.drawString(50, h - 366, self.report.date_long)
            self._cover_lead(canv, 50, h - 398, 430, p.cover_muted, 9.5)
            self._cover_top3(canv, 48, h - 470, w - 96, p.cover_fg, p.cover_muted, p.accent)
            canv.setStrokeColor(_color(p.accent))
            canv.setLineWidth(1)
            canv.line(48, 155, w - 48, 155)
            canv.setFont("CJK", 8)
            canv.setFillColor(_color(p.cover_muted))
            canv.drawString(48, 130, "已收录信号")
            canv.drawString(220, 130, "来源")
            canv.drawString(360, 130, "抓取时间")
            canv.setFont("Times-Bold", 22)
            canv.setFillColor(_color(p.cover_fg))
            canv.drawString(48, 99, f"{len(self.report.stories):02d}")
            canv.drawString(220, 99, f"{self.report.source_count:02d}")
            canv.drawString(360, 99, self.report.generated or "--:--")
        elif s.motif == "atelier":
            self._cover_wordmark(canv, p.cover_fg, p.cover_muted)
            canv.setFillColor(_color(p.cover_fg))
            canv.setFont("Times-Roman", 64)
            canv.drawString(48, h - 275, self.report.date)
            canv.setFont("CJK", 22)
            canv.drawString(50, h - 315, "AI 信号日报")
            canv.setFillColor(_color(p.cover_muted))
            canv.setFont("CJK", 9.5)
            canv.drawString(50, h - 338, self.report.date_long)
            self._cover_lead(canv, 50, h - 372, 230, p.cover_muted, 9.5)
            canv.setStrokeColor(_color(p.accent))
            canv.setLineWidth(0.8)
            canv.line(w - 132, 210, w - 132, h - 200)
            canv.setFillColor(_color("atelier_card"))
            canv.rect(w - 280, 290, 170, 150, stroke=0, fill=1)
            canv.setStrokeColor(_color(p.rule))
            canv.setLineWidth(0.6)
            canv.rect(w - 280, 290, 170, 150, stroke=1, fill=0)
            canv.setStrokeColor(_color("atelier_slate"))
            canv.setLineWidth(0.8)
            canv.line(w - 268, 292, w - 268, 438)
            canv.setFillColor(_color(p.cover_muted))
            canv.setFont("CJK", 8)
            canv.drawString(w - 256, 416, "本期重点")
            for index, story in enumerate(self.report.stories[:3]):
                row_y = 390 - index * 30
                canv.setFillColor(_color(p.cover_muted))
                canv.setFont("Times-Roman", 10)
                canv.drawString(w - 256, row_y, f"{index + 1:02d}")
                canv.setFillColor(_color(p.cover_fg))
                canv.setFont("CJK", 7.8)
                canv.drawString(w - 238, row_y, _canvas_trim(story.title_zh, 17))
            canv.setStrokeColor(_color(p.accent))
            canv.setLineWidth(2)
            canv.line(48, 160, w - 48, 160)
            canv.setFont("CJK", 8)
            canv.setFillColor(_color(p.cover_muted))
            canv.drawString(48, 132, "已收录信号")
            canv.drawString(210, 132, "来源")
            canv.drawString(340, 132, "抓取时间")
            canv.setFont("Times-Roman", 22)
            canv.setFillColor(_color(p.cover_fg))
            canv.drawString(48, 100, f"{len(self.report.stories):02d}")
            canv.drawString(210, 100, f"{self.report.source_count:02d}")
            canv.drawString(340, 100, self.report.generated or "--:--")
        else:  # riso
            self._cover_wordmark(canv, p.cover_fg, p.cover_muted)
            canv.setFillColor(_color(p.accent))
            canv.circle(w - 145, h - 255, 116, stroke=0, fill=1)
            canv.setFillColor(_color(p.accent))
            canv.setFont("CJK-Bold", 52)
            canv.drawString(51, h - 296, "AI")
            canv.setFillColor(_color(p.cover_fg))
            canv.setFont("CJK-Bold", 52)
            canv.drawString(48, h - 296, "AI")
            canv.setFont("CJK", 26)
            canv.drawString(50, h - 338, "信号日报")
            canv.setFillColor(_color(p.cover_fg))
            canv.setFont("Times-Roman", 52)
            canv.drawString(48, h - 402, self.report.date)
            self._cover_lead(canv, 50, h - 440, 330, p.cover_muted, 9.2)
            self._cover_top3(canv, 48, h - 510, w - 96, p.cover_fg, p.cover_muted, p.score)
            canv.setFillColor(_color(p.accent))
            canv.rect(48, 84, w - 96, 50, stroke=0, fill=1)
            canv.setFillColor(_color(p.accent_ink))
            canv.setFont("CJK", 8)
            canv.drawString(62, 116, "已收录信号")
            canv.drawString(220, 116, "来源")
            canv.drawString(350, 116, "抓取时间")
            canv.setFont("Times-Bold", 20)
            canv.drawString(62, 92, f"{len(self.report.stories):02d}")
            canv.drawString(220, 92, f"{self.report.source_count:02d}")
            canv.drawString(350, 92, self.report.generated or "--:--")

        canv.restoreState()

    def _draw_body(self, canv: canvas.Canvas, doc: BaseDocTemplate) -> None:
        s = self.report.style
        p = s.palette
        w, h = self.pagesize
        canv.saveState()
        canv.setFillColor(_color(p.page_bg))
        canv.rect(0, 0, w, h, stroke=0, fill=1)
        if s.motif == "darkroom":
            canv.saveState()
            canv.setStrokeColor(_color(p.rule), alpha=0.09)
            canv.setLineWidth(0.35)
            for x in range(48, int(w - 40), 48):
                canv.line(x, 54, x, h - 54)
            for y in range(54, int(h - 54), 48):
                canv.line(48, y, w - 48, y)
            canv.restoreState()
        canv.setFillColor(_color(p.ink))
        canv.setFont("CJK-Bold", 9)
        canv.drawString(48, h - 34, "织讯")
        canv.setFont("Times-Roman", 8)
        canv.setFillColor(_color(p.ink_muted))
        canv.drawString(77, h - 34, "SignalWeb")
        canv.drawRightString(w - 48, h - 34, self.report.date)
        canv.setStrokeColor(_color(p.rule))
        canv.setLineWidth(0.6)
        canv.line(48, h - 45, w - 48, h - 45)
        canv.line(48, 38, w - 48, 38)
        canv.setFont("CJK", 7.4)
        canv.setFillColor(_color(p.ink_muted))
        canv.drawString(48, 22, "每日信号")
        canv.drawRightString(w - 48, 22, f"{doc.page - 1:02d}")
        canv.restoreState()

    def build(self) -> None:
        _register_fonts()
        s = self.report.style
        cover_frame = Frame(0, 0, self.width, self.height, id="cover", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        body_frame = Frame(48, 54, self.width - 96, self.height - 54 - 70, id="body", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        doc = BaseDocTemplate(
            str(self.output),
            pagesize=self.pagesize,
            title=f"织讯 · {self.report.date} · AI 信号日报",
            author="SignalWeb",
            leftMargin=48,
            rightMargin=48,
            topMargin=70,
            bottomMargin=54,
        )
        doc.addPageTemplates([
            PageTemplate(id="cover", frames=[cover_frame], onPage=self._draw_cover),
            PageTemplate(id="body", frames=[body_frame], onPage=self._draw_body),
        ])

        story: list[Flowable] = [NextPageTemplate("cover"), Spacer(1, 1), NextPageTemplate("body"), PageBreak()]
        number = 1
        for section_index, (title, stories) in enumerate(self.report.sections):
            if section_index:
                story.append(CondPageBreak(260))
                story.append(Spacer(1, 18))
            story.append(SectionRule(title, len(stories), self.report))
            story.append(Spacer(1, 4))
            for item_index, item in enumerate(stories):
                story.append(StoryBlock(item, self.report, number, number <= 3))
                number += 1
                if item_index != len(stories) - 1:
                    story.append(Spacer(1, 12))
        doc.build(story)


def generate_report_pdf(latest_path: Path, output_dir: Path, style_id: str) -> Path:
    """Generate one PDF and return its path. Raises when the preset is unknown."""
    style = PDF_STYLES.get(style_id)
    if style is None:
        raise ValueError(f"未知 PDF 风格: {style_id}")
    report = load_report(latest_path, style)
    output_dir = Path(output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    date_slug = report.date.replace(".", "-")
    output = output_dir / f"signalweb-{date_slug}-{style.id}.pdf"
    ReportBuilder(report, output).build()
    return output
