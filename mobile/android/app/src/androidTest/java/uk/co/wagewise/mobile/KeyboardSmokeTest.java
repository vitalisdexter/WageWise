package uk.co.wagewise.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static uk.co.wagewise.mobile.WageWiseSmokeTest.await;
import static uk.co.wagewise.mobile.WageWiseSmokeTest.evaluate;

import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.View;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONArray;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class KeyboardSmokeTest {
    @Test
    public void keyboardResizesOnceAndOvertimePreviewUpdates() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            await(scenario, "typeof window.WageWiseNavigate === 'function'");
            int fullHeight = Integer.parseInt(evaluate(scenario, "window.innerHeight"));
            evaluate(scenario, """
                document.querySelector('[data-nav="calendar"]').click();
                document.querySelector('#add-shift').click();
                document.querySelector('#hours').scrollIntoView({block: 'center'});
                """);
            SystemClock.sleep(250);
            tapHours(scenario);
            evaluate(scenario, "document.querySelector('#hours').focus()");
            scenario.onActivity(activity -> WindowCompat.getInsetsController(activity.getWindow(),
                activity.getBridge().getWebView()).show(WindowInsetsCompat.Type.ime()));
            await(scenario, """
                document.documentElement.classList.contains('ime-open') &&
                document.activeElement.id === 'hours' &&
                getComputedStyle(document.querySelector('.bottomnav')).display === 'none'
                """);
            await(scenario, """
                Math.abs(window.innerHeight - window.visualViewport.height) < 16 &&
                document.activeElement.getBoundingClientRect().bottom <= window.visualViewport.height
                """);
            scenario.onActivity(activity -> {
                View content = activity.findViewById(android.R.id.content);
                View webView = activity.getBridge().getWebView();
                int keyboard = ViewCompat.getRootWindowInsets(content).getInsets(WindowInsetsCompat.Type.ime()).bottom;
                assertTrue(keyboard > 0);
                assertEquals(keyboard, content.getPaddingBottom());
                assertEquals(content.getHeight() - content.getPaddingTop() - keyboard, webView.getHeight());
            });
            assertTrue(Integer.parseInt(evaluate(scenario, "window.innerHeight")) < fullHeight);
            evaluate(scenario, """
                document.querySelector('#hours').value = '2';
                document.querySelector('#minutes').value = '30';
                document.querySelector('#shift-rate').value = '16.50';
                document.querySelector('#hours').dispatchEvent(new Event('input', {bubbles: true}));
                """);
            await(scenario, "document.querySelector('#shift-pay').value === '£41.25'");
            scenario.onActivity(activity -> WindowCompat.getInsetsController(activity.getWindow(),
                activity.getBridge().getWebView()).hide(WindowInsetsCompat.Type.ime()));
            await(scenario, """
                !document.documentElement.classList.contains('ime-open') &&
                getComputedStyle(document.querySelector('.bottomnav')).display === 'flex' &&
                window.innerHeight === %d
                """.formatted(fullHeight));
        }
    }

    private void tapHours(ActivityScenario<MainActivity> scenario) throws Exception {
        JSONArray point = new JSONArray(evaluate(scenario, """
            (() => {
                const field = document.querySelector('#hours').getBoundingClientRect();
                return [(field.left + field.width / 2) * devicePixelRatio,
                        (field.top + field.height / 2) * devicePixelRatio];
            })()
            """));
        float x = (float) point.getDouble(0);
        float y = (float) point.getDouble(1);
        scenario.onActivity(activity -> {
            View webView = activity.getBridge().getWebView();
            webView.requestFocus();
            long down = SystemClock.uptimeMillis();
            for (int action : new int[]{ MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP }) {
                MotionEvent event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, x, y, 0);
                event.setSource(InputDevice.SOURCE_TOUCHSCREEN);
                try {
                    webView.dispatchTouchEvent(event);
                } finally {
                    event.recycle();
                }
            }
        });
    }
}
