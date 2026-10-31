package com.signalweb.android;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.parser.Parser;
import org.jsoup.select.Elements;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;

import javax.net.ssl.HttpsURLConnection;

final class SourceFetcher {
    private final Context context;

    SourceFetcher(Context context) {
        this.context = context.getApplicationContext();
    }

    JSONObject fetchConfiguredSources() throws Exception {
        JSONObject config = new ConfigStore(context).sources().getJSONObject("sources");
        JSONArray items = new JSONArray();
        JSONArray health = new JSONArray();
        JSONArray feeds = config.getJSONArray("rss");
        for (int index = 0; index < feeds.length(); index++) {
            JSONObject feed = feeds.getJSONObject(index);
            if (!feed.optBoolean("enabled", true)) continue;
            String name = feed.getString("name");
            try {
                JSONArray sourceItems = new JSONArray();
                int count = fetchFeed(feed, sourceItems);
                append(items, sourceItems);
                health.put(new JSONObject().put("source", name).put("status", "ok")
                        .put("item_count", count));
            } catch (Exception error) {
                health.put(new JSONObject().put("source", name).put("status", "error")
                        .put("item_count", 0).put("error", error.getMessage()));
            }
        }
        JSONObject googleNews = config.optJSONObject("google_news");
        if (googleNews != null && googleNews.optBoolean("enabled", false)) {
            try {
                String language = googleNews.optString("language", "en");
                String country = googleNews.optString("country", "US");
                String ceid = googleNews.isNull("ceid") ? country + ":" + language
                        : googleNews.getString("ceid");
                if (ceid.trim().isEmpty()) ceid = country + ":" + language;
                String query = googleNews.getString("query") + " when:24h";
                String address = "https://news.google.com/rss/search?q=" + encode(query)
                        + "&hl=" + encode(language) + "&gl=" + encode(country)
                        + "&ceid=" + encode(ceid);
                JSONObject feed = new JSONObject()
                        .put("name", "Google News")
                        .put("url", address)
                        .put("max_items", googleNews.optInt("max_results", 30))
                        .put("category", googleNews.optString("category", ""))
                        .put("profile", googleNews.optString("profile", ""));
                JSONArray sourceItems = new JSONArray();
                int count = fetchFeed(feed, sourceItems, "google_news");
                append(items, sourceItems);
                health.put(new JSONObject().put("source", "Google News").put("status", "ok")
                        .put("item_count", count));
            } catch (Exception error) {
                health.put(new JSONObject().put("source", "Google News").put("status", "error")
                        .put("item_count", 0).put("error", error.getMessage()));
            }
        }
        JSONObject hackerNews = config.optJSONObject("hackernews");
        if (hackerNews != null && hackerNews.optBoolean("enabled", false)) {
            try {
                JSONArray sourceItems = new JSONArray();
                int count = fetchHackerNews(hackerNews, sourceItems);
                append(items, sourceItems);
                health.put(new JSONObject().put("source", "Hacker News").put("status", "ok")
                        .put("item_count", count));
            } catch (Exception error) {
                health.put(new JSONObject().put("source", "Hacker News").put("status", "error")
                        .put("item_count", 0).put("error", error.getMessage()));
            }
        }
        new OptionalSources(this, context).fetch(config, items, health);
        if (health.length() == 0) throw new IllegalStateException("没有启用的新闻源");
        return new JSONObject().put("items", items).put("sources", health);
    }

    private int fetchFeed(JSONObject feed, JSONArray items) throws Exception {
        return fetchFeed(feed, items, "rss");
    }

    private void append(JSONArray destination, JSONArray source) {
        for (int i = 0; i < source.length(); i++) destination.put(source.opt(i));
    }

    private int fetchFeed(JSONObject feed, JSONArray items, String sourceType) throws Exception {
        String feedUrl = feed.getString("url");
        Document xml = Jsoup.parse(fetchText(feedUrl, 5_000_000), feedUrl, Parser.xmlParser());
        Elements entries = xml.select("item, entry");
        if (entries.isEmpty()) throw new IllegalStateException("RSS/Atom 没有条目");
        int limit = feed.optInt("max_items", 10);
        int count = 0;
        for (Element entry : entries) {
            if (count >= limit) break;
            String title = entry.selectFirst("title") == null ? "" : entry.selectFirst("title").text().trim();
            Element linkElement = entry.selectFirst("link[href]");
            if (linkElement == null) linkElement = entry.selectFirst("link");
            String link = linkElement == null ? "" : linkElement.hasAttr("href")
                    ? linkElement.attr("abs:href") : linkElement.text().trim();
            Element dateElement = entry.selectFirst("pubDate, published, updated");
            String published = dateElement == null ? "" : dateElement.text().trim();
            if (title.isEmpty() || link.isEmpty() || published.isEmpty()) continue;
            String publishedIso = parseDate(published);
            String summary = "";
            Element description = entry.selectFirst("description, summary, content");
            if (description != null) summary = Jsoup.parse(description.text()).text();
            JSONObject item = new JSONObject()
                    .put("id", sourceType + ":" + digest(link))
                    .put("title", title)
                    .put("url", link)
                    .put("source", feed.getString("name"))
                    .put("source_type", sourceType)
                    .put("published_at", publishedIso)
                    .put("fetched_at", Instant.now().toString())
                    .put("category", feed.optString("category", ""))
                    .put("profile", feed.optString("profile", ""))
                    .put("content", summary)
                    .put("content_extractor", feed.optString("content_extractor", ""));
            items.put(item);
            count++;
        }
        if (count == 0) throw new IllegalStateException("RSS/Atom 条目缺少标题、链接或可解析日期");
        return count;
    }

    private int fetchHackerNews(JSONObject config, JSONArray items) throws Exception {
        JSONArray ids = new JSONArray(fetchText(
                "https://hacker-news.firebaseio.com/v0/topstories.json", 2_000_000));
        int limit = Math.min(config.optInt("fetch_top_stories", 30), ids.length());
        int minimumScore = config.optInt("min_score", 0);
        int count = 0;
        for (int index = 0; index < limit; index++) {
            long id = ids.getLong(index);
            JSONObject post = new JSONObject(fetchText(
                    "https://hacker-news.firebaseio.com/v0/item/" + id + ".json", 500_000));
            if (!"story".equals(post.optString("type")) || post.optInt("score") < minimumScore) continue;
            String title = post.optString("title");
            if (title.trim().isEmpty()) continue;
            String url = post.optString("url");
            if (url.trim().isEmpty()) continue;
            items.put(new JSONObject()
                    .put("id", "hackernews:story:" + id)
                    .put("title", title)
                    .put("url", url)
                    .put("source", "Hacker News")
                    .put("source_type", "hackernews")
                    .put("published_at", Instant.ofEpochSecond(post.getLong("time")).toString())
                    .put("fetched_at", Instant.now().toString())
                    .put("category", "ai-news")
                    .put("profile", config.optString("profile", "ai-news"))
                    .put("content", Jsoup.parse(post.optString("text", "")).text())
                    .put("metadata", new JSONObject().put("points", post.optInt("score"))));
            count++;
        }
        return count;
    }

    private String parseDate(String value) {
        try { return ZonedDateTime.parse(value, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toString(); }
        catch (Exception ignored) { }
        try { return Instant.parse(value).toString(); }
        catch (Exception ignored) { }
        try { return ZonedDateTime.parse(value).toInstant().toString(); }
        catch (Exception ignored) { }
        throw new IllegalArgumentException("无法解析发布日期：" + value);
    }

    private String digest(String text) throws Exception {
        byte[] hash = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder();
        for (int index = 0; index < 10; index++) hex.append(String.format("%02x", hash[index] & 0xff));
        return hex.toString();
    }

    private String encode(String text) throws Exception {
        return URLEncoder.encode(text, StandardCharsets.UTF_8.toString());
    }

    String fetchText(String address, int maxBytes) throws Exception {
        URL url = new URL(address);
        if (!"https".equalsIgnoreCase(url.getProtocol())) throw new IllegalArgumentException("新闻源地址必须使用 HTTPS");
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(20000);
        connection.setRequestProperty("User-Agent", "SignalWebAndroid/0.1 (+local news reader)");
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("HTTP " + status + "：" + address);
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > maxBytes) throw new IllegalStateException("新闻源响应超过大小限制");
                output.write(buffer, 0, count);
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
            }
        } finally {
            connection.disconnect();
        }
    }
}
