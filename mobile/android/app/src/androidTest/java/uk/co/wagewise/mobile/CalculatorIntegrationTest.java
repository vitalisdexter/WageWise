package uk.co.wagewise.mobile;

import static org.junit.Assert.assertTrue;
import static uk.co.wagewise.mobile.WageWiseSmokeTest.await;
import static uk.co.wagewise.mobile.WageWiseSmokeTest.evaluate;

import android.os.Bundle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class CalculatorIntegrationTest {
    @Test
    public void fingerprintExistingRecords() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        String json = WageWiseStore.read(instrumentation.getTargetContext());
        JSONObject data = new JSONObject(json);
        JSONObject log = data.getJSONObject("log");
        assertTrue(log.getJSONObject("days").length() > 0);
        assertTrue(log.getJSONObject("checks").length() > 0);
        assertTrue(log.getJSONObject("planner").getJSONObject("planned").length() > 0);
        assertTrue(log.getJSONObject("reminder").getBoolean("enabled"));
        assertTrue(data.getJSONObject("calculator").getJSONArray("history").length() > 0);
        var digest = MessageDigest.getInstance("SHA-256").digest(json.getBytes(StandardCharsets.UTF_8));
        var hex = new StringBuilder();
        for (byte value : digest) hex.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        Bundle result = new Bundle();
        result.putString("storeSha256", hex.toString());
        instrumentation.sendStatus(0, result);
    }

    @Test
    public void upgradeKeepsRecordsAndUsesOneInterfaceOffline() throws Exception {
        var target = InstrumentationRegistry.getInstrumentation().getTargetContext();
        JSONObject legacy = new JSONObject(WageWiseStore.read(target));
        JSONObject oldLog = legacy.getJSONObject("log");
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            await(scenario, "typeof window.WageWiseNavigate === 'function'");
            await(scenario, """
                !document.querySelector("iframe") && document.querySelectorAll("nav").length === 1 &&
                document.querySelector("[data-nav=calculator]").getAttribute("aria-current") === "page"
                """);
            await(scenario, """
                (() => {
                  const legacy = %s;
                  const state = WageWiseFeatures.read();
                  return ['days','checks','planner','schedule'].every(key => WageWiseMerge.equal(legacy.log[key], state.log[key])) &&
                    WageWiseMerge.equal(legacy.calculator.history, state.calculator.history);
                })()
                """.formatted(legacy.toString()));
            evaluate(scenario, "document.querySelector('[data-nav=dashboard]').click()");
            await(scenario, "document.querySelector('#dash-overtime').textContent.includes('1h 30m')");
            evaluate(scenario, """
                const data = WageWiseFeatures.read();
                const workDay = Object.entries(data.log.days).find(([, record]) => record.shifts.length)[0];
                WageWiseFeatures.openLogDate(workDay);
                """);
            await(scenario, "document.querySelector('#log-date').value === workDay");
            evaluate(scenario, "document.querySelector('[data-nav=planner]').click()");
            await(scenario, "document.querySelectorAll('.forecast-card').length === 4");
            evaluate(scenario, "document.querySelector('[data-nav=payslip]').click()");
            await(scenario, "Boolean(document.querySelector('.psl-header'))");
            evaluate(scenario, "document.querySelector('#open-payslip-check').click()");
            await(scenario, "!document.querySelector('#checks').hidden");
            evaluate(scenario, "document.querySelector('[data-nav=settings]').click()");
            await(scenario, "document.querySelector('#reminder-time').value === '19:15' && document.querySelector('#reminder-enabled').checked");
        }
    }
}
