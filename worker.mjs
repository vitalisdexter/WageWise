import {buildPushPayload} from '@block65/webcrypto-web-push';
import client from './supabase/client.json';
import {handleAccounts} from './accounts.mjs';
import {nextReminder} from './app/reminder-time.mjs';

const production = 'https://wagewise.vitalisdexter.workers.dev';
const pushHosts = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const reply = (body, status = 200) => Response.json(body, {status, headers: {'Cache-Control': 'no-store'}});

async function deviceId(request) {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ') || authorization.length > 8192) return null;
  const result = await fetch(client.url + '/auth/v1/user', {headers: {apikey: client.publishableKey, Authorization: authorization}});
  return result.ok ? (await result.json()).id : null;
}

function validate(data) {
  const {subscription, timezone, time, weekdays, completed} = data || {};
  const keys = subscription?.keys;
  if (!subscription || typeof subscription.endpoint !== 'string' || subscription.endpoint.length > 1400 ||
    !/^[\w-]{87}$/.test(keys?.p256dh) || !/^[\w-]{22}$/.test(keys?.auth) ||
    typeof timezone !== 'string' || timezone.length > 80 ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
    !Array.isArray(weekdays) || weekdays.length < 1 || weekdays.length > 7 ||
    !weekdays.every(day => Number.isInteger(day) && day >= 1 && day <= 7) ||
    !Array.isArray(completed) || completed.length > 15 || !completed.every(date => datePattern.test(date))) {
    throw Error('Invalid reminder settings.');
  }
  const endpoint = new URL(subscription.endpoint);
  if (endpoint.protocol !== 'https:' || !pushHosts.has(endpoint.hostname) ||
    endpoint.port || endpoint.username || endpoint.password || endpoint.hash) throw Error('Unsupported push service.');
  // Reject unrecognised time zones before storing the schedule.
  new Intl.DateTimeFormat('en-GB', {timeZone: timezone});
  return {subscription: {endpoint: endpoint.href, expirationTime: null, keys}, schedule: {timezone, time, weekdays, completed}};
}

async function send(env, row, date, test = false) {
  const subscription = JSON.parse(row.subscription);
  const options = await buildPushPayload({
    data: JSON.stringify({date, test}),
    options: {ttl: test ? 60 : 3600}
  }, subscription, {
    subject: production,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY?.trim()
  });
  const headers = new Headers(options.headers);
  headers.delete('content-length');
  const response = await fetch(subscription.endpoint, {body: options.body, headers, method: 'POST', redirect: 'manual'});
  if (response.status === 404 || response.status === 410) {
    await env.REMINDERS.prepare('DELETE FROM reminders WHERE device = ? AND subscription = ?')
      .bind(row.device, row.subscription).run();
  }
  return response.ok;
}

async function reminders(request, env, path) {
  if (path === '/api/reminders/key' && request.method === 'GET') {
    return env.VAPID_PUBLIC_KEY ? reply({key: env.VAPID_PUBLIC_KEY}) : reply({error: 'Reminders are unavailable.'}, 503);
  }
  if (request.headers.get('Origin') !== new URL(request.url).origin) return reply({error: 'Use the WageWise app.'}, 403);
  const id = await deviceId(request);
  if (!id) return reply({error: 'This browser session could not be verified.'}, 401);
  if (path === '/api/reminders/subscription' && request.method === 'DELETE') {
    await env.REMINDERS.prepare('DELETE FROM reminders WHERE device = ?').bind(id).run();
    return reply({ok: true});
  }
  if (path === '/api/reminders/subscription' && request.method === 'PUT') {
    const body = await request.text();
    if (body.length > 4096) return reply({error: 'Reminder settings are too large.'}, 413);
    let subscription;
    let schedule;
    try { ({subscription, schedule} = validate(JSON.parse(body))); }
    catch { return reply({error: 'Check the reminder settings and browser support.'}, 400); }
    const previous = await env.REMINDERS.prepare('SELECT last_date FROM reminders WHERE device = ?').bind(id).first();
    const next = nextReminder(Date.now() - 300000, schedule, previous?.last_date);
    if (!next) return reply({error: 'Choose at least one workday.'}, 400);
    await env.REMINDERS.prepare(`
      INSERT INTO reminders (device, subscription, schedule, due_at, due_date)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(device) DO UPDATE SET
      subscription = excluded.subscription, schedule = excluded.schedule, due_at = excluded.due_at, due_date = excluded.due_date
    `).bind(id, JSON.stringify(subscription), JSON.stringify(schedule), next.at, next.date).run();
    return reply({ok: true});
  }
  if (path === '/api/reminders/test' && request.method === 'POST') {
    const row = await env.REMINDERS.prepare('SELECT * FROM reminders WHERE device = ?').bind(id).first();
    if (!row) return reply({error: 'Enable and save reminders first.'}, 409);
    const now = Date.now();
    const claim = await env.REMINDERS.prepare('UPDATE reminders SET last_test = ? WHERE device = ? AND last_test <= ?')
      .bind(now, id, now - 60000).run();
    if (!claim.meta.changes) return reply({error: 'Wait a minute before sending another test.'}, 429);
    const schedule = JSON.parse(row.schedule);
    const date = new Intl.DateTimeFormat('sv-SE', {timeZone: schedule.timezone}).format(now);
    return await send(env, row, date, true) ? reply({ok: true}) : reply({error: 'Could not deliver the test. Save your reminders again.'}, 502);
  }
  return reply({error: 'Unknown reminder request.'}, 404);
}

async function deliverDue(env, now) {
  const {results} = await env.REMINDERS.prepare('SELECT * FROM reminders WHERE due_at <= ? ORDER BY due_at LIMIT 30').bind(now).all();
  for (const row of results) {
    const schedule = JSON.parse(row.schedule);
    const next = nextReminder(now, schedule, row.due_date);
    if (!next) continue;
    const claim = await env.REMINDERS.prepare(`
      UPDATE reminders SET due_at = ?, due_date = ?, last_date = ?
      WHERE device = ? AND due_at = ? AND schedule = ?
    `).bind(next.at, next.date, row.due_date, row.device, row.due_at, row.schedule).run();
    if (claim.meta.changes && row.last_date !== row.due_date && now - row.due_at < 3600000 &&
      !schedule.completed.includes(row.due_date)) {
      try { await send(env, row, row.due_date); } catch { /* A delivery failure affects this device only. */ }
    }
  }
}

export default {
  async fetch(request, env) {
    const {pathname} = new URL(request.url);
    if (pathname.startsWith('/api/account/') || pathname.startsWith('/api/admin/')) return handleAccounts(request,env,client);
    if (!pathname.startsWith('/api/reminders/')) return env.ASSETS.fetch(request);
    try { return await reminders(request, env, pathname); }
    catch (error) {
      const detail = String(error?.message ?? '').replace(/https?:\/\/\S+/g, '[URL]').replace(/[\w-]{22,}/g, '[redacted]');
      console.error('Reminder request failed', error?.name, detail);
      return reply({error: 'WageWise could not reach the reminder service.'}, 503);
    }
  },
  scheduled(controller, env, ctx) {
    ctx.waitUntil(deliverDue(env, controller.scheduledTime));
  }
};
