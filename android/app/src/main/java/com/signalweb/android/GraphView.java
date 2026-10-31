package com.signalweb.android;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.view.View;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Map;

final class GraphView extends View {
    interface SelectStory { void onSelect(JSONObject story); }

    private final JSONArray stories;
    private final JSONArray edges;
    private final SelectStory listener;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Map<String, Integer> positions = new HashMap<>();
    private float[] x = new float[0];
    private float[] y = new float[0];
    private float nodeRadius = 20f;
    private float scale = 1f;
    private float offsetX = 0f;
    private float offsetY = 0f;
    private float lastX, lastY, downX, downY;
    private boolean dragged;
    private final ScaleGestureDetector zoom;

    GraphView(Context context, JSONObject brief, SelectStory listener) throws Exception {
        super(context);
        stories = brief.getJSONArray("stories");
        edges = brief.getJSONArray("edges");
        this.listener = listener;
        zoom = new ScaleGestureDetector(context, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
            @Override public boolean onScale(ScaleGestureDetector detector) {
                scale = Math.max(0.55f, Math.min(4f, scale * detector.getScaleFactor()));
                invalidate();
                return true;
            }
        });
        for (int index = 0; index < stories.length(); index++)
            positions.put(stories.getJSONObject(index).getString("id"), index);
        setContentDescription("事件关系图，点选节点查看事件详情");
    }

    @Override protected void onSizeChanged(int width, int height, int oldWidth, int oldHeight) {
        super.onSizeChanged(width, height, oldWidth, oldHeight);
        int count = stories.length();
        x = new float[count];
        y = new float[count];
        if (count == 0) return;
        float centerX = width / 2f, centerY = height / 2f;
        float radius = Math.min(width, height) * 0.32f;
        for (int i = 0; i < count; i++) {
            double angle = -Math.PI / 2 + i * 2 * Math.PI / count;
            x[i] = centerX + (float) (radius * Math.cos(angle));
            y[i] = centerY + (float) (radius * Math.sin(angle));
        }
        // A fixed number of local force iterations gives related events a shared region.
        for (int step = 0; step < 100 && count > 1; step++) {
            float[] dx = new float[count], dy = new float[count];
            for (int left = 0; left < count; left++) {
                dx[left] += (centerX - x[left]) * 0.003f;
                dy[left] += (centerY - y[left]) * 0.003f;
                for (int right = left + 1; right < count; right++) {
                    float vx = x[left] - x[right], vy = y[left] - y[right];
                    float distance2 = Math.max(100f, vx * vx + vy * vy);
                    float force = 6500f / distance2;
                    float distance = (float) Math.sqrt(distance2);
                    dx[left] += vx / distance * force;
                    dy[left] += vy / distance * force;
                    dx[right] -= vx / distance * force;
                    dy[right] -= vy / distance * force;
                }
            }
            for (int i = 0; i < edges.length(); i++) {
                JSONObject edge = edges.optJSONObject(i);
                if (edge == null) continue;
                Integer left = positions.get(edge.optString("source"));
                Integer right = positions.get(edge.optString("target"));
                if (left == null || right == null) continue;
                float vx = x[right] - x[left], vy = y[right] - y[left];
                float distance = (float) Math.hypot(vx, vy);
                if (distance < 1) continue;
                float force = (distance - 85f) * 0.012f;
                dx[left] += vx / distance * force;
                dy[left] += vy / distance * force;
                dx[right] -= vx / distance * force;
                dy[right] -= vy / distance * force;
            }
            for (int i = 0; i < count; i++) {
                x[i] = Math.max(23, Math.min(width - 23, x[i] + Math.max(-4, Math.min(4, dx[i]))));
                y[i] = Math.max(23, Math.min(height - 23, y[i] + Math.max(-4, Math.min(4, dy[i]))));
            }
        }
    }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int count = stories.length();
        if (count == 0) return;
        nodeRadius = Math.max(7f, Math.min(17f, 80f / (float) Math.sqrt(count)));
        canvas.save();
        canvas.translate(offsetX, offsetY);
        canvas.scale(scale, scale, getWidth() / 2f, getHeight() / 2f);
        paint.setStrokeWidth(2f);
        paint.setColor(Color.rgb(178, 193, 209));
        for (int index = 0; index < edges.length(); index++) {
            JSONObject edge = edges.optJSONObject(index);
            if (edge == null) continue;
            Integer left = positions.get(edge.optString("source"));
            Integer right = positions.get(edge.optString("target"));
            if (left != null && right != null)
                canvas.drawLine(x[left], y[left], x[right], y[right], paint);
        }
        paint.setTextSize(Math.max(11f, nodeRadius * 1.15f));
        for (int index = 0; index < count; index++) {
            JSONObject story = stories.optJSONObject(index);
            if (story == null) continue;
            double score = story.optDouble("score", 0);
            paint.setColor(score >= 8 ? Color.rgb(191, 85, 63) : Color.rgb(42, 90, 143));
            float radius = Math.max(7f, Math.min(17f, nodeRadius * (float) (0.65 + score * 0.06)));
            canvas.drawCircle(x[index], y[index], radius, paint);
            paint.setColor(Color.WHITE);
            String label = String.valueOf(index + 1);
            canvas.drawText(label, x[index] - paint.measureText(label) / 2,
                    y[index] + paint.getTextSize() * 0.35f, paint);
        }
        canvas.restore();
    }

    @Override public boolean onTouchEvent(MotionEvent event) {
        zoom.onTouchEvent(event);
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                getParent().requestDisallowInterceptTouchEvent(true);
                downX = lastX = event.getX(); downY = lastY = event.getY(); dragged = false;
                return true;
            case MotionEvent.ACTION_POINTER_DOWN:
                dragged = true;
                return true;
            case MotionEvent.ACTION_MOVE:
                if (event.getPointerCount() == 1 && !zoom.isInProgress()) {
                    float moveX = event.getX() - lastX, moveY = event.getY() - lastY;
                    if (Math.hypot(event.getX() - downX, event.getY() - downY) > 7) dragged = true;
                    if (dragged) { offsetX += moveX; offsetY += moveY; invalidate(); }
                }
                lastX = event.getX(); lastY = event.getY();
                return true;
            case MotionEvent.ACTION_UP:
                if (dragged) return true;
                break;
            default: return true;
        }
        float centerX = getWidth() / 2f, centerY = getHeight() / 2f;
        float touchX = centerX + (event.getX() - offsetX - centerX) / scale;
        float touchY = centerY + (event.getY() - offsetY - centerY) / scale;
        for (int index = 0; index < x.length; index++) {
            float dx = touchX - x[index];
            float dy = touchY - y[index];
            float hitRadius = nodeRadius + 9f / scale;
            if (dx * dx + dy * dy < hitRadius * hitRadius) {
                JSONObject story = stories.optJSONObject(index);
                if (story != null) listener.onSelect(story);
                performClick();
                return true;
            }
        }
        return true;
    }

    @Override public boolean performClick() { super.performClick(); return true; }
}
