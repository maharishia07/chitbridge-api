#!/usr/bin/env node
// @type: contract
'use strict';
/**
 * ctr-204-till-hold.test.cjs - CTR-204 (till half, api #1240): A DIFFERENT SALE UNDER A BILL NUMBER THE SHOP ALREADY HAS IS HELD, THEN RENUMBERED ON ONE CONFIRM.
 *
 * OWNS      the proof, over the counter's OWN drain (CloudHost.drain lifted out of tools/tally-connector/till.html, as till-park lifts it), that:
 *             (1) a sale answered 409 CHIT_REPLAY_DIFFERS is HELD: no retry time, the server's words kept, never sent again (drain, forced drain), never renumbered by itself;
 *             (2) the held bill's words reach this.last.why on every later drain (the "nothing was attempted" alarm stays quiet), the rows behind it still go, and the stuck panel lists it with one button;
 *             (3) the cashier's one confirm: yes -> renumberBill(row) is called and the counter sends, no -> nothing is touched;
 *             (4) TILL_SERIES_COLLISION still auto-renumbers; any other 409 on a sale keeps the backoff ladder; a change row answered the same code parks as before; renumberBill clears the hold on its copy.
 * CALLED BY scripts/guards.cjs . CI. No database, no network, no browser.
 * FLOW      queue rows -> lifted drain (counting fetch) -> queue after; lifted heldRenumber / heldSectionHTML with stubs
 * CARD      09-counter/offline-queue-and-replay
 * Run: node tests/ctr-204-till-hold.test.cjs
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
const WORDS = 'This bill number is already kept at the shop for a different sale (total). Your bill is kept on the counter, unsent.';
const SALE = (no) => ({ no, at: '2026-11-13T09:00:00Z', lines: [{ name: 'Tea', qty: 1 }], total: 10 });

function fakeDB() {
  const stores = { bills: {}, queue: {} };
  return { stores,
    put: async (s, row) => { stores[s][row.no] = clone(row); }, del: async (s, k) => { delete stores[s][k]; },
    all: async (s) => Object.keys(stores[s]).sort().map((k) => clone(stores[s][k])), allRaw: async (s) => Object.keys(stores[s]).sort().map((k) => clone(stores[s][k])) };
}
const FNS = ['qBackoff', 'qDue', 'qSoonest', 'isParkedRow', 'parksOn', 'sendableRows', 'refusedRow', 'frozenDrain', 'heldWaitWords', 'staleHasItem', 'staleSaleRow', 'staleCandidate', 'staleGateSafe', 'staleGate', 'drainRecordSent', 'drainAnswerProof'];

/** a counter whose wire answers from `answer(url, n)` -> [status, body]; `renumbered` lists every bill renumberBill was asked to move */
function counter(answer, sharedDB) {
  const DB = sharedDB || fakeDB(), calls = [], renumbered = [];
  const ctx = { console, setTimeout, clearTimeout, JSON, Object, Math, Date, String, Number, Array, Promise, Error, DB, OWNER: null, FOREIGN: 0, STATE: { queued: 1 }, DEADLINE: 20000, dbFrozen: () => false, FROZEN_LINE: 'frozen',
    lineUp: () => true, cbQuiet: () => {}, queueTally: async () => {}, paintStatus: () => {}, personOn: () => false, drainSoon: () => {}, ls: { set() {}, get: (k, d) => d },
    stampDeliveryRefs: (n, r) => r, chitOf: (b) => b, qWaitWords: () => '',
    renumberBill: async (bill) => { renumbered.push(bill.no); const to = bill.no + 'N'; await DB.put('queue', Object.assign({}, bill, { no: to, _tries: 0 })); await DB.del('queue', bill.no); return { from: bill.no, to, companions: [] }; },
    fetchBy: async (url) => { calls.push(url); const [status, body] = answer(url, calls.length); return { ok: status >= 200 && status < 300, status, json: async () => body, clone() { return this; } }; } };
  vm.createContext(ctx);
  vm.runInContext(liftVar('Q_FLOOR') + liftVar('WAITS_FOR_BILL') + liftVar('FINAL_REFUSALS') + FNS.map(lift).join('') + lift('isSaleRow') + liftCloudHost(), ctx);
  const host = vm.runInContext('CloudHost', ctx);
  host.key = 'k'; host.api = 'http://shop'; host.cred = () => 'k'; host.auth = (x) => Object.assign({}, x || {}); host.idemHeaders = (p, b, x) => x;
  return { host, DB, calls, renumbered };
}
let n = 0, failed = 0;
const it = async (name, fn) => { n++; try { await fn(); console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n         ' + e.message); } };

(async () => {
  await it('a sale answered 409 CHIT_REPLAY_DIFFERS is HELD once: words kept, no retry time, never sent again, never renumbered by itself', async () => {
    const { host, DB, calls, renumbered } = counter(() => [409, { code: 'CHIT_REPLAY_DIFFERS', message: WORDS, differs: 'total' }]);
    DB.stores.queue['C1/1'] = SALE('C1/1');
    await host.drain({ force: true }); await host.drain({ force: true }); await host.drain();
    assert.strictEqual(calls.length, 1, 'the wire was asked ' + calls.length + ' times');
    const row = DB.stores.queue['C1/1'];
    assert.ok(row && row._hold && row._hold.why === WORDS, 'not held: ' + JSON.stringify(row));
    assert.strictEqual(row._nextAt, undefined, 'a held bill has no retry time'); assert.ok(!row._parked, 'a bill is held, never parked');
    assert.deepStrictEqual(renumbered, [], 'renumbered without the cashier');
  });
  await it('the held bill\'s words are on every later drain, and the bills behind it still go', async () => {
    const { host, DB, calls } = counter((url, k) => k === 1 ? [409, { code: 'CHIT_REPLAY_DIFFERS', message: WORDS }] : [200, { chit_id: 'c9' }]);
    DB.stores.queue['C1/1'] = SALE('C1/1'); DB.stores.queue['C1/2'] = SALE('C1/2');
    await host.drain({ force: true });
    assert.ok(!DB.stores.queue['C1/2'], 'the bill behind the held one did not go'); assert.ok(DB.stores.queue['C1/1']._hold);
    assert.ok(host.last.why.indexOf(WORDS) > 0, 'first run said: ' + host.last.why);
    await host.drain();
    assert.ok(/Bill C1\/1 is held, not sent: /.test(host.last.why) && host.last.why.indexOf(WORDS) > 0, 'later run said: ' + host.last.why);
    assert.strictEqual(calls.length, 2);
  });
  await it('TILL_SERIES_COLLISION still auto-renumbers (renumberBill called, no hold); any other 409 on a sale keeps the ladder, no hold', async () => {
    const a = counter(() => [409, { code: 'TILL_SERIES_COLLISION', message: 'taken' }]);
    a.DB.stores.queue['C1/3'] = SALE('C1/3');
    await a.host.drain({ force: true });
    assert.deepStrictEqual(a.renumbered.slice(0, 1), ['C1/3'], 'no auto-renumber on a series collision');
    for (const code of ['CHIT_REPLAY_DUPLICATE', 'SOMETHING_ELSE']) {
      const { host, DB, renumbered } = counter(() => [409, { code, message: 'no' }]);
      DB.stores.queue['C1/4'] = SALE('C1/4');
      await host.drain({ force: true });
      const row = DB.stores.queue['C1/4'];
      assert.ok(row && !row._hold && !row._parked && row._nextAt > Date.now(), code + ' changed behaviour: ' + JSON.stringify(row));
      assert.deepStrictEqual(renumbered, []);
    }
  });
  await it('a 409 CHIT_REPLAY_DIFFERS on a CHANGE row is not a held bill (it parks as before)', async () => {
    const { host, DB } = counter(() => [409, { code: 'CHIT_REPLAY_DIFFERS', message: 'x' }]);
    DB.stores.queue['OP/1'] = { no: 'OP/1', at: 'x', tillPost: { path: '/api/till/price', body: {} } };
    await host.drain({ force: true });
    assert.ok(DB.stores.queue['OP/1']._parked && !DB.stores.queue['OP/1']._hold);
  });

  const panel = (sureAnswer) => {
    const toasts = [], DB = fakeDB(), asked = [], renumbered = [];
    const ctx = { DB, toasts, console, JSON, String, Array, Object, esc: (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
      cbQuiet: () => {}, queueTally: async () => {}, paintStatus: () => {}, toastLine: (t) => toasts.push(t), openStuck: () => {}, HOST: { drain: () => toasts.push('DRAIN') },
      sure: async (m, ok, title) => { asked.push([m, ok, title]); return sureAnswer; }, renumberBill: async (row, why) => { renumbered.push([row.no, why]); return { from: row.no, to: 'C1/9' }; } };
    vm.createContext(ctx); vm.runInContext(['heldSectionHTML', 'heldRenumber'].map(lift).join(''), ctx);
    return { ctx, DB, toasts, asked, renumbered };
  };
  await it('the stuck panel lists a held bill with the shop\'s words and one button, stamped data-cbsid', async () => {
    const { ctx } = panel(true);
    const row = Object.assign(SALE('C1/1'), { _hold: { at: 1, why: WORDS } });
    const html = ctx.heldSectionHTML([row, SALE('C1/2')]);
    assert.ok(html.indexOf(WORDS) > 0 && /data-cbsid="CMP012"[^>]*data-testid="till-held-renumber-C1\/1"/.test(html), html);
    assert.strictEqual((html.match(/<button/g) || []).length, 1); assert.strictEqual(ctx.heldSectionHTML([SALE('C1/2')]), '');
  });
  await it('yes -> renumberBill is called with the held row and the counter sends; no -> nothing is touched', async () => {
    for (const yes of [true, false]) {
      const { ctx, DB, toasts, asked, renumbered } = panel(yes);
      DB.stores.queue['C1/1'] = Object.assign(SALE('C1/1'), { _hold: { at: 1, why: WORDS } });
      await ctx.heldRenumber('C1/1');
      assert.strictEqual(asked.length, 1); assert.ok(/new sale/.test(asked[0][0]) && asked[0][1] === 'Yes, new number');
      assert.strictEqual(renumbered.length, yes ? 1 : 0); assert.strictEqual(toasts.indexOf('DRAIN') >= 0, yes);
    }
    const { ctx, renumbered, asked } = panel(true);
    await ctx.heldRenumber('C1/404'); assert.strictEqual(asked.length, 0); assert.strictEqual(renumbered.length, 0);
  });

  await it('only a SALE is held: a goods-in note (chitBody), a credit note, an expense and a subscription answered the same code keep the old ladder', async () => {
    const rowsByKind = { grn: { no: 'GRN/1', at: 'x', chitBody: { kind: 'goods_in' } }, cn: Object.assign(SALE('CN/1'), { kind: 'credit_note' }), exp: Object.assign(SALE('EX/1'), { kind: 'expense' }), sub: Object.assign(SALE('SU/1'), { kind: 'subscription' }) };
    for (const k of Object.keys(rowsByKind)) {
      const { host, DB, calls } = counter(() => [409, { code: 'CHIT_REPLAY_DIFFERS', message: WORDS }]);
      const no = rowsByKind[k].no; DB.stores.queue[no] = rowsByKind[k];
      await host.drain({ force: true }); await host.drain({ force: true });
      const row = DB.stores.queue[no];
      assert.ok(row && !row._hold && row._nextAt > Date.now(), k + ' was held: ' + JSON.stringify(row));
      assert.strictEqual(calls.length, 2, k + ' is no longer retried');
    }
  });
  await it('a held bill survives a reload: the row is in the store, and a FRESH drain over the same store still holds it and sends nothing', async () => {
    const first = counter(() => [409, { code: 'CHIT_REPLAY_DIFFERS', message: WORDS }]);
    first.DB.stores.queue['C1/1'] = SALE('C1/1');
    await first.host.drain({ force: true });
    const second = counter(() => [200, { chit_id: 'x' }], first.DB);
    await second.host.drain({ force: true }); await second.host.drain();
    assert.strictEqual(second.calls.length, 0, 'the held bill was sent after a reload');
    assert.ok(second.DB.stores.queue['C1/1']._hold && second.host.last.why.indexOf(WORDS) > 0, second.host.last.why);
  });
  await it('a held bill still counts as WAITING: queueTally (STATE.queued, bills) and closeReadinessNow().waiting', async () => {
    const DB = fakeDB(), ctx = { DB, STATE: { queued: 0 }, QUEUED: null, OUT_OF_SYNC: [], PARKED: [], cbQuiet() {}, throwIfFrozen() {}, rowIsMine: () => true };
    vm.createContext(ctx);
    DB.isFrozen = () => false;
    vm.runInContext(liftVar('QUEUED') + ['dbFrozen', 'isParkedRow', 'sendableRows', 'queueTally', 'isSaleRow', 'isIssuedRow', 'closeReadinessNow'].map(lift).join(''), ctx);
    DB.stores.queue['C1/1'] = Object.assign(SALE('C1/1'), { _hold: { at: 1, why: WORDS } });
    DB.stores.queue['C1/2'] = SALE('C1/2');
    const t = await vm.runInContext('queueTally()', ctx);
    assert.strictEqual(t.bills, 2); assert.strictEqual(t.parked, 0); assert.strictEqual(ctx.STATE.queued, 2);
    const ready = await vm.runInContext('closeReadinessNow()', ctx);
    assert.strictEqual(ready.waiting, 2, 'the close would not wait for the held bill: ' + JSON.stringify(ready));
  });
  await it('the REAL renumberBill on a held row: the copy has no _hold (nor the old status), keeps the printed number, and the held key is gone', async () => {
    const DB = fakeDB(), ctx = { DB, LAST_SERIES: null, cbQuiet() {}, tillId: () => 'C1', nextNumber: async () => 'C1/9', rememberRenumber: async () => {}, rekeyCompanions: async () => [], forgetRows() {}, Object, Number, Date };
    vm.createContext(ctx); vm.runInContext(lift('renumberBill'), ctx);
    const held = Object.assign(SALE('C1/1'), { _hold: { at: 1, why: WORDS }, _status: 409, _why: WORDS, _code: 'CHIT_REPLAY_DIFFERS', _tries: 3 });
    DB.stores.queue['C1/1'] = clone(held); DB.stores.bills['C1/1'] = clone(held);
    const moved = await vm.runInContext('renumberBill', ctx)(held, 'x');
    const copy = DB.stores.queue['C1/9'];
    assert.deepStrictEqual([moved.from, moved.to], ['C1/1', 'C1/9']);
    assert.ok(copy && !('_hold' in copy) && !('_status' in copy) && copy.printed_as === 'C1/1' && copy._tries === 0, JSON.stringify(copy));
    assert.ok(!DB.stores.queue['C1/1'] && !DB.stores.bills['C1/1'] && DB.stores.bills['C1/9'] && !('_hold' in DB.stores.bills['C1/9']));
  });
  console.log('\n' + (n - failed) + '/' + n + ' passed');
  process.exit(failed ? 1 : 0);
})();
