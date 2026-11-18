import {createClient} from '@supabase/supabase-js';

let client;
let registration;
let previous;
let writing = Promise.resolve();

function supported() {
  return window.isSecureContext && 'serviceWorker' in navigator &&
    'PushManager' in window && 'Notification' in window;
}

async function token() {
  if (!client) {
    const response = await fetch('/sync-config.json');
    const config = await response.json();
    client = createClient(config.url, config.publishableKey, {
      auth: {storageKey: 'wagewise-reminder-device', detectSessionInUrl: false}
    });
  }
  let result = await client.auth.getSession();
  if (result.error) throw result.error;
  if (!result.data.session) result = await client.auth.signInAnonymously();
  if (result.error || !result.data.session) throw Error('This browser could not register for reminders.');
  return result.data.session.access_token;
}

async function request(route, method, body) {
  const response = await fetch('/api/reminders/' + route, {
    method,
    headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + await token()},
    body
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'Could not save web reminders.');
  return result;
}

async function serviceWorker() {
  if (!supported()) throw Error('Open WageWise in a browser that supports Web Push.');
  registration ??= await navigator.serviceWorker.getRegistration() ?? await navigator.serviceWorker.register('/sw.js');
  if (!registration.active) registration = await navigator.serviceWorker.ready;
  return registration;
}

function encode(settings, subscription) {
  return JSON.stringify({...settings, subscription: subscription.toJSON(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone});
}

function write(settings, immediate = false) {
  const task = writing.then(async () => {
    const worker = await serviceWorker();
    let subscription = await worker.pushManager.getSubscription();
    if (!subscription && immediate) {
      const response = await fetch('/api/reminders/key');
      if (!response.ok) throw Error('The reminder service is unavailable.');
      const {key} = await response.json();
      const bytes = Uint8Array.from(atob(key.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - key.length % 4) % 4)), char => char.charCodeAt(0));
      subscription = await worker.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: bytes});
    }
    if (!subscription) return;
    const payload = encode(settings, subscription);
    if (immediate || payload !== previous) {
      await request('subscription', 'PUT', payload);
      previous = payload;
    }
  });
  writing = task.catch(() => {});
  return task;
}

window.WageWiseWebReminders = {
  supported,
  async enable(settings) {
    if (!supported()) throw Error('Open WageWise in Chrome to enable reminders.');
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (permission !== 'granted') throw Error('Allow notifications for WageWise in your browser settings.');
    await write(settings, true);
  },
  async update(settings) {
    if (supported() && Notification.permission === 'granted' && navigator.onLine) await write(settings);
  },
  async disable() {
    const worker = await serviceWorker();
    await writing;
    await request('subscription', 'DELETE');
    const subscription = await worker.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
    previous = undefined;
  },
  test: () => request('test', 'POST')
};
