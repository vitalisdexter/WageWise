package uk.co.wagewise.mobile;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZonedDateTime;
import java.util.Set;
import java.util.function.Predicate;

final class ReminderTime {
    private ReminderTime() {}

    static ZonedDateTime next(ZonedDateTime now, LocalTime time, Set<DayOfWeek> weekdays,
                              Predicate<LocalDate> skip) {
        // Any completed dates are finite, but keep scheduling bounded if a restored
        // backup already contains every date in the coming year.
        for (int offset = 0; offset <= 366; offset++) {
            LocalDate date = now.toLocalDate().plusDays(offset);
            ZonedDateTime candidate = date.atTime(time).atZone(now.getZone());
            if (weekdays.contains(date.getDayOfWeek()) && candidate.isAfter(now) && !skip.test(date)) {
                return candidate;
            }
        }
        return null;
    }
}
