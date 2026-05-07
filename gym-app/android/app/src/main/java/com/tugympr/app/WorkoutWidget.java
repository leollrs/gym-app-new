package com.tugympr.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

/**
 * Home screen widget showing streak count and quick launch.
 */
public class WorkoutWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_workout);

        // Read cached streak from SharedPreferences
        SharedPreferences prefs = context.getSharedPreferences("tugympr_widget", Context.MODE_PRIVATE);
        int streak = prefs.getInt("streak", 0);
        String subtitle = streak > 0
            ? streak + " day streak — keep it going!"
            : "Tap to start workout";

        views.setTextViewText(R.id.widget_streak, String.valueOf(streak));
        views.setTextViewText(R.id.widget_subtitle, subtitle);

        // Tap to open app
        Intent intent = new Intent(context, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_root, pendingIntent);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
}
