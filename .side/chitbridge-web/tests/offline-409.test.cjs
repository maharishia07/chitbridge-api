/**
 * tests/offline-409.test.cjs — PAY-FIX L3: the outbox no longer treats every 409 as "done". A replayed key answers with the first
 * answer (2xx); 409 IDEMPOTENCY_IN_PROGRESS keeps the write for the next try; any other 409 is rejected and surfaced.
 * Run: node tests/offline-409.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert'), vm = require('vm');
const store = {}, rejected = [];
let answers = [];
const sandbox = { navigator: { onLine: true }, localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
  fetch: async () => answers.shift(), console, JSON, Date, Math, Promise };
sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'cb-offline.js'), 'utf8'), sandbox);
const reply = (status, body) => ({ status, clone() { return this; }, json: async () => body });
const O = sandbox.CBOffline;
O.configure({ apiBase: '', onReject: (r) => rejected.push(...r) });
(async () => {
  assert.strictEqual(O._classify(409), 'reject');
  assert.strictEqual(O._classify(409, 'IDEMPOTENCY_IN_PROGRESS'), 'retry');
  assert.strictEqual(O._classify(201), 'done');
  O.enqueue({ id: 'a', path: '/x', body: {} }); O.enqueue({ id: 'b', path: '/y', body: {} });
  answers = [reply(409, { code: 'IDEMPOTENCY_IN_PROGRESS' }), reply(409, { error: 'Already exists' })];
  const r = await O.flush();
  assert.strictEqual(r.pending, 1, 'the in-progress write is kept'); assert.strictEqual(r.rejected, 1, 'the business 409 is surfaced'); assert.strictEqual(r.sent, 0);
  assert.strictEqual(rejected[0].id, 'b');
  console.log('offline-409: 4 checks ok');
})().catch((e) => { console.error(e); process.exit(1); });
