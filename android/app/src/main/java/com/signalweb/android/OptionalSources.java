package com.signalweb.android;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

import java.net.URLEncoder;
import java.net.URL;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import javax.net.ssl.HttpsURLConnection;

/** Optional desktop sources fetched directly by the phone, with separate source status. */
final class OptionalSources {
    private final SourceFetcher http;
    private final Context context;

    OptionalSources(SourceFetcher http, Context context) {
        this.http = http;
        this.context = context.getApplicationContext();
    }

    interface Fetch { int run() throws Exception; }

    void fetch(JSONObject config, JSONArray items, JSONArray health) throws Exception {
        JSONArray github = config.optJSONArray("github");
        if (github != null) for (int i = 0; i < github.length(); i++) {
            JSONObject source = github.getJSONObject(i);
            if (source.optBoolean("enabled", true)) {
                String name = "GitHub " + ("user_events".equals(source.optString("type"))
                        ? source.optString("username") : source.optString("owner") + "/" + source.optString("repo"));
                collect(name, items, health, () -> github(source, items));
            }
        }
        JSONObject reddit = config.optJSONObject("reddit");
        if (reddit != null && reddit.optBoolean("enabled", false)) {
            JSONArray subreddits = reddit.getJSONArray("subreddits");
            for (int i = 0; i < subreddits.length(); i++) {
                JSONObject source = subreddits.getJSONObject(i);
                if (source.optBoolean("enabled", true))
                    collect("Reddit r/" + source.optString("subreddit"), items, health,
                            () -> reddit(source, reddit, false, items));
            }
            JSONArray users = reddit.getJSONArray("users");
            for (int i = 0; i < users.length(); i++) {
                JSONObject source = users.getJSONObject(i);
                if (source.optBoolean("enabled", true))
                    collect("Reddit u/" + source.optString("username"), items, health,
                            () -> reddit(source, reddit, true, items));
            }
        }
        JSONObject twitter = config.optJSONObject("twitter");
        if (twitter != null && twitter.optBoolean("enabled", false)) {
            JSONArray users = twitter.getJSONArray("users");
            if (users.length() > 0) collect("X 用户", items, health,
                    () -> twitter(twitter, "profiles", users, items));
            JSONArray keywords = twitter.getJSONArray("keywords");
            for (int i = 0; i < keywords.length(); i++) {
                String keyword = keywords.getString(i);
                collect("X 搜索 " + keyword, items, health,
                        () -> twitter(twitter, "search", new JSONArray().put(keyword), items));
            }
            if (users.length() == 0 && keywords.length() == 0)
                health.put(new JSONObject().put("source", "X").put("status", "error")
                        .put("item_count", 0).put("error", "未配置 X 用户或关键词"));
        }
        JSONObject openbb = config.optJSONObject("openbb");
        if (openbb != null && openbb.optBoolean("enabled", false)) {
            JSONArray watchlists = openbb.getJSONArray("watchlists");
            if (watchlists.length() == 0) health.put(new JSONObject()
                    .put("source", "OpenBB").put("status", "error").put("item_count", 0)
                    .put("error", "未配置 OpenBB 观察名单"));
            for (int i = 0; i < watchlists.length(); i++) {
                JSONObject watchlist = watchlists.getJSONObject(i);
                if (watchlist.optBoolean("enabled", true))
                    collect("OpenBB " + watchlist.optString("name"), items, health,
                            () -> openbb(watchlist, items));
            }
        }
        JSONObject gdelt = config.optJSONObject("gdelt");
        if (gdelt != null && gdelt.optBoolean("enabled", false))
            collect("GDELT", items, health, () -> gdelt(gdelt, items));
        JSONObject oss = config.optJSONObject("ossinsight");
        if (oss != null && oss.optBoolean("enabled", false)) {
            JSONArray languages = oss.getJSONArray("languages");
            List<JSONObject> ranked = new ArrayList<>();
            for (int i = 0; i < languages.length(); i++) {
                String language = languages.getString(i);
                List<JSONObject> sourceItems = new ArrayList<>();
                collect("OSS Insight " + language, items, health, () -> oss(oss, language, sourceItems));
                if ("ok".equals(health.getJSONObject(health.length() - 1).optString("status")))
                    ranked.addAll(sourceItems);
            }
            ranked.sort((a, b) -> Integer.compare(b.optInt("stars_gained"), a.optInt("stars_gained")));
            Set<String> seen = new HashSet<>();
            int maximum = oss.optInt("max_items", 30);
            for (JSONObject item : ranked) {
                if (seen.add(item.getString("id"))) {
                    items.put(item);
                    if (seen.size() >= maximum) break;
                }
            }
        }
        JSONObject telegram = config.optJSONObject("telegram");
        if (telegram != null && telegram.optBoolean("enabled", false)) {
            JSONArray channels = telegram.getJSONArray("channels");
            for (int i = 0; i < channels.length(); i++) {
                JSONObject channel = channels.getJSONObject(i);
                if (channel.optBoolean("enabled", true))
                    collect("Telegram " + channel.optString("channel"), items, health,
                            () -> telegram(channel, items));
            }
        }
    }

    private void collect(String name, JSONArray items, JSONArray health, Fetch fetch) throws Exception {
        int before = items.length();
        try {
            int count = fetch.run();
            health.put(new JSONObject().put("source", name).put("status", "ok").put("item_count", count));
        } catch (Exception error) {
            while (items.length() > before) items.remove(items.length() - 1);
            health.put(new JSONObject().put("source", name).put("status", "error")
                    .put("item_count", 0).put("error", error.getMessage()));
        }
    }

    private int github(JSONObject source, JSONArray items) throws Exception {
        String type = source.getString("type");
        String path;
        if ("user_events".equals(type)) path = "/users/" + segment(source.getString("username")) + "/events/public";
        else if ("repo_releases".equals(type)) path = "/repos/" + segment(source.getString("owner"))
                + "/" + segment(source.getString("repo")) + "/releases";
        else throw new IllegalArgumentException("不支持的 GitHub 来源类型：" + type);
        JSONArray rows = new JSONArray(http.fetchText("https://api.github.com" + path, 3_000_000));
        Instant since = Instant.now().minus(Duration.ofHours(24));
        int count = 0;
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            String date = "user_events".equals(type) ? row.optString("created_at") : row.optString("published_at");
            if (date.isEmpty() || Instant.parse(date).isBefore(since)) continue;
            String title, url, content, author;
            JSONObject metadata = new JSONObject().put("category", source.optString("category", ""));
            if ("repo_releases".equals(type)) {
                title = source.getString("owner") + "/" + source.getString("repo") + " released " + row.getString("tag_name");
                url = row.getString("html_url");
                content = row.optString("body");
                author = row.getJSONObject("author").getString("login");
                metadata.put("repo", source.getString("owner") + "/" + source.getString("repo"));
                metadata.put("tag", row.getString("tag_name"));
                metadata.put("prerelease", row.optBoolean("prerelease"));
            } else {
                String event = row.getString("type");
                if (!java.util.Arrays.asList("PushEvent", "CreateEvent", "ReleaseEvent", "PublicEvent", "WatchEvent").contains(event)) continue;
                String repo = row.getJSONObject("repo").getString("name");
                JSONObject payload = row.getJSONObject("payload");
                author = source.getString("username");
                url = "https://github.com/" + repo;
                content = "";
                switch (event) {
                    case "PushEvent":
                        JSONArray commits = payload.optJSONArray("commits");
                        int n = commits == null ? 0 : commits.length();
                        title = author + " pushed " + n + " commit(s) to " + repo;
                        for (int c = 0; c < Math.min(3, n); c++) content += commits.getJSONObject(c).optString("message") + "\n";
                        break;
                    case "CreateEvent": title = author + " created " + payload.optString("ref_type", "repository") + " in " + repo;
                        content = payload.optString("description"); break;
                    case "ReleaseEvent":
                        JSONObject release = payload.getJSONObject("release");
                        title = author + " released " + release.optString("tag_name") + " in " + repo;
                        content = release.optString("body"); url = release.optString("html_url", url); break;
                    case "PublicEvent": title = author + " made " + repo + " public"; break;
                    default: title = author + " starred " + repo;
                }
                metadata.put("event_type", event).put("repo", repo);
            }
            items.put(item("github:" + type + ":" + row.getString("id"), "github", title, url,
                    "GitHub " + author, date, content, source, metadata));
            count++;
        }
        return count;
    }

    private int openbb(JSONObject watchlist, JSONArray items) throws Exception {
        String provider = watchlist.optString("provider", "yfinance");
        if (!"yfinance".equals(provider) && !"nasdaq".equals(provider) && !"tmx".equals(provider))
            throw new IllegalStateException("安卓端尚未实现 OpenBB 提供方：" + provider);
        JSONArray symbols = watchlist.getJSONArray("symbols");
        if (symbols.length() == 0) throw new IllegalArgumentException("OpenBB 观察名单没有股票代码");
        int limit = watchlist.optInt("fetch_limit", 20);
        if (limit < 1 || limit > 100) throw new IllegalArgumentException("OpenBB 每次抓取条数必须为 1–100");
        Instant since = Instant.now().minus(Duration.ofHours(24));
        Set<String> seen = new HashSet<>();
        int count = 0;
        for (int symbolIndex = 0; symbolIndex < symbols.length(); symbolIndex++) {
            String symbol = symbols.getString(symbolIndex).trim().toUpperCase(java.util.Locale.ROOT);
            if (!symbol.matches("[A-Z0-9^.-]{1,20}")) throw new IllegalArgumentException("股票代码格式错误：" + symbol);
            if ("nasdaq".equals(provider)) {
                count += nasdaq(watchlist, symbol, limit, since, seen, items);
                continue;
            }
            if ("tmx".equals(provider)) {
                count += tmx(watchlist, symbol, limit, since, seen, items);
                continue;
            }
            String address = "https://query1.finance.yahoo.com/v1/finance/search?q=" + encode(symbol)
                    + "&quotesCount=0&newsCount=" + limit;
            JSONObject payload = new JSONObject(http.fetchText(address, 3_000_000));
            JSONArray news = payload.getJSONArray("news");
            for (int i = 0; i < news.length(); i++) {
                JSONObject row = news.getJSONObject(i);
                JSONArray related = row.optJSONArray("relatedTickers");
                if (related != null) {
                    boolean relevant = false;
                    for (int ticker = 0; ticker < related.length(); ticker++)
                        if (symbol.equalsIgnoreCase(related.optString(ticker))) relevant = true;
                    if (!relevant) continue;
                }
                long published = row.optLong("providerPublishTime");
                if (published <= 0 || Instant.ofEpochSecond(published).isBefore(since)) continue;
                String url = row.optString("link"), title = row.optString("title");
                if (url.isEmpty() || title.isEmpty() || !seen.add(url)) continue;
                JSONObject metadata = new JSONObject().put("watchlist", watchlist.getString("name"))
                        .put("provider", provider).put("symbols", new JSONArray().put(symbol));
                JSONObject article = item("openbb:news:" + row.optString("uuid", url), "openbb",
                        title, url, "OpenBB " + watchlist.getString("name"),
                        Instant.ofEpochSecond(published).toString(), "", watchlist, metadata);
                article.put("content_extractor", "trafilatura");
                items.put(article);
                count++;
            }
        }
        return count;
    }

    private int nasdaq(JSONObject watchlist, String symbol, int limit, Instant since,
                       Set<String> seen, JSONArray items) throws Exception {
        String assetClass = watchlist.optString("asset_class", "stocks");
        if (!java.util.Arrays.asList("stocks", "etf", "index", "mutualfunds", "crypto").contains(assetClass))
            throw new IllegalArgumentException("Nasdaq asset_class 不受支持：" + assetClass);
        String address = "https://api.nasdaq.com/api/news/topic/articlebysymbol?q="
                + encode(symbol + "|" + assetClass) + "&offset=0&limit=" + limit;
        JSONObject response = new JSONObject(http.fetchText(address, 4_000_000));
        if (response.getJSONObject("status").getInt("rCode") != 200)
            throw new IllegalStateException("Nasdaq 新闻接口返回失败状态");
        JSONArray rows = response.getJSONObject("data").getJSONArray("rows");
        int count = 0;
        java.time.format.DateTimeFormatter dateFormat = java.time.format.DateTimeFormatter
                .ofPattern("MMM d, yyyy", java.util.Locale.ENGLISH);
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            String rawDate = row.optString("created");
            Instant published;
            try { published = java.time.LocalDate.parse(rawDate, dateFormat).atStartOfDay(ZoneOffset.UTC).toInstant(); }
            catch (Exception invalid) { continue; }
            if (published.isBefore(since)) continue;
            String title = row.optString("title"), url = row.optString("url");
            if (title.isEmpty() || url.isEmpty()) continue;
            if (url.startsWith("/")) url = "https://www.nasdaq.com" + url;
            if (!seen.add(url)) continue;
            JSONObject meta = new JSONObject().put("watchlist", watchlist.getString("name"))
                    .put("provider", "nasdaq").put("symbols", new JSONArray().put(symbol))
                    .put("topic", row.optString("primarytopic"));
            items.put(item("openbb:news:nasdaq:" + row.optString("id", url), "openbb",
                    title, url, "OpenBB " + watchlist.getString("name"), published.toString(),
                    row.optString("description"), watchlist, meta));
            count++;
        }
        return count;
    }

    private int tmx(JSONObject watchlist, String symbol, int limit, Instant since,
                    Set<String> seen, JSONArray items) throws Exception {
        String normalized = symbol.replace("-", ".").replaceAll("(?i)\\.(TO|TSX)$", "");
        String query = "query getNewsAndEvents($symbol: String!, $page: Int!, $limit: Int!, "
                + "$locale: String!, $companyInNews: Boolean) { news: getNewsForSymbol("
                + "symbol:$symbol,page:$page,limit:$limit,locale:$locale,companyInNews:$companyInNews) "
                + "{ headline datetime source newsid summary } }";
        JSONObject body = new JSONObject().put("operationName", "getNewsAndEvents")
                .put("variables", new JSONObject().put("symbol", normalized).put("page", 1)
                        .put("limit", limit).put("locale", "en"))
                .put("query", query);
        URL url = new URL("https://app-money.tmx.com/graphql");
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("User-Agent", "Mozilla/5.0 SignalWebAndroid/0.2");
        connection.setRequestProperty("Origin", "https://money.tmx.com");
        connection.setRequestProperty("Referer", "https://money.tmx.com/en/quote/" + normalized);
        connection.setRequestProperty("locale", "en");
        try (java.io.OutputStream output = connection.getOutputStream())
        { output.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
        JSONObject response;
        try {
            int status = connection.getResponseCode();
            if (status != 200) throw new IllegalStateException("TMX HTTP " + status);
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int n;
                while ((n = input.read(buffer)) != -1) {
                    if (output.size() + n > 3_000_000) throw new IllegalStateException("TMX 响应过大");
                    output.write(buffer, 0, n);
                }
                response = new JSONObject(new String(output.toByteArray(), StandardCharsets.UTF_8));
            }
        } finally { connection.disconnect(); }
        if (response.has("errors")) throw new IllegalStateException("TMX GraphQL 返回错误："
                + response.getJSONArray("errors").optJSONObject(0).optString("message"));
        JSONArray rows = response.getJSONObject("data").getJSONArray("news");
        int count = 0;
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            Instant published;
            try { published = java.time.OffsetDateTime.parse(row.getString("datetime")).toInstant(); }
            catch (Exception invalid) { continue; }
            if (published.isBefore(since)) continue;
            String title = row.optString("headline"), newsId = row.optString("newsid");
            if (title.isEmpty() || newsId.isEmpty()) continue;
            String articleUrl = "https://money.tmx.com/quote/" + normalized + "/news/" + newsId;
            if (!seen.add(articleUrl)) continue;
            JSONObject meta = new JSONObject().put("watchlist", watchlist.getString("name"))
                    .put("provider", "tmx").put("symbols", new JSONArray().put(normalized));
            items.put(item("openbb:news:tmx:" + newsId, "openbb", title, articleUrl,
                    "OpenBB " + watchlist.getString("name"), published.toString(), "",
                    watchlist, meta));
            count++;
        }
        return count;
    }

    private int reddit(JSONObject source, JSONObject root, boolean user, JSONArray items) throws Exception {
        String name = segment(source.getString(user ? "username" : "subreddit"));
        String sort = segment(source.optString("sort", user ? "new" : "hot"));
        String address = user ? "https://www.reddit.com/user/" + name + "/submitted.json?sort=" + encode(sort)
                : "https://www.reddit.com/r/" + name + "/" + sort + ".json?";
        if (!user && ("top".equals(sort) || "controversial".equals(sort)))
            address += "t=" + encode(source.optString("time_filter", "day")) + "&";
        if (user) address += "&";
        address += "limit=" + Math.min(100, source.optInt("fetch_limit", user ? 10 : 25)) + "&raw_json=1";
        JSONObject response = new JSONObject(http.fetchText(address, 5_000_000));
        JSONArray rows = response.getJSONObject("data").getJSONArray("children");
        Instant since = Instant.now().minus(Duration.ofHours(24));
        int count = 0;
        for (int i = 0; i < rows.length(); i++) {
            JSONObject wrapper = rows.getJSONObject(i);
            if (!"t3".equals(wrapper.optString("kind"))) continue;
            JSONObject post = wrapper.getJSONObject("data");
            long created = (long) post.getDouble("created_utc");
            if (Instant.ofEpochSecond(created).isBefore(since) || post.optInt("score") < source.optInt("min_score", 0)) continue;
            String id = post.getString("id");
            String discussion = "https://www.reddit.com" + post.getString("permalink");
            String url = post.optBoolean("is_self") ? discussion : post.getString("url");
            String content = Jsoup.parse(post.optString("selftext")).text();
            int commentsToFetch = root.optInt("fetch_comments", 0);
            if (commentsToFetch > 0) {
                JSONArray discussionRows = new JSONArray(http.fetchText("https://www.reddit.com/r/"
                        + segment(post.getString("subreddit")) + "/comments/" + segment(id)
                        + ".json?limit=" + commentsToFetch + "&depth=1&sort=top&raw_json=1", 3_000_000));
                JSONArray commentRows = discussionRows.getJSONObject(1).getJSONObject("data").getJSONArray("children");
                List<JSONObject> comments = new ArrayList<>();
                for (int c = 0; c < commentRows.length(); c++) {
                    JSONObject row = commentRows.getJSONObject(c);
                    if ("t1".equals(row.optString("kind")) && !row.getJSONObject("data").optString("body").isEmpty()
                            && !"moderator".equals(row.getJSONObject("data").optString("distinguished")))
                        comments.add(row.getJSONObject("data"));
                }
                comments.sort((a, b) -> Integer.compare(b.optInt("score"), a.optInt("score")));
                StringBuilder discussionText = new StringBuilder();
                for (int c = 0; c < Math.min(commentsToFetch, comments.size()); c++) {
                    JSONObject comment = comments.get(c);
                    discussionText.append("\n\nComment by ").append(comment.optString("author"))
                            .append(" (+").append(comment.optInt("score")).append("): ")
                            .append(comment.getString("body"));
                }
                content += discussionText;
            }
            JSONObject meta = new JSONObject().put("score", post.optInt("score"))
                    .put("subreddit", post.optString("subreddit"))
                    .put("num_comments", post.optInt("num_comments"))
                    .put("discussion_url", discussion);
            items.put(item("reddit:" + (user ? "user:" : "subreddit:") + id, "reddit",
                    post.getString("title"), url, "Reddit " + (user ? "u/" : "r/") + name,
                    Instant.ofEpochSecond(created).toString(), content, source, meta));
            count++;
        }
        return count;
    }

    private int twitter(JSONObject config, String mode, JSONArray inputs, JSONArray items) throws Exception {
        String sourceMode = config.optString("mode", "official");
        if ("official".equals(sourceMode) || "playwright".equals(sourceMode))
            return twitterOfficial(config, mode, inputs, items);
        if (!"apify".equals(sourceMode))
            throw new IllegalStateException("不支持的 X 来源模式：" + sourceMode);
        String token = new KeyVault(context).readNamed("apify");
        if (token == null || token.isEmpty()) throw new IllegalStateException("请先在设置页保存 Apify Token");
        String actor = config.optString("actor_id", "altimis~scweet");
        if (!actor.matches("[A-Za-z0-9_~-]+")) throw new IllegalArgumentException("Apify Actor ID 格式错误");
        JSONObject payload = new JSONObject().put("source_mode", mode).put("search_sort", "Latest")
                .put("max_items", Math.max(100, config.optInt("fetch_limit", 10)));
        if ("profiles".equals(mode)) payload.put("profile_urls", inputs);
        else payload.put("search_query", inputs.getString(0));
        JSONArray rows = apifyRows(actor, token, payload);
        Instant since = Instant.now().minus(Duration.ofHours(24));
        int before = items.length();
        int count = 0;
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            if (row.optBoolean("noResults")) continue;
            String date = row.optString("created_at");
            Instant published;
            try { published = Instant.parse(date); }
            catch (Exception iso) {
                try {
                    java.text.SimpleDateFormat format = new java.text.SimpleDateFormat("EEE MMM dd HH:mm:ss Z yyyy", java.util.Locale.ENGLISH);
                    published = format.parse(date).toInstant();
                } catch (Exception invalid) { continue; }
            }
            if (published.isBefore(since)) continue;
            String id = row.optString("id_str", row.optString("id"));
            if (id.startsWith("tweet-")) id = id.substring(6);
            if (id.isEmpty()) continue;
            JSONObject user = row.optJSONObject("user");
            if (user == null) user = new JSONObject();
            String handle = user.optString("screen_name", user.optString("username",
                    user.optString("handle", row.optString("handle"))));
            if (handle.isEmpty()) continue;
            String content = row.optString("full_text", row.optString("text"));
            if (content.isEmpty()) continue;
            String url = row.optString("url");
            if (url.isEmpty()) url = "https://twitter.com/" + handle + "/status/" + id;
            String shortText = content.replace('\n', ' ');
            if (shortText.length() > 50) shortText = shortText.substring(0, 50) + "...";
            JSONObject meta = new JSONObject().put("tweet_id", id)
                    .put("conversation_id", row.optString("conversation_id", id))
                    .put("favorite_count", row.optInt("favorite_count"))
                    .put("retweet_count", row.optInt("retweet_count"))
                    .put("reply_count", row.optInt("reply_count"));
            items.put(item("twitter:tweet:" + id, "twitter", "@" + handle + ": " + shortText,
                    url, "X @" + handle, published.toString(), content, config, meta));
            count++;
        }
        if (config.optBoolean("fetch_reply_text", false)) {
            int maximum = Math.min(config.optInt("max_tweets_to_expand", 10), items.length() - before);
            for (int i = before; i < before + maximum; i++)
                appendReplies(config, actor, token, items.getJSONObject(i));
        }
        return count;
    }

    private int twitterOfficial(JSONObject config, String mode, JSONArray inputs, JSONArray items) throws Exception {
        String token = new KeyVault(context).readNamed("x_api");
        if (token == null || token.isEmpty()) throw new IllegalStateException("请先在设置页保存 X 官方 API Bearer Token");
        int limit = config.optInt("fetch_limit", 10);
        if (limit < 1 || limit > 100) throw new IllegalArgumentException("X 每项抓取条数必须为 1–100");
        Instant since = Instant.now().minus(Duration.ofHours(24));
        int before = items.length();
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < inputs.length(); i++) {
            String input = inputs.getString(i).trim();
            String query;
            if ("profiles".equals(mode)) {
                String handle = input.replaceFirst("^https?://(www\\.)?(x|twitter)\\.com/", "")
                        .replaceFirst("^@", "").replaceFirst("/.*$", "");
                if (!handle.matches("[A-Za-z0-9_]{1,15}"))
                    throw new IllegalArgumentException("X 用户名格式错误：" + input);
                query = "from:" + handle + " -is:retweet";
            } else {
                if (input.isEmpty() || input.length() > 450)
                    throw new IllegalArgumentException("X 关键词长度必须为 1–450 字符");
                query = input;
            }
            int collected = 0;
            String next = "";
            do {
                JSONObject page = xSearch(query, token, Math.min(100, Math.max(10, limit - collected)),
                        since, next);
                JSONArray rows = page.optJSONArray("data");
                JSONObject authors = xAuthors(page);
                if (rows != null) for (int rowIndex = 0; rowIndex < rows.length(); rowIndex++) {
                    JSONObject row = rows.getJSONObject(rowIndex);
                    String id = row.getString("id");
                    if (!id.matches("[0-9]+") || seen.contains(id)) continue;
                    Instant published = Instant.parse(row.getString("created_at"));
                    if (published.isBefore(since)) continue;
                    String authorId = row.getString("author_id");
                    String handle = authors.optString(authorId);
                    if (!handle.matches("[A-Za-z0-9_]{1,15}"))
                        throw new IllegalStateException("X 响应缺少帖子作者：" + id);
                    String content = row.getString("text");
                    if (content.isEmpty()) continue;
                    String shortText = content.replace('\n', ' ');
                    if (shortText.length() > 50) shortText = shortText.substring(0, 50) + "...";
                    JSONObject metrics = row.optJSONObject("public_metrics");
                    if (metrics == null) metrics = new JSONObject();
                    JSONObject meta = new JSONObject().put("tweet_id", id)
                            .put("conversation_id", row.optString("conversation_id", id))
                            .put("favorite_count", metrics.optInt("like_count"))
                            .put("retweet_count", metrics.optInt("retweet_count"))
                            .put("reply_count", metrics.optInt("reply_count"));
                    items.put(item("twitter:tweet:" + id, "twitter", "@" + handle + ": " + shortText,
                            "https://x.com/" + handle + "/status/" + id, "X @" + handle,
                            published.toString(), content, config, meta));
                    seen.add(id);
                    collected++;
                    if (collected >= limit) break;
                }
                next = page.optJSONObject("meta") == null ? "" : page.getJSONObject("meta").optString("next_token");
            } while (!next.isEmpty() && collected < limit);
        }
        if (config.optBoolean("fetch_reply_text", false)) {
            int maximum = Math.min(config.optInt("max_tweets_to_expand", 10), items.length() - before);
            for (int i = before; i < before + maximum; i++)
                appendOfficialReplies(config, token, items.getJSONObject(i), since);
        }
        return items.length() - before;
    }

    private JSONObject xAuthors(JSONObject page) throws Exception {
        JSONObject authors = new JSONObject();
        JSONObject includes = page.optJSONObject("includes");
        JSONArray users = includes == null ? null : includes.optJSONArray("users");
        if (users != null) for (int i = 0; i < users.length(); i++) {
            JSONObject user = users.getJSONObject(i);
            authors.put(user.getString("id"), user.getString("username"));
        }
        return authors;
    }

    private void appendOfficialReplies(JSONObject config, String token, JSONObject story, Instant since) throws Exception {
        int maximum = config.optInt("max_replies_per_tweet", 3);
        if (maximum <= 0) return;
        JSONObject meta = story.getJSONObject("metadata");
        String conversation = meta.getString("conversation_id");
        if (!conversation.matches("[0-9]+")) throw new IllegalStateException("X 对话 ID 格式错误");
        JSONObject page = xSearch("conversation_id:" + conversation + " is:reply", token, 100, since, "");
        JSONArray rows = page.optJSONArray("data");
        if (rows == null) return;
        JSONObject authors = xAuthors(page);
        List<JSONObject> ranked = new ArrayList<>();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            JSONObject metrics = row.optJSONObject("public_metrics");
            if (metrics == null || metrics.optInt("like_count") < config.optInt("reply_min_likes", 0)) continue;
            String handle = authors.optString(row.optString("author_id"));
            if (handle.isEmpty() || story.optString("source").equalsIgnoreCase("X @" + handle)) continue;
            ranked.add(row);
        }
        ranked.sort((a, b) -> {
            JSONObject am = a.optJSONObject("public_metrics"), bm = b.optJSONObject("public_metrics");
            return Integer.compare(bm.optInt("like_count") * 2 + bm.optInt("reply_count"),
                    am.optInt("like_count") * 2 + am.optInt("reply_count"));
        });
        if (ranked.isEmpty()) return;
        StringBuilder content = new StringBuilder(story.getString("content")).append("\n\n--- Top Comments ---");
        for (int i = 0; i < Math.min(maximum, ranked.size()); i++) {
            JSONObject reply = ranked.get(i);
            JSONObject metrics = reply.getJSONObject("public_metrics");
            String handle = authors.getString(reply.getString("author_id"));
            String text = reply.getString("text");
            content.append("\n[@").append(handle).append(" | ❤️ ").append(metrics.optInt("like_count"))
                    .append(" | 💬 ").append(metrics.optInt("reply_count")).append("] ")
                    .append(text.substring(0, Math.min(280, text.length())));
        }
        story.put("content", content.toString());
    }

    private JSONObject xSearch(String query, String token, int limit, Instant since, String next) throws Exception {
        String url = "https://api.x.com/2/tweets/search/recent?query=" + encode(query)
                + "&start_time=" + encode(since.toString())
                + "&max_results=" + limit
                + "&tweet.fields=created_at,author_id,conversation_id,public_metrics"
                + "&expansions=author_id&user.fields=username";
        if (!next.isEmpty()) url += "&next_token=" + encode(next);
        HttpsURLConnection connection = (HttpsURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setRequestProperty("Accept", "application/json");
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("X 官方 API HTTP " + status);
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int n;
                while ((n = input.read(buffer)) != -1) {
                    if (output.size() + n > 5_000_000) throw new IllegalStateException("X 官方 API 响应过大");
                    output.write(buffer, 0, n);
                }
                JSONObject response = new JSONObject(new String(output.toByteArray(), StandardCharsets.UTF_8));
                JSONArray errors = response.optJSONArray("errors");
                if (errors != null && errors.length() > 0)
                    throw new IllegalStateException("X 官方 API 错误：" + errors.getJSONObject(0).optString("detail"));
                return response;
            }
        } finally { connection.disconnect(); }
    }

    private JSONArray apifyRows(String actor, String token, JSONObject payload) throws Exception {
        JSONObject started = new JSONObject(apify("POST", "/actors/" + actor + "/runs", payload, token))
                .getJSONObject("data");
        String runId = segment(started.getString("id"));
        String datasetId = segment(started.getString("defaultDatasetId"));
        boolean finished = false;
        for (int attempt = 0; attempt < 60; attempt++) {
            JSONObject status = new JSONObject(apify("GET", "/actor-runs/" + runId, null, token))
                    .getJSONObject("data");
            String state = status.getString("status");
            if ("SUCCEEDED".equals(state)) { finished = true; break; }
            if ("FAILED".equals(state) || "ABORTED".equals(state) || "TIMED-OUT".equals(state))
                throw new IllegalStateException("Apify Actor 运行失败：" + state);
            Thread.sleep(3000);
        }
        if (!finished) throw new IllegalStateException("Apify Actor 超过 180 秒仍未完成");
        return new JSONArray(apify("GET", "/datasets/" + datasetId + "/items", null, token));
    }

    private void appendReplies(JSONObject config, String actor, String token, JSONObject story) throws Exception {
        int maximum = config.optInt("max_replies_per_tweet", 3);
        if (maximum <= 0) return;
        JSONObject meta = story.getJSONObject("metadata");
        String conversation = meta.optString("conversation_id");
        if (conversation.isEmpty()) return;
        JSONObject payload = new JSONObject().put("source_mode", "search")
                .put("search_query", "conversation_id:" + conversation)
                .put("search_sort", "Latest").put("max_items", Math.max(100, maximum * 5));
        JSONArray rows = apifyRows(actor, token, payload);
        List<JSONObject> replies = new ArrayList<>();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject reply = rows.getJSONObject(i);
            String id = reply.optString("id_str", reply.optString("id"));
            if (id.startsWith("tweet-")) id = id.substring(6);
            if (id.equals(meta.optString("tweet_id"))) continue;
            String text = reply.optString("full_text", reply.optString("text"));
            if (text.isEmpty() || reply.optInt("favorite_count") < config.optInt("reply_min_likes", 0)) continue;
            JSONObject author = reply.optJSONObject("user");
            if (author == null) author = new JSONObject();
            String handle = author.optString("handle", author.optString("username"));
            if (handle.isEmpty() || story.optString("source").equalsIgnoreCase("X @" + handle)) continue;
            replies.add(reply);
        }
        replies.sort((a, b) -> Integer.compare(b.optInt("favorite_count") * 2 + b.optInt("reply_count"),
                a.optInt("favorite_count") * 2 + a.optInt("reply_count")));
        if (replies.isEmpty()) return;
        StringBuilder content = new StringBuilder(story.optString("content"));
        content.append("\n\n--- Top Comments ---");
        for (int i = 0; i < Math.min(maximum, replies.size()); i++) {
            JSONObject reply = replies.get(i);
            JSONObject author = reply.optJSONObject("user");
            String handle = author == null ? "" : author.optString("handle", author.optString("username"));
            String text = reply.optString("full_text", reply.optString("text"));
            content.append("\n[@").append(handle).append(" | ❤️ ").append(reply.optInt("favorite_count"))
                    .append(" | 💬 ").append(reply.optInt("reply_count")).append("] ")
                    .append(text.substring(0, Math.min(280, text.length())));
        }
        story.put("content", content.toString());
    }

    private String apify(String method, String path, JSONObject body, String token) throws Exception {
        URL url = new URL("https://api.apify.com/v2" + path);
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setRequestProperty("Accept", "application/json");
        if (body != null) {
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            try (java.io.OutputStream output = connection.getOutputStream())
            { output.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
        }
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("Apify HTTP " + status);
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int n;
                while ((n = input.read(buffer)) != -1) {
                    if (output.size() + n > 5_000_000) throw new IllegalStateException("Apify 响应过大");
                    output.write(buffer, 0, n);
                }
                return new String(output.toByteArray(), StandardCharsets.UTF_8);
            }
        } finally { connection.disconnect(); }
    }

    private int gdelt(JSONObject config, JSONArray items) throws Exception {
        String query = config.getString("query").trim();
        if (query.isEmpty()) throw new IllegalArgumentException("GDELT query 不能为空");
        if (!config.isNull("language") && !config.optString("language").isEmpty()) query += " sourcelang:" + config.getString("language");
        if (!config.isNull("country") && !config.optString("country").isEmpty()) query += " sourcecountry:" + config.getString("country");
        String address = "https://api.gdeltproject.org/api/v2/doc/doc?query=" + encode(query)
                + "&mode=" + encode(config.optString("mode", "ArtList")) + "&format=json&maxrecords="
                + config.optInt("max_records", 75) + "&sort=datedesc";
        if (!config.isNull("timespan") && !config.optString("timespan").isEmpty())
            address += "&timespan=" + encode(config.getString("timespan"));
        else {
            address += "&startdatetime=" + gdeltDate(Instant.now().minus(Duration.ofHours(24)))
                    + "&enddatetime=" + gdeltDate(Instant.now());
        }
        JSONObject response = new JSONObject(http.fetchText(address, 4_000_000));
        JSONArray articles = response.optJSONArray("articles");
        if (articles == null) throw new IllegalStateException("GDELT 响应缺少 articles 数组"
                + (response.has("message") ? "：" + response.optString("message") : ""));
        int count = 0;
        for (int i = 0; i < articles.length(); i++) {
            JSONObject row = articles.getJSONObject(i);
            String title = row.optString("title"), url = row.optString("url"), seen = row.optString("seendate");
            if (title.isEmpty() || url.isEmpty() || seen.isEmpty()) continue;
            Instant published;
            try { published = LocalDateTime.parse(seen, java.time.format.DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'"))
                    .toInstant(ZoneOffset.UTC); } catch (Exception invalid) { continue; }
            JSONObject meta = new JSONObject().put("domain", row.optString("domain"))
                    .put("sourcecountry", row.optString("sourcecountry"))
                    .put("language", row.optString("language")).put("query", config.getString("query"));
            items.put(item("gdelt:article:" + seen + ":" + url, "gdelt", title, url,
                    "GDELT", published.toString(), "", config, meta));
            count++;
        }
        return count;
    }

    private int oss(JSONObject config, String language, List<JSONObject> ranked) throws Exception {
        String period = config.optString("period", "past_24_hours");
        JSONObject payload = new JSONObject(http.fetchText("https://api.ossinsight.io/v1/trends/repos?period="
                + encode(period) + "&language=" + encode(language), 4_000_000));
        JSONArray rows = payload.getJSONObject("data").getJSONArray("rows");
        int count = 0;
        JSONArray keywords = config.getJSONArray("keywords");
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            String repo = row.optString("repo_name"), id = row.optString("repo_id");
            if (repo.isEmpty() || id.isEmpty()) continue;
            int stars = row.optInt("stars");
            if (stars < config.optInt("min_stars", 5)) continue;
            if (keywords.length() > 0) {
                String searchable = (repo + " " + row.optString("description") + " " + row.optString("collection_names")).toLowerCase();
                boolean match = false;
                for (int k = 0; k < keywords.length(); k++) if (searchable.contains(keywords.getString(k).toLowerCase())) match = true;
                if (!match) continue;
            }
            String content = "Trending GitHub repo: " + repo + "\nStars gained (" + period + "): " + stars
                    + "\nForks gained: " + row.optInt("forks") + "\nPushes: " + row.optInt("pushes")
                    + "\nPull requests: " + row.optInt("pull_requests") + "\nLanguage: "
                    + row.optString("primary_language", language) + "\n" + row.optString("description");
            JSONObject item = item("ossinsight:trending:" + id, "ossinsight",
                    repo + " (+" + stars + "⭐ " + period + ")", "https://github.com/" + repo,
                    "OSS Insight", Instant.now().toString(), content, config,
                    new JSONObject().put("repo", repo).put("period", period).put("stars_gained", stars));
            item.put("stars_gained", stars);
            ranked.add(item);
            count++;
        }
        return count;
    }

    private int telegram(JSONObject config, JSONArray items) throws Exception {
        String channel = segment(config.getString("channel"));
        Document page = Jsoup.parse(http.fetchText("https://t.me/s/" + channel, 4_000_000), "https://t.me/s/" + channel);
        List<Element> messages = page.select("div.tgme_widget_message[data-post]");
        if (messages.isEmpty()) throw new IllegalStateException("Telegram 频道没有可解析消息");
        int limit = config.optInt("fetch_limit", 20), count = 0;
        Instant since = Instant.now().minus(Duration.ofHours(24));
        for (int i = Math.max(0, messages.size() - limit); i < messages.size(); i++) {
            Element message = messages.get(i);
            Element time = message.selectFirst("time[datetime]");
            Element body = message.selectFirst("div.tgme_widget_message_text.js-message_text");
            if (time == null || body == null) continue;
            Instant published;
            try { published = Instant.parse(time.attr("datetime")); } catch (Exception invalid) { continue; }
            if (published.isBefore(since)) continue;
            String text = body.wholeText().trim();
            if (text.isEmpty()) continue;
            String post = message.attr("data-post");
            String id = post.substring(post.lastIndexOf('/') + 1);
            if (id.isEmpty()) continue;
            String url = "https://t.me/" + channel + "/" + id;
            for (Element link : body.select("a[href]")) {
                String href = link.attr("abs:href");
                if (href.startsWith("https://") && !href.contains("t.me/")) { url = href; break; }
            }
            String title = text.split("\\R\\s*\\R", 2)[0].replace('\n', ' ').trim();
            if (title.length() > 80) title = title.substring(0, 80);
            items.put(item("telegram:" + channel + ":" + id, "telegram", title, url,
                    "Telegram " + channel, published.toString(), text, config,
                    new JSONObject().put("msg_url", "https://t.me/" + channel + "/" + id).put("channel", channel)));
            count++;
        }
        return count;
    }

    private JSONObject item(String id, String type, String title, String url, String source,
                            String published, String content, JSONObject config, JSONObject metadata) throws Exception {
        if (!url.startsWith("https://")) throw new IllegalArgumentException("来源链接必须使用 HTTPS：" + url);
        return new JSONObject().put("id", id).put("source_type", type).put("title", title)
                .put("url", url).put("source", source).put("published_at", published)
                .put("fetched_at", Instant.now().toString()).put("content", content)
                .put("category", config.optString("category", ""))
                .put("profile", config.optString("profile", "")).put("metadata", metadata);
    }

    private String segment(String value) {
        if (!value.matches("[A-Za-z0-9_.-]+")) throw new IllegalArgumentException("来源名称含非法字符：" + value);
        return value;
    }

    private String encode(String value) throws Exception { return URLEncoder.encode(value, StandardCharsets.UTF_8.toString()); }

    private String gdeltDate(Instant value) {
        return java.time.format.DateTimeFormatter.ofPattern("yyyyMMddHHmmss").withZone(ZoneOffset.UTC).format(value);
    }
}
