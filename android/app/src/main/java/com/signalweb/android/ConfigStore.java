package com.signalweb.android;

import android.content.Context;
import android.util.AtomicFile;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

final class ConfigStore {
    private final Context context;

    ConfigStore(Context context) {
        this.context = context.getApplicationContext();
    }

    JSONObject settings() throws Exception {
        File file = new File(context.getFilesDir(), "settings.json");
        if (!file.exists()) {
            return new JSONObject().put("endpoint", "https://api.deepseek.com/v1")
                    .put("model", "deepseek-flash").put("max_stories", 20)
                    .put("pdf_style", "atelier");
        }
        return read(file);
    }

    void saveSettings(String endpoint, String model) throws Exception {
        JSONObject data = settings().put("endpoint", endpoint).put("model", model);
        write(new File(context.getFilesDir(), "settings.json"), data);
    }

    void saveMaxStories(int count) throws Exception {
        if (count < 1 || count > 100) throw new IllegalArgumentException("每次分析条数必须在 1 到 100 之间");
        write(new File(context.getFilesDir(), "settings.json"), settings().put("max_stories", count));
    }

    void savePdfStyle(String style) throws Exception {
        if (!java.util.Arrays.asList("grid", "darkroom", "atelier", "riso").contains(style))
            throw new IllegalArgumentException("未知 PDF 风格：" + style);
        write(new File(context.getFilesDir(), "settings.json"), settings().put("pdf_style", style));
    }

    JSONObject sources() throws Exception {
        File file = new File(context.getFilesDir(), "sources.json");
        if (!file.exists()) {
            try (InputStream input = context.getAssets().open("source-config.json")) {
                JSONObject initial = new JSONObject(readStream(input));
                write(file, initial);
            }
        }
        return read(file);
    }

    void saveSources(JSONObject data) throws Exception {
        write(new File(context.getFilesDir(), "sources.json"), data);
    }

    private JSONObject read(File file) throws Exception {
        AtomicFile atomic = new AtomicFile(file);
        try (InputStream input = atomic.openRead()) {
            return new JSONObject(readStream(input));
        }
    }

    private void write(File file, JSONObject data) throws Exception {
        AtomicFile atomic = new AtomicFile(file);
        FileOutputStream output = atomic.startWrite();
        try {
            output.write(data.toString(2).getBytes(StandardCharsets.UTF_8));
            atomic.finishWrite(output);
        } catch (Exception error) {
            atomic.failWrite(output);
            throw error;
        }
    }

    private String readStream(InputStream input) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) {
            if (bytes.size() + count > 4_000_000) throw new IllegalStateException("配置文件过大");
            bytes.write(buffer, 0, count);
        }
        return new String(bytes.toByteArray(), StandardCharsets.UTF_8);
    }
}
