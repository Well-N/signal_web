package com.signalweb.android;

import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.pdf.PdfDocument;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;

final class PdfExporter {
    private static final int WIDTH = 595;
    private static final int HEIGHT = 842;
    private static final int MARGIN = 42;
    private final int paper;
    private final int ink;

    PdfExporter(String style) {
        switch (style) {
            case "grid":
                paper = Color.WHITE;
                ink = Color.rgb(19, 43, 83);
                break;
            case "darkroom":
                paper = Color.rgb(24, 24, 27);
                ink = Color.rgb(244, 237, 223);
                break;
            case "atelier":
                paper = Color.rgb(250, 247, 239);
                ink = Color.rgb(58, 43, 31);
                break;
            case "riso":
                paper = Color.rgb(253, 249, 237);
                ink = Color.rgb(36, 70, 150);
                break;
            default: throw new IllegalArgumentException("未知 PDF 风格：" + style);
        }
    }

    void write(JSONObject brief, OutputStream output) throws Exception {
        PdfDocument document = new PdfDocument();
        try {
            Writer writer = new Writer(document, paper, ink);
            writer.line(brief.getString("headline"), 20, true);
            writer.line("生成时间 " + brief.getString("generated_at"), 10, false);
            writer.gap(12);
            writer.paragraph(MarkdownText.plain(brief.getString("summary_markdown")), 11);
            writer.gap(16);
            JSONArray stories = brief.getJSONArray("stories");
            for (int index = 0; index < stories.length(); index++) {
                JSONObject story = stories.getJSONObject(index);
                JSONObject bilingual = story.getJSONObject("bilingual");
                writer.line((index + 1) + ". " + bilingual.getJSONObject("title").getString("zh"), 14, true);
                writer.line(bilingual.getJSONObject("title").getString("en"), 11, false);
                writer.line("评分 " + story.getDouble("score") + " · " + story.getString("source"), 10, false);
                writer.paragraph(bilingual.getJSONObject("one_liner").getString("zh"), 11);
                writer.paragraph(bilingual.getJSONObject("one_liner").getString("en"), 10);
                writer.line("评分原因 / Score rationale", 10, true);
                writer.paragraph(bilingual.getJSONObject("reason").getString("zh"), 10);
                writer.paragraph(bilingual.getJSONObject("reason").getString("en"), 10);
                writer.line("分类 / Category", 10, true);
                writer.line(bilingual.getJSONObject("category").getString("zh") + " / "
                        + bilingual.getJSONObject("category").getString("en"), 10, false);
                JSONArray tags = story.getJSONArray("tags");
                if (tags.length() > 0) {
                    writer.line("标签 / Tags", 10, true);
                    for (int tag = 0; tag < tags.length(); tag++) {
                        JSONObject pair = bilingual.getJSONObject("tag." + tag);
                        writer.line(pair.getString("zh") + " / " + pair.getString("en"), 10, false);
                    }
                }
                JSONObject artifact = story.getJSONObject("artifact");
                JSONArray blocks = artifact.getJSONArray("blocks");
                JSONArray citedSources = artifact.getJSONArray("sources");
                for (int blockIndex = 0; blockIndex < blocks.length(); blockIndex++) {
                    JSONObject block = blocks.getJSONObject(blockIndex);
                    String id = block.getString("id");
                    writer.line(bilingual.getJSONObject(id + ".title").getString("zh") + " / "
                            + bilingual.getJSONObject(id + ".title").getString("en"), 11, true);
                    writer.paragraph(MarkdownText.plain(bilingual.getJSONObject(id + ".content").getString("zh")), 10);
                    writer.paragraph(MarkdownText.plain(bilingual.getJSONObject(id + ".content").getString("en")), 10);
                    JSONArray refs = block.optJSONArray("source_refs");
                    if (refs != null) for (int refIndex = 0; refIndex < refs.length(); refIndex++) {
                        String ref = refs.getString(refIndex);
                        for (int sourceIndex = 0; sourceIndex < citedSources.length(); sourceIndex++) {
                            JSONObject cited = citedSources.getJSONObject(sourceIndex);
                            if (ref.equals(cited.getString("id")))
                                writer.paragraph("[" + ref + "] " + cited.getString("title") + " — "
                                        + cited.getString("url"), 9);
                        }
                    }
                }
                writer.paragraph(story.getString("url"), 9);
                JSONArray related = story.optJSONArray("related_reports");
                if (related != null && related.length() > 0) {
                    writer.line("同一事件的其他报道 / Related reports", 10, true);
                    for (int reportIndex = 0; reportIndex < related.length(); reportIndex++) {
                        JSONObject report = related.getJSONObject(reportIndex);
                        JSONObject title = report.getJSONObject("bilingual_title");
                        writer.line(title.getString("zh") + " / " + title.getString("en"), 10, false);
                        writer.paragraph(report.getString("url"), 9);
                    }
                }
                writer.gap(15);
            }
            writer.finish();
            document.writeTo(output);
        } finally {
            document.close();
        }
    }

    private static final class Writer {
        final PdfDocument document;
        final int paper;
        final int ink;
        final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        PdfDocument.Page page;
        Canvas canvas;
        int y;
        int pageNumber = 0;

        Writer(PdfDocument document, int paper, int ink) {
            this.document = document;
            this.paper = paper;
            this.ink = ink;
            newPage();
        }

        void newPage() {
            if (page != null) document.finishPage(page);
            page = document.startPage(new PdfDocument.PageInfo.Builder(WIDTH, HEIGHT, ++pageNumber).create());
            canvas = page.getCanvas();
            canvas.drawColor(paper);
            y = MARGIN;
        }

        void line(String text, int size, boolean bold) {
            paint.setColor(ink);
            paint.setTextSize(size);
            paint.setTypeface(bold ? Typeface.create(Typeface.DEFAULT, Typeface.BOLD) : Typeface.DEFAULT);
            int lineHeight = size + 6;
            String remaining = text == null ? "" : text;
            if (remaining.isEmpty()) { gap(lineHeight); return; }
            while (!remaining.isEmpty()) {
                int length = paint.breakText(remaining, true, WIDTH - 2 * MARGIN, null);
                if (length < 1) throw new IllegalStateException("PDF 文字无法排版");
                if (length < remaining.length()) {
                    int space = remaining.lastIndexOf(' ', length - 1);
                    if (space > length / 2) length = space;
                }
                if (y + lineHeight > HEIGHT - MARGIN) newPage();
                canvas.drawText(remaining.substring(0, length).trim(), MARGIN, y + size, paint);
                y += lineHeight;
                remaining = remaining.substring(length).trim();
            }
        }

        void paragraph(String text, int size) {
            String[] lines = text.replace("\r", "").split("\n", -1);
            for (String line : lines) line(line, size, false);
            gap(5);
        }

        void gap(int pixels) {
            y += pixels;
            if (y > HEIGHT - MARGIN) newPage();
        }

        void finish() {
            document.finishPage(page);
            page = null;
        }
    }
}
