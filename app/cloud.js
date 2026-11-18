import {createClient} from '@supabase/supabase-js';

const $ = id => document.getElementById(id);
const storage = window.WageWiseData;
const features = window.WageWiseFeatures;
const {equal, merge} = window.WageWiseMerge;
const empty = () => ({calculator: null, log: Tracking.empty()});
const envelope = data => ({format: 'wagewise', version: 2, ...data});
const validate = data => Planner.readBackup(JSON.stringify(data));
const status = message => { $('sync-status').textContent = message; };
let client;
let connection;
let running;
let queued = false;
let timer;
let generation = 0;
let firstOpen = false;

function button(label, action) {
  const item = document.createElement('button');
  item.type = 'button';
  item.textContent = label;
  item.onclick = () => run(item, action);
  return item;
}

function paragraph(text) {
  const element = document.createElement('p');
  element.textContent = text;
  return element;
}

async function run(control, action) {
  control.disabled = true;
  try { await action(); }
  catch (error) { status(error.message || 'WageWise could not connect.'); }
  finally { control.disabled = false; }
}

async function rpc(name, args) {
  const {data, error} = await client.rpc('wagewise_' + name, args);
  if (error) throw error;
  return data;
}

function controls(paired) {
  $('sync-pair-form').hidden = paired;
  $('sync-create').hidden = paired;
  $('sync-retry').hidden = !paired;
  $('sync-logout').hidden = !paired;
  $('sync-rotate').hidden = !paired;
  $('sync-import').hidden = true;
  $('sync-conflicts').hidden = true;
  status(paired ? 'Paired · Connecting…' : 'Create a pairing code or paste one from your other device.');
}

async function cloudRead(id) {
  const remote = await rpc('read', {expected_workspace: id});
  return remote ? {...remote, data: validate(remote.data)} : {revision: 0, data: null};
}

function workspaceDescription(data) {
  const shifts = Tracking.allShifts(data.log).length;
  return `${shifts} logged shifts, ${Object.keys(data.log.checks).length} payslip checks and ${data.calculator?.history?.length ?? 0} pay entries`;
}

async function allowFirstUpload(id, remote, authorized) {
  const guest = (await storage.get('guest')).data;
  if (!authorized()) return;
  const blankLog = Tracking.empty(guest.log.started);
  if (!guest.calculator && equal(guest.log, blankLog)) {
    await openAccount(id, remote, remote.data ?? empty(), authorized);
    return;
  }
  const preview = $('sync-import');
  firstOpen = true;
  preview.replaceChildren(
    paragraph('This device has ' + workspaceDescription(guest) + ', plus any payroll and Planner settings.'),
    paragraph(remote.data ? 'Add local records to your account. Existing account values take priority where the same record differs.' :
      'Add the local records and settings to your new account.'),
    button('Add local data to account', async () => {
      const data = remote.data ? merge(empty(), remote.data, guest).data : guest;
      await openAccount(id, remote, validate(envelope(data)), authorized);
    }),
    button('Open account without local data', () => openAccount(id, remote, remote.data ?? empty(), authorized))
  );
  preview.hidden = false;
  status('Review the local records before opening this account.');
}

async function openAccount(id, remote, data, authorized) {
  if (!authorized()) return;
  await storage.change('account:' + id, old => old ?? {data, base: remote.data, revision: remote.revision});
  if (!authorized()) return;
  await features.useWorkspace('account:' + id);
  await storage.change('active-account', () => ({id}));
  firstOpen = false;
  $('sync-import').hidden = true;
  schedule();
}

async function disconnect() {
  if (!navigator.onLine) throw Error('Reconnect to disconnect this device.');
  const key = features.getWorkspace();
  const record = await storage.get(key);
  if (key !== 'guest' && !equal(record.data, record.base) &&
    !confirm('Some changes are pending. Disconnect and keep them on this device?')) return;
  if (connection) await rpc('disconnect');
  generation++;
  connection = null;
  firstOpen = false;
  await storage.change('active-account', () => undefined);
  await features.useWorkspace('guest');
  $('sync-created-code').replaceChildren();
  $('sync-created-code').hidden = true;
  controls(false);
  await client.auth.signOut({scope: 'local'});
}

async function connectWorkspace(id) {
  const epoch = ++generation;
  connection = id;
  firstOpen = false;
  const authorized = () => generation === epoch && connection === id;
  controls(true);
  try {
    const remote = await cloudRead(id);
    if (!authorized()) return;
    if (await storage.get('account:' + id)) await openAccount(id, remote, remote.data ?? empty(), authorized);
    else await allowFirstUpload(id, remote, authorized);
  } catch (error) {
    if (!authorized()) return;
    if (await storage.get('account:' + id) && error.code !== '42501') {
      await features.useWorkspace('account:' + id);
      status('Offline or unable to contact sync. Changes are saved on this device.');
    } else throw error;
  }
}

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return 'WW-' + btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function showCode(code) {
  const panel = $('sync-created-code');
  const text = document.createElement('code');
  text.textContent = code;
  panel.replaceChildren(paragraph('Save this code somewhere private. It gives another device access to your WageWise records.'),
    text, button('Copy pairing code', async () => {
      await navigator.clipboard.writeText(code);
      status('Pairing code copied.');
    }), button('Hide code', () => { panel.replaceChildren(); panel.hidden = true; }));
  panel.hidden = false;
}

async function pair(code, createWorkspace) {
  if (!/^WW-[a-zA-Z0-9_-]{43}$/.test(code)) throw Error('Paste the full WageWise pairing code.');
  let {data, error} = await client.auth.getSession();
  if (error) throw error;
  if (!data.session) {
    ({data, error} = await client.auth.signInAnonymously());
    if (error) throw error;
  }
  const id = await rpc('pair', {pairing_code: code, create_workspace: createWorkspace});
  if (createWorkspace) showCode(code);
  await connectWorkspace(id);
}

function conflictPanel(conflicts, resolve) {
  const panel = $('sync-conflicts');
  const choices = Object.create(null);
  const fields = conflicts.map(conflict => {
    const field = document.createElement('label');
    const select = document.createElement('select');
    for (const [value, title] of [['', 'Choose the version to keep'], ['local', 'This device'], ['remote', 'Cloud']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = title;
      select.append(option);
    }
    select.onchange = () => { choices[conflict.key] = select.value; };
    field.append(conflict.label || 'WageWise records', select);
    return field;
  });
  panel.replaceChildren(paragraph('Some records changed on both devices.'), ...fields,
    button('Apply choices', () => {
      if (conflicts.some(item => !choices[item.key])) throw Error('Choose a version for each conflict.');
      return resolve(choices);
    }));
  panel.hidden = false;
}

async function synchronize(choices, reviewed) {
  const id = connection;
  const key = 'account:' + id;
  const epoch = generation;
  const usable = () => epoch === generation && features.getWorkspace() === key;
  if (!id || !usable() || firstOpen) return;
  const record = await storage.get(key);
  const remote = await cloudRead(id);
  if (!usable()) return;
  if (reviewed && (!equal(record.data, reviewed.local) || remote.revision !== reviewed.revision)) choices = undefined;
  const review = {local: record.data, revision: remote.revision};
  const combined = remote.data ? merge(record.base, record.data, remote.data, choices) : {data: record.data, conflicts: []};
  if (combined.conflicts.length) {
    status('Review changes made on both devices.');
    conflictPanel(combined.conflicts, value => syncNow(value, review));
    return;
  }
  let candidate;
  try { candidate = validate(envelope(combined.data)); }
  catch (error) {
    if (!remote.data) throw error;
    if (!choices?.snapshot) {
      status('The combined changes could not be saved together.');
      conflictPanel([{key: 'snapshot', label: 'Combined records'}], value => syncNow(value, review));
      return;
    }
    candidate = choices.snapshot === 'remote' ? remote.data : record.data;
  }
  let revision = remote.revision;
  if (!equal(candidate, remote.data)) {
    revision = await rpc('write', {expected_workspace: id, expected_revision: revision,
      snapshot: envelope(candidate), mutation_id: crypto.randomUUID()});
    if (revision == null) { queued = true; return; }
  }
  if (!usable()) return;
  let adopted = false;
  await storage.change(key, current => {
    if (!equal(current.data, record.data) || current.revision !== record.revision) return current;
    adopted = true;
    return {...current, data: candidate, base: candidate, revision};
  });
  if (!usable()) return;
  if (!adopted) { queued = true; return; }
  if (!equal(candidate, record.data)) await features.useWorkspace(key);
  $('sync-conflicts').hidden = true;
  status(`Paired · Last synced ${new Date().toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit'})}`);
}

function syncNow(choices, reviewed) {
  if (running) { queued = true; return running; }
  running = synchronize(choices, reviewed).catch(async error => {
    if (error.code === '42501') {
      await storage.change('active-account', () => undefined);
      await features.useWorkspace('guest');
      connection = null;
      controls(false);
      status('This device is no longer paired.');
    } else status('Sync paused. Changes are saved on this device. ' + (error.message || ''));
  }).finally(() => {
    running = null;
    if (queued) { queued = false; schedule(); }
  });
  return running;
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(syncNow, 450);
}

async function initiate() {
  let config;
  try { config = await (await fetch('/sync-config.json', {cache: 'no-store'})).json(); } catch {}
  if (!config?.url || !config?.publishableKey) {
    status('Account sync has not been configured. Your records are saved on this device.');
    return;
  }
  client = createClient(config.url, config.publishableKey, {auth: {detectSessionInUrl: false}});
  controls(false);
  $('sync-create').onclick = () => run($('sync-create'), () => pair(newCode(), true));
  $('sync-pair-form').onsubmit = event => {
    event.preventDefault();
    run(event.submitter, async () => {
      await pair($('sync-code-input').value.trim(), false);
      $('sync-code-input').value = '';
    });
  };
  $('sync-logout').onclick = () => run($('sync-logout'), disconnect);
  $('sync-retry').onclick = () => run($('sync-retry'), syncNow);
  $('sync-rotate').onclick = () => run($('sync-rotate'), async () => {
    if (!confirm('Replace this code? Existing devices will stay connected.')) return;
    const code = newCode();
    await rpc('replace_code', {pairing_code: code, expected_workspace: connection});
    showCode(code);
  });
  window.addEventListener('wagewise-data', event => {
    if (event.detail.key !== 'guest') { status('Changes saved here · Sync pending'); schedule(); }
  });
  window.addEventListener('online', schedule);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
  setInterval(() => { if (!document.hidden) schedule(); }, 25000);
  const last = await storage.get('active-account');
  if (last && await storage.get('account:' + last.id)) {
    connection = last.id;
    await features.useWorkspace('account:' + last.id);
    controls(true);
    status('Changes are saved on this device · Connecting…');
  }
  const restorePairing = async () => {
    if (!navigator.onLine || firstOpen) return;
    const {data, error} = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) {
      if (last?.id === connection) {
        controls(false);
        status('Pair again to sync. Pending changes remain on this device.');
      }
      return;
    }
    const id = await rpc('workspace');
    if (id) {
      if (features.getWorkspace() === 'account:' + id) schedule();
      else await connectWorkspace(id);
    }
  };
  window.addEventListener('online', () => restorePairing().catch(error => status(error.message)));
  await restorePairing();
}
window.addEventListener('wagewise-ready', () => initiate().catch(error => status(error.message)), {once: true});
