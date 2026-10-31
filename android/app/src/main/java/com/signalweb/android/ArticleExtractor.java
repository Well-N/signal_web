package com.signalweb.android;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

import java.net.URL;

final class ArticleExtractor {
    String extract(String address) throws Exception {
        URL url = new URL(address);
        if (!"https".equalsIgnoreCase(url.getProtocol()))
            throw new IllegalArgumentException("正文链接必须使用 HTTPS");
        Document page = Jsoup.connect(address)
                .userAgent("SignalWebAndroid/0.1 (+local news reader)")
                .timeout(20000).maxBodySize(5_000_000).followRedirects(true).get();
        if (!"https".equalsIgnoreCase(new URL(page.location()).getProtocol()))
            throw new IllegalStateException("正文重定向到了非 HTTPS 地址");
        String content = "";
        long bestScore = -1;
        for (Element candidate : page.select(".blog-content, .entry, .wp-block-post-content, article, main, [role=main]")) {
            Element cleaned = candidate.clone();
            cleaned.select("script, style, nav, footer, aside, form").remove();
            String text = cleaned.text().trim();
            if (text.length() < 200) continue;
            long score = text.length();
            if (candidate.hasClass("blog-content") || candidate.hasClass("entry")
                    || candidate.hasClass("wp-block-post-content")) score += 100_000;
            else if ("article".equals(candidate.tagName())) score += 50_000;
            if (score > bestScore) { bestScore = score; content = text; }
        }
        if (content.isEmpty())
            throw new IllegalStateException("页面没有可识别的正文结构：" + address);
        return content.substring(0, Math.min(content.length(), 12_000));
    }
}
