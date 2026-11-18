const test = require('node:test');
const assert = require('node:assert/strict');
const Payroll = require('../payroll');
const Tracking = require('../app/tracking');
const Planner = require('../app/planner');

const shift = (index, minutes, ratePence = 1650) => ({id: `a0000000-0000-4000-8000-${String(index).padStart(12, '0')}`, minutes, ratePence, note: ''});
function fixture() {
  const log = Tracking.empty('2026-10-01');
  log.schedule = {cutoff: '2026-11-01', payDate: '2026-11-06'};
  log.planner = Planner.empty();
  return {log, calculator: null};
}

test('forecast compares four cutoff-aligned paydays and subtracts logged hours from the plan', () => {
  const state = fixture();
  state.log.days['2026-11-01'] = {status: 'overtime', shifts: [shift(1, 120, 1800)]};
  state.log.planner.planned['2026-11-01'] = 180;
  state.calculator = {basic: 620, allowance: 12570, customDeductions: [{name: 'Union', type:'amount', value: 4}]};
  const rows = Planner.forecast(state, '2026-11-01');
  assert.deepEqual(rows.map(row => row.payDate), ['2026-11-06', '2026-11-13', '2026-11-20', '2026-11-27']);
  assert.deepEqual(rows[0].payroll.map(scenario => scenario.pay.gross), [620, 656, 672.5]);
  assert.equal(Planner.forecast(state, '2026-11-02')[0].payroll[2].pay.gross, 672.5);
  assert.equal(rows[0].payroll[2].pay.customDedRes.total, 4);
  state.log.days['2026-11-01'].shifts.push(shift(2, 60));
  assert.equal(Planner.forecast(state, '2026-11-01')[0].payroll[2].pay.gross, 672.5);
  assert.equal(Planner.forecast(state, '2026-10-31')[0].payroll[2].pay.gross, 672.5);
});

test('payslip assignments override cutoffs and preserve saved rates without counting a shift twice', () => {
  const state = fixture();
  const original = shift(1, 60, 1500);
  state.log.days['2026-11-01'] = {status: 'overtime', shifts: [{...original, ratePence: 2100}]};
  state.log.checks['2026-11-13'] = {shifts: [{...original, date: '2026-11-01'}], actualHours: 100, actualPay: 1500};
  const rows = Planner.forecast(state, '2026-11-01');
  assert.equal(rows[0].payroll[1].overtime.minutes, 0);
  assert.equal(rows[1].payroll[1].overtime.payPence, 1500);
});

test('separate PAYE scenario chains start at reliable actual totals and stop on gaps', () => {
  const state = fixture();
  const {planner, days} = state.log;
  planner.anchor = {date: '2026-10-30', gross: 1900000, tax: 237000};
  days['2026-11-01'] = {status: 'overtime', shifts: [shift(1, 360)]};
  planner.planned['2026-11-02'] = 480;
  const rows = Planner.forecast(state, '2026-11-01');
  for (const index of [0, 1, 2]) {
    assert.equal(rows[0].payroll[index].prior.gross, 19000);
    assert.equal(rows[1].payroll[index].prior.gross, rows[0].payroll[index].pay.cumulativeGross);
    assert.equal(rows[1].payroll[index].prior.tax, rows[0].payroll[index].pay.cumulativeTaxToDate);
  }
  assert.notEqual(rows[1].payroll[0].prior.gross, rows[1].payroll[2].prior.gross);
  assert(Planner.forecast(state, '2026-11-07').every(row => row.payroll.every(item => item.prior === null)));
  planner.anchor.date = '2026-11-06';
  assert.equal(Planner.forecast(state, '2026-11-06')[0].payDate, '2026-11-13');
});

test('the first supported tax week starts from zero and an unsupported year gives an error', () => {
  const state = fixture();
  state.log.planner.anchor = {date: '2026-04-03', gross: 2600000, tax: 350000};
  const first = Planner.forecast(state, '2026-04-06')[0].payroll[2];
  assert.deepEqual(first.prior, {year: 2026, week: 0, gross: 0, tax: 0});
  assert.equal(Planner.forecast(state, '2027-04-06')[0].payroll[2].error, 'Supported tax years: 2025/26 and 2026/27.');
});

test('goal uses the first quarter-hour reaching the target across the NI threshold', () => {
  const state = fixture();
  state.calculator = {basic: 960};
  const date = '2026-11-02';
  const period = Planner.forecast(state, date)[1];
  const eligible = Planner.eligibleDates(state.log, period, date);
  const expected = Payroll.calculate({gross: 972.38, date: period.payDate});
  const result = Planner.goal(period, Math.round(expected.net * 100), 120, eligible);
  assert.equal(result.reached, true);
  assert.equal(result.minutes, 45);
  assert.equal(result.pay.net, expected.net);
  assert.equal(Planner.goal(period, 10000, 30, eligible).minutes, 0);
  assert.equal(Planner.goal(period, 99999999, 30, eligible).minutes, 30);
  assert.equal(Planner.goal(period, 99999999, 30, []).minutes, 0);
});

test('goal allocation checks eligible dates and adds above existing logged minutes', () => {
  const state = fixture();
  const date = '2026-11-03';
  state.log.days[date] = {status: 'overtime', shifts: [shift(1, 90)]};
  state.log.days['2026-11-04'] = {status: 'off', shifts: []};
  state.log.planner.planned[date] = 60;
  const period = Planner.forecast(state, date)[1];
  assert(Planner.eligibleDates(state.log, period, date).some(day => day.date === date));
  assert.equal(Planner.addGoal(state.log, period, date, [{date, minutes: 45}], 45)[date], 135);
  assert.throws(() => Planner.addGoal(state.log, period, date, [{date: '2026-11-04', minutes: 45}], 45), /available dates/);
  assert.deepEqual(Planner.eligibleDates(state.log, period, '2026-11-09'), []);
  assert.throws(() => Planner.addGoal(state.log, period, '2026-11-09', [{date, minutes: 45}], 45));
});

test('budget converts monthly bills and reconciles every penny including unallocated pay', () => {
  const bills = [{name: 'Rent', pence: 52000, cadence: 'monthly'}, {name: 'Travel', pence: 1000, cadence: 'weekly'}];
  const pots = [{name: 'Savings', share: 33}, {name: 'Investing', share: 33}];
  const budget = Planner.budget(20001, bills, pots);
  assert.equal(budget.reserved, 13000);
  assert.equal(budget.available, 7001);
  assert.equal(budget.pots.reduce((sum, pot) => sum + pot.value, 0), 7001);
  assert.equal(budget.pots.at(-1).name, 'Unallocated');
  assert(Planner.budget(199, bills, pots).pots.every(pot => pot.value === 0));
  assert.equal(Planner.budget(199, bills, pots).shortfall, 12801);
  assert.throws(() => Planner.budget(1, [], [{share: 101}]), /percentages/);
});

test('investment calculations cover contributions, zero return, fees and loss', () => {
  const inputs = {balance: 100000, weekly: 1000, years: 1, returnRate: 0, downside: -1000, fee: 0};
  const result = Planner.projection(inputs);
  assert.equal(result.contributions, 52000);
  assert.equal(result.baseline, 152000);
  assert.equal(result.chosen.ending, 152000);
  assert.equal(result.chosen.feeImpact, 0);
  assert(result.downside.ending < result.baseline);
  assert.equal(Planner.projection({...inputs, weekly: 0, fee: 500}).chosen.ending, 95000);
  assert.equal(Planner.projection({...inputs, weekly: 0, fee: 500}).chosen.feeImpact, 5000);
  assert.throws(() => Planner.projection({...inputs, years: 50, returnRate:10000}), /too large/);
});

test('planner settings round-trip in Android backups and old logs remain intact', () => {
  const state = fixture();
  state.log.reminder.enabled = true;
  state.log.days['2026-11-01'] = {status:'overtime', shifts:[shift(1, 60)]};
  state.log.planner.planned['2026-11-05'] = 120;
  state.log.planner.pots.push({name: 'Investing', share: 20});
  const backup = () => JSON.stringify({format: 'wagewise-android', version: 1, ...state});
  assert.deepEqual(Planner.readBackup(backup()), state);
  state.log.planner.pots[0].share = 101;
  assert.throws(() => Planner.readBackup(backup()), /invalid planner/);
  delete state.log.planner;
  assert.deepEqual(Planner.readBackup(backup()), state);
});
