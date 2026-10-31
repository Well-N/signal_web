package com.signalweb.android;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import javax.net.ssl.HttpsURLConnection;

final class DeepSeekClient {
    String complete(String endpoint, String model, String apiKey, String prompt, int maxTokens)
            throws Exception {
        return complete(endpoint, model, apiKey, "You are a careful news analyst.", prompt, maxTokens);
    }

    String complete(String endpoint, String model, String apiKey, String system,
                    String prompt, int maxTokens) throws Exception {
        return complete(endpoint, model, apiKey, system, prompt, maxTokens, false);
    }

    String complete(String endpoint, String model, String apiKey, String system,
                    String prompt, int maxTokens, boolean jsonMode) throws Exception {
        if (apiKey == null || apiKey.trim().isEmpty()) throw new IllegalArgumentException("请先填写 API Key");
        if (model == null || model.trim().isEmpty()) throw new IllegalArgumentException("模型名不能为空");
        String base = endpoint == null ? "" : endpoint.trim().replaceAll("/+$", "");
        if (!base.startsWith("https://")) throw new IllegalArgumentException("API Base URL 必须使用 HTTPS");
        URL url = new URL(base.endsWith("/chat/completions") ? base : base + "/chat/completions");
        if (!"api.deepseek.com".equalsIgnoreCase(url.getHost())) {
            throw new IllegalArgumentException("本地安卓版当前只支持 DeepSeek 官方 API 地址");
        }
        JSONObject body = new JSONObject()
                .put("model", model)
                .put("messages", new JSONArray()
                        .put(new JSONObject().put("role", "system").put("content", system))
                        .put(new JSONObject().put("role", "user").put("content", prompt)))
                .put("max_tokens", maxTokens)
                .put("thinking", new JSONObject().put("type", "disabled"));
        if (jsonMode) body.put("response_format", new JSONObject().put("type", "json_object"));
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(120000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Authorization", "Bearer " + apiKey);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
        try (java.io.OutputStream output = connection.getOutputStream()) { output.write(bytes); }
        try {
            int status = connection.getResponseCode();
            InputStream stream = status < 400 ? connection.getInputStream() : connection.getErrorStream();
            String text = readText(stream);
            if (status != 200) {
                String kind = "unknown_error";
                try { kind = new JSONObject(text).getJSONObject("error").optString("type", kind); }
                catch (Exception ignored) { }
                if (status == 401) throw new IllegalStateException("DeepSeek HTTP 401：API Key 无效");
                if ("RegionError".equals(kind))
                    throw new IllegalStateException("DeepSeek HTTP 403：该模型在当前地区不可用");
                throw new IllegalStateException("DeepSeek HTTP " + status + "：" + kind);
            }
            JSONObject reply = new JSONObject(text);
            JSONObject choice = reply.getJSONArray("choices").getJSONObject(0);
            if ("length".equals(choice.optString("finish_reason")))
                throw new IllegalStateException("DeepSeek 输出因长度限制被截断");
            String content = choice.getJSONObject("message").optString("content", "");
            if (content.trim().isEmpty()) throw new IllegalStateException("DeepSeek 返回了空内容");
            return content;
        } finally {
            connection.disconnect();
        }
    }

    private String readText(InputStream input) throws Exception {
        if (input == null) return "";
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = stream.read(buffer)) != -1) {
                if (output.size() + count > 2_000_000) throw new IllegalStateException("API 响应过大");
                output.write(buffer, 0, count);
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
