(function (root, factory) {
  if (typeof module === 'object') module.exports = factory(require('./tracking'), require('../payroll'));
  else root.Planner = factory(root.Tracking, root.Payroll);
})(globalThis, function (Tracking, Payroll) {
  'use strict';

  const scenarios = ['Basic pay', 'Logged overtime', 'Logged + planned'];
  const empty = () => ({anchor: null, planned: {}, bills: [], pots: [], actualNet: null, projection: null});
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const pence = value => Math.round(value * 100);
  const amount = (value, min = 0, max = 999999999) => Number.isSafeInteger(value) && value >= min && value <= max;
  const name = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 60;

  function valid(provisions) {
    if (!object(provisions)) return false;
    const {anchor, planned, bills, pots, actualNet, projection} = provisions;
    return (anchor === null || (object(anchor) && Tracking.dateValid(anchor.date) && amount(anchor.gross) && amount(anchor.tax, -999999999))) &&
      object(planned) && Object.entries(planned).every(([date, minutes]) => Tracking.dateValid(date) && amount(minutes, 1, 1440)) &&
      Array.isArray(bills) && bills.length <= 100 && bills.every(bill => object(bill) && name(bill.name) &&
        ['weekly', 'monthly'].includes(bill.cadence) && amount(bill.pence)) &&
      Array.isArray(pots) && pots.length <= 100 && pots.every(pot => object(pot) && name(pot.name) && amount(pot.share, 0, 100)) &&
      pots.reduce((sum, pot) => sum + pot.share, 0) <= 100 && (actualNet === null || amount(actualNet, -999999999)) &&
      (projection === null || (object(projection) && amount(projection.balance) && amount(projection.weekly) &&
        amount(projection.years, 1, 50) && amount(projection.returnRate, -9999, 10000) &&
        amount(projection.downside, -9999, projection.returnRate) && amount(projection.fee, 0, 10000)));
  }

  function readBackup(json) {
    const backup = Tracking.readBackup(json);
    if (backup.log && Object.hasOwn(backup.log, 'planner') && !valid(backup.log.planner)) {
      throw Error('The backup contains invalid planner settings.');
    }
    return backup;
  }

  function nextPayday(schedule, onOrAfter) {
    const days = (Date.parse(onOrAfter) - Date.parse(schedule.payDate)) / 86400000;
    return Tracking.dateAdd(schedule.payDate, Math.ceil(days / 7) * 7);
  }

  function loggedMinutes(log, date) {
    return (log.days[date]?.shifts ?? []).reduce((sum, shift) => sum + shift.minutes, 0);
  }

  function remainingMinutes(log, planned, date) {
    const status = log.days[date]?.status;
    if (status === 'off' || status === 'none') return 0;
    return Math.max(0, (planned[date] ?? 0) - loggedMinutes(log, date));
  }

  function priorFor(date, last) {
    const year = Payroll.year(date);
    const week = Payroll.week(date);
    if (week === 1) return {year, week: 0, gross: 0, tax: 0};
    if (!last || last.date >= date || Payroll.year(last.date) !== year || Payroll.week(last.date) !== week - 1) return null;
    return {year, week: week - 1, gross: last.gross / 100, tax: last.tax / 100};
  }

  function estimate(date, settings, shifts, prior) {
    const gross = (pence(settings.basic) + Tracking.totals(shifts).payPence) / 100;
    return Payroll.calculate({gross, date, allowance: settings.allowance, deductions: settings.deductions, prior});
  }

  function forecast(state, today) {
    const {log, calculator} = state;
    if (!log.schedule) return [];
    const settings = Payroll.calculatorSettings(calculator);
    const planner = log.planner ?? empty();
    const anchor = planner.anchor?.date <= today ? planner.anchor : null;
    const start = anchor?.date === today ? Tracking.dateAdd(today, 1) : today;
    const first = nextPayday(log.schedule, start);
    const last = scenarios.map(() => anchor);
    return Array.from({length: 4}, (_, i) => {
      const date = Tracking.dateAdd(first, i * 7);
      const period = Tracking.periodForPayDate(date, log.schedule);
      const confirmed = log.checks[date];
      const logged = Tracking.shiftsForPayday(log, date);
      const planned = confirmed ? [] : Object.keys(planner.planned).filter(day => day >= period.from && day <= period.cutoff)
        .map(day => ({date: day, minutes: remainingMinutes(log, planner.planned, day), ratePence: log.ratePence}));
      const groups = [[], logged, [...logged, ...planned]];
      const payroll = groups.map((shifts, index) => {
        const prior = priorFor(date, last[index]);
        try {
          const pay = estimate(date, settings, shifts, prior);
          last[index] = pay.cumulativeGross === null ? null : {
            date, gross: pence(pay.cumulativeGross), tax: pence(pay.cumulativeTaxToDate)
          };
          return {pay, prior, overtime: Tracking.totals(shifts)};
        } catch (error) {
          last[index] = null;
          return {error: error.message, overtime: Tracking.totals(shifts)};
        }
      });
      return {...period, settings, groups, payroll, ratePence: log.ratePence, confirmed: Boolean(confirmed)};
    });
  }

  function eligibleDates(log, period, today) {
    if (period.confirmed) return [];
    const planned = log.planner?.planned ?? {};
    return Array.from({length: 7}, (_, i) => Tracking.dateAdd(period.from, i))
      .filter(date => date >= today && log.reminder.weekdays.includes(Tracking.weekday(date)) &&
        !['off', 'none'].includes(log.days[date]?.status))
      .map(date => ({date, capacity: 1440 - Math.max(planned[date] ?? 0, loggedMinutes(log, date))}))
      .filter(day => day.capacity >= 15);
  }

  function goal(period, target, maxMinutes, eligible) {
    if (!amount(target, 1) || !amount(maxMinutes, 0, 10080) || maxMinutes % 15) {
      throw Error('Enter a positive pay target and extra hours in 15-minute steps.');
    }
    const base = period.payroll[2];
    if (!base.pay) throw Error(base.error);
    const capacity = eligible.reduce((sum, day) => sum + Math.floor(day.capacity / 15) * 15, 0);
    const cap = Math.min(maxMinutes, capacity);
    let best = {minutes: 0, pay: base.pay};
    const outcome = (result, reached) => ({...result, reached, cap, shortfall: Math.max(0, target - pence(result.pay.net))});
    if (pence(best.pay.net) >= target) return outcome(best, true);
    // Penny rounding can cause small dips. Scan the allowed quarter-hours in order.
    for (let minutes = 15; minutes <= cap; minutes += 15) {
      const pay = estimate(period.payDate, period.settings,
        [...period.groups[2], {minutes, ratePence: period.ratePence}], base.prior);
      if (pence(pay.net) >= target) return outcome({minutes, pay}, true);
      if (pence(pay.net) > pence(best.pay.net)) best = {minutes, pay};
    }
    return outcome(best, false);
  }

  function addGoal(log, period, today, allocations, minutes) {
    if (!log.schedule || log.checks[period.payDate]) throw Error('This payday no longer accepts planned overtime.');
    const current = Tracking.periodForPayDate(period.payDate, log.schedule);
    if (current?.cutoff !== period.cutoff) throw Error('The cutoff changed. Recalculate your goal.');
    const capacity = new Map(eligibleDates(log, current, today).map(day => [day.date, day.capacity]));
    if (!amount(minutes, 15, 10080) || allocations.reduce((sum, day) => sum + day.minutes, 0) !== minutes ||
      new Set(allocations.map(day => day.date)).size !== allocations.length ||
      allocations.some(({date, minutes: extra}) => !capacity.has(date) || !amount(extra, 0, capacity.get(date)) || extra % 15)) {
      throw Error('Allocate the required hours across the available dates in 15-minute steps.');
    }
    const planned = {...(log.planner?.planned ?? {})};
    for (const {date, minutes: extra} of allocations) {
      if (extra) planned[date] = Math.max(planned[date] ?? 0, loggedMinutes(log, date)) + extra;
    }
    return planned;
  }

  function budget(net, bills, pots) {
    const reserves = bills.map(bill => ({...bill, weekly: bill.cadence === 'weekly' ? bill.pence : Math.round(bill.pence * 12 / 52)}));
    const reserved = reserves.reduce((sum, bill) => sum + bill.weekly, 0);
    const available = Math.max(0, net - reserved);
    const share = pots.reduce((sum, pot) => sum + pot.share, 0);
    if (share > 100) throw Error('Pot percentages must add up to 100% or less.');
    const parts = [...pots, {name: 'Unallocated', share: 100 - share}].map(pot => ({...pot,
      value: Math.floor(available * pot.share / 100), remainder: available * pot.share % 100}));
    const pennies = available - parts.reduce((sum, pot) => sum + pot.value, 0);
    [...parts].sort((a, b) => b.remainder - a.remainder).slice(0, pennies).forEach(pot => pot.value++);
    return {reserves, reserved, available, shortfall: Math.max(0, reserved - net), pots: parts};
  }

  function projection(options) {
    const {balance, weekly, years, returnRate, downside, fee} = options;
    const weeks = years * 52;
    const contributions = weeks * weekly;
    function simulate(rate, feeRate) {
      const factor = ((1 + rate / 10000) * (1 - feeRate / 10000)) ** (1 / 52);
      let value = balance;
      for (let i = 0; i < weeks; i++) value = value * factor + weekly;
      const rounded = Math.round(value);
      if (!Number.isSafeInteger(rounded)) throw Error('The projected balance is too large. Reduce the amounts, years or assumed return.');
      return rounded;
    }
    const scenario = rate => {
      const ending = simulate(rate, fee);
      return {ending, feeImpact: simulate(rate, 0) - ending};
    };
    return {contributions, baseline: balance + contributions, chosen: scenario(returnRate), downside: scenario(downside)};
  }

  return {scenarios, empty, valid, readBackup, nextPayday, priorFor, loggedMinutes, remainingMinutes, forecast, eligibleDates, goal, addGoal, budget, projection};
});
