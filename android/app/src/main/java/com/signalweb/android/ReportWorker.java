package com.signalweb.android;

import android.content.Context;
import android.content.SharedPreferences;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.work.ForegroundInfo;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

import java.time.Instant;
import java.util.concurrent.TimeUnit;

public final class ReportWorker extends Worker {
    private static final String CHANNEL_ID = "signalweb-daily";
    private static final int RUNNING_NOTIFICATION_ID = 1000;

    public ReportWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    @NonNull @Override public Result doWork() {
        SharedPreferences prefs = getApplicationContext().getSharedPreferences("report_schedule", Context.MODE_PRIVATE);
        try {
            setForegroundAsync(createForegroundInfo()).get(30, TimeUnit.SECONDS);
            JSONObject brief = new ReportEngine(getApplicationContext()).run(message ->
                    prefs.edit().putString("progress", message).apply());
            prefs.edit().putString("last_result", "完成：" + brief.optString("date"))
                    .putString("last_finished_at", Instant.now().toString()).apply();
            notifyResult("日报已生成", brief.optString("date") + " · "
                    + brief.optJSONObject("stats").optInt("story_count") + " 条事件");
            return Result.success();
        } catch (Exception error) {
            prefs.edit().putString("last_result", "失败：" + error.getClass().getSimpleName()
                    + "：" + error.getMessage())
                    .putString("last_finished_at", Instant.now().toString()).apply();
            notifyResult("日报生成失败", error.getClass().getSimpleName() + "：" + error.getMessage());
            return retryable(error) && getRunAttemptCount() < 2 ? Result.retry() : Result.failure();
        }
    }

    private ForegroundInfo createForegroundInfo() {
        Context context = getApplicationContext();
        ensureChannel(context);
        Notification notification = new Notification.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("织讯正在生成日报")
                .setContentText("新闻抓取和 AI 分析仍在进行")
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 29) {
            return new ForegroundInfo(RUNNING_NOTIFICATION_ID, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        }
        return new ForegroundInfo(RUNNING_NOTIFICATION_ID, notification);
    }

    private boolean retryable(Exception error) {
        String message = String.valueOf(error.getMessage()).toLowerCase();
        return !message.contains("api key")
                && !message.contains("http 401")
                && !message.contains("http 403")
                && !message.contains("模型名不能为空")
                && !message.contains("请先");
    }

    private void ensureChannel(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) throw new IllegalStateException("系统通知服务不可用");
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(new NotificationChannel(CHANNEL_ID,
                    "定时日报", NotificationManager.IMPORTANCE_LOW));
        }
    }

    private void notifyResult(String title, String message) {
        Context context = getApplicationContext();
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
                context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                        != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            context.getSharedPreferences("report_schedule", Context.MODE_PRIVATE).edit()
                    .putString("notification_error", "没有通知权限；日报运行结果已保存在应用内").apply();
            return;
        }
        try {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) throw new IllegalStateException("系统通知服务不可用");
        ensureChannel(context);
        Intent open = new Intent(context, HomeActivity.class);
        PendingIntent pending = PendingIntent.getActivity(context, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(message.length() > 140 ? message.substring(0, 140) : message)
                .setStyle(new Notification.BigTextStyle().bigText(message))
                .setContentIntent(pending).setAutoCancel(true).build();
        manager.notify(1001, notification);
        context.getSharedPreferences("report_schedule", Context.MODE_PRIVATE).edit()
                .remove("notification_error").apply();
        } catch (Exception error) {
            context.getSharedPreferences("report_schedule", Context.MODE_PRIVATE).edit()
                    .putString("notification_error", error.getClass().getSimpleName() + "：" + error.getMessage()).apply();
        }
    }
}
