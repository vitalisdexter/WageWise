const test = require('node:test');
const assert = require('node:assert/strict');
const {nextReminder} = require('../app/reminder-time.mjs');

const workdays = {timezone: 'Europe/London', time: '19:00', weekdays: [1, 2, 3, 4, 5]};
const iso = value => new Date(value).toISOString();

test('uses local time on both sides of the UK clock change', () => {
  const dates = ['2026-03-27T17:00:00Z', '2026-03-30T17:00:00Z'];
  assert.equal(iso(nextReminder(Date.parse(dates[0]), workdays).at), '2026-03-27T19:00:00.000Z');
  assert.equal(iso(nextReminder(Date.parse(dates[1]), workdays).at), '2026-03-30T18:00:00.000Z');
});

test('skips completed workdays and weekends', () => {
  const next = nextReminder(Date.parse('2026-11-20T14:00:00Z'), {...workdays, completed: ['2026-11-20']});
  assert.deepEqual(next, {date: '2026-11-23', at: Date.parse('2026-11-23T19:00:00Z')});
});

test('skips a date that already produced a reminder even if the time changes', () => {
  const next = nextReminder(Date.parse('2026-11-18T15:00:00Z'), workdays, '2026-11-18');
  assert.equal(next.date, '2026-11-19');
});

test('handles local dates that differ from the Worker date', () => {
  const next = nextReminder(Date.parse('2026-11-19T00:00:00Z'), {...workdays, timezone: 'America/Los_Angeles'});
  assert.deepEqual(next, {date: '2026-11-18', at: Date.parse('2026-11-19T03:00:00Z')});
});
