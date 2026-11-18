package uk.co.wagewise.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.time.LocalDate;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

// Run on a fresh, isolated emulator. The test writes synthetic data to its own app.
@RunWith(AndroidJUnit4.class)
public class WageWiseSmokeTest {
    @Test
    public void offlineShiftLogAndReminderDate() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        LocalDate today = LocalDate.now();
        LocalDate workDate = today.minusDays(2);
        // Simulate the content intent of a notification that has stayed in the tray.
        Intent launch = new Intent(context, MainActivity.class)
            .setAction(ReminderReceiver.OPEN_LOG).putExtra(ReminderReceiver.DATE, workDate.toString());
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(launch)) {
            await(scenario, "document.querySelector('#log-date')?.value === '" + workDate + "'");
            await(scenario, "typeof window.WageWiseNavigate === 'function'");
            evaluate(scenario, """
                document.querySelector('#add-shift').click();
                document.querySelector('#shift-mode').value = 'clock';
                document.querySelector('#shift-mode').dispatchEvent(new Event('change'));
                document.querySelector('#start').value = '22:00';
                document.querySelector('#end').value = '02:00';
                document.querySelector('#break').value = '30';
                document.querySelector('#shift-form').requestSubmit();
                """);
            await(scenario, "document.querySelector('#shifts')?.textContent.includes('3h 30m at £16.50/hr')");
            JSONObject data = readShared(scenario);
            JSONObject shift = data.getJSONObject("log").getJSONObject("days").getJSONObject(workDate.toString())
                .getJSONArray("shifts").getJSONObject(0);
            assertEquals(210, shift.getInt("minutes"));
            assertEquals(1650, shift.getInt("ratePence"));
            scenario.recreate();
            await(scenario, "typeof window.WageWiseNavigate === 'function'");
            evaluate(scenario, """
                document.querySelector('[data-nav="calendar"]').click();
                document.querySelector('#log-date').value = '%s';
                document.querySelector('#log-date').dispatchEvent(new Event('change'));
                """.formatted(workDate));
            await(scenario, "document.querySelector('#shifts')?.textContent.includes('3h 30m at £16.50/hr')");
            evaluate(scenario, """
                document.querySelector('button[data-nav="settings"]').click();
                const picker = document.querySelector('#backup-file');
                const files = new DataTransfer();
                files.items.add(new File([JSON.stringify({format: 'wagewise-backup', version: 1,
                    state: {basic: 604.13, history: [{id: 104, date: '2026-11-06', gross: 701, net: 557}]}})],
                    'wagewise-test.json', {type: 'application/json'}));
                picker.files = files.files;
                picker.dispatchEvent(new Event('change'));
                """);
            await(scenario, "!document.querySelector('#backup-preview').hidden && document.querySelector('#backup-preview').textContent.includes('1 saved pay entries')");
            evaluate(scenario, "document.querySelector('#backup-preview button.primary').click()");
            await(scenario, "document.querySelector('#notice').textContent === 'Backup restored'");
            JSONObject restored = readShared(scenario);
            assertEquals(557, restored.getJSONObject("calculator").getJSONArray("history").getJSONObject(0).getInt("net"));
            assertTrue(restored.getJSONObject("log").getJSONObject("days").has(workDate.toString()));
            evaluate(scenario, """
                document.querySelector('#reminder-time').value = '19:15';
                document.querySelector('#reminder-form').requestSubmit();
                """);
            await(scenario, "document.querySelector('#notice')?.textContent === 'Reminder schedule saved'");
        }
    }

    @Test
    public void keepsOfflineShiftAndReminderSettings() throws Exception {
        Assume.assumeTrue("true".equals(InstrumentationRegistry.getArguments().getString("upgrade")));
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        context.getSharedPreferences("reminder-delivery", Context.MODE_PRIVATE).edit().clear().commit();
        JSONObject log = new JSONObject(WageWiseStore.read(context)).getJSONObject("log");
        JSONObject shift = log.getJSONObject("days").getJSONObject(LocalDate.now().minusDays(2).toString())
            .getJSONArray("shifts").getJSONObject(0);
        assertEquals(210, shift.getInt("minutes"));
        assertEquals("19:15", log.getJSONObject("reminder").getString("time"));
    }

    @Test
    public void receiverSuppressesCompletedDayAndRespectsPermission() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        NotificationManager notifications = ReminderReceiver.notifications(context);
        LocalDate today = LocalDate.now();
        String json = """
            {"format":"wagewise-android","version":1,"calculator":null,"log":{
            "started":"%s","days":{"%s":{"status":"none","shifts":[]}},"checks":{},"schedule":null,
            "ratePence":1650,"reminder":{"enabled":true,"weekdays":[%d],"time":"00:00"}}}
            """.formatted(today, today, today.getDayOfWeek().getValue());
        WageWiseStore.writeReminderProjection(context, new JSONObject(json).getJSONObject("log").toString());
        ReminderReceiver receiver = new ReminderReceiver();
        Intent alarm = new Intent("uk.co.wagewise.mobile.OVERTIME_ALARM").putExtra(ReminderReceiver.DATE, today.toString());
        receiver.onReceive(context, alarm);
        assertEquals(0, notifications.getActiveNotifications().length);

        JSONObject data = new JSONObject(json);
        data.getJSONObject("log").getJSONObject("days").remove(today.toString());
        WageWiseStore.writeReminderProjection(context, data.getJSONObject("log").toString());
        receiver.onReceive(context, alarm);
        if (ReminderReceiver.allowed(context)) {
            boolean posted = false;
            for (int i = 0; i < 40 && !posted; i++) {
                posted = notifications.getActiveNotifications().length == 1;
                if (!posted) SystemClock.sleep(100);
            }
            assertTrue("The enabled workday posts a reminder", posted);
        } else assertEquals(0, notifications.getActiveNotifications().length);
        notifications.cancelAll();
    }

    static JSONObject readShared(ActivityScenario<MainActivity> scenario) throws Exception {
        return new JSONObject(evaluate(scenario, "WageWiseFeatures.read()"));
    }

    static void await(ActivityScenario<MainActivity> scenario, String predicate) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 25000;
        do {
            if ("true".equals(evaluate(scenario, predicate))) return;
            SystemClock.sleep(200);
        } while (SystemClock.elapsedRealtime() < deadline);
        throw new AssertionError("Condition not met: " + predicate);
    }

    static String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        CountDownLatch callback = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        scenario.onActivity(activity -> {
            assertNotNull(activity.getBridge());
            activity.getBridge().getWebView().evaluateJavascript(script, value -> {
                result.set(value);
                callback.countDown();
            });
        });
        assertTrue("WebView evaluation timed out", callback.await(5, TimeUnit.SECONDS));
        return result.get();
    }
}
