const test = require('node:test');
const assert = require('node:assert/strict');
const Tracking = require('../app/tracking');

const shift = (id, minutes, ratePence = 1650) => ({id: `a0000000-0000-4000-8000-${String(id).padStart(12, '0')}`, minutes, ratePence, note: ''});
const schedule = {cutoff: '2026-10-25', payDate: '2026-11-06'};

test('inclusive cutoffs handle weeks before and after the anchor and DST', () => {
  assert.deepEqual(Tracking.payPeriod('2026-10-25', schedule), {from: '2026-10-19', cutoff: '2026-10-25', payDate: '2026-11-06'});
  assert.equal(Tracking.payPeriod('2026-10-26', schedule).payDate, '2026-11-13');
  assert.equal(Tracking.payPeriod('2026-10-18', schedule).payDate, '2026-10-30');
  assert.equal(Tracking.periodForPayDate('2026-10-30', schedule).cutoff, '2026-10-18');
  assert.equal(Tracking.periodForPayDate('2026-10-31', schedule), null);
  assert.equal(Tracking.validSchedule({cutoff: '2026-10-25', payDate: '2026-10-24'}), false);
});

test('overnight shifts deduct breaks and stay on their logged start date', () => {
  assert.equal(Tracking.shiftMinutes('22:15', '02:00', 30), 195);
  assert.throws(() => Tracking.shiftMinutes('22:15', '22:15', 0));
  assert.throws(() => Tracking.shiftMinutes('22:15', '23:00', 45));
  assert.throws(() => Tracking.shiftMinutes('25:00', '02:00', 0));
});

test('calendar distinguishes no overtime, days off, missing and unscheduled dates', () => {
  const log = Tracking.empty('2026-11-02');
  log.days['2026-11-02'] = {status: 'none', shifts: []};
  log.days['2026-11-03'] = {status: 'off', shifts: []};
  log.days['2026-11-04'] = {status: 'overtime', shifts: [shift(1, 90)]};
  const status = date => Tracking.dayStatus(log, date, '2026-11-18');
  assert.equal(status('2026-11-02'), 'none');
  assert.equal(status('2026-11-03'), 'off');
  assert.equal(status('2026-11-04'), 'overtime');
  assert.equal(status('2026-11-05'), 'missing');
  assert.equal(status('2026-11-07'), '');
  assert.equal(status('2026-10-30'), '');
  assert.equal(status('2026-11-19'), '');
});

test('reconciliation rounds total duration by rate and keeps saved original amounts', () => {
  const log = Tracking.empty('2026-10-01');
  log.days['2026-10-19'] = {status: 'overtime', shifts: [shift(1, 577)]};
  log.days['2026-10-20'] = {status: 'overtime', shifts: [shift(2, 578)]};
  const shifts = Tracking.availableShifts(log, '2026-11-06');
  const check = {actualHours: 1925, actualPay: 31763, shifts};
  log.checks['2026-11-06'] = check;
  assert.deepEqual(Tracking.discrepancy(check), {expected: {minutes: 1155, hundredths: 1925, payPence: 31763}, hoursDifference: 0, payDifference: 0});
  log.ratePence = 2000;
  log.schedule = {cutoff: '2026-10-27', payDate: '2026-11-06'};
  log.days['2026-10-20'].shifts[0].ratePence = 2100;
  assert.equal(Tracking.discrepancy(check).expected.payPence, 31763);
  assert.deepEqual(Tracking.availableShifts(log, '2026-11-13'), []);
  assert.equal(Tracking.discrepancy({...check, actualPay: 31500}).payDifference, -263);
});

test('imports existing browser exports and validates Android backups', () => {
  const calculator = {basic: 604.13, theme: 'light', history: [{id: 1, date: '2026-11-06', gross: 900, net: 710}]};
  assert.deepEqual(Tracking.readBackup(JSON.stringify({format: 'wagewise-backup', version: 1, state: calculator})), {calculator, log: null});
  const log = Tracking.empty('2026-11-03');
  log.days['2026-11-03'] = {status: 'overtime', shifts: [shift(1, 135)]};
  const android = {format: 'wagewise-android', version: 1, calculator, log};
  assert.deepEqual(Tracking.readBackup(JSON.stringify(android)), {calculator, log});
  log.reminder.weekdays.push(1);
  assert.throws(() => Tracking.readBackup(JSON.stringify(android)));
  assert.throws(() => Tracking.readBackup(JSON.stringify({format: 'wagewise-backup', version: 1, state: {otEntries: [{mode: 'shift', hours: 0, rate: 16.50, startTime: '\" onclick=\"alert(1)'}]}})));
});
