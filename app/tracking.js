(function (root, factory) {
  if (typeof module === 'object') module.exports = factory();
  else root.Tracking = factory();
})(globalThis, function () {
  'use strict';

  const DAY = 86400000;
  const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
  const DEFAULT_RATE = 1650;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const number = (value, min = 0, max = 1000000000) => Number.isFinite(value) && value >= min && value <= max;
  const integer = (value, min, max) => Number.isInteger(value) && number(value, min, max);
  const dateValid = value => typeof value === 'string' && datePattern.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const timeValid = value => typeof value === 'string' && timePattern.test(value);
  const dateAdd = (date, days) => new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);
  const weekday = date => (new Date(date).getUTCDay() + 6) % 7 + 1;

  function localDate(date = new Date()) {
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((part, index) =>
      String(part).padStart(index === 0 ? 4 : 2, '0')).join('-');
  }

  function shiftMinutes(start, end, breakMinutes) {
    if (!timeValid(start) || !timeValid(end) || !integer(breakMinutes, 0, 1439)) {
      throw Error('Enter valid start, end and break times.');
    }
    const minutesOfDay = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    const duration = (minutesOfDay(end) - minutesOfDay(start) + 1440) % 1440;
    if (duration <= breakMinutes) throw Error('The shift must be longer than its break.');
    return duration - breakMinutes;
  }

  function empty(today = localDate()) {
    return {started: today, days: {}, checks: {}, schedule: null, ratePence: DEFAULT_RATE,
      reminder: {enabled: false, weekdays: [1, 2, 3, 4, 5], time: '19:00'}};
  }

  function dayStatus(log, date, today) {
    return log.days[date]?.status ?? (date >= log.started && date <= today &&
      log.reminder.weekdays.includes(weekday(date)) ? 'missing' : '');
  }

  function payPeriod(date, schedule) {
    if (!dateValid(date) || !validSchedule(schedule) || schedule === null) return null;
    const offset = (Date.parse(date) - Date.parse(schedule.cutoff)) / DAY;
    const cutoff = dateAdd(schedule.cutoff, Math.ceil(offset / 7) * 7);
    return {from: dateAdd(cutoff, -6), cutoff, payDate: dateAdd(schedule.payDate, Math.ceil(offset / 7) * 7)};
  }

  function periodForPayDate(date, schedule) {
    if (!schedule || !dateValid(date)) return null;
    const offset = (Date.parse(date) - Date.parse(schedule.payDate)) / DAY;
    return offset % 7 === 0 ? payPeriod(dateAdd(schedule.cutoff, offset), schedule) : null;
  }

  function allShifts(log) {
    return Object.keys(log.days).sort().flatMap(date => log.days[date].shifts.map(shift => ({date, ...shift})));
  }

  function availableShifts(log, payDate) {
    const used = new Set(Object.entries(log.checks).filter(([date]) => date !== payDate)
      .flatMap(([, check]) => check.shifts.map(shift => shift.id)));
    return allShifts(log).filter(shift => !used.has(shift.id));
  }

  function shiftsForPayday(log, payDate) {
    const confirmed = log.checks[payDate];
    const period = periodForPayDate(payDate, log.schedule);
    if (confirmed) return confirmed.shifts;
    if (!period) return null;
    return availableShifts(log, payDate).filter(shift => shift.date >= period.from && shift.date <= period.cutoff);
  }

  function totals(shifts) {
    const minutesByRate = new Map();
    let minutes = 0;
    for (const shift of shifts) {
      minutes += shift.minutes;
      minutesByRate.set(shift.ratePence, (minutesByRate.get(shift.ratePence) ?? 0) + shift.minutes);
    }
    const payPence = [...minutesByRate].reduce((sum, [rate, duration]) => sum + Math.round(duration * rate / 60), 0);
    return {minutes, hundredths: Math.round(minutes * 100 / 60), payPence};
  }

  function discrepancy(check) {
    const expected = totals(check.shifts);
    return {expected, hoursDifference: check.actualHours - expected.hundredths,
      payDifference: check.actualPay - expected.payPence};
  }

  function formMoney(value) {
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(value)) throw Error('Enter an amount with up to two decimal places.');
    return Math.round(Number(value) * 100);
  }

  function validSchedule(schedule) {
    return schedule === null || (isObject(schedule) && dateValid(schedule.cutoff) &&
      dateValid(schedule.payDate) && schedule.payDate >= schedule.cutoff);
  }

  function validShift(shift) {
    if (!isObject(shift) || typeof shift.id !== 'string' || !/^[a-f0-9-]{36}$/.test(shift.id) ||
      !integer(shift.minutes, 1, 1440) || !integer(shift.ratePence, 0, 9999999) ||
      typeof shift.note !== 'string' || shift.note.length > 300) return false;
    if (shift.start == null && shift.end == null && shift.breakMinutes == null) return true;
    try { return shift.minutes === shiftMinutes(shift.start, shift.end, shift.breakMinutes); }
    catch { return false; }
  }

  function validLog(log) {
    if (!isObject(log) || !dateValid(log.started) || !isObject(log.days) || !isObject(log.checks) ||
      !validSchedule(log.schedule) || !integer(log.ratePence, 0, 9999999)) return false;
    const reminder = log.reminder;
    if (!isObject(reminder) || typeof reminder.enabled !== 'boolean' || !timeValid(reminder.time) ||
      !Array.isArray(reminder.weekdays) || reminder.weekdays.length < 1 ||
      reminder.weekdays.length !== new Set(reminder.weekdays).size ||
      !reminder.weekdays.every(day => integer(day, 1, 7))) return false;
    const ids = new Set();
    const checkedIds = new Set();
    return Object.entries(log.days).every(([date, day]) => dateValid(date) && isObject(day) &&
      ['overtime', 'none', 'off'].includes(day.status) && Array.isArray(day.shifts) &&
      (day.status === 'overtime') === Boolean(day.shifts.length) && day.shifts.every(shift => {
        if (!validShift(shift) || ids.has(shift.id)) return false;
        ids.add(shift.id);
        return true;
      }) && totals(day.shifts).minutes <= 1440) && Object.entries(log.checks).every(([date, check]) =>
      dateValid(date) && isObject(check) && integer(check.actualHours, 0, 16800) &&
      integer(check.actualPay, 0, 999999999) && Array.isArray(check.shifts) && check.shifts.every(shift => {
        if (!validShift(shift) || !dateValid(shift.date) || checkedIds.has(shift.id)) return false;
        checkedIds.add(shift.id);
        return true;
      }));
  }

  // Validate fields used by the imported calculator's existing HTML templates.
  const optional = (object, key, test) => object[key] == null || test(object[key]);
  const text = value => typeof value === 'string';
  const safeId = value => Number.isSafeInteger(value) && value >= 0;
  const optionalDate = value => value === '' || dateValid(value);
  const optionalTime = value => value === '' || timeValid(value);
  const list = (value, test) => Array.isArray(value) && value.every(test);
  const signedAmount = value => number(value, -1000000000);
  const prior = value => isObject(value) && number(value.gross) && signedAmount(value.tax) &&
    optional(value, 'ni', number) && integer(value.week, 0, 52) && integer(value.year, 1900, 9999);
  const legacyShift = value => isObject(value) && ['manual', 'shift'].includes(value.mode) && number(value.rate) &&
    number(value.hours) && optional(value, 'date', optionalDate) && optional(value, 'startTime', optionalTime) &&
    optional(value, 'endTime', optionalTime) && optional(value, 'breakMins', number) &&
    optional(value, 'logShiftId', id => /^[a-f0-9-]{36}$/.test(id) && dateValid(value.date));
  const deduction = value => isObject(value) && text(value.name) && number(value.value) &&
    ['amount', 'percent'].includes(value.type) && optional(value, 'id', safeId);
  const deductions = value => list(value, deduction);
  const snapshot = value => isObject(value) && optional(value, 'prior', prior) &&
    ['cumulativeGross', 'cumulativeTaxToDate', 'cumulativeNiToDate'].every(key => optional(value, key, signedAmount)) &&
    optional(value, 'customDedRes', result => isObject(result) && signedAmount(result.total) &&
      list(result.breakdown, item => deduction(item) && signedAmount(item.amount)));
  const entry = value => isObject(value) && safeId(value.id) && dateValid(value.date) &&
    number(value.gross) && signedAmount(value.net) && optional(value, 'otEntries', items => list(items, legacyShift)) &&
    optional(value, 'basic', number) && optional(value, 'otTotal', number) && optional(value, 'tax', signedAmount) &&
    optional(value, 'ni', value.imported ? signedAmount : number) && optional(value, 'allowance', number) && optional(value, 'note', text) &&
    optional(value, 'customDeductions', deductions) && optional(value, 'snapshot', snapshot) &&
    optional(value, 'imported', d => (typeof module==='object' ? require('./payslip-import') : globalThis.PayslipImport).valid(d) && d.date===value.date);
  const numberText = value => text(value) && (value === '' || /^-?\d+(\.\d+)?$/.test(value));

  function validateCalculator(value) {
    return isObject(value) && optional(value, 'basic', number) && optional(value, 'allowance', number) &&
      optional(value, 'salaryRevision', text) && optional(value, 'payDate', optionalDate) &&
      optional(value, 'useOvertimeLog', value => typeof value === 'boolean') &&
      optional(value, 'theme', theme => ['light', 'dark'].includes(theme)) &&
      optional(value, 'accent', accent => ['pine', 'indigo', 'plum', 'slate'].includes(accent)) &&
      optional(value, 'employeeName', text) && optional(value, 'employerName', text) &&
      optional(value, 'activePresetId', safeId) && optional(value, 'customDeductions', deductions) &&
      optional(value, 'deductionPresets', items => list(items, preset => isObject(preset) &&
        safeId(preset.id) && text(preset.name) && deductions(preset.deductions))) &&
      optional(value, 'history', items => list(items, entry)) &&
      optional(value, 'otEntries', items => list(items, legacyShift)) &&
      optional(value, 'ytd', ytd => isObject(ytd) && typeof ytd.enabled === 'boolean' &&
        integer(ytd.year, 1900, 9999) && ['gross', 'tax', 'ni', 'week'].every(key => numberText(ytd[key])));
  }

  function readBackup(json) {
    const data = JSON.parse(json);
    if (data?.format === 'wagewise-backup' && data.version === 1 && validateCalculator(data.state)) {
      return {calculator: data.state, log: null};
    }
    if (((data?.format === 'wagewise-android' && data.version === 1) ||
      (data?.format === 'wagewise' && data.version === 2)) && validLog(data.log) &&
      (data.calculator === null || validateCalculator(data.calculator))) {
      return {calculator: data.calculator, log: data.log};
    }
    throw Error('This file is not a valid WageWise backup.');
  }

  return {MAX_BACKUP_BYTES, dateValid, timeValid, dateAdd, weekday, localDate, shiftMinutes, empty, dayStatus,
    payPeriod, periodForPayDate, allShifts, availableShifts, shiftsForPayday, totals, discrepancy, formMoney, validSchedule, readBackup};
});
