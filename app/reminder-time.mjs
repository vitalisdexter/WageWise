const dayMs = 86400000;
const minute = 60000;

function zonedParts(format, time) {
  return Object.fromEntries(format.formatToParts(time)
    .filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}

function dateOnly(parts) {
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
}

export function nextReminder(now, {timezone, time, weekdays, completed = []}, lastDate = null) {
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const today = dateOnly(zonedParts(format, now));
  const [hour, minutes] = time.split(':').map(Number);
  for (let offset = 0; offset < 15; offset++) {
    const workday = today + offset * dayMs;
    const date = new Date(workday).toISOString().slice(0, 10);
    const weekday = new Date(workday).getUTCDay() || 7;
    if (!weekdays.includes(weekday) || date === lastDate || completed.includes(date)) continue;
    const wall = workday + (hour * 60 + minutes) * minute;
    let target = wall;
    const seen = new Set();
    for (let i = 0; i < 4; i++) {
      const parts = zonedParts(format, target);
      const local = dateOnly(parts) + (Number(parts.hour) * 60 + Number(parts.minute)) * minute;
      if (local === wall) break;
      seen.add(target);
      const adjusted = target + wall - local;
      if (seen.has(adjusted)) { target = Math.max(target, adjusted); break; }
      target = adjusted;
    }
    if (target > now) return {date, at: target};
  }
  return null;
}
