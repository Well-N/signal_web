package com.signalweb.android;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.view.View;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

final class WordCloudView extends View {
    private final List<Map.Entry<String, Integer>> words;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);

    WordCloudView(Context context, Map<String, Integer> counts) {
        super(context);
        words = new ArrayList<>(counts.entrySet());
        words.sort((a, b) -> Integer.compare(b.getValue(), a.getValue()));
        if (words.size() > 50) words.subList(50, words.size()).clear();
        StringBuilder description = new StringBuilder("关键词：");
        for (Map.Entry<String, Integer> word : words)
            description.append(word.getKey()).append(" ").append(word.getValue()).append("次；");
        setContentDescription(description.toString());
    }

    @Override protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        int width = MeasureSpec.getSize(widthMeasureSpec);
        if (width < 100) width = 300;
        float left = 10f;
        float baseline = 36f;
        float rowHeight = 44f;
        for (Map.Entry<String, Integer> word : words) {
            float size = Math.min(31f, 17f + word.getValue() * 3f);
            paint.setTextSize(size);
            float textWidth = paint.measureText(word.getKey());
            if (left + textWidth > width - 10f) {
                left = 10f;
                baseline += rowHeight;
                rowHeight = 44f;
            }
            left += textWidth + 17f;
            rowHeight = Math.max(rowHeight, size + 13f);
        }
        setMeasuredDimension(width, (int) (baseline + rowHeight + 14f));
    }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int[] colors = {Color.rgb(32, 72, 130), Color.rgb(176, 77, 63),
                Color.rgb(55, 108, 91), Color.rgb(120, 77, 140)};
        float left = 10f;
        float baseline = 36f;
        float rowHeight = 44f;
        for (int index = 0; index < words.size(); index++) {
            Map.Entry<String, Integer> word = words.get(index);
            float size = Math.min(31f, 17f + word.getValue() * 3f);
            paint.setTextSize(size);
            paint.setColor(colors[index % colors.length]);
            float width = paint.measureText(word.getKey());
            if (left + width > getWidth() - 10f) {
                left = 10f;
                baseline += rowHeight;
                rowHeight = 44f;
            }
            if (baseline > getHeight() - 8f) break;
            canvas.drawText(word.getKey(), left, baseline, paint);
            left += width + 17f;
            rowHeight = Math.max(rowHeight, size + 13f);
        }
    }
}
