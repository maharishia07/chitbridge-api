#!/usr/bin/env node
// @type: contract
'use strict';
/**
 * till-park.test.cjs - till-park (12 Nov): A QUEUED CHANGE THE SHOP REFUSES FOR GOOD IS PARKED, NOT RETRIED FOR EVER (twin of api M9 #1168 PRICE_DECIMALS / #1170 OFFER_CLASH).
 *
 * OWNS      the proof, over the counter's OWN drain (CloudHost.drain lifted out of tools/tally-connector/till.html, as till-queue-poison lifts it) with a counting fetch, that:
 *             (1) a queued price row answered 400 PRICE_DECIMALS is parked ONCE (words kept, no retry time) and a later drain, forced or not, never sends it again;
 *             (2) a non-bill row answered 404 / 409 / 422 is parked too, but 401 (stops the queue), 408, 429, 500 and the 409 BILL_NOT_RECORDED "wait for the bill" are NOT;
 *             (3) a BILL (a sale row) is never parked: 5xx and even 400 keep the backoff ladder and the row;
 *             (4) a parked change is not "waiting to reach the shop" (queueTally) and Drop is the owner's: no PIN = row stays, PIN = row gone;
 *             (5) a corrected save for the same item replaces its parked copy; the Needs-fixing rows carry Fix (only while the item exists) and Drop, stamped data-cbsid;
 *             (6) the price grain: JPY 0 / INR 2 / KWD 3 decimals from CBMoney.decimals, a finer typed price is refused in the api's sentence, a bulk +10% in JPY rounds to whole yen.
 * CALLED BY scripts/guards.cjs . CI. No database, no network, no browser.
 * FLOW      queue rows -> lifted drain (counting fetch) -> queue after; lifted pickedPrice / priceFinerWords / parked helpers with stubs
 * CARD      09-counter/offline-queue-and-replay
 * Run: node tests/till-park.test.cjs
 */
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const API = path.join(__dirname, '..');
const PAGE = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
const MONEY = fs.readFileSync(path.join(API, 'lib', 'money.js'), 'utf8');

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

function fakeDB() {
  const stores = { bills: {}, queue: {} };
  return { stores,
    put: async (s, row) => { stores[s][row.no] = clone(row); }, del: async (s, k) => { delete stores[s][k]; },
    all: async (s) => Object.keys(stores[s]).sort().map((k) => clone(stores[s][k])), allRaw: async (s) => Object.keys(stores[s]).sort().map((k) => clone(stores[s][k])) };
}
const PARK_FNS = ['qBackoff', 'qDue', 'qSoonest', 'isParkedRow', 'parksOn', 'sendableRows', 'refusedRow'];
const PRICE_SENTENCE = 'Price can have at most 2 decimal places in INR (not 10.999). Round it and send it again.';

/** a counter whose wire answers from `answer(url)` -> [status, body]; `calls` lists every url it was asked */
function counter(answer) {
  const DB = fakeDB(), calls = [];
  const ctx = { console, setTimeout, clearTimeout, JSON, Object, Math, Date, String, Number, Array, Promise, Error, DB, OWNER: null, FOREIGN: 0, STATE: { queued: 0 }, DEADLINE: 20000,
    lineUp: () => true, cbQuiet: () => {}, queueTally: async () => {}, paintStatus: () => {}, personOn: () => false, drainSoon: () => {}, ls: { set() {}, get: (k, d) => d },
    isSaleRow: (b) => !!(b && !b.tillPost && Array.isArray(b.lines)), renumberBill: async () => null, stampDeliveryRefs: (n, r) => r, chitOf: (b) => b, qWaitWords: () => '',
    fetchBy: async (url) => { calls.push(url); const [status, body] = answer(url); return { ok: status >= 200 && status < 300, status, json: async () => body, clone() { return this; } }; } };
  vm.createContext(ctx);
  vm.runInContext(liftVar('Q_FLOOR') + liftVar('WAITS_FOR_BILL') + liftVar('FINAL_REFUSALS') + PARK_FNS.map(lift).join('') + liftCloudHost(), ctx);
  const host = vm.runInContext('CloudHost', ctx);
  host.key = 'k'; host.api = 'http://shop'; host.cred = () => 'k'; host.auth = (x) => Object.assign({}, x || {}); host.idemHeaders = (p, b, x) => x;
  return { host, DB, calls };
}
const change = (no, route, body) => ({ no, at: '2026-11-12T09:00:00Z', tillPost: { path: route, body } });
const ITEM = 'item-1';
let n = 0, failed = 0;
const it = async (name, fn) => { n++; try { await fn(); console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n         ' + e.message); } };

(async () => {
  await it('a queued price row answered 400 PRICE_DECIMALS is parked ONCE with the sentence, and never sent again (drain, forced drain, drain)', async () => {
    const { host, DB, calls } = counter(() => [400, { code: 'PRICE_DECIMALS', message: PRICE_SENTENCE }]);
    DB.stores.queue['OP/1'] = change('OP/1', '/api/till/price', { item_id: ITEM, price: 10.999 });
    await host.drain({ force: true }); await host.drain({ force: true }); await host.drain();
    assert.strictEqual(calls.length, 1, 'the wire was asked ' + calls.length + ' times');
    const row = DB.stores.queue['OP/1'];
    assert.ok(row && row._parked, 'the row is not parked: ' + JSON.stringify(row));
    assert.strictEqual(row._parked.code, 'PRICE_DECIMALS'); assert.strictEqual(row._parked.status, 400); assert.strictEqual(row._why, PRICE_SENTENCE);
    assert.strictEqual(row._nextAt, undefined, 'a parked row has no retry time'); assert.strictEqual(row._tries, 1);
    assert.deepStrictEqual(row.tillPost.body, { item_id: ITEM, price: 10.999 }, 'the change itself was altered');
  });
  await it('404 / 409 OFFER_CLASH / 422 park a change; 401, 408, 429, 500 and 409 BILL_NOT_RECORDED do not', async () => {
    for (const [status, code, parks] of [[404, 'NOT_FOUND', true], [409, 'OFFER_CLASH', true], [422, 'INVALID_INPUT', true], [401, 'X', false], [408, 'X', false], [429, 'X', false], [500, 'X', false], [409, 'BILL_NOT_RECORDED', false]]) {
      const { host, DB } = counter(() => [status, { code, message: 'no' }]);
      DB.stores.queue['OP/2'] = change('OP/2', '/api/till/offer-item', { item_id: ITEM, offer_id: 'o1', on: true });
      await host.drain({ force: true });
      const row = DB.stores.queue['OP/2'];
      assert.ok(row, status + ' ' + code + ': the row was deleted');
      assert.strictEqual(!!row._parked, parks, status + ' ' + code + ' parked=' + !!row._parked + ', expected ' + parks);
      if (!parks && status !== 401) assert.ok(row._nextAt > Date.now(), status + ' ' + code + ': a transient refusal keeps the backoff ladder');
    }
  });
  await it('a 401 on a change stops the whole queue (nothing parked, nothing behind it tried)', async () => {
    const { host, DB, calls } = counter(() => [401, { code: 'UNAUTHORIZED' }]);
    DB.stores.queue['OP/3'] = change('OP/3', '/api/till/price', { item_id: ITEM, price: 5 });
    DB.stores.queue['OP/4'] = change('OP/4', '/api/till/stock', { item_id: ITEM, status: 'unavailable' });
    await host.drain({ force: true });
    assert.strictEqual(calls.length, 1); assert.ok(!DB.stores.queue['OP/3']._parked);
  });
  await it('a BILL is never parked: a sale row answered 500 or even 400 keeps the backoff ladder and the row', async () => {
    for (const status of [500, 400]) {
      const { host, DB } = counter(() => [status, { code: status === 400 ? 'BAD' : 'X', message: 'no' }]);
      DB.stores.queue['C1/1'] = { no: 'C1/1', at: '2026-11-12T09:00:00Z', lines: [{ name: 'Tea', qty: 1 }], total: 10 };
      await host.drain({ force: true }); await host.drain({ force: true });
      const row = DB.stores.queue['C1/1'];
      assert.ok(row && !row._parked && row._nextAt > Date.now(), status + ': the bill was parked or lost: ' + JSON.stringify(row));
    }
  });
  await it('a parked change is not "waiting to reach the shop": queueTally counts it apart and leaves STATE.queued to the rest', async () => {
    const DB = fakeDB(), ctx = { DB, STATE: { queued: 0 }, QUEUED: null, OUT_OF_SYNC: [] };
    vm.createContext(ctx);
    vm.runInContext(liftVar('QUEUED') + lift('isParkedRow') + lift('sendableRows') + lift('queueTally'), ctx);
    DB.stores.queue['OP/5'] = Object.assign(change('OP/5', '/api/till/price', { item_id: ITEM, price: 1 }), { _parked: { at: 1, status: 400 } });
    DB.stores.queue['OP/6'] = change('OP/6', '/api/till/stock', { item_id: ITEM, status: 'unavailable' });
    DB.stores.queue['C1/2'] = { no: 'C1/2', lines: [] };
    const t = await vm.runInContext('queueTally()', ctx);
    assert.strictEqual(t.parked, 1); assert.strictEqual(t.changes, 1); assert.strictEqual(t.bills, 1);
    assert.strictEqual(ctx.STATE.queued, 2, 'STATE.queued ' + ctx.STATE.queued);
  });

  const helperCtx = (extra) => {
    const DB = fakeDB(), toasts = [], ctx = Object.assign({ DB, S: { items: [{ item_id: ITEM, name: 'Rice' }] }, console, JSON, String, Array, Object, toasts, QUEUED: { parked: 1 },
      esc: (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'), cbQuiet: () => {}, queueTally: async () => {}, paintStatus: () => {},
      toastLine: (t) => toasts.push(t), openStuck: () => {}, refreshNow: () => {}, sure: async () => true, ownerPinAsk: async () => ({ by: { id: 'o' } }),
      pinBook: () => ({ o: { kind: 'entity' } }), rateMay: () => ({ ok: false, why: 'Ask the owner.' }), say: (m) => toasts.push('SAY ' + m), WHO: { id: 'w1', name: 'Asha' }, modes: [], fields: {}, setMode: (m) => ctx0.modes.push(m),
      document: { getElementById: (id) => id === 'billsdlg' ? { close() {} } : (ctx0.fields[id] = ctx0.fields[id] || { value: '' }) }, pendClear() {}, paintCard() {}, paintHits() {}, CARD_ID: null }, extra || {});
    const ctx0 = ctx;
    vm.createContext(ctx);
    vm.runInContext('function isParkedRow(row){ return !!(row && row._parked); }\n' + ['parkedWords', 'parkedItem', 'parkKey', 'unparkSame', 'hasParkedFor', 'isRewardRow', 'rewardBillNo', 'parkedRewardWords', 'parkedName', 'parkedCustomer', 'parkedRowHTML', 'parkedSectionHTML', 'parkedRowOf', 'parkedFix', 'parkedFixCustomer', 'dropApproval', 'parkedDrop'].map(lift).join(''), ctx);
    return { ctx, DB, toasts };
  };
  const parkedRow = (no, extra) => Object.assign({ no, at: 'x', says: 'Rice — price 10 → 10.999', tillPost: { path: '/api/till/price', body: { item_id: ITEM, price: 10.999 } }, _why: PRICE_SENTENCE, _parked: { at: 1, status: 400, code: 'PRICE_DECIMALS', why: PRICE_SENTENCE } }, extra || {});
  await it('Needs fixing shows the item, the server\'s sentence, Fix (while the item exists) and Drop, each stamped data-cbsid from the register', async () => {
    const { ctx } = helperCtx();
    const html = vm.runInContext('parkedSectionHTML', ctx)([parkedRow('OP/7')]);
    assert.ok(/Needs fixing/.test(html) && html.includes('Rice') && html.includes('at most 2 decimal places'), html);
    assert.ok(/data-cbsid="CMP010"[^>]*data-testid="till-parked-fix-OP\/7"/.test(html), 'no Fix');
    assert.ok(/data-cbsid="CMP011"[^>]*data-testid="till-parked-drop-OP\/7"/.test(html), 'no Drop');
    ctx.S = { items: [] };
    assert.ok(!/till-parked-fix/.test(vm.runInContext('parkedSectionHTML', ctx)([parkedRow('OP/7')])), 'Fix offered for an item that is gone');
    assert.strictEqual(vm.runInContext('parkedSectionHTML', ctx)([{ no: 'a' }]), '', 'a section with no parked row');
  });
  await it('Drop is the owner\'s: without the PIN the row stays, with it the row goes; a declined confirm changes nothing', async () => {
    for (const [sure, pin, gone] of [[true, null, false], [false, { by: 1 }, false], [true, { by: 1 }, true]]) {
      const { ctx, DB } = helperCtx({ sure: async () => sure, ownerPinAsk: async () => pin });
      DB.stores.queue['OP/8'] = parkedRow('OP/8');
      await vm.runInContext('parkedDrop', ctx)('OP/8');
      assert.strictEqual(!DB.stores.queue['OP/8'], gone, 'confirm ' + sure + ' pin ' + !!pin + ' -> gone ' + !DB.stores.queue['OP/8']);
    }
  });
  await it('Drop with NO owner PIN: a signed-in owner or manager may, after the confirm, and the words say so; anyone else is told why (row stays)', async () => {
    const noPin = { pinBook: () => ({}) };
    let c = helperCtx(Object.assign({ rateMay: () => ({ ok: true, why: '' }) }, noPin));
    c.DB.stores.queue['OP/20'] = parkedRow('OP/20');
    await vm.runInContext('parkedDrop', c.ctx)('OP/20');
    assert.ok(!c.DB.stores.queue['OP/20'], 'a manager could not drop'); assert.ok(c.toasts.some((t) => /owner or manager dropped it/.test(t)), c.toasts.join('|'));
    c = helperCtx(Object.assign({ rateMay: () => ({ ok: false, why: 'Ask the owner.' }) }, noPin));
    c.DB.stores.queue['OP/21'] = parkedRow('OP/21');
    await vm.runInContext('parkedDrop', c.ctx)('OP/21');
    assert.ok(c.DB.stores.queue['OP/21'], 'a cashier dropped it'); assert.ok(c.toasts.some((t) => /SAY .*only a signed-in owner or manager/.test(t)), c.toasts.join('|'));
    c = helperCtx({ rateMay: () => ({ ok: true, why: '' }), ownerPinAsk: async () => null });   // an owner PIN IS set: the PIN rules, a manager role is not enough
    c.DB.stores.queue['OP/22'] = parkedRow('OP/22');
    await vm.runInContext('parkedDrop', c.ctx)('OP/22');
    assert.ok(c.DB.stores.queue['OP/22'], 'the role bypassed a set owner PIN');
  });
  await it('a parked REWARD row says "Points for bill N could not be recorded: <sentence>" and Fix puts that customer in the customer box', async () => {
    const reward = (extra) => Object.assign({ no: 'C1/9/reward', at: 'x', tillPost: { path: '/api/till/reward', body: { ref: 'C1/9', holder: { scheme: 'phone', value: '+919812345678' }, spend: 0 } }, _why: 'That customer is not on this shop.', _parked: { at: 1, status: 404 } }, extra || {});
    const c = helperCtx({ S: { items: [], customers: [{ identity_id: 'i1', name: 'Kumar', phone: '98123 45678' }] } });
    const html = vm.runInContext('parkedSectionHTML', c.ctx)([reward()]);
    assert.ok(html.includes('Points for bill C1/9 could not be recorded: That customer is not on this shop.'), html);
    assert.ok(/till-parked-fix-C1\/9\/reward/.test(html), 'no Fix for a known customer');
    c.DB.stores.queue['C1/9/reward'] = reward();
    await vm.runInContext('parkedFix', c.ctx)('C1/9/reward');
    assert.deepStrictEqual(c.ctx.modes, ['sell']); assert.strictEqual(c.ctx.fields.cname.value, 'Kumar'); assert.strictEqual(c.ctx.fields.cphone.value, '98123 45678');
    c.ctx.S = { items: [], customers: [] };
    assert.ok(!/till-parked-fix/.test(vm.runInContext('parkedSectionHTML', c.ctx)([reward()])), 'Fix offered for a customer this counter does not know');
  });
  await it('a parked reward row is parked by the drain like any change (404), and a parked change never counts in the close sheet\'s waiting, the close check, Send now or the wipe', async () => {
    const { host, DB } = counter(() => [404, { code: 'NOT_FOUND', message: 'No such customer.' }]);
    DB.stores.queue['C1/9/reward'] = change('C1/9/reward', '/api/till/reward', { ref: 'C1/9', holder: { scheme: 'phone', value: '+9198' }, spend: 0 });
    await host.drain({ force: true });
    assert.ok(DB.stores.queue['C1/9/reward']._parked, 'a reward row refused 404 was not parked');
    const ctx = { DB, PARKED: [], rowIsMine: () => true, isIssuedRow: () => false, cbQuiet() {} };
    vm.createContext(ctx);
    vm.runInContext('function isParkedRow(row){ return !!(row && row._parked); }\n' + lift('sendableRows') + lift('closeReadinessNow') + lift('parkedLine'), ctx);
    DB.stores.bills = {};
    const rd = await vm.runInContext('closeReadinessNow()', ctx);
    assert.strictEqual(rd.waiting, 0); assert.strictEqual(rd.parked, 1);
    assert.strictEqual(vm.runInContext('parkedLine', ctx)(0).length, 0); assert.ok(/1 change needs fixing — they do not stop the close/.test(vm.runInContext('parkedLine', ctx)(1)[0]));
    for (const fn of ['closeCounter', 'sendNow', 'coldStart']) {
      const at = PAGE.indexOf('\nasync function ' + fn + '('), body = PAGE.slice(at, PAGE.indexOf('\n}\n', at));
      assert.ok(/sendableRows/.test(body), fn + ' still counts the raw queue');
    }
  });
  await it('a corrected save of the same change replaces its parked copy (same path + item), and leaves another item\'s parked change alone', async () => {
    const { ctx, DB } = helperCtx();
    DB.stores.queue['OP/9'] = parkedRow('OP/9');
    DB.stores.queue['OP/10'] = parkedRow('OP/10', { tillPost: { path: '/api/till/price', body: { item_id: 'item-2', price: 3.333 } } });
    await vm.runInContext('unparkSame', ctx)('/api/till/price', { item_id: ITEM, price: 11 });
    assert.deepStrictEqual(Object.keys(DB.stores.queue), ['OP/10']);
  });

  /** the money reader the till already has: CBMoney (engine money.js) on the window, the shop's currency from S.shop.currency */
  const priceCtx = (cur, extra) => {
    const ctx = Object.assign({ console, JSON, Math, Number, String, isFinite, Array, Object, Date, window: null, S: { shop: { currency: cur } }, toasts: [] }, extra || {});
    ctx.window = ctx; vm.createContext(ctx); vm.runInContext(MONEY, ctx);
    vm.runInContext('var r2 = function(n){ return window.CBMoney.round(Number(n) || 0); };\nfunction shopCur(){ return (typeof S !== "undefined" && S && S.shop && S.shop.currency) || null; }\n' + ['priceFinerWords', 'priceToGrain', 'bulkRefused'].map(lift).join(''), ctx);
    return ctx;
  };
  await it('price grain: INR 2, JPY 0, KWD 3 decimals; float noise passes; a finer typed price is refused in the api\'s sentence', () => {
    const w = (cur, x) => vm.runInContext('priceFinerWords', priceCtx(cur))(x);
    assert.strictEqual(w('INR', 19.99), ''); assert.strictEqual(w('INR', 19.990000000000002), ''); assert.strictEqual(w('JPY', 500), ''); assert.strictEqual(w('KWD', 1.234), '');
    assert.strictEqual(w('INR', 10.999), PRICE_SENTENCE);
    assert.strictEqual(w('JPY', 10.5), 'Price can have at most 0 decimal places in JPY (not 10.5). Round it and send it again.');
    assert.strictEqual(w('KWD', 1.2345), 'Price can have at most 3 decimal places in KWD (not 1.2345). Round it and send it again.');
  });
  await it('priceWrite refuses a finer price BEFORE any send, and sends one that fits', async () => {
    const sent = [], ctx = priceCtx('JPY', { money: (x) => String(x), WHO: null, CHANGED: { price: [] }, cloudFirst: async (o) => { sent.push(o.body.price); return { ok: true }; } });
    vm.runInContext(lift('priceWrite'), ctx);
    const refused = await vm.runInContext('priceWrite', ctx)({ item_id: ITEM, name: 'Rice', price: 100 }, 10.5);
    assert.ok(refused.ok === false && /at most 0 decimal places in JPY/.test(refused.why), JSON.stringify(refused));
    assert.deepStrictEqual(sent, []);
    await vm.runInContext('priceWrite', ctx)({ item_id: ITEM, name: 'Rice', price: 100 }, 110);
    assert.deepStrictEqual(sent, [110]);
  });
  await it('bulk +10% in JPY rounds to whole yen (999 -> 1099, 105 -> 116 half away), a typed 12.5 step is refused, INR keeps 2 decimals, a typed bulk price in JPY with decimals is refused', async () => {
    const run = async (cur, typed, was) => {
      const written = [], toasts = [], items = was.map((p, k) => ({ item_id: 'i' + k, name: 'Item' + k, price: p }));
      const ctx = priceCtx(cur, { ask: async () => typed, sure: async () => true, esc: String, money: String, toastLine: (t) => toasts.push(t), pickedItems: () => items, PICKED_IDS: [],
        priceWrite: async (i, v) => { written.push(v); return { ok: true }; }, changedLoad() {}, paintHits() {}, paintCard() {}, paintChips() {} });
      vm.runInContext(lift('pickedPrice'), ctx);
      await vm.runInContext('pickedPrice', ctx)();
      return { written, toasts };
    };
    let r = await run('JPY', '+10%', [999, 105, 33]);
    assert.deepStrictEqual(r.written, [1099, 116, 36], 'JPY +10% wrote ' + JSON.stringify(r.written));
    r = await run('JPY', '+12.5', [999]);
    assert.deepStrictEqual(r.written, []); assert.ok(/at most 0 decimal places in JPY/.test(r.toasts.join('|')), r.toasts.join('|'));
    r = await run('JPY', '66.5', [999]);
    assert.deepStrictEqual(r.written, []);
    r = await run('INR', '+10%', [19.99, 100]);
    assert.deepStrictEqual(r.written, [21.99, 110], 'INR +10% wrote ' + JSON.stringify(r.written));
    r = await run('KWD', '-5%', [1.2]);
    assert.deepStrictEqual(r.written, [1.14], 'KWD -5% wrote ' + JSON.stringify(r.written));
  });
  await it('re-saving the SAME price while a refused copy waits sends it again (replacing the parked copy); with none waiting it is still "nothing to do"', async () => {
    const sent = [], mk = (rows) => { const c = priceCtx('INR', { money: String, WHO: null, CHANGED: { price: [] }, DB: Object.assign(fakeDB(), {}), cloudFirst: async (o) => { sent.push(o.body.price); return { ok: true }; } });
      rows.forEach((r) => { c.DB.stores.queue[r.no] = r; });
      vm.runInContext(['isParkedRow', 'parkKey', 'hasParkedFor', 'priceWrite'].map((n) => n === 'isParkedRow' ? 'function isParkedRow(row){ return !!(row && row._parked); }\n' : lift(n)).join(''), c); return c; };
    let c = mk([]);
    let out = await vm.runInContext('priceWrite', c)({ item_id: ITEM, name: 'Rice', price: 10 }, 10);
    assert.deepStrictEqual([out.ok, sent.length], [true, 0], 'sent with nothing parked');
    c = mk([parkedRow('OP/30', { tillPost: { path: '/api/till/price', body: { item_id: ITEM, price: 10 } } })]);
    out = await vm.runInContext('priceWrite', c)({ item_id: ITEM, name: 'Rice', price: 10 }, 10);
    assert.deepStrictEqual(sent, [10], 'the same price was not sent again');
  });
  console.log('\n' + (n - failed) + '/' + n + ' passed');
  process.exit(failed ? 1 : 0);
})();
