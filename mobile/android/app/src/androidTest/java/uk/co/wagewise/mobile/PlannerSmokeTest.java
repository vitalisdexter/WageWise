package uk.co.wagewise.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static uk.co.wagewise.mobile.WageWiseSmokeTest.await;
import static uk.co.wagewise.mobile.WageWiseSmokeTest.evaluate;
import static uk.co.wagewise.mobile.WageWiseSmokeTest.readShared;

import android.content.Context;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.time.LocalDate;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

// Run the seed on a disposable emulator with the previous release installed.
@RunWith(AndroidJUnit4.class)
public class PlannerSmokeTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();

    @Test
    public void seedPreviousRelease() throws Exception {
        Assume.assumeTrue("true".equals(InstrumentationRegistry.getArguments().getString("upgrade")));
        LocalDate now = LocalDate.now();
        String fixture = """
            {"format":"wagewise-android","version":1,"calculator":{"basic":650,"salaryRevision":"2026-11-06",
            "history":[{"id":101,"date":"%s","gross":618.69,"net":509.34}],"customDeductions":[]},
            "log":{"started":"%s","days":{"%s":{"status":"overtime","shifts":[
            {"id":"a0000000-0000-4000-8000-000000000001","minutes":90,"ratePence":1650,"note":"QA fixture"}]}},
            "checks":{"%s":{"shifts":[],"actualHours":0,"actualPay":0}},"schedule":{"cutoff":"%s","payDate":"%s"},"ratePence":1650,
            "reminder":{"enabled":true,"weekdays":[1,2,3,4,5,6,7],"time":"19:15"}}}
            """.formatted(now.minusDays(4), now.minusDays(4), now.minusDays(1), now.minusDays(4), now.plusDays(2), now.plusDays(5));
        WageWiseStore.write(context, fixture);
        assertFalse(read().getJSONObject("log").has("planner"));
    }

    @Test
    public void plannerSurvivesUpdateAndBackupRestore() throws Exception {
        Assume.assumeTrue("true".equals(InstrumentationRegistry.getArguments().getString("upgrade")));
        LocalDate now = LocalDate.now();
        JSONObject original = read();
        assertEquals("19:15", original.getJSONObject("log").getJSONObject("reminder").getString("time"));
        assertTrue(original.getJSONObject("log").getJSONObject("reminder").getBoolean("enabled"));
        assertEquals(509.34, original.getJSONObject("calculator").getJSONArray("history").getJSONObject(0).getDouble("net"), .001);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            await(scenario, "typeof window.WageWiseNavigate === 'function'");
            evaluate(scenario, "document.querySelector('button[data-nav=planner]').click()");
            await(scenario, "document.querySelectorAll('.forecast-card').length === 4");
            await(scenario, "document.querySelector('.forecast-card').textContent.includes('1h 30m logged')");
            evaluate(scenario, """
                document.querySelector('#planned-date').value = '%s';
                document.querySelector('#planned-hours').value = '1';
                document.querySelector('#planned-form').requestSubmit();
                """.formatted(now.plusDays(1)));
            await(scenario, "document.querySelector('.forecast-card').textContent.includes('1h 00m planned remaining')");
            evaluate(scenario, """
                document.querySelector('button[data-planner=goal]').click();
                const qaPeriod = Planner.forecast(WageWiseFeatures.read(), Tracking.localDate())[0];
                document.querySelector('#goal-target').value = (qaPeriod.payroll[2].pay.net + 0.01).toFixed(2);
                document.querySelector('#goal-max').value = '1';
                document.querySelector('#goal-form').requestSubmit();
                """);
            await(scenario, "document.querySelector('#goal-result').textContent.includes('0h 15m extra')");
            evaluate(scenario, """
                document.querySelector('#goal-result button').click();
                document.querySelector('#goal-result input').value = '0.25';
                document.querySelector('#goal-result form').requestSubmit();
                """);
            await(scenario, "document.querySelector('.forecast-card').textContent.includes('1h 15m planned remaining')");
            evaluate(scenario, """
                document.querySelector('button[data-planner=pots]').click();
                document.querySelector('#budget-source').value = 'actual';
                document.querySelector('#budget-source').dispatchEvent(new Event('change'));
                document.querySelector('#actual-net').value = '700';
                document.querySelector('#actual-net-form').requestSubmit();
                """);
            await(scenario, "document.querySelector('#budget-summary').textContent.includes('£700.00')");
            evaluate(scenario, """
                document.querySelector('#bill-name').value = 'Rent';
                document.querySelector('#bill-amount').value = '520';
                document.querySelector('#bill-cadence').value = 'monthly';
                document.querySelector('#bill-form').requestSubmit();
                """);
            await(scenario, "document.querySelector('#bill-list').textContent.includes('£120.00 weekly reserve')");
            evaluate(scenario, """
                document.querySelector('#pot-name').value = 'Investing';
                document.querySelector('#pot-share').value = '25';
                document.querySelector('#pot-form').requestSubmit();
                """);
            await(scenario, "document.querySelector('#budget-summary').textContent.includes('£145.00')");
            evaluate(scenario, """
                document.querySelector('#use-pot').click();
                document.querySelector('#projection-balance').value = '100';
                document.querySelector('#projection-years').value = '1';
                document.querySelector('#projection-fee').value = '0';
                document.querySelector('#projection-return').value = '0';
                document.querySelector('#projection-downside').value = '-10';
                document.querySelector('#projection-form').requestSubmit();
                """);
            await(scenario, "document.querySelector('#projection-result').textContent.includes('£7,640.00')");
            JSONObject saved = readShared(scenario).put("format", "wagewise").put("version", 2);
            assertEquals(14500, saved.getJSONObject("log").getJSONObject("planner").getJSONObject("projection").getInt("weekly"));
            evaluate(scenario, "document.querySelector('#actual-net').value = '25'; document.querySelector('#actual-net-form').requestSubmit()");
            await(scenario, "document.querySelector('#budget-summary').textContent.includes('Shortfall')");
            evaluate(scenario, """
                document.querySelector('#bill-list button').click();
                document.querySelector('#bill-name').value = 'Unsubmitted change';
                document.querySelector('button[data-nav=settings]').click();
                const qaFiles = new DataTransfer();
                qaFiles.items.add(new File([%s], 'planner-test.json', {type:'application/json'}));
                const qaPicker = document.querySelector('#backup-file');
                qaPicker.files = qaFiles.files;
                qaPicker.dispatchEvent(new Event('change'));
                """.formatted(JSONObject.quote(saved.toString())));
            await(scenario, "document.querySelector('#backup-preview').textContent.includes('Includes planner settings')");
            evaluate(scenario, "document.querySelector('#backup-preview button.primary').click()");
            await(scenario, "document.querySelector('#notice').textContent === 'Backup restored'");
            JSONObject restored = readShared(scenario);
            assertEquals(70000, restored.getJSONObject("log").getJSONObject("planner").getInt("actualNet"));
            assertEquals(saved.getJSONObject("log").getString("planner"), restored.getJSONObject("log").getString("planner"));
            assertEquals(saved.getJSONObject("log").getString("reminder"), restored.getJSONObject("log").getString("reminder"));
            assertEquals(original.getJSONObject("log").getString("days"), restored.getJSONObject("log").getString("days"));
            assertEquals(original.getJSONObject("log").getString("checks"), restored.getJSONObject("log").getString("checks"));
            evaluate(scenario, "document.querySelector('button[data-nav=planner]').click()");
            await(scenario, "document.querySelector('#bill-name').value === '' && document.querySelector('#bill-list').textContent.includes('Rent')");
        }
    }

    private JSONObject read() throws Exception { return new JSONObject(WageWiseStore.read(context)); }
}
