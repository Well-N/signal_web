package com.signalweb.android;

import android.content.Context;
import android.util.AtomicFile;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

final class BriefStore {
    private final File directory;

    BriefStore(Context context) {
        directory = new File(context.getFilesDir(), "briefs");
    }

    void save(JSONObject brief) throws Exception {
        if (!directory.exists() && !directory.mkdirs())
            throw new IllegalStateException("无法创建手机本地日报目录");
        String date = brief.getString("date");
        if (!date.matches("\\d{4}-\\d{2}-\\d{2}"))
            throw new IllegalArgumentException("日报日期格式错误");
        AtomicFile file = new AtomicFile(new File(directory, date + ".json"));
        FileOutputStream output = file.startWrite();
        try {
            output.write(brief.toString(2).getBytes(StandardCharsets.UTF_8));
            file.finishWrite(output);
        } catch (Exception error) {
            file.failWrite(output);
            throw error;
        }
    }

    JSONObject read(String date) throws Exception {
        if (!date.matches("\\d{4}-\\d{2}-\\d{2}"))
            throw new IllegalArgumentException("日报日期格式错误");
        AtomicFile file = new AtomicFile(new File(directory, date + ".json"));
        try (InputStream input = file.openRead(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > 20_000_000) throw new IllegalStateException("日报文件过大");
                output.write(buffer, 0, count);
            }
            return new JSONObject(new String(output.toByteArray(), StandardCharsets.UTF_8));
        }
    }

    JSONArray dates() {
        JSONArray dates = new JSONArray();
        File[] files = directory.listFiles((dir, name) -> name.matches("\\d{4}-\\d{2}-\\d{2}\\.json"));
        if (files == null) return dates;
        java.util.Arrays.sort(files, (a, b) -> b.getName().compareTo(a.getName()));
        for (File file : files) dates.put(file.getName().substring(0, 10));
        return dates;
    }
}
