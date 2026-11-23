(function () {
'use strict';

const $ = id => document.getElementById(id);
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LABELS = {overtime: 'Overtime logged', none: 'No overtime', off: 'Day off', missing: 'Missing entry', '': 'Unscheduled'};
const gbp = new Intl.NumberFormat('en-GB', {style: 'currency', currency: 'GBP'});
const dateFormat = new Intl.DateTimeFormat('en-GB', {weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC'});
const money = pence => gbp.format(pence / 100);
const dateText = date => dateFormat.format(new Date(date));
const duration = minutes => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
const encode = state => JSON.stringify({format: 'wagewise', version: 2, ...state});
const isAndroid = window.Capacitor?.getPlatform() === 'android';
const native = isAndroid ? window.Capacitor.Plugins?.WageWise : null;
const storage = window.WageWiseData;
let workspace = 'guest';
let deviceReminder;

let state;
let pending = Promise.resolve();
let screen = 'calculator';
let selectedDate = Tracking.localDate();
let editShiftId = null;
let editingCheck = false;
let checkOptions = [];

function node(tag, text = '', className = '') {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function button(text, onClick) {
  const element = node('button', text);
  element.type = 'button';
  element.addEventListener('click', onClick);
  return element;
}

function notice(text = '', error = false) {
  $('notice').textContent = text;
  $('notice').classList.toggle('error', error);
  $('notice').hidden = !text;
  if (error) window.scrollTo(0, 0);
}

function save(change, source = 'log') {
  if(!window.WageWiseAccess.valid)return Promise.reject(Error('Reconnect to save changes.'));
  const key = workspace;
  const write = pending.then(async () => {
    const record = await storage.change(key, (stored, records) => {
      const next = change(stored?.data ?? state, records);
      if (new TextEncoder().encode(encode(next)).length > Tracking.MAX_BACKUP_BYTES) throw Error('Storage limit reached. Export a backup.');
      return {...stored, data: next};
    });
    if (workspace !== key) return;
    state = record.data;
    window.dispatchEvent(new CustomEvent('wagewise-data', {detail: {key, source}}));
    if (source !== 'calculator') updateReminders();
  });
  pending = write.catch(() => {});
  return write;
}

async function updateReminders() {
  if (!deviceReminder) return;
  if (!native) {
    if (deviceReminder.enabled) window.WageWiseWebReminders?.update(reminderSettings()).catch(() => {});
    return;
  }
  try {
    await native.writeReminderProjection({json: JSON.stringify({
      reminder: {...deviceReminder, weekdays: state.log.reminder.weekdays},
      days: Object.fromEntries(Object.keys(state.log.days).map(date => [date, true]))
    })});
  } catch (error) { notice(error.message, true); }
}

function reminderSettings() {
  const today = Tracking.localDate();
  const from = Tracking.dateAdd(today, -1), to = Tracking.dateAdd(today, 8);
  return {time: deviceReminder.time, weekdays: state.log.reminder.weekdays,
    completed: Object.keys(state.log.days).filter(date => date >= from && date <= to).sort()};
}

async function useWorkspace(key) {
  await pending;
  const record = await storage.get(key);
  if (!record) throw Error('This workspace has not been opened yet.');
  workspace = key;
  state = record.data;
  deviceReminder = await storage.get(key+':reminder');
  editingCheck = false;
  closeEditor();
  plannerView.resetDrafts();
  window.dispatchEvent(new Event('wagewise-workspace'));
  renderScreen();
  updateReminders();
}
function action(id, event, handler) {
  $(id).addEventListener(event, async e => {
    e.preventDefault();
    if (e.currentTarget.dataset.busy) return;
    const target = e.currentTarget;
    target.dataset.busy = 'true';
    try { await handler(e); }
    catch (error) { notice(error.message || String(error), true); }
    finally { delete target.dataset.busy; }
  });
}

function show(next) { window.WageWiseNavigate(next); }

function renderScreen() {
  if (screen === 'calendar') renderDay();
  if (screen === 'payslip' && !$('checks').hidden) renderCheck();
  if (screen === 'settings') loadSettings();
  if (screen === 'planner') plannerView.render();
}
function selectDate(date) {
  if (!Tracking.dateValid(date) || date > Tracking.localDate()) return;
  selectedDate = date;
  closeEditor();
  renderDay();
}

function renderDay() {
  const today = Tracking.localDate();
  $('log-date').max = today;
  $('log-date').value = selectedDate;
  const record = state.log.days[selectedDate];
  const status = Tracking.dayStatus(state.log, selectedDate, today);
  $('day-status').className = `status ${status}`;
  $('day-status').textContent = LABELS[status];
  const period = Tracking.payPeriod(selectedDate, state.log.schedule);
  $('suggested-pay').textContent = period ? `Scheduled payday ${dateText(period.payDate)}` : 'Set a cutoff in Settings to group shifts by payday.';
  $('clear-day').hidden = !record || record.status === 'overtime';
  $('shifts').replaceChildren(...(record?.shifts ?? []).map(shift => {
    const item = node('li', '', 'row');
    const content = node('div', '', 'entry-text');
    content.append(node('strong', `${duration(shift.minutes)} at ${money(shift.ratePence)}/hr`));
    if (shift.start) content.append(node('small', `${shift.start}–${shift.end} · ${shift.breakMinutes} min break`));
    if (shift.note) content.append(node('small', shift.note));
    const controls = node('div', '', 'entry-actions');
    controls.append(button('Edit', () => openEditor(shift)), button('Remove', async () => {
      if (!confirm('Remove this shift from your daily log?')) return;
      try {
        const remaining = record.shifts.filter(entry => entry.id !== shift.id);
        await setDay(remaining.length ? {status: 'overtime', shifts: remaining} : null);
        notice('Shift removed');
      } catch (error) { notice(error.message, true); }
    }));
    item.append(content, controls);
    return item;
  }));
}

function setDay(record) {
  const date = selectedDate;
  return save(current => {
    const days = {...current.log.days};
    if (record) days[date] = record;
    else delete days[date];
    return {...current, log: {...current.log, days}};
  }).then(() => { closeEditor(); renderDay(); });
}

function updateShiftMode() {
  const clock = $('shift-mode').value === 'clock';
  $('clock-fields').hidden = !clock;
  $('duration-fields').hidden = clock;
  for (const id of ['start', 'end', 'break']) $(id).disabled = !clock;
  for (const id of ['hours', 'minutes']) $(id).disabled = clock;
  renderShiftEstimate();
}

function readShiftTiming() {
  if ($('shift-mode').value !== 'clock') {
    return {minutes: Number($('hours').value) * 60 + Number($('minutes').value)};
  }
  const start = $('start').value;
  const end = $('end').value;
  const breakMinutes = Number($('break').value);
  return {start, end, breakMinutes, minutes: Tracking.shiftMinutes(start, end, breakMinutes)};
}

function renderShiftEstimate() {
  const output = $('shift-pay');
  try {
    const {minutes} = readShiftTiming();
    const ratePence = Tracking.formMoney($('shift-rate').value);
    output.textContent = Number.isInteger(minutes) && minutes > 0 && minutes <= 1440
      ? money(Tracking.totals([{minutes, ratePence}]).payPence) : '—';
  } catch { output.textContent = '—'; }
}

function openEditor(shift = null) {
  editShiftId = shift?.id ?? null;
  $('shift-heading').textContent = shift ? 'Edit overtime' : 'Log overtime';
  $('shift-mode').value = shift?.start ? 'clock' : 'duration';
  $('hours').value = Math.floor((shift?.minutes ?? 0) / 60);
  $('minutes').value = (shift?.minutes ?? 0) % 60;
  $('shift-rate').value = ((shift?.ratePence ?? state.log.ratePence) / 100).toFixed(2);
  $('shift-note').value = shift?.note ?? '';
  $('start').value = shift?.start ?? '';
  $('end').value = shift?.end ?? '';
  $('break').value = shift?.breakMinutes ?? 0;
  $('shift-form').hidden = false;
  $('day-actions').hidden = true;
  updateShiftMode();
  $('shift-heading').scrollIntoView({block: 'nearest'});
}

function closeEditor() {
  $('shift-form').hidden = true;
  $('day-actions').hidden = false;
  editShiftId = null;
}

async function markDay(status) {
  if (state.log.days[selectedDate]?.shifts.length && !confirm('Replace the shifts on this day with this status?')) return;
  await setDay({status, shifts: []});
  notice(LABELS[status]);
}

function option(shift, selected) {
  const label = node('label', '', 'check');
  const choice = node('input');
  choice.type = 'checkbox';
  choice.value = shift.id;
  choice.checked = selected;
  choice.addEventListener('change', renderPreview);
  label.append(choice, node('span', `${dateText(shift.date)} · ${duration(shift.minutes)} at ${money(shift.ratePence)}/hr`));
  return label;
}

function checkedShifts() {
  const checked = new Set([...$('check-form').querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value));
  return checkOptions.filter(shift => checked.has(shift.id));
}

function renderPreview() {
  const total = Tracking.totals(checkedShifts());
  $('check-preview').textContent = `Selected overtime ${duration(total.minutes)} · ${money(total.payPence)}`;
}

function renderCheck() {
  const date = $('check-date').value;
  const check = state.log.checks[date];
  const period = Tracking.periodForPayDate(date, state.log.schedule);
  $('confirmed-check').hidden = !check || editingCheck;
  $('check-form').hidden = Boolean(check && !editingCheck);
  $('cancel-check').hidden = !editingCheck;
  $('check-period').textContent = check && !editingCheck ? 'Confirmed shifts for this payday.' : period
    ? `Scheduled work dates ${dateText(period.from)} to ${dateText(period.cutoff)}.`
    : 'Choose the shifts manually for this pay date.';
  if (check && !editingCheck) {
    const diff = Tracking.discrepancy(check);
    const list = node('ul', '', 'entries');
    for (const shift of check.shifts) list.append(node('li', `${dateText(shift.date)} · ${duration(shift.minutes)} at ${money(shift.ratePence)}/hr`));
    const signedHours = (diff.hoursDifference > 0 ? '+' : '') + (diff.hoursDifference / 100).toFixed(2);
    $('confirmed-details').replaceChildren(
      node('p', `Logged ${(diff.expected.hundredths / 100).toFixed(2)}h · ${money(diff.expected.payPence)}`),
      node('p', `Payslip ${(check.actualHours / 100).toFixed(2)}h · ${money(check.actualPay)}`),
      node('p', diff.hoursDifference || diff.payDifference
        ? `Payslip difference ${signedHours}h · ${diff.payDifference > 0 ? '+' : ''}${money(diff.payDifference)}`
        : 'Overtime hours and pay match.'), list);
  } else {
    const saved = new Map(check?.shifts.map(shift => [shift.id, shift]));
    const available = new Map(Tracking.availableShifts(state.log, date).map(shift => [shift.id, shift]));
    for (const [id, shift] of saved) available.set(id, shift);
    checkOptions = [...available.values()].sort((a, b) => a.date.localeCompare(b.date));
    const suggested = shift => Boolean(period && shift.date >= period.from && shift.date <= period.cutoff);
    const main = checkOptions.filter(shift => saved.has(shift.id) || suggested(shift));
    const remaining = checkOptions.filter(shift => !main.includes(shift));
    $('check-shifts').replaceChildren(...(main.length ? main.map(shift => option(shift, check ? saved.has(shift.id) : true))
      : [node('p', 'No shifts are selected for this payday.', 'context')]));
    $('other-shifts').replaceChildren(...remaining.map(shift => option(shift, false)));
    $('other-details').hidden = !remaining.length;
    $('other-details').open = remaining.length > 0 && !main.length;
    const imported = (state.calculator?.history??[]).filter(e=>e.date===date && e.imported?.frequency==='weekly')
      .flatMap(e=>e.imported.lines).filter(row=>row.kind==='overtime');
    const totals = PayslipImport.totals(imported);
    $('actual-hours').value = check ? (check.actualHours / 100).toFixed(2) : imported.length && totals.hours!=null ? totals.hours.toFixed(2) : '';
    $('actual-pay').value = check ? (check.actualPay / 100).toFixed(2) : imported.length ? (totals.overtime/100).toFixed(2) : '';
    renderPreview();
  }
  const payDates = Object.keys(state.log.checks).sort().reverse();
  $('past-checks-card').hidden = !payDates.length;
  $('past-checks').replaceChildren(...payDates.map(payDate => {
    const item = node('li');
    item.append(button(dateText(payDate), () => { $('check-date').value = payDate; editingCheck = false; renderCheck(); }));
    return item;
  }));
}

function loadSettings() {
  const {reminder, schedule, ratePence} = state.log;
  $('reminder-enabled').checked = deviceReminder.enabled;
  $('reminder-time').value = deviceReminder.time;
  $('reminder-days').replaceChildren(...DAYS.map((day, index) => {
    const label = node('label', '', 'check');
    const choice = node('input');
    choice.type = 'checkbox';
    choice.value = index + 1;
    choice.checked = reminder.weekdays.includes(index + 1);
    label.append(choice, node('span', day));
    return label;
  }));
  $('anchor-cutoff').value = schedule?.cutoff ?? '';
  $('anchor-pay').value = schedule?.payDate ?? '';
  $('default-rate').value = (ratePence / 100).toFixed(2);
  reminderStatus().catch(error => notice(error.message, true));
}

async function reminderStatus() {
  if (!native) {
    const supported = window.WageWiseWebReminders?.supported();
    $('reminder-status').hidden = false;
    $('test-reminder').hidden = !supported || !deviceReminder.enabled;
    $('reminder-status').textContent = !supported ? 'Open WageWise in a browser that supports Web Push.' :
      Notification.permission === 'denied' ? 'Allow WageWise notifications in your browser settings.' :
      deviceReminder.enabled ? 'Reminders are enabled on this device. Delivery can take a few minutes.' :
      'Enable reminders to get a notification when it’s time to log overtime.';
    return;
  }
  const allowed = native && (await native.notificationStatus()).allowed;
  $('notification-settings').hidden = !native || allowed;
  $('reminder-status').hidden = !native;
  $('reminder-status').textContent = !native ? 'Reminders are available in the installed Android app.' : !deviceReminder.enabled
    ? 'Reminders are off.' : allowed ? 'Reminders are on. Android may deliver them later than the selected time.'
      : 'Allow WageWise notifications in Android settings to receive reminders.';
}

async function exportBackup() {
  await pending;
  const json = encode(native ? {...state, log: {...state.log, reminder: {...state.log.reminder, ...deviceReminder}}} : state);
  const name = `wagewise-${Tracking.localDate()}.json`;
  if (native) {
    const {saved} = await native.exportBackup({json, name});
    if (saved) notice('Backup saved');
  } else {
    const url = URL.createObjectURL(new Blob([json], {type: 'application/json'}));
    const link = node('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function offerRestore(backup) {
  const preview = $('backup-preview');
  const count = backup.calculator?.history?.length ?? 0;
  const summary = backup.log
    ? `${Object.keys(backup.log.days).length} logged days, ${Object.keys(backup.log.checks).length} payslip comparisons and ${count} saved pay entries.${backup.log.planner ? ' Includes planner settings.' : ''}`
    : `${count} saved pay entries and calculator settings. Your overtime log will be kept.`;
  const apply = button('Replace from backup', async () => {
    apply.disabled = true;
    try {
      await save(current => ({calculator: backup.calculator, log: backup.log ? {...backup.log,
        reminder: {...Tracking.empty().reminder, weekdays: backup.log.reminder.weekdays}} : current.log}));
      if (native && backup.log) {
        const {enabled, time} = backup.log.reminder;
        deviceReminder = await storage.change(workspace+':reminder', () => ({enabled, time}));
        updateReminders();
      }
      window.dispatchEvent(new Event('wagewise-workspace'));
      preview.hidden = true;
      editingCheck = false;
      plannerView.resetDrafts();
      loadSettings();
      notice('Backup restored');
    } catch (error) { notice(error.message, true); apply.disabled = false; }
  });
  apply.className = 'primary';
  const buttons = node('div', '', 'actions');
  buttons.append(apply, button('Cancel', () => { preview.hidden = true; preview.replaceChildren(); }));
  preview.replaceChildren(node('h2', 'Review backup'), node('p', summary),
    node('p', backup.log ? 'Restoring this backup replaces the app’s current records and settings.' : 'Restoring replaces the current calculator records and settings.'), buttons);
  preview.hidden = false;
}

async function init() {
  const identity=await window.WageWiseAccess.ready;
  if (isAndroid && !native) throw Error('Android storage is unavailable.');
  let local = await storage.get('guest');
  let legacy;
  if (!local) {
    const json = native ? (await native.readState()).json : localStorage.getItem('wagewise-android-preview');
    if (json) legacy = Planner.readBackup(json);
    else {
      const raw = localStorage.getItem('wagewise-v5');
      if (raw) legacy = Planner.readBackup(JSON.stringify({format: 'wagewise-backup', version: 1, state: JSON.parse(raw)}));
    }
    local = await storage.change('guest', existing => existing ?? {data: {
      calculator: legacy?.calculator ?? null, log: legacy?.log ?? Tracking.empty()
    }});
  }
  workspace='account:'+identity.workspace;
  const snapshot=await window.WageWiseAccess.request('read',{workspace:identity.workspace});
  const cloud=snapshot?Planner.readBackup(JSON.stringify(snapshot.data)):{calculator:null,log:Tracking.empty()};
  let account=await storage.get(workspace);
  if(account&&!account.originalsMigrated)await storage.adoptOriginals(workspace,account.data.calculator?.history);
  if(!account)account=await storage.change(workspace,existing=>existing??{originalsMigrated:true,data:cloud,base:cloud,revision:snapshot?.revision??0});
  state=account.data;

  const reminderKey=workspace+':reminder';
  deviceReminder = await storage.get(reminderKey);
  if (!deviceReminder) {
    const {enabled, time} = state.log.reminder;
    const legacyReminder=(await storage.get('active-account'))?.id===identity.workspace?await storage.get('device-reminder'):null;
    deviceReminder = await storage.change(reminderKey, existing => existing ?? legacyReminder ?? {enabled: Boolean(native && enabled), time});
  }
  if (state.log.reminder.enabled || state.log.reminder.time !== Tracking.empty().reminder.time) {
    await storage.change(workspace, current => ({...current, data: {...current.data,
      log: {...current.data.log, reminder: {...Tracking.empty().reminder, weekdays: current.data.log.reminder.weekdays}}}}));
    state = (await storage.get(workspace)).data;
  }
  Object.assign(api, {
    flush: () => pending,
    readCalculator: () => structuredClone(state.calculator),
    readLogDays: () => structuredClone(state.log.days),
    dayStatus: date => Tracking.dayStatus(state.log, date, Tracking.localDate()),
    monthlyOvertime: month => Tracking.totals(Tracking.allShifts(state.log).filter(shift => shift.date.startsWith(month))),
    recentShifts: () => Tracking.allShifts(state.log).slice(-4).reverse(),
    nextPay: () => Planner.forecast(state, Tracking.localDate())[0],
    overtimeForPayday: date => structuredClone(Tracking.shiftsForPayday(state.log, date)),
    defaultPayday: () => state.log.schedule ? Planner.nextPayday(state.log.schedule, Tracking.localDate()) : Tracking.localDate(),
    latestPayslip: () => structuredClone(state.log.planner?.anchor ?? null),
    read: () => structuredClone(state),
    getWorkspace: () => workspace,
    importPayslip: ({entry,file,replace,anchor,mapping,workspaceKey,expectedMatches}) => save((current,records)=>{
      if(workspace!==workspaceKey)throw Error('The workspace changed. Open the file again.');
      const history=current.calculator?.history??[];
      const matches=window.PayslipReview.matches(history,entry);
      if(matches.some(e=>e.imported?.hash===entry.imported.hash))throw Error('This file already has a saved pay entry.');
      if(JSON.stringify(matches)!==expectedMatches)throw Error('Pay history changed during review. Review the matching records again.');
      if(!Tracking.dateValid(entry.date)||!PayslipImport.valid(entry.imported))throw Error('Check the pay date, figures and line categories.');
      const updated=[{...entry,id:replace??entry.id},...history.filter(e=>e.id!==replace)];
      const log={...current.log};
      if(anchor){
        const planner=log.planner??Planner.empty();
        if(planner.anchor?.date>entry.date)throw Error('A newer YTD starting point already exists.');
        log.planner={...planner,anchor:{date:entry.date,gross:entry.imported.ytdGross,tax:entry.imported.ytdTax}};
      }
      records.put(file,workspace+':payslip-file:'+entry.imported.hash);
      if(mapping)records.put(mapping.rules,mapping.key);
      return {...current,calculator:{...current.calculator,history:updated},log};
    },'payslip-import'),
    useWorkspace,
    selectCalendarDate: date => { if (date !== selectedDate) selectDate(date); else renderDay(); },
    priorForPayday: date => {
      if (!Tracking.dateValid(date)) return null;
      const anchor = state.log.planner?.anchor;
      return Planner.priorFor(date, anchor?.date <= Tracking.localDate() ? anchor : null);
    },
    openPayslipTotals: () => {
      show('payslip');
      $('payslip-preview').hidden = false;
      $('forecast-setup').hidden = false;
      $('checks').hidden = true;
      plannerView.renderLatestTotals();
      $('forecast-setup').open = true;
      $('forecast-setup').scrollIntoView({block: 'start'});
    },
    openPayslipCheck: date => {
      $('check-date').value = date || Tracking.localDate();
      editingCheck = false;
      show('payslip');
      $('payslip-preview').hidden = true;
      $('forecast-setup').hidden = true;
      $('checks').hidden = false;
      renderCheck();
    },
    openLogDate: date => { show('calendar'); selectDate(date); window.dispatchEvent(new CustomEvent('wagewise-calendar-date', {detail: date})); },
    saveCalculator: calculator => {
      const snapshot = structuredClone(calculator);
      save(current => ({...current, calculator: snapshot}), 'calculator').catch(error => notice(error.message, true));
    },
    exportBackup: () => exportBackup().catch(error => notice(error.message, true))
  });
  plannerView.connect({state: () => state, save, notice, settings: () => show('settings')});

  window.addEventListener('wagewise-screen', event => {
    screen = event.detail;
    notice();
    if (screen === 'payslip') {
      $('payslip-preview').hidden = false;
      $('forecast-setup').hidden = true;
      $('checks').hidden = true;
    }
    renderScreen();
  });
  $('back-to-payslip').onclick = () => show('payslip');
  $('planner-totals-link').onclick = api.openPayslipTotals;
  const reminderInputs = $('reminder-form');
  const canNotify = Boolean(native || window.WageWiseWebReminders?.supported());
  for (const element of reminderInputs.querySelectorAll('[data-reminder-control]')) element.hidden = !canNotify;
  $('log-date').onchange = () => api.openLogDate($('log-date').value);
  $('add-shift').onclick = () => openEditor();
  $('cancel-shift').onclick = closeEditor;
  $('shift-mode').onchange = updateShiftMode;
  $('shift-form').addEventListener('input', renderShiftEstimate);
  action('no-overtime', 'click', () => markDay('none'));
  action('day-off', 'click', () => markDay('off'));
  action('clear-day', 'click', () => setDay(null));
  action('shift-form', 'submit', async () => {
    const shift = {id: editShiftId ?? crypto.randomUUID(), ratePence: Tracking.formMoney($('shift-rate').value), note: $('shift-note').value.trim()};
    Object.assign(shift, readShiftTiming());
    if (!Number.isSafeInteger(shift.minutes) || shift.minutes < 1 || shift.minutes > 1440) throw Error('Enter between one minute and 24 hours of overtime.');
    const shifts = [...(state.log.days[selectedDate]?.shifts ?? [])];
    const index = shifts.findIndex(entry => entry.id === shift.id);
    if (index < 0) shifts.push(shift);
    else shifts[index] = shift;
    if (Tracking.totals(shifts).minutes > 1440) throw Error('Total overtime for one day cannot exceed 24 hours.');
    await setDay({status: 'overtime', shifts});
    notice('Shift saved');
  });

  $('check-date').value = Tracking.localDate();
  $('check-date').onchange = () => { editingCheck = false; renderCheck(); };
  $('edit-check').onclick = () => { editingCheck = true; renderCheck(); };
  $('cancel-check').onclick = () => { editingCheck = false; renderCheck(); };
  action('check-form', 'submit', async () => {
    const date = $('check-date').value;
    if (!Tracking.dateValid(date)) throw Error('Enter the payslip pay date.');
    const check = {shifts: checkedShifts(), actualHours: Tracking.formMoney($('actual-hours').value),
      actualPay: Tracking.formMoney($('actual-pay').value)};
    await save(current => ({...current, log: {...current.log, checks: {...current.log.checks, [date]: check}}}));
    editingCheck = false;
    renderCheck();
    notice('Payslip comparison saved');
  });
  action('reminder-form', 'submit', async () => {
    const weekdays = [...$('reminder-days').querySelectorAll('input:checked')].map(day => Number(day.value));
    if (!weekdays.length) throw Error('Choose at least one working day.');
    const time = $('reminder-time').value;
    if (!Tracking.timeValid(time)) throw Error('Choose a valid reminder time.');
    const enabled = $('reminder-enabled').checked;
    if (enabled) {
      if (native) await native.requestNotifications();
      else await window.WageWiseWebReminders.enable({...reminderSettings(), time, weekdays});
    } else if (!native && deviceReminder.enabled) await window.WageWiseWebReminders.disable();
    deviceReminder = await storage.change(workspace+':reminder', () => ({enabled, time,configured:true}));
    await save(current => ({...current, log: {...current.log, reminder: {...Tracking.empty().reminder, weekdays}}}));
    await reminderStatus();
    notice(enabled ? 'Reminder schedule saved' : 'Working days saved');
  });
  action('notification-settings', 'click', () => native.openNotificationSettings());
  action('test-reminder', 'click', async () => {
    await window.WageWiseWebReminders.test();
    notice('Test notification sent');
  });
  action('payroll-form', 'submit', async () => {
    const cutoff = $('anchor-cutoff').value;
    const payDate = $('anchor-pay').value;
    const schedule = cutoff || payDate ? {cutoff, payDate} : null;
    if (!Tracking.validSchedule(schedule)) throw Error('Enter a cutoff and a pay date on or after the cutoff.');
    const ratePence = Tracking.formMoney($('default-rate').value);
    await save(current => ({...current, log: {...current.log, schedule, ratePence}}));
    notice('Payroll settings saved');
  });
  action('export', 'click', exportBackup);
  $('import').onclick = () => { $('backup-file').value = ''; $('backup-preview').hidden = true; $('backup-file').click(); };
  action('backup-file', 'change', async () => {
    const file = $('backup-file').files[0];
    if (!file) return;
    if (file.size > Tracking.MAX_BACKUP_BYTES) throw Error('This backup is larger than 5 MB.');
    try { offerRestore(Planner.readBackup(await file.text())); }
    catch { throw Error('Choose a valid WageWise JSON backup.'); }
  });
  if (native) {
    const openReminder = ({date}) => {
      if (!Tracking.dateValid(date)) return;
      if (window.WageWiseNavigate) api.openLogDate(date);
      else api.launchDate = date;
    };
    await native.addListener('openLog', openReminder);
    openReminder(await native.takeLaunchDate());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (screen === 'settings') reminderStatus().catch(error => notice(error.message, true));
      renderScreen();
    });
  } else {
    const query = new URL(location.href).searchParams.get('log');
    if (Tracking.dateValid(query)) {
      api.launchDate = query;
      history.replaceState(null, '', location.pathname);
    }
    navigator.serviceWorker?.addEventListener('message', ({data}) => {
      if (data?.type === 'wagewise-reminder' && Tracking.dateValid(data.date)) api.openLogDate(data.date);
    });
    window.addEventListener('online', updateReminders);
  }
  updateReminders();
}

const api = window.WageWiseFeatures = {};
api.ready = init();
api.ready.catch(error => notice('WageWise could not open its saved data. ' + error.message, true));
})();
