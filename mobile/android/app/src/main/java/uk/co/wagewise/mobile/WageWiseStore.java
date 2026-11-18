package uk.co.wagewise.mobile;

import android.content.Context;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.json.JSONException;
import org.json.JSONObject;

final class WageWiseStore {
    static final int MAX_BYTES = 5 * 1024 * 1024;

    private WageWiseStore() {}

    private static AtomicFile file(Context context) {
        return new AtomicFile(new File(context.getNoBackupFilesDir(), "wagewise.json"));
    }

    static synchronized String read(Context context) throws IOException {
        return read(file(context));
    }

    static synchronized JSONObject readReminderProjection(Context context) throws JSONException, IOException {
        String projection = read(reminders(context));
        if (projection != null) return new JSONObject(projection);
        String legacy = read(context);
        return legacy == null ? new JSONObject() : new JSONObject(legacy).getJSONObject("log");
    }

    private static AtomicFile reminders(Context context) {
        return new AtomicFile(new File(context.getNoBackupFilesDir(), "reminders.json"));
    }

    static synchronized void writeReminderProjection(Context context, String json) throws JSONException, IOException {
        JSONObject data = new JSONObject(json);
        if (data.optJSONObject("reminder") == null || data.optJSONObject("days") == null) {
            throw new IOException("Invalid reminder settings");
        }
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BYTES) throw new IOException("Reminder settings are too large");
        write(reminders(context), bytes);
    }

    private static String read(AtomicFile source) throws IOException {
        try {
            return new String(source.readFully(), StandardCharsets.UTF_8);
        } catch (FileNotFoundException missing) {
            return null;
        }
    }

    static synchronized void write(Context context, String data) throws JSONException, IOException {
        byte[] bytes = data.getBytes(StandardCharsets.UTF_8);
        JSONObject state = new JSONObject(data);
        if (bytes.length > MAX_BYTES || !"wagewise-android".equals(state.optString("format")) ||
            state.optInt("version") != 1 || state.optJSONObject("log") == null) {
            throw new IOException("Invalid WageWise state");
        }
        write(file(context), bytes);
    }

    private static void write(AtomicFile target, byte[] bytes) throws IOException {
        FileOutputStream stream = target.startWrite();
        try {
            stream.write(bytes);
            stream.getFD().sync();
            target.finishWrite(stream);
        } catch (IOException error) {
            target.failWrite(stream);
            throw error;
        }
    }
}
