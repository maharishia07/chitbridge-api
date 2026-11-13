#!/usr/bin/env node
// @type: contract
'use strict';
/**
 * till-queue-poison.test.cjs - S33-T, THE QUEUED-DOOR POISON QUESTION: "a replayed old queued row now carries a junk value; where does it go, and does the till's whole queue jam?"
 *
 * OWNS      the proof, over the counter's OWN drain (CloudHost.drain lifted out of tools/tally-connector/till.html, as tests/till-fix2.test.cjs lifts it) talking to the REAL
 *           routes (routes/till.js, routes/chits.js over http, the database stubbed), that:
 *             (1) a queued row whose value the door now refuses (400, problem shape) does not stop the rows behind it: they go and are deleted;
 *             (2) the refused row is PARKED, not dropped: it stays in the queue with the server's words (_status 400, _why, _code) and a later retry time (backoff), so it is
 *                 visible ("Bill ...: <why>") and the shopkeeper can set it aside; a bill is a sale and is never deleted by a refusal;
 *             (3) a refusal of the door is never 401/403 (the drain STOPS the whole queue on those two, unless the code is TILL_SEND_REFUSED);
 *             (4) the parked row is not hammered: the next un-forced drain skips it (qDue), the rows behind it still go.
 * CALLED BY scripts/guards.cjs . CI. No database, no network, no browser.
 * FLOW      queue rows (bill, poison reward, stock, flags) -> lifted drain -> http -> real routers -> queue after the run
 * CARD      09-counter/offline-queue-and-replay
 * Run: node tests/till-queue-poison.test.cjs
 */
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const G = require('./support/route-golden.cjs');

const PAGE = fs.readFileSync(path.join(G.API, 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
const SHOP = '11111111-1111-4111-8111-111111111111';
const ITEM = '33333333-3333-4333-8333-333333333333';
const h = G.harness({ known: { [SHOP]: 'SHOP' }, rows: (sql) => (/idempotency/i.test(sql) ? [] : [{ item_id: ITEM, item_data: { name: 'Tea' } }]) });
const express = require('express');
const app = express();
app.use((req, res, next) => { req.headers['idempotency-key'] = req.headers['idempotency-key'] || 'q-' + Math.random().toString(36).slice(2); next(); });
app.use(h.app('/api/till', require('../routes/till')));
app.use(h.app('/api/chits', require('../routes/chits')));

/** lift one top-level function (plain or async) out of the page, by name */
function lift(name) {
  let i = PAGE.indexOf('\nfunction ' + name + '(');
  if (i < 0) i = PAGE.indexOf('\nasync function ' + name + '(');
  assert.ok(i >= 0, name + ' is not in the page');
  let depth = 0;
  for (let k = PAGE.indexOf('{', i); k < PAGE.length; k++) {
    if (PAGE[k] === '{') depth++;
    else if (PAGE[k] === '}') { depth--; if (depth === 0) return PAGE.slice(i, k + 1) + '\n'; }
  }
  throw new Error('unbalanced ' + name);
}
const liftVar = (name) => (PAGE.match(new RegExp('\\nvar ' + name + ' = [^\\n]*;')) || [''])[0] + '\n';
const liftCloudHost = () => { const a = PAGE.indexOf('\nvar CloudHost = {'); assert.ok(a >= 0, 'CloudHost is gone'); return PAGE.slice(a, PAGE.indexOf('\n};\n', a) + 4); };

function fakeDB() {
  const stores = { bills: {}, queue: {} };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  return { stores,
    put: async (s, row) => { stores[s][row.no] = clone(row); }, del: async (s, k) => { delete stores[s][k]; },
    all: async (s) => Object.keys(stores[s]).sort().map((k) => clone(stores[s][k])), allRaw: async (s) => Object.keys(stores[s]).sort().map((k) => clone(stores[s][k])) };
}

function counterOn(port) {
  const DB = fakeDB();
  const ctx = { console, setTimeout, clearTimeout, JSON, Object, Math, Date, String, Number, Array, Promise, Error, DB, OWNER: null, FOREIGN: 0, STATE: { queued: 0 }, DEADLINE: 20000, dbFrozen: () => false, FROZEN_LINE: 'frozen',
    lineUp: () => true, cbQuiet: () => {}, queueTally: async () => {}, paintStatus: () => {}, personOn: () => false, drainSoon: () => {}, ls: { set() {}, get: (k, d) => d },
    isSaleRow: () => false, renumberBill: async () => null, stampDeliveryRefs: (n, r) => r, chitOf: (b) => b, qWaitWords: () => '',
    fetchBy: async (url, init) => fetch(url, init) };
  vm.createContext(ctx);
  vm.runInContext(liftVar('Q_FLOOR') + lift('qBackoff') + lift('qDue') + lift('qSoonest') + liftVar('WAITS_FOR_BILL') + liftVar('FINAL_REFUSALS') + liftVar('ONE_ROW_REFUSALS') + lift('isParkedRow') + lift('parksOn') + lift('sendableRows') + lift('refusedRow') + lift('frozenDrain') + lift('staleSaleRow') + lift('staleCandidate') + lift('staleGateSafe') + lift('staleGate') + lift('drainRecordSent') + lift('drainAnswerProof') + liftCloudHost(), ctx);
  const host = vm.runInContext('CloudHost', ctx);
  host.key = 'till-key'; host.api = 'http://127.0.0.1:' + port;
  host.cred = () => 'till-key'; host.auth = (extra) => Object.assign({ Authorization: 'Bearer till-key' }, extra || {}); host.idemHeaders = (p, b, extra) => extra;
  return { host, DB };
}

const queueRow = (no, at, route, body) => ({ no, at, tillPost: { path: route, body } });
let n = 0, failed = 0;
const it = async (name, fn) => { n++; try { await fn(); console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n         ' + e.message); } };

(async () => {
  const server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  const port = server.address().port;
  h.state.identity = { identity_id: SHOP };
  h.state.calls = [];
  const poison = () => queueRow('A1/reward', '2026-11-10T09:00:00Z', '/api/till/reward', { ref: 'A1', holder: 'a phone number', spend: 0 });
  const behind = () => [
    queueRow('B2/stock', '2026-11-10T09:01:00Z', '/api/till/stock', { item_id: ITEM, status: 'unavailable', by: null }),
    queueRow('C3/flags', '2026-11-10T09:02:00Z', '/api/till/flags', { item_id: ITEM, screen: true })];
  try {
    await it('a refused queued CHANGE (junk value, 400) is PARKED (till-park) with the server\'s words and no retry time; the rows behind it go and are deleted', async () => {
      const { host, DB } = counterOn(port);
      [poison(), ...behind()].forEach((r) => { DB.stores.queue[r.no] = r; });
      await host.drain({ force: true });
      const left = Object.keys(DB.stores.queue);
      assert.deepStrictEqual(left, ['A1/reward'], 'queue after the drain: ' + JSON.stringify(left));
      const row = DB.stores.queue['A1/reward'];
      assert.strictEqual(row._status, 400, 'status ' + row._status);
      assert.strictEqual(row._code, 'TILL_BAD_REQUEST');
      assert.ok(row._why && /holder/.test(row._why), 'the row does not carry the server\'s words: ' + row._why);
      assert.ok(row._parked && row._parked.status === 400 && row._parked.why === row._why, 'not marked parked: ' + JSON.stringify(row._parked));
      assert.strictEqual(row._nextAt, undefined, 'a parked row has no retry time: it waits for a person');
      assert.strictEqual(row._tries, 1);
      assert.ok(row.tillPost && row.tillPost.body.holder === 'a phone number', 'the row itself was changed or dropped');
    });
    await it('the parked row is skipped by the next drain, even a FORCED one (Send now); the rows queued after it still go', async () => {
      const { host, DB } = counterOn(port);
      DB.stores.queue['A1/reward'] = poison();
      await host.drain({ force: true });
      const tries = DB.stores.queue['A1/reward']._tries;
      behind().forEach((r) => { DB.stores.queue[r.no] = r; });
      await host.drain({ force: true });
      assert.deepStrictEqual(Object.keys(DB.stores.queue), ['A1/reward'], 'queue: ' + JSON.stringify(Object.keys(DB.stores.queue)));
      assert.strictEqual(DB.stores.queue['A1/reward']._tries, tries, 'a parked row was tried again');
    });
    await it('a refused BILL-side row (junk value in a known key of POST /api/chits/send) keeps the backoff ladder (till-park never parks a bill), is never deleted, and does not stop the rows behind it', async () => {
      const { host, DB } = counterOn(port);
      DB.stores.queue['S1'] = { no: 'S1', at: '2026-11-10T08:00:00Z', chitBody: { purpose: 'invoice', self_copy: 'everyone', recipients: [{ self: true }] } };
      behind().forEach((r) => { DB.stores.queue[r.no] = r; });
      await host.drain({ force: true });
      assert.deepStrictEqual(Object.keys(DB.stores.queue), ['S1'], 'queue: ' + JSON.stringify(Object.keys(DB.stores.queue)));
      assert.strictEqual(DB.stores.queue['S1']._status, 400);
      assert.ok(DB.stores.queue['S1']._why, 'no words kept');
      assert.ok(!DB.stores.queue['S1']._parked && DB.stores.queue['S1']._nextAt > Date.now(), 'a bill must retry on the ladder, not be parked');
    });
    await it('the door never refuses a junk value with 401 or 403 (the drain stops the WHOLE queue on those, unless the code is TILL_SEND_REFUSED)', async () => {
      const bodies = [['/api/till/flags', { item_id: { a: 1 } }], ['/api/till/stock', { item_id: ITEM, status: 5 }], ['/api/till/stock/bulk', { item_ids: 'x' }], ['/api/till/reward', { ref: 'A1', holder: 'x' }],
        ['/api/till/reward/claim', { from: 'x', to: 'y' }], ['/api/till/quick-keys/hide', { product_id: ITEM, also_counters: 'x' }], ['/api/till/quick-keys/unhide', { product_id: ['x'] }]];
      for (const [route, body] of bodies) {
        const r = await fetch('http://127.0.0.1:' + port + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'k' + Math.random() }, body: JSON.stringify(body) });
        assert.ok(r.status === 400, route + ' answered ' + r.status);
      }
    });
  } finally { server.close(); }
  console.log('\n' + (n - failed) + '/' + n + ' passed');
  process.exit(failed ? 1 : 0);
})();
