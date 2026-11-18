const test = require('node:test');
const assert = require('node:assert/strict');
const {merge} = require('../app/merge');

const date = '2026-11-17';
const shift = (id, minutes = 90) => ({id, minutes, ratePence: 1650, note: ''});
const log = (shifts, status = 'overtime') => ({log: {days: {[date]: {status, shifts}}}});

test('two devices can record separate shifts on the same work date', () => {
  const first = log([shift('phone')]);
  const second = log([shift('web')]);
  const result = merge({log: {days: {}}}, first, second);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.data.log.days[date].shifts.map(record => record.id), ['phone', 'web']);
});

test('a conflicting shift edit requires a choice and keeps independent changes', () => {
  const base = log([shift('shift')]);
  const local = log([shift('shift', 120), shift('phone')]);
  const remote = log([shift('shift', 60), shift('web')]);
  const review = merge(base, local, remote);
  assert.equal(review.conflicts.length, 1);
  const result = merge(base, local, remote, {[review.conflicts[0].key]: 'remote'});
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.data.log.days[date].shifts.map(record => record.minutes), [60, 90, 90]);
});

test('marking a day off conflicts with recording more overtime for it', () => {
  const base = log([shift('shift')]);
  const local = log([], 'off');
  const remote = log([shift('shift'), shift('extra')]);
  const review = merge(base, local, remote);
  assert.equal(review.conflicts.length, 1);
  assert.deepEqual(merge(base, local, remote, {[review.conflicts[0].key]: 'local'}).data, local);
});

test('an accepted deletion does not reappear when the other device adds a different record', () => {
  const base = log([shift('delete'), shift('keep')]);
  const local = log([shift('keep')]);
  const remote = log([shift('delete'), shift('keep'), shift('new')]);
  const result = merge(base, local, remote);
  assert.equal(result.conflicts.length, 0);
  assert.deepEqual(result.data.log.days[date].shifts.map(record => record.id), ['keep', 'new']);
});
