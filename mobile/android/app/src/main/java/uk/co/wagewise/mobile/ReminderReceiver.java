package uk.co.wagewise.mobile;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZonedDateTime;
import java.util.EnumSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

public class ReminderReceiver extends BroadcastReceiver {
    static final String CHANNEL = "overtime-reminders";
    static final String OPEN_LOG = "uk.co.wagewise.mobile.OPEN_LOG";
    static final String DATE = "workDate";
    private static final String ALARM = "uk.co.wagewise.mobile.OVERTIME_ALARM";
    private static final String PREFS = "reminder-delivery";
    private static final String LAST_SENT = "lastSent";
    private static final int NOTIFICATION_ID = 17;

    static NotificationManager notifications(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Overtime reminders",
            NotificationManager.IMPORTANCE_DEFAULT));
        return manager;
    }

    static boolean allowed(Context context) {
        NotificationManager manager = notifications(context);
        return manager.areNotificationsEnabled() && manager.getNotificationChannel(CHANNEL).getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    private static PendingIntent alarm(Context context, String date, int flags) {
        Intent intent = new Intent(context, ReminderReceiver.class).setAction(ALARM).putExtra(DATE, date);
        return PendingIntent.getBroadcast(context, 0, intent, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    private static JSONObject readLog(Context context) throws Exception {
        return WageWiseStore.readReminderProjection(context);
    }

    static synchronized void schedule(Context context) {
        AlarmManager manager = context.getSystemService(AlarmManager.class);
        // Cancel before rebuilding so changes or restored settings cannot leave duplicate alarms.
        PendingIntent oldAlarm = alarm(context, null, PendingIntent.FLAG_NO_CREATE);
        if (oldAlarm != null) manager.cancel(oldAlarm);
        try {
            JSONObject log = readLog(context);
            JSONObject reminder = log.optJSONObject("reminder");
            String today = LocalDate.now().toString();
            JSONObject days = log.optJSONObject("days");
            if (reminder == null || !reminder.optBoolean("enabled")) {
                notifications(context).cancel(NOTIFICATION_ID);
                return;
            }
            if (days.has(today)) notifications(context).cancel(NOTIFICATION_ID);
            if (!allowed(context)) return;
            String lastSent = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(LAST_SENT, "");
            ZonedDateTime now = ZonedDateTime.now();
            LocalTime time = LocalTime.parse(reminder.getString("time"));
            Set<DayOfWeek> workdays = weekdays(reminder);
            ZonedDateTime next;
            if (workdays.contains(now.getDayOfWeek()) && !now.toLocalTime().isBefore(time) &&
                !days.has(today) && !lastSent.equals(today)) {
                next = now;
            } else {
                next = ReminderTime.next(now, time, workdays,
                    date -> days.has(date.toString()) || lastSent.equals(date.toString()));
            }
            if (next != null) manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.toInstant().toEpochMilli(),
                alarm(context, next.toLocalDate().toString(), PendingIntent.FLAG_UPDATE_CURRENT));
        } catch (Exception error) {
            Log.w("WageWise", "Could not schedule overtime reminder", error);
        }
    }

    private static Set<DayOfWeek> weekdays(JSONObject reminder) throws Exception {
        Set<DayOfWeek> result = EnumSet.noneOf(DayOfWeek.class);
        JSONArray days = reminder.getJSONArray("weekdays");
        for (int i = 0; i < days.length(); i++) result.add(DayOfWeek.of(days.getInt(i)));
        return result;
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            if (ALARM.equals(intent.getAction())) deliver(context, intent.getStringExtra(DATE));
        } catch (Exception error) {
            Log.w("WageWise", "Could not deliver overtime reminder", error);
        } finally {
            schedule(context);
        }
    }

    private static synchronized void deliver(Context context, String date) throws Exception {
        ZonedDateTime now = ZonedDateTime.now();
        if (!now.toLocalDate().toString().equals(date) || !allowed(context)) return;
        JSONObject log = readLog(context);
        JSONObject reminder = log.getJSONObject("reminder");
        android.content.SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!reminder.optBoolean("enabled") || log.getJSONObject("days").has(date) ||
            !weekdays(reminder).contains(now.getDayOfWeek()) || date.equals(prefs.getString(LAST_SENT, "")) ||
            now.toLocalTime().isBefore(LocalTime.parse(reminder.getString("time")))) return;

        Intent open = new Intent(context, MainActivity.class).setAction(OPEN_LOG).putExtra(DATE, date);
        PendingIntent tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_overtime_reminder)
            .setContentTitle("Log today's overtime")
            .setContentText("Add your hours or mark no overtime.")
            .setContentIntent(tap).setAutoCancel(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build();
        notifications(context).notify(NOTIFICATION_ID, notification);
        prefs.edit().putString(LAST_SENT, date).apply();
    }
}
