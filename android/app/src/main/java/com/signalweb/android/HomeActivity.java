package com.signalweb.android;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.graphics.Color;
import android.net.Uri;
import android.text.InputType;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.Switch;
import android.widget.TextView;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public final class HomeActivity extends Activity {
    private static final int CREATE_PDF = 73;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private LinearLayout body;
    private TextView status;
    private ScrollView scroll;
    private JSONObject currentBrief;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(Color.rgb(250, 248, 244));
        int padding = dp(18);
        page.setPadding(padding, padding, padding, padding);
        scroll = new ScrollView(this);
        scroll.addView(page);
        setContentView(scroll);
        TextView title = text(page, "织讯 · 手机本地版", 25);
        title.setTextColor(Color.rgb(20, 32, 58));
        LinearLayout nav = new LinearLayout(this);
        nav.setOrientation(LinearLayout.HORIZONTAL);
        page.addView(nav);
        button(nav, "日报", this::showHome);
        button(nav, "设置", this::showSettings);
        button(nav, "来源", this::showSources);
        status = text(page, "新闻、分析和日报保存在这部手机。", 13);
        status.setPadding(0, dp(8), 0, dp(12));
        body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        page.addView(body);
        showHome();
    }

    private void showHome() {
        status.setText("新闻、分析和日报保存在这部手机。");
        body.removeAllViews();
        heading("日报");
        button(body, "运行一次，生成双语日报", this::runReport);
        button(body, "查看最新日报", this::openLatest);
        button(body, "历史日报", this::showHistory);
        String last = getSharedPreferences("report_schedule", MODE_PRIVATE)
                .getString("last_result", "尚无定时运行记录");
        text(body, "定时运行：" + last, 13);
        String notificationError = getSharedPreferences("report_schedule", MODE_PRIVATE)
                .getString("notification_error", "");
        if (!notificationError.isEmpty()) text(body, "通知状态：" + notificationError, 13);
        text(body, "报告只使用设置中启用的真实新闻源。来源或 AI 出错时会显示原因。", 13);
    }

    private void showSettings() {
        status.setText("在这里设置并测试 DeepSeek 连接。");
        body.removeAllViews();
        heading("DeepSeek 设置");
        try {
            JSONObject saved = new ConfigStore(this).settings();
            EditText endpoint = field("API Base URL", saved.getString("endpoint"), false);
            EditText model = field("模型名", saved.getString("model"), false);
            EditText key = field("API Key（留空沿用已保存的 Key）", "", true);
            button(body, "显示 / 隐藏本次输入的 Key", () -> {
                int type = key.getInputType();
                boolean hidden = (type & InputType.TYPE_TEXT_VARIATION_PASSWORD) != 0;
                key.setInputType(InputType.TYPE_CLASS_TEXT | (hidden ? InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                        : InputType.TYPE_TEXT_VARIATION_PASSWORD));
            });
            EditText limit = field("每次分析条数（1–100）", String.valueOf(saved.optInt("max_stories", 20)), false);
            limit.setInputType(InputType.TYPE_CLASS_NUMBER);
            button(body, "测试连接并保存", () -> {
                String url = endpoint.getText().toString().trim();
                String name = model.getText().toString().trim();
                String provided = key.getText().toString().trim();
                int count;
                try { count = Integer.parseInt(limit.getText().toString().trim()); }
                catch (NumberFormatException error) { status.setText("分析条数必须是整数"); return; }
                status.setText("正在测试 DeepSeek…");
                worker.execute(() -> {
                    try {
                        String secret = provided.isEmpty() ? new KeyVault(this).read() : provided;
                        String answer = new DeepSeekClient().complete(url, name, secret, "Reply with OK.", 64);
                        if (!provided.isEmpty()) new KeyVault(this).save(provided);
                        ConfigStore store = new ConfigStore(this);
                        store.saveSettings(url, name);
                        store.saveMaxStories(count);
                        runOnUiThread(() -> { key.setText(""); status.setText("连接成功，设置已保存：" + answer); });
                    } catch (Exception error) { fail("连接或保存失败", error); }
                });
            });
            text(body, "密钥由手机系统密钥库加密保存，不写入日报或 PDF。", 12);
            heading("X 官方 API");
            EditText xToken = field("X Bearer Token（留空保持已保存的 Token）", "", true);
            button(body, "保存 X Bearer Token", () -> {
                try {
                    String provided = xToken.getText().toString().trim();
                    if (provided.isEmpty()) throw new IllegalArgumentException("请填写 X Bearer Token");
                    new KeyVault(this).saveNamed("x_api", provided);
                    xToken.setText("");
                    status.setText("X Bearer Token 已加密保存到手机");
                } catch (Exception error) { fail("保存 X Bearer Token 失败", error); }
            });
            text(body, "X 来源默认使用官方 API。旧配置的 Playwright 模式也使用官方 API；Apify 模式继续使用下方 Token。", 12);
            heading("X 来源（Apify 模式）");
            EditText apify = field("Apify Token（留空保持已保存的 Token）", "", true);
            button(body, "保存 Apify Token", () -> {
                try {
                    new KeyVault(this).saveNamed("apify", apify.getText().toString().trim());
                    apify.setText("");
                    status.setText("Apify Token 已加密保存到手机");
                } catch (Exception error) { fail("保存 Apify Token 失败", error); }
            });
            heading("定时运行");
            String savedTime = getSharedPreferences("report_schedule", MODE_PRIVATE).getString("time", "08:00");
            EditText time = field("每天开始时间（HH:mm）", savedTime, false);
            button(body, "开启每天运行", () -> schedule(time.getText().toString().trim()));
            button(body, "关闭定时运行", () -> {
                WorkManager.getInstance(this).cancelUniqueWork("daily-report");
                getSharedPreferences("report_schedule", MODE_PRIVATE).edit().remove("time").apply();
                status.setText("已关闭定时运行");
                scroll.post(() -> scroll.fullScroll(View.FOCUS_UP));
            });
            text(body, "Android 可能延后后台任务；完成或失败时间会记录在日报首页。", 12);
            heading("PDF 风格");
            text(body, "当前：" + saved.optString("pdf_style", "atelier"), 13);
            for (String style : new String[]{"grid", "darkroom", "atelier", "riso"}) {
                String label = "grid".equals(style) ? "网格档案" : "darkroom".equals(style)
                        ? "暗房" : "atelier".equals(style) ? "手作工坊" : "孔版印刷";
                button(body, label, () -> {
                    try {
                        new ConfigStore(this).savePdfStyle(style);
                        status.setText("PDF 风格已设为：" + label);
                        scroll.post(() -> scroll.fullScroll(View.FOCUS_UP));
                    } catch (Exception error) { fail("保存 PDF 风格失败", error); }
                });
            }
        } catch (Exception error) { fail("读取设置失败", error); }
    }

    private void schedule(String value) {
        try {
            if (android.os.Build.VERSION.SDK_INT >= 33 &&
                    checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                            != android.content.pm.PackageManager.PERMISSION_GRANTED)
                requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 74);
            LocalTime target = LocalTime.parse(value);
            ZonedDateTime now = ZonedDateTime.now();
            ZonedDateTime next = now.toLocalDate().atTime(target).atZone(ZoneId.systemDefault());
            if (!next.isAfter(now)) next = next.plusDays(1);
            long delay = Duration.between(now, next).toMillis();
            Constraints constraints = new Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED).build();
            PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(ReportWorker.class, 24, TimeUnit.HOURS)
                    .setInitialDelay(delay, TimeUnit.MILLISECONDS)
                    .setConstraints(constraints).build();
            WorkManager.getInstance(this).enqueueUniquePeriodicWork("daily-report",
                    ExistingPeriodicWorkPolicy.UPDATE, request);
            getSharedPreferences("report_schedule", MODE_PRIVATE).edit().putString("time", value).apply();
            status.setText("已安排每天 " + value + " 开始；系统可能延后执行");
            scroll.post(() -> scroll.fullScroll(View.FOCUS_UP));
        } catch (Exception error) { fail("设置定时运行失败", error); }
    }

    private void showSources() {
        status.setText("选择手机需要抓取的真实新闻源。");
        body.removeAllViews();
        heading("新闻来源");
        text(body, "选择需要抓取的真实来源，设置会保存在手机上。", 13);
        try {
            JSONObject sources = new ConfigStore(this).sources();
            JSONObject configured = sources.getJSONObject("sources");
            JSONArray rss = configured.getJSONArray("rss");
            for (int index = 0; index < rss.length(); index++) {
                JSONObject item = rss.getJSONObject(index);
                Switch toggle = new Switch(this);
                toggle.setText(item.getString("name"));
                toggle.setTextSize(14);
                toggle.setPadding(0, dp(8), 0, dp(8));
                toggle.setChecked(item.optBoolean("enabled", true));
                body.addView(toggle);
                toggle.setOnCheckedChangeListener((view, enabled) -> {
                    try {
                        item.put("enabled", enabled);
                        new ConfigStore(this).saveSources(sources);
                        status.setText(item.optString("name") + (enabled ? " 已开启" : " 已关闭"));
                    } catch (Exception error) {
                        toggle.setOnCheckedChangeListener(null);
                        toggle.setChecked(!enabled);
                        fail("保存来源失败", error);
                    }
                });
            }
            for (String name : new String[]{"hackernews", "google_news", "reddit", "telegram", "ossinsight", "gdelt", "twitter", "openbb"}) {
                JSONObject source = configured.optJSONObject(name);
                if (source == null) continue;
                Switch toggle = new Switch(this);
                toggle.setText("hackernews".equals(name) ? "Hacker News" : "google_news".equals(name)
                        ? "Google News 搜索" : "twitter".equals(name)
                        ? "X（" + ("apify".equals(source.optString("mode", "official")) ? "需 Apify Token" : "需 X Bearer Token") + "）"
                        : name + ("openbb".equals(name) ? "（需配置观察名单）" : ""));
                toggle.setChecked(source.optBoolean("enabled", false));
                body.addView(toggle);
                toggle.setOnCheckedChangeListener((view, enabled) -> {
                    try {
                        source.put("enabled", enabled);
                        new ConfigStore(this).saveSources(sources);
                        status.setText(toggle.getText() + (enabled ? " 已开启" : " 已关闭"));
                    } catch (Exception error) {
                        toggle.setOnCheckedChangeListener(null);
                        toggle.setChecked(!enabled);
                        fail("保存来源失败", error);
                    }
                });
            }
            button(body, "财经观察名单", this::showOpenBbEditor);
            button(body, "X 账号与关键词", this::showXEditor);
            button(body, "高级来源配置", this::showSourcesJson);
            sourceCheckButton();
        } catch (Exception error) { fail("读取来源配置失败", error); }
    }

    private void showXEditor() {
        body.removeAllViews();
        button(body, "← 返回来源", this::showSources);
        heading("X 账号与关键词");
        text(body, "每行一个账号或搜索词。需要先在设置页保存 X Bearer Token。", 13);
        try {
            JSONObject sources = new ConfigStore(this).sources();
            JSONObject x = sources.getJSONObject("sources").getJSONObject("twitter");
            EditText users = field("X 账号，每行一个", joinLines(x.getJSONArray("users")), false);
            users.setSingleLine(false);
            users.setMinLines(3);
            EditText keywords = field("搜索词，每行一个", joinLines(x.getJSONArray("keywords")), false);
            keywords.setSingleLine(false);
            keywords.setMinLines(3);
            EditText limit = field("每项最多抓取条数（1–100）",
                    String.valueOf(x.optInt("fetch_limit", 20) > 0 ? x.optInt("fetch_limit", 20) : 20), false);
            limit.setInputType(InputType.TYPE_CLASS_NUMBER);
            Switch replies = new Switch(this);
            replies.setText("抓取热门回复");
            replies.setChecked(x.optBoolean("fetch_reply_text", false));
            body.addView(replies);
            button(body, "保存 X 来源", () -> {
                try {
                    int count = Integer.parseInt(limit.getText().toString().trim());
                    if (count < 1 || count > 100) throw new IllegalArgumentException("抓取条数必须为 1–100");
                    JSONArray accounts = lines(users.getText().toString());
                    JSONArray queries = lines(keywords.getText().toString());
                    if (accounts.length() == 0 && queries.length() == 0)
                        throw new IllegalArgumentException("请填写至少一个 X 账号或搜索词");
                    x.put("users", accounts).put("keywords", queries).put("fetch_limit", count)
                            .put("fetch_reply_text", replies.isChecked()).put("mode", "official")
                            .put("enabled", true);
                    if (replies.isChecked()) {
                        x.put("max_tweets_to_expand", Math.max(1, x.optInt("max_tweets_to_expand", 5)));
                        x.put("max_replies_per_tweet", Math.max(1, x.optInt("max_replies_per_tweet", 3)));
                    }
                    new ConfigStore(this).saveSources(sources);
                    status.setText("X 官方 API 来源已保存");
                    showSources();
                } catch (Exception error) { fail("保存 X 来源失败", error); }
            });
            sourceCheckButton();
        } catch (Exception error) { fail("读取 X 来源失败", error); }
    }

    private String joinLines(JSONArray values) throws Exception {
        StringBuilder joined = new StringBuilder();
        for (int i = 0; i < values.length(); i++) {
            if (i > 0) joined.append('\n');
            joined.append(values.getString(i));
        }
        return joined.toString();
    }

    private JSONArray lines(String value) {
        JSONArray values = new JSONArray();
        for (String line : value.split("\\R")) if (!line.trim().isEmpty()) values.put(line.trim());
        return values;
    }

    private void showOpenBbEditor() {
        body.removeAllViews();
        button(body, "← 返回来源", this::showSources);
        heading("财经观察名单");
        text(body, "每个名单按所选提供方直接抓取；目前支持 Yahoo、Nasdaq 和 TMX。", 13);
        try {
            JSONObject sources = new ConfigStore(this).sources();
            JSONObject openbb = sources.getJSONObject("sources").getJSONObject("openbb");
            JSONArray watchlists = openbb.getJSONArray("watchlists");
            for (int i = 0; i < watchlists.length(); i++) {
                final int position = i;
                JSONObject list = watchlists.getJSONObject(i);
                String label = list.optString("name") + " · " + list.optString("provider") + " · "
                        + list.getJSONArray("symbols").join(", ");
                text(body, label, 14);
                button(body, "删除 " + list.optString("name"), () -> {
                    try {
                        watchlists.remove(position);
                        new ConfigStore(this).saveSources(sources);
                        showOpenBbEditor();
                    } catch (Exception error) { fail("删除观察名单失败", error); }
                });
            }
            button(body, "添加观察名单", () -> {
                LinearLayout form = new LinearLayout(this);
                form.setOrientation(LinearLayout.VERTICAL);
                form.setPadding(dp(18), dp(8), dp(18), dp(8));
                EditText name = formField(form, "名单名称", "");
                EditText symbols = formField(form, "股票代码，用逗号分隔，例如 AAPL, MSFT", "");
                text(form, "数据提供方", 13);
                Spinner provider = new Spinner(this);
                String[] providers = {"yfinance", "nasdaq", "tmx"};
                provider.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, providers));
                form.addView(provider);
                new AlertDialog.Builder(this).setTitle("添加财经观察名单")
                        .setView(form).setNegativeButton("取消", null)
                        .setPositiveButton("保存", (dialog, which) -> {
                            try {
                                String title = name.getText().toString().trim();
                                if (title.isEmpty()) throw new IllegalArgumentException("请填写名单名称");
                                JSONArray tickers = new JSONArray();
                                for (String entry : symbols.getText().toString().split(",")) {
                                    String ticker = entry.trim().toUpperCase(java.util.Locale.ROOT);
                                    if (ticker.isEmpty()) continue;
                                    if (!ticker.matches("[A-Z0-9^.-]{1,20}"))
                                        throw new IllegalArgumentException("股票代码格式错误：" + ticker);
                                    tickers.put(ticker);
                                }
                                if (tickers.length() == 0) throw new IllegalArgumentException("请填写股票代码");
                                watchlists.put(new JSONObject().put("name", title).put("symbols", tickers)
                                        .put("provider", provider.getSelectedItem().toString())
                                        .put("enabled", true).put("fetch_limit", 20)
                                        .put("category", "finance-news").put("profile", "finance-news"));
                                openbb.put("enabled", true);
                                new ConfigStore(this).saveSources(sources);
                                showOpenBbEditor();
                                status.setText("观察名单已保存：" + title);
                            } catch (Exception error) { fail("保存观察名单失败", error); }
                        }).show();
            });
            sourceCheckButton();
        } catch (Exception error) { fail("读取观察名单失败", error); }
    }

    private EditText formField(LinearLayout form, String label, String value) {
        text(form, label, 13);
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setText(value);
        form.addView(input);
        return input;
    }

    private void showSourcesJson() {
        body.removeAllViews();
        button(body, "← 返回来源", this::showSources);
        heading("高级来源配置");
        text(body, "这里编辑完整 JSON，保存前会检查结构。", 13);
        try {
            JSONObject sources = new ConfigStore(this).sources();
            EditText editor = new EditText(this);
            editor.setText(sources.toString(2));
            editor.setTextSize(12);
            editor.setMinLines(14);
            editor.setHorizontallyScrolling(true);
            editor.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
            body.addView(editor, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(360)));
            button(body, "保存来源配置", () -> {
                try {
                    JSONObject value = new JSONObject(editor.getText().toString());
                    JSONObject configured = value.getJSONObject("sources");
                    configured.getJSONArray("rss");
                    value.getJSONObject("processing").getJSONObject("profile_settings");
                    new ConfigStore(this).saveSources(value);
                    status.setText("来源配置已保存到手机");
                } catch (Exception error) { fail("来源配置未保存", error); }
            });
            sourceCheckButton();
        } catch (Exception error) { fail("读取来源配置失败", error); }
    }

    private void sourceCheckButton() {
            button(body, "抓取并检查来源状态", () -> {
                status.setText("正在连接配置的新闻源…");
                scroll.post(() -> scroll.fullScroll(View.FOCUS_UP));
                worker.execute(() -> {
                    try {
                        JSONObject result = new SourceFetcher(this).fetchConfiguredSources();
                        JSONArray health = result.getJSONArray("sources");
                        StringBuilder message = new StringBuilder("抓取到 "
                                + result.getJSONArray("items").length() + " 条。\n");
                        for (int index = 0; index < health.length(); index++) {
                            JSONObject source = health.getJSONObject(index);
                            message.append(source.getString("source")).append("：")
                                    .append(source.getString("status"))
                                    .append(" · ").append(source.optInt("item_count")).append(" 条");
                            if (!"ok".equals(source.getString("status")))
                                message.append(" · ").append(source.optString("error"));
                            message.append("\n");
                        }
                        runOnUiThread(() -> {
                            status.setText(message.toString());
                            scroll.post(() -> scroll.fullScroll(View.FOCUS_UP));
                        });
                    } catch (Exception error) { fail("抓取失败", error); }
                });
            });
    }

    private void runReport() {
        status.setText("正在生成日报…");
        worker.execute(() -> {
            try {
                JSONObject brief = new ReportEngine(this).run(message ->
                        runOnUiThread(() -> status.setText(message)));
                runOnUiThread(() -> showReport(brief));
            } catch (Exception error) { fail("日报生成失败", error); }
        });
    }

    private void openLatest() {
        try {
            JSONArray dates = new BriefStore(this).dates();
            if (dates.length() == 0) { status.setText("手机上还没有日报"); return; }
            showReport(new BriefStore(this).read(dates.getString(0)));
        } catch (Exception error) { fail("打开日报失败", error); }
    }

    private void showHistory() {
        status.setText("选择一份已保存在手机上的日报。");
        body.removeAllViews();
        heading("历史日报");
        EditText query = field("搜索手机上的历史事件", "", false);
        button(body, "搜索事件", () -> searchHistory(query.getText().toString().trim()));
        JSONArray dates = new BriefStore(this).dates();
        if (dates.length() == 0) text(body, "手机上还没有日报", 14);
        for (int index = 0; index < dates.length(); index++) {
            String date = dates.optString(index);
            button(body, date, () -> {
                try { showReport(new BriefStore(this).read(date)); }
                catch (Exception error) { fail("打开日报失败", error); }
            });
        }
    }

    private void searchHistory(String query) {
        if (query.isEmpty()) { status.setText("请填写要搜索的事件名称或关键词"); return; }
        body.removeAllViews();
        button(body, "← 返回历史日报", this::showHistory);
        heading("搜索结果 · " + query);
        try {
            JSONArray dates = new BriefStore(this).dates();
            int matches = 0;
            for (int day = 0; day < dates.length(); day++) {
                JSONObject brief = new BriefStore(this).read(dates.getString(day));
                JSONArray stories = brief.getJSONArray("stories");
                for (int index = 0; index < stories.length(); index++) {
                    JSONObject story = stories.getJSONObject(index);
                    JSONObject bilingual = story.getJSONObject("bilingual");
                    String haystack = story.getString("title") + " "
                            + bilingual.getJSONObject("title").getString("zh") + " "
                            + bilingual.getJSONObject("title").getString("en") + " "
                            + bilingual.getJSONObject("one_liner").getString("zh") + " "
                            + bilingual.getJSONObject("one_liner").getString("en") + " "
                            + story.getJSONArray("tags").toString();
                    if (!haystack.toLowerCase().contains(query.toLowerCase())) continue;
                    matches++;
                    button(body, brief.getString("date") + " · "
                            + bilingual.getJSONObject("title").getString("zh") + "\n"
                            + bilingual.getJSONObject("title").getString("en"),
                            () -> showStory(brief, story));
                }
            }
            if (matches == 0) text(body, "手机上的历史日报没有匹配事件。", 14);
            status.setText("搜索到 " + matches + " 条历史事件");
        } catch (Exception error) { fail("历史搜索失败", error); }
    }

    private void showReport(JSONObject brief) {
        status.setText("已打开 " + brief.optString("date") + " 的日报。");
        currentBrief = brief;
        body.removeAllViews();
        heading(brief.optString("headline"));
        text(body, "生成于 " + brief.optString("generated_at"), 12);
        button(body, "保存为 PDF…", this::exportPdf);
        button(body, "事件关系", () -> showNetwork(brief));
        button(body, "关键词", () -> showWordCloud(brief));
        button(body, "来源与分析状态", () -> showReportStatus(brief));
        text(body, MarkdownText.plain(brief.optString("summary_markdown")), 14);
        try {
            JSONObject fetch = brief.getJSONObject("fetch_report");
            text(body, "来源成功 " + fetch.getInt("successful") + "，失败 " + fetch.getInt("failed"), 12);
            JSONArray failures = brief.optJSONArray("analysis_failures");
            if (failures != null && failures.length() > 0)
                text(body, "AI 分析失败 " + failures.length() + " 条；详情保存在本地日报中。", 12);
            JSONArray stories = brief.getJSONArray("stories");
            heading("事件列表 · " + stories.length());
            for (int index = 0; index < stories.length(); index++) {
                JSONObject story = stories.getJSONObject(index);
                JSONObject title = story.getJSONObject("bilingual").getJSONObject("title");
                button(body, (index + 1) + ". " + title.getString("zh") + "\n"
                        + title.getString("en") + " · " + story.getDouble("score"),
                        () -> showStory(brief, story));
            }
        } catch (Exception error) { fail("日报内容损坏", error); }
    }

    private void showStory(JSONObject brief, JSONObject story) {
        body.removeAllViews();
        button(body, "← 返回日报", () -> showReport(brief));
        try {
            JSONObject bilingual = story.getJSONObject("bilingual");
            heading(bilingual.getJSONObject("title").getString("zh"));
            text(body, bilingual.getJSONObject("title").getString("en"), 16);
            text(body, "评分 " + story.getDouble("score") + " · " + story.getString("source"), 13);
            for (String name : new String[]{"one_liner", "reason", "category"}) {
                JSONObject pair = bilingual.getJSONObject(name);
                heading(name.equals("reason") ? "评分原因" : name.equals("category") ? "分类" : "要点");
                text(body, pair.getString("zh"), 14);
                text(body, pair.getString("en"), 13);
            }
            heading("标签 / Tags");
            JSONArray tags = story.getJSONArray("tags");
            for (int index = 0; index < tags.length(); index++) {
                JSONObject tag = bilingual.getJSONObject("tag." + index);
                text(body, tag.getString("zh") + " / " + tag.getString("en"), 13);
            }
            JSONArray blocks = story.getJSONObject("artifact").getJSONArray("blocks");
            JSONArray evidenceSources = story.getJSONObject("artifact").getJSONArray("sources");
            for (int index = 0; index < blocks.length(); index++) {
                JSONObject detail = blocks.getJSONObject(index);
                String id = detail.getString("id");
                JSONObject title = bilingual.getJSONObject(id + ".title");
                JSONObject content = bilingual.getJSONObject(id + ".content");
                heading(title.getString("zh") + " / " + title.getString("en"));
                text(body, MarkdownText.plain(content.getString("zh")), 14);
                text(body, MarkdownText.plain(content.getString("en")), 13);
                JSONArray refs = detail.optJSONArray("source_refs");
                if (refs != null) for (int refIndex = 0; refIndex < refs.length(); refIndex++) {
                    String ref = refs.getString(refIndex);
                    for (int sourceIndex = 0; sourceIndex < evidenceSources.length(); sourceIndex++) {
                        JSONObject cited = evidenceSources.getJSONObject(sourceIndex);
                        if (!ref.equals(cited.optString("id"))) continue;
                        button(body, "引用：" + cited.getString("title"), () ->
                                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(cited.optString("url")))));
                    }
                }
            }
            heading("原文");
            button(body, story.getString("url"), () -> {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(story.optString("url")));
                startActivity(intent);
            });
            JSONArray related = story.optJSONArray("related_reports");
            if (related != null && related.length() > 0) {
                heading("同一事件的其他报道 / Related reports");
                for (int index = 0; index < related.length(); index++) {
                    JSONObject report = related.getJSONObject(index);
                    JSONObject title = report.getJSONObject("bilingual_title");
                    button(body, title.getString("zh") + "\n" + title.getString("en")
                            + " · " + report.getString("source"), () ->
                            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(report.optString("url")))));
                }
            }
        } catch (Exception error) { fail("事件详情损坏", error); }
    }

    private void showReportStatus(JSONObject brief) {
        body.removeAllViews();
        button(body, "← 返回日报", () -> showReport(brief));
        heading("来源与分析状态");
        try {
            JSONArray sources = brief.getJSONObject("fetch_report").getJSONArray("sources");
            for (int index = 0; index < sources.length(); index++) {
                JSONObject source = sources.getJSONObject(index);
                text(body, source.getString("source") + " · " + source.getString("status")
                        + " · " + source.optInt("item_count") + " 条"
                        + (source.has("error") ? "\n" + source.getString("error") : ""), 13);
            }
            JSONArray below = brief.optJSONArray("below_threshold");
            if (below != null && below.length() > 0) {
                heading("低于分类阈值 · " + below.length());
                for (int index = 0; index < below.length(); index++) {
                    JSONObject item = below.getJSONObject(index);
                    text(body, item.getString("title") + " · " + item.getDouble("score")
                            + " / " + item.getDouble("threshold"), 13);
                }
            }
            JSONArray failures = brief.optJSONArray("analysis_failures");
            if (failures != null && failures.length() > 0) {
                heading("AI 分析失败 · " + failures.length());
                for (int index = 0; index < failures.length(); index++) {
                    JSONObject item = failures.getJSONObject(index);
                    text(body, item.getString("title") + "\n" + item.getString("error"), 13);
                }
            }
        } catch (Exception error) { fail("状态读取失败", error); }
    }

    private void showNetwork(JSONObject brief) {
        body.removeAllViews();
        button(body, "← 返回日报", () -> showReport(brief));
        heading("事件关系");
        try {
            JSONArray stories = brief.getJSONArray("stories");
            GraphView graph = new GraphView(this, brief, story -> showStory(brief, story));
            body.addView(graph, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(360)));
            text(body, "拖动或双指缩放查看关系；点选编号打开事件。节点大小随评分变化，连线表示共同标签。", 12);
            Map<String, String> names = new HashMap<>();
            for (int index = 0; index < stories.length(); index++) {
                JSONObject story = stories.getJSONObject(index);
                names.put(story.getString("id"), story.getJSONObject("bilingual")
                        .getJSONObject("title").getString("zh"));
            }
            JSONArray edges = brief.getJSONArray("edges");
            if (edges.length() == 0) text(body, "这份日报没有共享标签的事件关系。", 13);
            for (int index = 0; index < edges.length(); index++) {
                JSONObject edge = edges.getJSONObject(index);
                text(body, names.get(edge.getString("source")) + "\n ↔ "
                        + names.get(edge.getString("target")) + "\n共同标签："
                        + edge.getString("label"), 13);
            }
            heading("事件列表 · " + stories.length());
            for (int index = 0; index < stories.length(); index++) {
                JSONObject story = stories.getJSONObject(index);
                JSONObject title = story.getJSONObject("bilingual").getJSONObject("title");
                button(body, (index + 1) + ". " + title.getString("zh") + "\n"
                        + title.getString("en") + " · " + story.getDouble("score"),
                        () -> showStory(brief, story));
            }
        } catch (Exception error) { fail("事件关系读取失败", error); }
    }

    private void showWordCloud(JSONObject brief) {
        body.removeAllViews();
        button(body, "← 返回日报", () -> showReport(brief));
        heading("关键词");
        try {
            Map<String, Integer> counts = new HashMap<>();
            JSONArray stories = brief.getJSONArray("stories");
            for (int index = 0; index < stories.length(); index++) {
                JSONArray tags = stories.getJSONObject(index).getJSONArray("tags");
                for (int tag = 0; tag < tags.length(); tag++)
                    counts.merge(tags.getString(tag), 1, Integer::sum);
            }
            if (counts.isEmpty()) text(body, "这份日报没有关键词。", 14);
            else body.addView(new WordCloudView(this, counts),
                    new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.WRAP_CONTENT));
        } catch (Exception error) { fail("关键词读取失败", error); }
    }

    private void exportPdf() {
        if (currentBrief == null) { status.setText("请先打开一份日报"); return; }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/pdf");
        intent.putExtra(Intent.EXTRA_TITLE, "织讯日报-" + currentBrief.optString("date") + ".pdf");
        startActivityForResult(intent, CREATE_PDF);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != CREATE_PDF || resultCode != RESULT_OK || data == null) return;
        Uri uri = data.getData();
        if (uri == null || currentBrief == null) { status.setText("没有选择 PDF 保存位置"); return; }
        JSONObject brief = currentBrief;
        status.setText("正在生成 PDF…");
        worker.execute(() -> {
            try (OutputStream output = getContentResolver().openOutputStream(uri, "w")) {
                if (output == null) throw new IllegalStateException("无法打开所选保存位置");
                String style = new ConfigStore(this).settings().optString("pdf_style", "atelier");
                new PdfExporter(style).write(brief, output);
                runOnUiThread(() -> status.setText("PDF 已保存到所选位置"));
            } catch (Exception error) { fail("PDF 保存失败", error); }
        });
    }

    private void heading(String value) {
        TextView view = text(body, value, 19);
        view.setTextColor(Color.rgb(20, 32, 58));
        view.setPadding(0, dp(17), 0, dp(8));
    }

    private EditText field(String label, String value, boolean password) {
        text(body, label, 13);
        EditText field = new EditText(this);
        field.setSingleLine(true);
        field.setText(value);
        if (password) field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        body.addView(field, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));
        return field;
    }

    private TextView text(LinearLayout parent, String value, int size) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(Color.rgb(51, 61, 75));
        view.setPadding(0, dp(5), 0, dp(5));
        parent.addView(view);
        return view;
    }

    private void button(LinearLayout parent, String label, Runnable action) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        parent.addView(button);
        button.setOnClickListener(view -> action.run());
    }

    private int dp(int value) { return (int) (value * getResources().getDisplayMetrics().density); }

    private void fail(String prefix, Exception error) {
        runOnUiThread(() -> status.setText(prefix + "：" + error.getClass().getSimpleName()
                + "：" + error.getMessage()));
    }

    @Override protected void onDestroy() {
        worker.shutdown();
        super.onDestroy();
    }
}
