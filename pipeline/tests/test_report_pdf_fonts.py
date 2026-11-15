from __future__ import annotations

from pathlib import Path

from reportlab.pdfbase import pdfmetrics

from src.report import pdf


def test_register_face_rejects_unreadable_file(tmp_path: Path) -> None:
    broken = tmp_path / "broken.ttc"
    broken.write_bytes(b"not a font collection")

    assert pdf._register_face("BrokenFace", [broken]) is None
    assert "BrokenFace" not in pdfmetrics.getRegisteredFontNames()


def test_cjk_font_paths_only_return_existing_files() -> None:
    for path in pdf._cjk_font_paths():
        assert path.is_file(), path


def test_register_fonts_still_defines_bold_when_no_face_is_usable(tmp_path, monkeypatch) -> None:
    broken = tmp_path / "broken.ttf"
    broken.write_bytes(b"nope")
    saved = dict(pdfmetrics._fonts)
    try:
        pdfmetrics._fonts.clear()
        monkeypatch.setattr(pdf, "_cjk_font_paths", lambda: [broken])

        pdf._register_fonts()

        names = pdfmetrics.getRegisteredFontNames()
        assert "STSong-Light" in names
        assert "CJK-Bold" in names
    finally:
        pdfmetrics._fonts.clear()
        pdfmetrics._fonts.update(saved)
