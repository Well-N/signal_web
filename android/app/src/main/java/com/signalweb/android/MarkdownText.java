package com.signalweb.android;

final class MarkdownText {
    private MarkdownText() { }

    static String plain(String value) {
        return value.replace("\r", "")
                .replaceAll("(?m)^#{1,6}\\s*", "")
                .replaceAll("(?m)^>\\s*", "")
                .replaceAll("(?m)^---+\\s*$", "")
                .replaceAll("\\[([^]]+)\\]\\(#[^)]+\\)", "$1")
                .replaceAll("\\[([^]]+)\\]\\((https?://[^)]+)\\)", "$1 ($2)")
                .replace("**", "")
                .replace("__", "")
                .replace("`", "");
    }
}
