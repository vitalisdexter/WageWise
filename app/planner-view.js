/* The app supplies the same persistent state used by Log and Settings. */
const plannerView = (() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const currency = new Intl.NumberFormat('en-GB', {style: 'currency', currency: 'GBP'});
  const dates = new Intl.DateTimeFormat('en-GB', {weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'});
  const money = pence => currency.format(pence / 100);
  const dateLabel = date => dates.format(new Date(date));
  const hours = minutes => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
  const signed = id => {
    const raw = $(id).value;
    return raw.startsWith('-') ? -Tracking.formMoney(raw.slice(1)) : Tracking.formMoney(raw);
  };
  const asInput = value => value == null ? '' : (value / 100).toFixed(2);
  let host;
  let tab = 'forecast';
  let periods = [];
  let source = '';
  let billEdit = null;
  let potEdit = null;
  let lastBudget;
  const plan = () => host.state().log.planner ?? Planner.empty();
  const today = () => Tracking.localDate();

  function el(tag, content = '', className = '') {
    const node = document.createElement(tag);
    node.textContent = content;
    if (className) node.className = className;
    return node;
  }

  function button(label, handler, primary = false) {
    const node = el('button', label, primary ? 'primary' : '');
    node.type = 'button';
    node.addEventListener('click', () => run(node, handler));
    return node;
  }

  async function run(element, handler) {
    if (element.dataset.busy) return;
    element.dataset.busy = 'true';
    try { host.notice(); await handler(); }
    catch (error) { host.notice(error.message || String(error), true); }
    finally { delete element.dataset.busy; }
  }

  function submit(id, handler) {
    $(id).addEventListener('submit', event => { event.preventDefault(); run($(id), handler); });
  }

  async function update(change, message) {
    await host.save(state => {
      const planner = change(state.log.planner ?? Planner.empty(), state);
      if (!Planner.valid(planner)) throw Error('Check the planner amounts and dates.');
      return {...state, log: {...state.log, planner}};
    });
    render();
    host.notice(message);
  }

  function table(headers, rows, caption = '') {
    const result = el('table', '', 'planner-table');
    if (caption) result.append(el('caption', caption));
    const header = el('tr');
    for (const label of headers) {
      const cell = el('th', label);
      cell.scope = 'col';
      header.append(cell);
    }
    const head = el('thead');
    head.append(header);
    result.append(head);
    const body = el('tbody');
    for (const [label, ...values] of rows) {
      const row = el('tr');
      const title = el('th', label);
      title.scope = 'row';
      row.append(title, ...values.map(value => el('td', value)));
      body.append(row);
    }
    result.append(body);
    return result;
  }

  function cardWithActions(label, detail, edit, remove) {
    const item = el('li', '', 'row');
    const content = el('div', '', 'entry-text');
    content.append(el('strong', label), el('small', detail));
    const actions = el('div', '', 'entry-actions');
    actions.append(button('Edit', edit), button('Remove', remove));
    item.append(content, actions);
    return item;
  }

  function renderForecast() {
    const data = plan();
    $('forecast-list').replaceChildren(...periods.map(period => {
      const card = el('article', '', 'card forecast-card');
      const main = period.payroll[2];
      const format = (entry, field) => entry.pay ? money(Math.round(field(entry.pay) * 100)) : '—';
      card.append(el('h2', dateLabel(period.payDate)), el('p', `Work period ${dateLabel(period.from)} to ${dateLabel(period.cutoff)}`, 'context'));
      if (!main.pay) card.append(el('p', main.error, 'context'));
      else {
        const basis = main.pay.taxWeek === 53 ? 'Week 53 basis' : main.prior
          ? 'Cumulative estimate' : 'Weekly estimate · a continuous payslip starting point is unavailable';
        const logged = period.payroll[1].overtime.minutes;
        card.append(el('p', `${hours(logged)} logged · ${hours(main.overtime.minutes - logged)} planned remaining`, 'context'),
          el('p', basis, 'context'));
      }
      const net = ['Take-home', ...period.payroll.map(item => format(item, pay => pay.net))];
      const columns = ['Estimate', 'Basic', 'Logged', '+ Planned'];
      card.append(table(columns, [net], 'Comparison of take-home pay'));
      const details = el('details');
      details.append(el('summary', 'Pay and deductions'), table(columns, [
        ['Gross', pay => pay.gross], ['PAYE', pay => pay.taxW], ['National Insurance', pay => pay.niRes.ni],
        ['Other deductions', pay => pay.customDedRes.total]
      ].map(([label, field]) => [label, ...period.payroll.map(entry => format(entry, field))])));
      card.append(details);
      return card;
    }));
    if (!periods.length) {
      const setup = el('article', '', 'card');
      setup.append(el('p', 'Set a known overtime cutoff and its payday to see your forecast.'), button('Open payroll settings', host.settings, true));
      $('forecast-list').append(setup);
    }
    $('planned-card').hidden = !periods.length;
    $('planned-date').min = periods[0]?.from ?? today();
    $('planned-date').max = periods.at(-1)?.cutoff ?? today();
    const plannedDate = $('planned-date');
    if (!plannedDate.value || plannedDate.value < plannedDate.min || plannedDate.value > plannedDate.max) {
      plannedDate.value = [plannedDate.min, today(), plannedDate.max].sort()[1];
    }
    $('planned-list').replaceChildren(...Object.entries(data.planned).sort(([a], [b]) => b.localeCompare(a)).map(([date, minutes]) => {
      const activePeriod = periods.find(period => !period.confirmed && date >= period.from && date <= period.cutoff);
      const remaining = activePeriod ? Planner.remainingMinutes(host.state().log, data.planned, date) : 0;
      return cardWithActions(dateLabel(date), `${hours(minutes)} planned · ${hours(remaining)} remaining`, () => {
        $('planned-date').value = date;
        $('planned-hours').value = minutes / 60;
        $('planned-date').scrollIntoView({block: 'nearest'});
      }, () => update(current => {
        const planned = {...current.planned};
        delete planned[date];
        return {...current, planned};
      }, 'Planned hours removed'));
    }));
  }

  const options = (select, items, selected) => {
    select.replaceChildren(...items.map(([value, label]) => {
      const item = el('option', label);
      item.value = value;
      return item;
    }));
    if (items.some(([value]) => value === selected)) select.value = selected;
  };

  function goalPeriod() { return periods.find(period => period.payDate === $('goal-payday').value); }

  function goalContext() {
    $('goal-result').replaceChildren();
    const period = goalPeriod();
    const log = host.state().log;
    $('goal-calculate').disabled = !period?.payroll[2].pay;
    if (!period) {
      $('goal-cutoff').textContent = 'Set your cutoff and payday in Settings first.';
      return;
    }
    const eligible = Planner.eligibleDates(log, period, today());
    const nextDate = Tracking.dateAdd(period.cutoff, 1);
    const nextWork = today() < nextDate ? nextDate : today();
    const nextPay = Tracking.payPeriod(nextWork, log.schedule).payDate;
    $('goal-cutoff').textContent = `Cutoff ${dateLabel(period.cutoff)}. ${eligible.length
      ? `Eligible dates ${eligible.map(day => dateLabel(day.date)).join(', ')}.`
      : 'There are no remaining eligible work dates for this payday.'} Overtime on ${dateLabel(nextWork)} would count towards ${dateLabel(nextPay)}. ${period.payroll[2].error ?? ''}`;
  }

  function allocate(card, period, minutes, eligible) {
    const form = el('form');
    form.append(el('h2', 'Choose dates for the extra hours'));
    for (const {date, capacity} of eligible) {
      const label = el('label', `${dateLabel(date)} · extra hours`);
      const input = el('input');
      Object.assign(input, {type: 'number', min: '0', max: String(Math.floor(capacity / 15) / 4), step: '0.25', inputMode: 'decimal', value: '0', name: date});
      label.append(input);
      form.append(label);
    }
    const confirm = el('button', 'Confirm planned hours', 'primary');
    confirm.type = 'submit';
    form.append(confirm);
    form.addEventListener('submit', event => {
      event.preventDefault();
      run(form, async () => {
        const allocations = [...form.querySelectorAll('input')].map(input => ({date: input.name, minutes: Number(input.value) * 60}));
        await update((current, state) => ({...current, planned: Planner.addGoal(state.log, period, today(), allocations, minutes)}), 'Extra overtime added to your plan');
        switchTab('forecast');
      });
    });
    card.append(form);
  }

  function calculateGoal() {
    const period = goalPeriod();
    const log = host.state().log;
    const eligible = Planner.eligibleDates(log, period, today());
    const result = Planner.goal(period, Tracking.formMoney($('goal-target').value), Number($('goal-max').value) * 60, eligible);
    const card = el('article', '', 'card');
    const highlight = el('div', '', 'planner-result');
    highlight.append(el('strong', result.reached ? `${hours(result.minutes)} extra` : `${money(result.shortfall)} short of target`),
      el('p', result.reached && !result.minutes ? 'Your existing forecast meets this target.'
        : `${result.reached ? 'Estimated' : 'Best achievable'} take-home ${currency.format(result.pay.net)} with ${hours(result.minutes)} extra.`));
    card.append(highlight);
    if (result.minutes) {
      const add = button('Add to plan', () => { add.hidden = true; allocate(card, period, result.minutes, eligible); }, true);
      card.append(add);
    }
    $('goal-result').replaceChildren(card);
  }

  function renderBudget() {
    const data = plan();
    const selected = $('budget-source');
    const entries = periods.flatMap(period => period.payroll.flatMap((item, index) => item.pay
      ? [{id: `${period.payDate}/${index}`, label: `${dateLabel(period.payDate)} · ${Planner.scenarios[index]} estimate`, net: Math.round(item.pay.net * 100)}] : []));
    const actualEntries = (host.state().calculator?.history ?? []).filter(item => item.manual)
      .sort((left, right) => right.date.localeCompare(left.date))
      .map(item => ({id: 'pay/' + item.id, label: `${dateLabel(item.date)} · Actual payslip`, net: Math.round(item.net * 100)}));
    const all = [...actualEntries, ...entries];
    options(selected, [...all.map(item => [item.id, item.label]), ['actual', 'Enter a take-home amount']],
      source || (actualEntries[0]?.id ?? entries[2]?.id ?? 'actual'));
    source = selected.value;
    const actual = source === 'actual';
    $('actual-net-form').hidden = !actual;
    $('actual-net').value = asInput(data.actualNet);
    const net = actual ? data.actualNet : all.find(entry => entry.id === source)?.net;
    lastBudget = net == null ? null : Planner.budget(net, data.bills, data.pots);
    $('budget-summary').replaceChildren(...(lastBudget ? [table(['Weekly allocation', 'Amount'], [
      [actual || source.startsWith('pay/') ? 'Actual take-home' : 'Estimated take-home', money(net)], ['Bills reserve', money(lastBudget.reserved)],
      ['Left to split', money(lastBudget.available)], ...(lastBudget.shortfall ? [['Shortfall', money(lastBudget.shortfall)]] : []),
      ...lastBudget.pots.map(pot => [`${pot.name} (${pot.share}%)`, money(pot.value)])
    ])] : [el('p', 'Enter take-home pay from your payslip to see your split.', 'context')]));
    const actions = [
      {key: 'bills', list: 'bill-list', values: data.bills, detail: bill => `${money(bill.pence)} ${bill.cadence} · ${money(bill.cadence === 'weekly' ? bill.pence : Math.round(bill.pence * 12 / 52))} weekly reserve`, edit: index => {
        billEdit = index;
        $('bill-name').value = data.bills[index].name;
        $('bill-amount').value = asInput(data.bills[index].pence);
        $('bill-cadence').value = data.bills[index].cadence;
        $('bill-name').focus();
      }},
      {key: 'pots', list: 'pot-list', values: data.pots, detail: pot => `${pot.share}% of remaining pay`, edit: index => {
        potEdit = index;
        $('pot-name').value = data.pots[index].name;
        $('pot-share').value = data.pots[index].share;
        $('pot-name').focus();
      }}
    ];
    for (const {key, list, values, detail, edit} of actions) {
      $(list).replaceChildren(...values.map((item, index) => cardWithActions(item.name, detail(item), () => edit(index), () => {
        billEdit = null; potEdit = null;
        $('bill-form').reset(); $('pot-form').reset();
        return update(current => ({...current, [key]: current[key].filter((_, i) => i !== index)}), 'Allocation updated');
      })));
    }
    options($('projection-pot'), data.pots.map((pot, index) => [String(index), pot.name]), $('projection-pot').value);
    $('use-pot').disabled = !lastBudget || !data.pots.length;
    $('projection-pot').disabled = $('use-pot').disabled;
  }

  function renderProjection() {
    const saved = plan().projection;
    const result = $('projection-result');
    result.replaceChildren();
    if (!saved) return;
    for (const key of ['balance', 'weekly', 'years', 'returnRate', 'downside', 'fee']) {
      const value = saved[key];
      const id = key === 'returnRate' ? 'return' : key;
      $(`projection-${id}`).value = key === 'years' ? value : asInput(value);
    }
    let view;
    try { view = Planner.projection(saved); }
    catch (error) { result.append(el('p', error.message)); return; }
    result.append(el('p', `New contributions over ${saved.years} years: ${money(view.contributions)}`, 'context'),
      table(['Scenario', 'Ending balance', 'Fee impact'], [
        ['Contributions only', money(view.baseline), '—'], ['Chosen assumptions', money(view.chosen.ending), money(view.chosen.feeImpact)],
        ['Downside assumptions', money(view.downside.ending), money(view.downside.feeImpact)]
      ], 'Fee impact is the reduction in ending balance compared with the same return and no fees.'));
  }

  function render() {
    periods = Planner.forecast(host.state(), today());
    if (tab === 'forecast') renderForecast();
    if (tab === 'goal') {
      options($('goal-payday'), periods.map(period => [period.payDate, dateLabel(period.payDate)]), $('goal-payday').value);
      goalContext();
    }
    if (tab === 'pots') { renderBudget(); renderProjection(); }
  }

  function switchTab(next) {
    tab = next;
    for (const control of document.querySelectorAll('[data-planner]')) {
      const active = control.dataset.planner === tab;
      control.setAttribute('aria-pressed', String(active));
      $(`planner-${control.dataset.planner}`).hidden = !active;
    }
    render();
  }

  function connect(api) {
    host = api;
    for (const control of document.querySelectorAll('[data-planner]')) control.onclick = () => switchTab(control.dataset.planner);
    submit('ytd-form', () => {
      const date = $('planner-anchor-date').value;
      if (!Tracking.dateValid(date) || date > today()) throw Error('Enter the date of a payslip you have already received.');
      const anchor = {date, gross: Tracking.formMoney($('planner-anchor-gross').value), tax: signed('planner-anchor-tax')};
      return update(current => ({...current, anchor}), 'Payslip totals saved');
    });
    $('clear-anchor').onclick = () => run($('clear-anchor'), () => update(current => ({...current, anchor: null}), 'Payslip totals cleared'));
    submit('planned-form', () => {
      const date = $('planned-date').value;
      const minutes = Number($('planned-hours').value) * 60;
      return update((current, state) => {
        const period = Tracking.payPeriod(date, state.log.schedule);
        if (!period || !Planner.forecast(state, today()).some(row => row.payDate === period.payDate && !row.confirmed)) {
          throw Error('Choose a work date covered by an unconfirmed forecast payday.');
        }
        const planned = {...current.planned};
        if (minutes) planned[date] = minutes;
        else delete planned[date];
        return {...current, planned};
      }, 'Planned hours saved');
    });
    $('goal-payday').onchange = goalContext;
    for (const id of ['goal-target', 'goal-max']) $(id).oninput = () => $('goal-result').replaceChildren();
    submit('goal-form', calculateGoal);
    $('budget-source').onchange = () => { source = $('budget-source').value; renderBudget(); };
    submit('actual-net-form', () => {
      const actualNet = signed('actual-net');
      return update(current => ({...current, actualNet}), 'Actual take-home saved');
    });
    submit('bill-form', async () => {
      const bill = {name: $('bill-name').value.trim(), pence: Tracking.formMoney($('bill-amount').value), cadence: $('bill-cadence').value};
      await update(current => {
        const bills = current.bills.slice();
        bills[billEdit ?? bills.length] = {...bill, id: bills[billEdit]?.id ?? crypto.randomUUID()};
        return {...current, bills};
      }, 'Bill saved');
      billEdit = null;
      $('bill-form').reset();
    });
    submit('pot-form', async () => {
      const pot = {name: $('pot-name').value.trim(), share: Number($('pot-share').value)};
      await update(current => {
        const pots = current.pots.slice();
        pots[potEdit ?? pots.length] = {...pot, id: pots[potEdit]?.id ?? crypto.randomUUID()};
        if (pots.reduce((sum, entry) => sum + entry.share, 0) > 100) throw Error('Pot percentages must add up to 100% or less.');
        return {...current, pots};
      }, 'Pot saved');
      potEdit = null;
      $('pot-form').reset();
    });
    $('use-pot').onclick = () => { $('projection-weekly').value = asInput(lastBudget?.pots[Number($('projection-pot').value)]?.value); };
    submit('projection-form', () => {
      const projection = {balance: signed('projection-balance'), weekly: signed('projection-weekly'), years: Number($('projection-years').value),
        returnRate: signed('projection-return'), downside: signed('projection-downside'), fee: signed('projection-fee')};
      if (projection.downside > projection.returnRate) throw Error('The downside return must be at or below your chosen return.');
      Planner.projection(projection);
      return update(current => ({...current, projection}), 'Investment scenarios calculated');
    });
  }

  function resetDrafts() {
    billEdit = null;
    potEdit = null;
    source = '';
    $('planned-date').value = '';
    for (const id of ['planned-form', 'goal-form', 'bill-form', 'pot-form', 'projection-form']) $(id).reset();
  }

  function renderLatestTotals() {
    const anchor = host.state().log.planner?.anchor;
    $('planner-anchor-date').value = anchor?.date ?? '';
    $('planner-anchor-date').max = today();
    $('planner-anchor-gross').value = asInput(anchor?.gross);
    $('planner-anchor-tax').value = asInput(anchor?.tax);
    $('clear-anchor').hidden = !anchor;
  }

  return {connect, render, resetDrafts, renderLatestTotals};
})();
