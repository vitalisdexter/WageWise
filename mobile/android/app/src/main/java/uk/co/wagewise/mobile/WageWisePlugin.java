package uk.co.wagewise.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "WageWise", permissions = {
    @Permission(alias = "reminders", strings = {Manifest.permission.POST_NOTIFICATIONS})
})
public class WageWisePlugin extends Plugin {
    @PluginMethod
    public void readState(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("json", WageWiseStore.read(getContext()));
            call.resolve(result);
        } catch (IOException error) {
            call.reject("Could not read saved WageWise data.");
        }
    }

    @PluginMethod
    public void writeReminderProjection(PluginCall call) {
        String data = call.getString("json");
        if (data == null) {
            call.reject("Missing WageWise data.");
            return;
        }
        try {
            WageWiseStore.writeReminderProjection(getContext(), data);
            ReminderReceiver.schedule(getContext());
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not save WageWise data. Free up space and try again.");
        }
    }

    @PluginMethod
    public void notificationStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("allowed", ReminderReceiver.allowed(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        ReminderReceiver.notifications(getContext());
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("reminders") != PermissionState.GRANTED) {
            requestPermissionForAlias("reminders", call, "notificationPermissionResult");
        } else notificationStatus(call);
    }

    @PermissionCallback
    private void notificationPermissionResult(PluginCall call) {
        if (call != null) notificationStatus(call);
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        getActivity().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void takeLaunchDate(PluginCall call) {
        call.resolve(consumeDate(getActivity().getIntent()));
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        JSObject result = consumeDate(intent);
        if (result.has("date")) notifyListeners("openLog", result, true);
    }

    @Override
    protected void handleOnResume() {
        ReminderReceiver.schedule(getContext());
    }

    private JSObject consumeDate(Intent intent) {
        JSObject result = new JSObject();
        if (intent != null && ReminderReceiver.OPEN_LOG.equals(intent.getAction())) {
            String date = intent.getStringExtra(ReminderReceiver.DATE);
            intent.removeExtra(ReminderReceiver.DATE);
            if (date != null && date.matches("\\d{4}-\\d{2}-\\d{2}")) result.put("date", date);
        }
        return result;
    }

    @PluginMethod
    public void exportBackup(PluginCall call) {
        Intent picker = new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/json")
            .addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE, call.getString("name", "wagewise.json"));
        startActivityForResult(call, picker, "writeBackup");
    }

    @ActivityCallback
    private void writeBackup(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.resolve(new JSObject().put("saved", false));
            return;
        }
        try (OutputStream stream = getContext().getContentResolver().openOutputStream(result.getData().getData(), "wt")) {
            if (stream == null) throw new IOException("Could not open file");
            stream.write(call.getString("json", "{}").getBytes(StandardCharsets.UTF_8));
        } catch (IOException error) {
            call.reject("Could not save the backup file.");
            return;
        }
        call.resolve(new JSObject().put("saved", true));
    }
}
