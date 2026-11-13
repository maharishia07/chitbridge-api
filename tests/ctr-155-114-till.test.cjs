#!/usr/bin/env node
// @type: contract
'use strict';
/**
 * ctr-155-114-till.test.cjs - CTR-155 + CTR-114 on the till master.
 *
 * OWNS      the proof, over the counter's OWN drain (CloudHost.drain lifted out of tools/tally-connector/till.html) and usignBecome, that:
 *             (1) a 403 MEMBERSHIP_SUSPENDED on ONE bill (a receiver's network suspended this shop's membership with THAT receiver, api routes/chits.js
 *                 sendSuspended, answered per receiver) holds that bill on the ladder with the server's words and the rows behind it still go: it is
 *                 not "the key", so it never stops the queue (CTR-155);
 *             (2) a plain 403 (the key) still stops the queue with the key's words, and TILL_SEND_REFUSED still lets the rest go;
 *             (3) usignBecome clears USIGN.busy when becomeShop throws (CTR-114).
 * CALLED BY scripts/guards.cjs . CI. No database, no network, no browser.
 * FLOW      queue rows -> lifted drain (counting fetch) -> queue after; lifted usignBecome with a throwing becomeShop
 * CARD      09-counter/offline-queue-and-replay
 * Run: node tests/ctr-155-114-till.test.cjs
 */
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const PAGE = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');

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
const clone = (v) => JSON.parse(JSON.stringify(v));
const WORDS = 'The network has suspended your membership, so you cannot send to it. Ask the network to resume it, then send again.';
const SALE = (no) => ({ no, at: '2026-11-13T09:00:00Z', lines: [{ name: 'Tea', qty: 1 }], total: 10 });

function fakeDB() {
  const stores = { bills: {}, queue: {} };
  return { stores,
    put: async (s, row) => { stores[s][row.no] = clone(row); }, del: async (s, k) => { delete stores[s][k]; },
    all: async (s) => Object.keys(stores[s]).sort().map((k) => clone(stores[s][k])), allRaw: async (s) => Object.keys(stores[s]).sort().map((k) => clone(stores[s][k])) };
}
const FNS = ['qBackoff', 'qDue', 'qSoonest', 'isParkedRow', 'parksOn', 'sendableRows', 'refusedRow', 'frozenDrain', 'heldWaitWords', 'isSaleRow'];
function counter(answer) {
  const DB = fakeDB(), calls = [];
  const ctx = { console, setTimeout, clearTimeout, JSON, Object, Math, Date, String, Number, Array, Promise, Error, DB, OWNER: null, FOREIGN: 0, STATE: { queued: 1 }, DEADLINE: 20000, dbFrozen: () => false, FROZEN_LINE: 'frozen',
    lineUp: () => true, cbQuiet: () => {}, queueTally: async () => {}, paintStatus: () => {}, personOn: () => false, drainSoon: () => {}, ls: { set() {}, get: (k, d) => d },
    stampDeliveryRefs: (n, r) => r, chitOf: (b) => b, qWaitWords: () => '', renumberBill: async () => null,
    fetchBy: async (url) => { calls.push(url); const [status, body] = answer(url, calls.length); return { ok: status >= 200 && status < 300, status, json: async () => body, clone() { return this; } }; } };
  vm.createContext(ctx);
  const fns = FNS.map((f) => { try { return lift(f); } catch (e) { return ''; } }).join('');
  vm.runInContext(liftVar('Q_FLOOR') + liftVar('WAITS_FOR_BILL') + liftVar('FINAL_REFUSALS') + liftVar('ONE_ROW_REFUSALS') + fns + liftCloudHost(), ctx);
  const host = vm.runInContext('CloudHost', ctx);
  host.key = 'k'; host.api = 'http://shop'; host.cred = () => 'k'; host.auth = (x) => Object.assign({}, x || {}); host.idemHeaders = (p, b, x) => x;
  return { host, DB, calls };
}
/** usignBecome with a becomeShop that answers or throws, and USIGN.busy readable after */
function signin(becomeShop) {
  const USIGN = { pending: { token: 't', person: 'p', idn: null }, busy: false, held: null };
  const ctx = { USIGN, becomeShop, usignNote() {}, usignRestore() {}, usignHeldHtml: () => '', esc: String, tillId: () => 'C1' };
  vm.createContext(ctx);
  vm.runInContext(lift('usignBecome'), ctx);
  return { USIGN, run: () => vm.runInContext('usignBecome(false)', ctx) };
}
let n = 0, failed = 0;
const it = async (name, fn) => { n++; try { await fn(); console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n         ' + e.message); } };

(async () => {
  await it('a 403 MEMBERSHIP_SUSPENDED on one bill holds that bill with the server words and the bills behind it still go', async () => {
    const { host, DB, calls } = counter((url, k) => k === 1 ? [403, { code: 'MEMBERSHIP_SUSPENDED', message: WORDS }] : [200, { chit_id: 'c9' }]);
    DB.stores.queue['C1/1'] = SALE('C1/1'); DB.stores.queue['C1/2'] = SALE('C1/2'); DB.stores.queue['C1/3'] = SALE('C1/3');
    await host.drain({ force: true });
    assert.strictEqual(calls.length, 3, 'the queue stopped after ' + calls.length + ' call(s)');
    assert.ok(!DB.stores.queue['C1/2'] && !DB.stores.queue['C1/3'], 'rows behind the held bill did not go');
    const row = DB.stores.queue['C1/1'];
    assert.ok(row && row._code === 'MEMBERSHIP_SUSPENDED' && row._why === WORDS && row._nextAt > Date.now(), 'not held on the ladder: ' + JSON.stringify(row));
    assert.ok(!row._parked, 'a bill is never parked');
    assert.ok(host.last.why.indexOf(WORDS) >= 0 && !/key/i.test(host.last.why), 'the cashier was told: ' + host.last.why);
  });
  await it('a plain 403 is still the key: the queue stops there, with the key words; TILL_SEND_REFUSED lets the rest go', async () => {
    const a = counter(() => [403, { code: 'KEY_REFUSED' }]);
    a.DB.stores.queue['C1/1'] = SALE('C1/1'); a.DB.stores.queue['C1/2'] = SALE('C1/2');
    await a.host.drain({ force: true });
    assert.strictEqual(a.calls.length, 1); assert.ok(/refused this counter's key/.test(a.host.last.why), a.host.last.why);
    const b = counter((url, k) => k === 1 ? [403, { code: 'TILL_SEND_REFUSED', message: 'no' }] : [200, {}]);
    b.DB.stores.queue['C1/1'] = SALE('C1/1'); b.DB.stores.queue['C1/2'] = SALE('C1/2');
    await b.host.drain({ force: true });
    assert.strictEqual(b.calls.length, 2);
  });
  await it('usignBecome clears USIGN.busy when becomeShop throws, and when it answers', async () => {
    const t = signin(async () => { throw new Error('line dropped'); });
    await assert.rejects(t.run(), /line dropped/);
    assert.strictEqual(t.USIGN.busy, false, 'busy stayed true');
    const u = signin(async () => ({ ok: false, message: 'x' }));
    await u.run(); assert.strictEqual(u.USIGN.busy, false);
  });
  console.log(failed ? failed + ' of ' + n + ' FAILED' : 'ctr-155-114-till: ' + n + ' ok');
  process.exit(failed ? 1 : 0);
})();
