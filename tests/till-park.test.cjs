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
const PARK_FNS = ['qBackoff', 'qDue', 'qSoonest', 'isParkedRow', 'parksOn', 'sendableRows', 'refusedRow', 'frozenDrain'];
const PRICE_SENTENCE = 'Price can have at most 2 decimal places in INR (not 10.999). Round it and send it again.';

/** a counter whose wire answers from `answer(url)` -> [status, body]; `calls` lists every url it was asked */
function counter(answer) {
  const DB = fakeDB(), calls = [];
  const ctx = { console, setTimeout, clearTimeout, JSON, Object, Math, Date, String, Number, Array, Promise, Error, DB, OWNER: null, FOREIGN: 0, STATE: { queued: 0 }, DEADLINE: 20000, dbFrozen: () => false, FROZEN_LINE: 'frozen',
    lineUp: () => true, cbQuiet: () => {}, queueTally: async () => {}, paintStatus: () => {}, personOn: () => false, drainSoon: () => {}, ls: { set() {}, get: (k, d) => d },
    isSaleRow: (b) => !!(b && !b.tillPost && Array.isArray(b.lines)), renumberBill: async () => null, stampDeliveryRefs: (n, r) => r, chitOf: (b) => b, qWaitWords: () => '',
    fetchBy: async (url) => { calls.push(url); const [status, body] = answer(url); return { ok: status >= 200 && status < 300, status, json: async () => body, clone() { return this; } }; } };
  vm.createContext(ctx);
  vm.runInContext(liftVar('Q_FLOOR') + liftVar('WAITS_FOR_BILL') + liftVar('FINAL_REFUSALS') + liftVar('ONE_ROW_REFUSALS') + PARK_FNS.map(lift).join('') + liftCloudHost(), ctx);
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
    DB.isFrozen = () => false; vm.runInContext(liftVar('QUEUED') + lift('dbFrozen') + lift('isParkedRow') + lift('sendableRows') + lift('queueTally'), ctx);
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
  await it('a store clear keeps refused changes: closeCounter, coldStart and wipeDevice read them FIRST (closeCounter before the shop is told), stop with words if unreadable, and clear through clearStoreKeeping (the browser run proves the rows survive: e2e/till-park.cjs)', () => {
    for (const fn of ['closeCounter', 'coldStart', 'wipeDevice']) {
      const at = PAGE.indexOf('\nasync function ' + fn + '('), body = PAGE.slice(at, PAGE.indexOf('\n}\n', at));
      const a = body.indexOf('await keepParked()'), u = body.indexOf('keptUnread(kept'), c = body.indexOf('await clearStoreKeeping(');
      assert.ok(a > 0 && a < u && u < c, fn + ' order read/unreadable-stop/clear: ' + [a, u, c]);
      assert.ok(!/await restoreParked\(|DB\.release\(\)/.test(body), fn + ' restores or releases by hand again');
    }
    const at = PAGE.indexOf('\nasync function closeCounter('), body = PAGE.slice(at, PAGE.indexOf('\n}\n', at));
    assert.ok(body.indexOf('await keepParked()') < body.indexOf("'/api/till/close'"), 'closeCounter reads the parked rows only AFTER telling the shop');
  });
  await it('an unreadable queue is not an empty one: keepParked answers null, keptUnread says so in words and stops, a readable one (even with no parked rows) goes on', async () => {
    const said = [];
    const ctx = { DB: { allRaw: async () => { throw new Error('idb gone'); } }, rowIsMine: () => true, cbQuiet() {}, say: (m) => said.push(m), busyDone() {} };
    vm.createContext(ctx);
    vm.runInContext('function isParkedRow(row){ return !!(row && row._parked); }\n' + ['keepParked', 'keptUnread'].map(lift).join(''), ctx);
    const kept = await vm.runInContext('keepParked()', ctx);
    assert.strictEqual(kept, null);
    assert.strictEqual(vm.runInContext('keptUnread', ctx)(kept, 'closing the counter'), true);
    assert.ok(/could not read the changes the shop refused, so closing the counter was stopped and nothing was cleared/.test(said[0]), said[0]);
    ctx.DB.allRaw = async () => [{ no: 'a' }, { no: 'b', _parked: { at: 1 } }];
    const ok = await vm.runInContext('keepParked()', ctx);
    assert.deepStrictEqual(ok.map((row) => row.no), ['b']); assert.strictEqual(vm.runInContext('keptUnread', ctx)(ok, 'x'), false); assert.strictEqual(vm.runInContext('keptUnread', ctx)([], 'x'), false);
  });
  await it('restoreOrSay retries ONCE with the rows still in memory and says in words if they still did not come back', async () => {
    for (const [answers, saysIt, calls] of [[[0, 2], false, 2], [[0, 0], true, 2], [[2], false, 1]]) {
      const said = [], tried = [];
      const ctx = { say: (m) => said.push(m), restoreParked: async (name, rows) => { tried.push(rows.length); return answers[tried.length - 1]; } };
      vm.createContext(ctx); vm.runInContext(lift('restoreOrSay'), ctx);
      await vm.runInContext('restoreOrSay', ctx)('store', [{ no: 'a' }, { no: 'b' }]);
      assert.strictEqual(tried.length, calls, 'tries ' + tried.length); assert.strictEqual(said.length > 0, saysIt, said.join('|'));
      if (saysIt) assert.ok(/2 change\(s\) the shop refused could not be put back/.test(said[0]), said[0]);
    }
  });
  await it('clearStoreKeeping: restores only after onsuccess; a BLOCKED delete restores nothing yet, says to close the other counter tab and stops; a late success still restores; an error stops with words', async () => {
    for (const mode of ['success', 'blocked', 'error']) {
      const said = [], restored = [], req = {};
      const ctx = { DB: { release: async () => {} }, busyDone() {}, say: (m) => said.push(m), restoreOrSay: async (name, rows) => { restored.push(name); return rows.length; }, indexedDB: { deleteDatabase: () => req }, holdBlocked: (name, rows) => said.push('HOLD ' + name + ' ' + rows.length) };
      vm.createContext(ctx); vm.runInContext(lift('clearStoreKeeping'), ctx);
      const pending = vm.runInContext('clearStoreKeeping', ctx)('store-1', [{ no: 'a' }]);
      await new Promise((r) => setImmediate(r));
      if (mode === 'success') req.onsuccess();
      if (mode === 'blocked') { req.onblocked(); }
      if (mode === 'error') { req.error = { name: 'UnknownError' }; req.onerror(); }
      const out = await pending;
      if (mode === 'success') assert.deepStrictEqual([out, restored.length], ['done', 1]);
      if (mode === 'error') assert.deepStrictEqual([out, restored.length, /could not clear its copy of the counter \(UnknownError\)/.test(said[0])], ['stopped', 0, true], said.join('|'));
      if (mode === 'blocked') {
        assert.deepStrictEqual([out, restored.length], ['stopped', 0], 'blocked restored before the delete finished');
        assert.deepStrictEqual(said, ['HOLD store-1 1'], 'a blocked delete must hold the counter (holdBlocked), got ' + said.join('|'));
        req.onsuccess(); await new Promise((r) => setImmediate(r));
        assert.strictEqual(restored.length, 1, 'a late success did not restore the kept rows');
      }
    }
  });
  await it('AFTER A BLOCKED CLEAR the counter takes nothing new: every DB write (bill, queue row, number series, delete) is refused with the Reload-this-counter words, every read REJECTS with the one DB_FROZEN error (never empty, never a hang), and nothing was written', async () => {
    const wrote = [], ctx = { console, Promise, Error, JSON, Object, MEM: { on: false, get: async () => undefined, put: async (...a) => { wrote.push(a); }, del: async () => { wrote.push('del'); }, all: async () => [] },
      ownRow: (x) => x, ownOK: () => true, cbQuiet() {}, tillStore: () => 'cb-till-x', tillStoresMake() {}, OWNER: null,
      indexedDB: { open: () => { const rq = {}; setImmediate(() => { wrote.push('open'); rq.onerror && rq.onerror(); }); return rq; } } };
    vm.createContext(ctx);
    const at = PAGE.indexOf('\nvar DB = (function(){');
    vm.runInContext(liftVar('BLOCKED_WORDS') + PAGE.slice(at, PAGE.indexOf('\n})();\n', at) + 7), ctx);
    const DB = vm.runInContext('DB', ctx);
    DB.freeze(vm.runInContext('BLOCKED_WORDS', ctx));
    for (const [name, call] of [['put bill', () => DB.put('bills', { no: 'C1/1' })], ['put queue', () => DB.put('queue', { no: 'C1/1' })], ['set series', () => DB.set('series', { next: 2 })], ['del', () => DB.del('queue', 'x')]]) {
      let said = ''; try { await call(); } catch (e) { said = e.message; }
      assert.ok(/Reload this counter/.test(said) && /no new bills or changes/.test(said), name + ' was not refused with words: ' + said);
    }
    for (const [name, read] of [['get', () => DB.get('series')], ['all', () => DB.all('bills')], ['allRaw', () => DB.allRaw('queue')], ['ownerRaw', () => DB.ownerRaw()]]) {
      let err = null; try { await Promise.race([read(), new Promise((_, no) => setTimeout(() => no(new Error('HUNG')), 500))]); } catch (e) { err = e; }
      assert.ok(err && err.code === 'DB_FROZEN' && /Reload this counter/.test(err.message), name + ' while frozen must REJECT at once with the frozen error (never [] / undefined = empty, never hang): ' + (err ? err.message : 'it answered'));
    }
    assert.deepStrictEqual(wrote, [], 'something was written after the block: ' + JSON.stringify(wrote));
  });
  await it('holdBlocked freezes the DB, saves the kept rows where a reload finds them and offers Reload this counter; reviveKept (after the reload) puts them back once, only into the same store', async () => {
    const store = {}, puts = [], asked = [], reloads = [];
    const base = { DB: { freeze: (w) => { base.frozen = w; }, put: async (st, row) => { puts.push(row.no); }, }, ls: { set: (k, v) => { store[k] = v; }, get: (k, d) => (k in store ? store[k] : d) }, cbQuiet() {}, tillStore: () => 'cb-till-x',
      sure: (...a) => { asked.push(a.slice(1, 4)); return Promise.resolve(true); }, location: { reload: () => reloads.push(1) },
      removeLocalKeys: (keys) => keys.forEach((k) => { delete store[k]; }), queueTally: async () => {}, paintStatus() {}, JSON, Array };
    vm.createContext(base);
    vm.runInContext(liftVar('BLOCKED_WORDS') + lift('askReload') + lift('mergedKept') + lift('holdBlocked') + lift('reviveKept'), base);
    vm.runInContext('holdBlocked', base)('cb-till-x', [{ no: 'OP/77' }]);
    await new Promise((r) => setImmediate(r));
    assert.ok(/Reload this counter/.test(base.frozen), 'DB not frozen'); assert.deepStrictEqual(asked[0], ['Reload this counter', 'Close the other counter tab', 'Not yet']); assert.strictEqual(reloads.length, 1, 'Reload this counter did nothing');
    assert.ok(store.cb_kept_parked && JSON.parse(store.cb_kept_parked).rows[0].no === 'OP/77', 'the kept rows were not saved for the reload');
    vm.runInContext('holdBlocked', base)('cb-till-x', []);   // a SECOND block with fewer (here no) rows must not shrink the note
    vm.runInContext('holdBlocked', base)('cb-till-x', [{ no: 'OP/78' }]);
    assert.deepStrictEqual(JSON.parse(store.cb_kept_parked).rows.map((row) => row.no).sort(), ['OP/77', 'OP/78'], 'the note was overwritten with fewer rows, or lost one: ' + store.cb_kept_parked);
    base.tillStore = () => 'cb-till-OTHER'; await vm.runInContext('reviveKept()', base);
    assert.deepStrictEqual(puts, [], 'revived into another shop\'s store'); assert.ok(store.cb_kept_parked, 'the note was dropped for another shop');
    base.tillStore = () => 'cb-till-x'; await vm.runInContext('reviveKept()', base);
    assert.deepStrictEqual(puts, ['OP/77', 'OP/78']); assert.ok(!store.cb_kept_parked, 'the note was not forgotten'); await vm.runInContext('reviveKept()', base); assert.strictEqual(puts.length, 2, 'revived twice');
  });
  await it('WHILE FROZEN the counter never looks empty or all sent: queueWords/queueStuck/queueTally/the day pill/the 🩺 block/the alert card/the Bills list all say frozen and offer Reload this counter', async () => {
    const els = {}, el = (id) => (els[id] = els[id] || { textContent: '', innerHTML: '', open: false, showModal() { this.open = true; } });
    let frozen = true;
    const ctx = { console, JSON, Array, Object, String, Number, STATE: { queued: 0 }, QUEUED: { parked: 0 }, DB: { isFrozen: () => frozen, all: async () => [] }, esc: (x) => String(x), money: String, CART: [], DAY_LAST: null,
      document: { getElementById: el, body: { classList: { contains: () => false } } }, cbQuiet() {}, personOn: () => false, paired: () => true, queueBlock: () => null, OUT_OF_SYNC: [] };
    vm.createContext(ctx);
    vm.runInContext(liftVar('BLOCKED_WORDS') + liftVar('FROZEN_LINE') + 'function isParkedRow(row){ return !!(row && row._parked); }\n' + liftVar('QUEUED')
      + ['dbFrozen', 'stuckLine', 'frozenNoticeHTML', 'frozenBillsView', 'frozenMark', 'queueCount', 'queueStuck', 'sendableRows', 'queueTally', 'paintDayPill', 'parkedAlert'].map(lift).join('')
      + 'function parkedWords(){ return "parked"; }\n', ctx);
    const run = (src) => vm.runInContext(src, ctx);
    assert.strictEqual(run('queueCount()'), 1, 'a frozen counter counts as something NOT at the shop');
    const stuck = run('queueStuck()'); assert.deepStrictEqual([stuck.fix, stuck.act], ['Reload this counter', 'reloadCounter']);
    assert.ok(/^Frozen — close the other counter tab and then reload this counter/.test(run('stuckLine(queueStuck())')), 'the status line does not say frozen');
    assert.ok(!/all sent|0 bill|reached the shop/i.test(run('stuckLine(queueStuck())')));
    const t = await run('queueTally()'); assert.strictEqual(t.frozen, true, 'queueTally does not say frozen'); assert.ok(run('QUEUED.frozen'));
    run('paintDayPill({ count: 0, total: 0 })'); assert.strictEqual(el('daypill').textContent, 'frozen — reload this counter', 'the day pill reads 0.00 while frozen');
    const notice = run('frozenNoticeHTML()'); assert.ok(/till-frozen-reload/.test(notice) && /Reload this counter/.test(notice) && /data-cbsid="CMP009"/.test(notice));
    run('frozenBillsView()'); assert.ok(els.billsdlg.open && /Reload this counter/.test(els.billsbody.innerHTML), 'the Bills list shows an empty day while frozen');
    assert.ok(/FROZEN/.test(run('frozenMark()')));
    const cards = []; run('parkedAlert')((...a) => cards.push(a)); assert.ok(cards.some((c) => c[0] === 'frozen' && /Reload this counter/.test(c[4])), 'no alert card while frozen');
    frozen = false;
    assert.strictEqual(run('queueCount()'), 0); assert.strictEqual(run('frozenNoticeHTML()'), ''); assert.strictEqual(run('frozenMark()'), ''); assert.strictEqual(run('queueStuck()'), null);
    run('paintDayPill({ count: 3, total: 40 })'); assert.strictEqual(el('daypill').textContent, 'today 3 · 40', 'the pill must be normal when not frozen');
    // the status bar itself: paintStatus's button path and queueWords read the frozen answer, pinned in the source (the browser run shows the painted bar)
    const ps = PAGE.slice(PAGE.indexOf('\nfunction paintStatus('), PAGE.indexOf('\n}\n', PAGE.indexOf('\nfunction paintStatus(')));
    assert.ok(/stuckNow && queueCount\(\)/.test(ps) && /queueCount\(\) \? '  ·  ' \+ queueWords\(\)/.test(ps), 'paintStatus does not read the frozen state');
    const qw = PAGE.slice(PAGE.indexOf('\nfunction queueWords('), PAGE.indexOf('\n}\n', PAGE.indexOf('\nfunction queueWords(')));
    assert.ok(/stuck && queueCount\(\)/.test(qw) && /return stuckLine\(stuck\)/.test(qw), 'queueWords can still say "all sent" while frozen');
  });
  await it('a FROZEN counter cannot decide from a read: frozenStop says the frozen words with the Reload offer and stops; closeCounter, wipeDevice, coldStart and sureSheet all begin with it; closeReadinessNow rethrows the frozen error instead of "0 of 0 sent"', async () => {
    const said = [], asked = [];
    const ctx = { dbFrozen: () => true, busyDone() {}, sure: (m, ok, t, no) => { asked.push([ok, no]); return Promise.resolve(false); }, location: { reload() {} }, cbQuiet() {}, PARKED: [], rowIsMine: () => true, isIssuedRow: () => true, Array, Error,
      DB: { all: async () => { const e = new Error('frozen'); e.code = 'DB_FROZEN'; throw e; }, allRaw: async () => { const e = new Error('frozen'); e.code = 'DB_FROZEN'; throw e; } } };
    vm.createContext(ctx);
    vm.runInContext(liftVar('BLOCKED_WORDS') + ['askReload', 'frozenStop', 'throwIfFrozen', 'closeReadinessNow'].map(lift).join('') + 'function sendableRows(r){ return r; }\n', ctx);
    ctx.sure = (m, ok) => { said.push(m); asked.push(ok); return Promise.resolve(false); };
    assert.strictEqual(vm.runInContext('frozenStop', ctx)('closing the counter'), true);
    assert.ok(/This counter is frozen, so closing the counter was stopped and nothing was cleared or sent\. Another counter tab/.test(said[0]) && asked[0] === 'Reload this counter', said[0]);
    let thrown = null; try { await vm.runInContext('closeReadinessNow()', ctx); } catch (e) { thrown = e; }
    assert.ok(thrown && thrown.code === 'DB_FROZEN', 'closeReadinessNow swallowed the frozen error and would show 0 of 0 sent');
    for (const fn of ['closeCounter', 'wipeDevice', 'coldStart', 'sureSheet']) {
      const at = PAGE.indexOf('\nasync function ' + fn + '('), body = PAGE.slice(at, PAGE.indexOf('\n}\n', at)), gate = body.indexOf('frozenStop(');
      assert.ok(gate > 0 && gate < body.indexOf('await ') || (gate > 0 && body.slice(0, gate).indexOf('await ') < 0), fn + ' reads before it checks frozen');
    }
  });
  await it('item 1: tillIssued never answers "not issued" for a frozen store (it rethrows), so tillClaimQuery cannot send issued=0 to the shop; tillStopped stops a bill with the frozen words', async () => {
    const froze = () => { const e = new Error('frozen'); e.code = 'DB_FROZEN'; return e; };
    const said = [];
    const ctx = { DB: { get: async () => { throw froze(); } }, tillId: () => 'C1', engineQueryOf: () => '', engineVersionsLoad: async () => ({}), encodeURIComponent, Number, Error, dbFrozen: () => true, busyDone() {}, sure: (m) => { said.push(m); return Promise.resolve(false); }, location: { reload() {} }, BREAK: false, LOCK: false };
    vm.createContext(ctx);
    vm.runInContext(liftVar('BLOCKED_WORDS') + ['throwIfFrozen', 'askReload', 'frozenStop', 'tillIssued', 'tillClaimQuery', 'tillStopped'].map(lift).join(''), ctx);
    let err = null, claim = null; try { claim = await vm.runInContext('tillClaimQuery()', ctx); } catch (e) { err = e; }
    assert.ok(err && err.code === 'DB_FROZEN' && claim === null, 'tillClaimQuery answered ' + claim + ' instead of stopping');
    ctx.dbFrozen = () => true;
    assert.strictEqual(await vm.runInContext('tillStopped()', ctx), true, 'a bill may be taken while frozen'); assert.ok(/taking this bill was stopped/.test(said[0]), said[0]);
    ctx.DB.get = async () => { throw new Error('plain read failure'); };   // a NON-frozen failure keeps the old answer (false = not issued) — only frozen changed
    assert.strictEqual(await vm.runInContext('tillIssued()', ctx), false);
  });
  await it('item 3: sendNow while frozen stops with the frozen words before ANY read (no unhandled rejection from the bare DB.all)', async () => {
    const said = []; let reads = 0;
    const ctx = { DB: { all: async () => { reads++; const e = new Error('frozen'); e.code = 'DB_FROZEN'; throw e; } }, dbFrozen: () => true, busyDone() {}, sure: (m) => { said.push(m); return Promise.resolve(false); }, location: { reload() {} }, lineUp: () => true, toastLine() {}, HOST: { drain: async () => ({}) }, sendableRows: (r) => r };
    vm.createContext(ctx);
    vm.runInContext(liftVar('BLOCKED_WORDS') + ['askReload', 'frozenStop', 'sendNow'].map(lift).join(''), ctx);
    await vm.runInContext('sendNow()', ctx);
    assert.strictEqual(reads, 0, 'sendNow read the queue while frozen'); assert.ok(/sending was stopped/.test(said[0]), said[0]);
  });
  await it('dayReread while frozen says the frozen words and stops: never "Nothing new on the server", no history call, nothing re-read', async () => {
    const said = []; let called = 0;
    const ctx = { dbFrozen: () => true, busyDone() {}, sure: (m) => { said.push(m); return Promise.resolve(false); }, location: { reload() {} }, HOST: { history: async () => { called++; return { bills: [] }; }, cred: () => 'k' }, tillId: () => 'C1', toastLine: (t) => said.push('TOAST ' + t), Array, Object, Date, DB: { all: async () => { throw new Error('read while frozen'); } } };
    vm.createContext(ctx);
    vm.runInContext(liftVar('BLOCKED_WORDS') + ['askReload', 'frozenStop', 'historyOrNull', 'dayReread'].map(lift).join(''), ctx);
    assert.strictEqual(await vm.runInContext('dayReread(true)', ctx), 0);
    assert.strictEqual(called, 0, 'it asked the shop for the day while frozen'); assert.ok(/re-reading the day was stopped/.test(said[0]) && !said.some((t) => /Nothing new/.test(t)), said.join('|'));
  });
  await it('GUARD: every DB read inside a try/catch is sorted — gated (the function stops first), checked (the catch rethrows/paints frozen) or closed (fails closed, reason written); a new unsorted one fails here', async () => {
    const esprima = require('esprima');   // already in the lock (4.0.1, via js-yaml); a missing parser FAILS this test, it never skips
    const html = PAGE, code = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map((x) => x[1]).join('\n');
    const ast = esprima.parseScript(code, { loc: true, range: true, tolerant: true }), found = {};
    const isFn = (node) => /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type);
    const walk = (node, ctx, name) => {
      if (!node || typeof node.type !== 'string') return;
      if (isFn(node)) ctx = { fn: (node.id && node.id.name) || name || ctx.fn + '>anon', handler: null, text: code.slice(node.range[0], node.range[1]) };
      if (node.type === 'AwaitExpression' && node.argument.type === 'CallExpression' && /^DB\.(get|all|allRaw|ownerRaw)$/.test(code.slice(node.argument.callee.range[0], node.argument.callee.range[1])) && ctx.handler) {
        const key = ctx.fn.replace(/>anon.*/, ''); (found[key] = found[key] || []).push(ctx);
      }
      for (const key of Object.keys(node)) {
        if (key === 'loc' || key === 'range') continue;
        for (const child of (Array.isArray(node[key]) ? node[key] : [node[key]])) {
          if (!child || typeof child.type !== 'string') continue;
          let next = ctx, nm = null;
          if (node.type === 'Property' && key === 'value' && node.key) nm = node.key.name || node.key.value;
          if (node.type === 'VariableDeclarator' && key === 'init' && node.id) nm = node.id.name;
          if (node.type === 'TryStatement' && key === 'block') next = Object.assign({}, ctx, { handler: node.handler ? code.slice(node.handler.range[0], node.handler.range[1]) : '(finally only)' });
          walk(child, next, nm);
        }
      }
    };
    walk(ast, { fn: '(top)', handler: null, text: '' }, null);
    const GATE = /frozenStop\(|frozenDrain\(|dbFrozen\(\)/, CHECK = /throwIfFrozen|dbFrozen|frozenOr|paintFrozenInto|DB_FROZEN/;
    const SORTED = {   // fn: [kind, why]   gated = the function stops/branches on frozen first · checked = every catch rethrows or paints frozen · closed = an unreadable store already fails closed, said here
      closeCounter: ['gated'], dayReread: ['gated'], closeReadinessNow: ['checked'], coldStart: ['gated'], drain: ['gated'], openBills: ['gated'], openStorage: ['gated'], releaseQueue: ['gated'], stuckSend: ['gated'], sureSheet: ['gated'], wipeDevice: ['gated'],
      queueTally: ['gated'], queueLength: ['checked'], retainPaint: ['checked'], subListPaint: ['checked'], tillIssued: ['checked'],
      keepParked: ['closed', 'null = unreadable; every caller stops through keptUnread'],
      checkAbsorbed: ['closed', 'null = could not check; callers say so, nothing is decided from it'],
      dayMarkWithdrawn: ['closed', 'only marks bills withdrawn; its writes reject while frozen'],
            load: ['closed', 'boot only: a fresh page is never frozen'],
      moveOldStores: ['closed', 'the read feeds a log line; the moves are writes that reject while frozen'],
      openStuck: ['closed', 'the catch puts the frozen words on the panel, and the frozen notice leads it'],
      qReady: ['closed', 'resets waits only; nothing is decided from an empty read'],
      resendBill: ['closed', 'the catch toasts the frozen words and queues nothing'],
      retainRun: ['closed', 'a read that fails stops the whole run'],
      schemeTakesEffect: ['closed', 'blank = no claim made'],
      setAside: ['closed', 'the catch toasts the frozen words; nothing is moved'],
      storageMap: ['closed', 'null rows print as an unknown dash, not as zero'],
      stuckReport: ['closed', 'the catch prints the frozen words in the report'],
      unparkSame: ['closed', 'a parked copy simply stays; its delete would reject anyway'],
      waitingNow: ['gated', 'falls back to queueCount(), which counts a frozen counter']
    };
    const bad = [];
    if (Object.keys(found).length < 25) bad.push('the scan found only ' + Object.keys(found).length + ' functions with a DB read in a try/catch — the guard has gone blind');
    for (const fn of Object.keys(found)) {
      const entry = SORTED[fn];
      if (!entry) { bad.push(fn + ': a DB read in a try/catch that is not sorted (decides-from-empty / paints-empty / fails-closed?) — gate it, rethrow DB_FROZEN, or add it to SORTED with its reason'); continue; }
      const text = found[fn][0].text;
      if (entry[0] === 'gated' && !(GATE.test(text) || /queueCount\(\)/.test(text))) bad.push(fn + ': claimed gated but the function never checks frozen');
      if (entry[0] === 'checked' && !found[fn].every((c) => CHECK.test(c.handler))) bad.push(fn + ': claimed checked but a catch lacks the frozen check');
      if (entry[0] === 'closed' && !(entry[1] && entry[1].length > 15)) bad.push(fn + ': closed without a written reason');
    }
    for (const fn of Object.keys(SORTED)) if (!found[fn]) bad.push(fn + ': listed but no longer has a DB read in a try (remove it from SORTED)');
    assert.deepStrictEqual(bad, [], bad.join('\n         '));
  });
  console.log('\n' + (n - failed) + '/' + n + ' passed');
  process.exit(failed ? 1 : 0);
})();
