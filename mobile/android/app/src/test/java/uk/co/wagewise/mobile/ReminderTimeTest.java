package uk.co.wagewise.mobile;

import static org.junit.Assert.assertEquals;
import java.time.DayOfWeek;
import java.time.LocalTime;
import java.time.ZonedDateTime;
import java.util.EnumSet;
import org.junit.Test;

public class ReminderTimeTest {
    @Test
    public void selectedWorkingDaysAndCompletedDays() {
        ZonedDateTime now = ZonedDateTime.parse("2026-11-06T18:00:00Z[Europe/London]");
        var weekdays = EnumSet.range(DayOfWeek.MONDAY, DayOfWeek.FRIDAY);
        var time = LocalTime.of(19, 0);
        assertEquals("2026-11-06T19:00Z[Europe/London]", ReminderTime.next(now, time, weekdays, date -> false).toString());
        assertEquals("2026-11-09T19:00Z[Europe/London]", ReminderTime.next(now, time, weekdays, date -> date.equals(now.toLocalDate())).toString());
    }

    @Test
    public void keepsEveningTimeAcrossDst() {
        ZonedDateTime now = ZonedDateTime.parse("2026-10-23T19:15:00+01:00[Europe/London]");
        var next = ReminderTime.next(now, LocalTime.of(19, 0), EnumSet.range(DayOfWeek.MONDAY, DayOfWeek.FRIDAY), date -> false);
        assertEquals("2026-10-26T19:00Z[Europe/London]", next.toString());
    }
}
