'use strict';
/**
 * bill-checks.test.js — the BILL's data checks (walk 2026-10-09, BF1–BF4, TB1, TB4, TB9, K1).
 *
 * Loads the real functions out of tools/tally-connector/till.html (no copy) into a sandbox with the real CBProfileMap
 * (lib/profile-map) and the real orders registry, and asserts one rule each:
 *   BF1  a GST shop's line with no rate is named, and a stored tax invoice with such a line is NOT headed TAX INVOICE
 *   BF2  the address's state / PIN must match the GSTIN's first two digits, else the shop's data is said to contradict itself
 *   BF3/8 modifiers print under their line; Dine-in (table) / Takeaway / Delivery print from bill.order
 *   BF4  one counter name, built from the prefix the bills are numbered under (C5 -> "Counter 5")
 *   TB4  park keeps the bill's own payment and order type; recall restores it (or resets to defaults)
 *   TB9  the day close is its own button, with a stated state
 * Run: node tests/bill-checks.test.js   · no DB, no browser.
 */
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const PAGE = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
const PM = require('../lib/profile-map');
const ORD = require('../lib/orders');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

/** the source of `function name(...) { ... }` — brace-matched, skipping strings, regex literals and comments well enough for these */
function srcOf(name) {
  const at = PAGE.indexOf('\nfunction ' + name + '(');
  assert(at >= 0, 'function ' + name + ' not found in till.html');
  let i = PAGE.indexOf('{', PAGE.indexOf(')', at)), depth = 0;
  for (let j = i; j < PAGE.length; j++) {
    const c = PAGE[j];
    if (c === '"' || c === "'") { const q = c; j++; while (PAGE[j] !== q) { if (PAGE[j] === '\\') j++; j++; } continue; }
    if (c === '/' && PAGE[j + 1] === '/') { while (PAGE[j] !== '\n') j++; continue; }
    if (c === '/' && PAGE[j + 1] === '*') { j = PAGE.indexOf('*/', j + 2) + 1; continue; }
    if (c === '/' && /[=(,:!&|?{};]\s*$/.test(PAGE.slice(Math.max(0, j - 12), j))) {   // a regex literal
      j++; while (PAGE[j] !== '/') { if (PAGE[j] === '\\') j++; else if (PAGE[j] === '[') { while (PAGE[j] !== ']') { if (PAGE[j] === '\\') j++; j++; } } j++; } continue;
    }
    if (c === '{') depth++;
    if (c === '}') { depth--; if (depth === 0) return PAGE.slice(at + 1, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}

function world(over) {
  const store = {};
  const box = Object.assign({
    window: { CBProfileMap: PM }, S: { shop: {} }, CART: [], STATE: {}, console,
    esc: (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    O: () => ORD, modWordsPlain: (m) => m.map((x) => x.option).join(' · '),
    ls: { get: (k, d) => (k in store ? store[k] : d), set: (k, v) => { store[k] = v; } },
    shopLs: (k) => k, tillId: () => 'C5',
  }, over || {});
  vm.createContext(box);
  ['shopTax', 'unratedNames', 'unratedOnBill', 'shopStateClash', 'counterName', 'posWords', 'billOrderRow'].forEach((n) => vm.runInContext(srcOf(n), box));
  box.__store = store;
  return box;
}
const reg = { gstin: '29ABCPE1234F1Z7', reg_type: 'regular' };

console.log('BF1 · no tax rate is named, and the paper does not say TAX INVOICE');
it('a GST shop lists the lines with no rate; a real 0 is a rate', () => {
  const w = world({ S: { shop: reg } });
  assert.deepStrictEqual(Array.from(w.unratedNames([{ name: 'Poori', gst_rate: null }, { name: 'Salt', gst_rate: 0 }, { name: 'Dosa', gst_rate: 5 }, { name: 'Chilli Paneer' }])), ['Poori', 'Chilli Paneer']);
});
it('a shop that charges no GST has nothing to warn about', () => {
  assert.deepStrictEqual(Array.from(world({ S: { shop: { reg_type: 'regular' } } }).unratedNames([{ name: 'Poori', gst_rate: null }])), []);
  assert.deepStrictEqual(Array.from(world({ S: { shop: Object.assign({}, reg, { reg_type: 'composition' }) } }).unratedNames([{ name: 'Poori' }])), []);
});
it('a stored tax invoice with an unrated line is flagged; a cash memo or a fully rated invoice is not', () => {
  const w = world({ S: { shop: reg } });
  assert.deepStrictEqual(Array.from(w.unratedOnBill({ kind: 'tax', lines: [{ name: 'Poori' }, { name: 'Dosa', gst_rate: 5 }] })), ['Poori']);
  assert.deepStrictEqual(Array.from(w.unratedOnBill({ kind: 'cash', lines: [{ name: 'Poori' }] })), []);
  assert.deepStrictEqual(Array.from(w.unratedOnBill({ kind: 'tax', lines: [{ name: 'Dosa', gst_rate: 5 }] })), []);
});
it('the slip source titles an unrated bill "NOT A TAX INVOICE" before it can say TAX INVOICE', () => {
  const s = srcOf('slipHTML');
  assert(/unrated\.length \? 'BILL — NOT A TAX INVOICE' : bill\.kind === 'tax' \? 'TAX INVOICE'/.test(s));
});

console.log('BF2 · the state of the address must be the state of the GSTIN');
it('Chennai, Tamil Nadu 600100 with a 29 (Karnataka) GSTIN is a contradiction, said in words with the fix', () => {
  const w = world({ S: { shop: Object.assign({}, reg, { address: 'Anna Nagar, Chennai, Tamil Nadu 600100' }) } });
  const c = w.shopStateClash();
  assert(c, 'expected a clash');
  assert.strictEqual(c.gstin_state, '29');
  assert(/Karnataka/.test(c.words) && /Tamil Nadu/.test(c.words), c.words);
  assert(/Correct the address or the GSTIN/.test(c.fix));
});
it('a PIN code alone is enough to catch it', () => {
  assert(world({ S: { shop: Object.assign({}, reg, { pincode: '600100' }) } }).shopStateClash());
});
it('an explicit state field that disagrees is caught', () => {
  assert(world({ S: { shop: Object.assign({}, reg, { state: 'Tamil Nadu' }) } }).shopStateClash());
});
it('an address in the GSTIN\'s own state is fine, and so is a shop with no GSTIN', () => {
  assert.strictEqual(world({ S: { shop: Object.assign({}, reg, { address: 'MG Road, Bengaluru, Karnataka 560001' }) } }).shopStateClash(), null);
  assert.strictEqual(world({ S: { shop: { address: 'Chennai, Tamil Nadu 600100' } } }).shopStateClash(), null);
});
it('finish() refuses on a clash before any number is taken', () => {
  const f = PAGE.slice(PAGE.indexOf('\nasync function finish('));
  assert(f.indexOf('shopStateClash()') > 0 && f.indexOf('shopStateClash()') < f.indexOf('var body = {'));
});
it('the place of supply prints with its state name', () => {
  assert.strictEqual(world().posWords('29'), '29 Karnataka');
  assert.strictEqual(world().posWords('99'), '99');
});

console.log('BF3 / BF8 · modifiers and the order type are on the paper');
it('Dine-in prints with its table, Takeaway and Delivery print plainly, no order prints nothing', () => {
  const w = world();
  assert(/Dine-in · Table 4/.test(w.billOrderRow({ order: { type: 'dine', table: '4' } })));
  assert(/Takeaway/.test(w.billOrderRow({ order: { type: 'take' } })) && !/Table/.test(w.billOrderRow({ order: { type: 'take', table: '4' } })));
  assert(/Delivery/.test(w.billOrderRow({ order: { type: 'deliver' } })));
  assert.strictEqual(w.billOrderRow({}), '');
});
it('the slip prints the chosen modifiers under the line, and the bill, chit and reprint all carry them', () => {
  assert(/till-slip-mods/.test(srcOf('slipHTML')));
  const f = PAGE.slice(PAGE.indexOf('\nasync function finish('));
  assert(/mods:\(c\.mods && c\.mods\.length \? c\.mods : null\)/.test(f), 'finish() puts mods on the bill line');
  assert(/if \(l\.mods && l\.mods\.length\) o\.mods = l\.mods;/.test(PAGE), 'the chit line carries mods');
  assert(/order: bill\.order \|\| undefined/.test(PAGE), 'the chit carries the order');
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'till.js'), 'utf8');
  assert(/order: \(b\.order && typeof b\.order === 'object'\)/.test(route) && /mods: Array\.isArray\(l\.mods\)/.test(route), 'GET /api/till/bills returns them');
});

console.log('BF4 · one counter name, from the prefix the bills are numbered under');
it('the default "Counter 1" does not outlive a C5 prefix', () => {
  const w = world(); w.__store.cb_till_name = 'Counter 1';
  assert.strictEqual(w.counterName(), 'Counter 5');
});
it('a name the shop gave (counter_name), or its own stored name, wins', () => {
  const w = world(); w.__store.cb_till_name = 'Counter 1'; w.__store.cb_till_counter_name = 'Front till';
  assert.strictEqual(w.counterName(), 'Front till');
  const v = world(); v.__store.cb_till_name = 'Juice bar';
  assert.strictEqual(v.counterName(), 'Juice bar');
});
it('no printed place reads the stored default name any more', () => {
  assert(!/ls\.get\('cb_till_name', 'Counter( 1)?'\)/.test(PAGE.replace(/\/\*[\s\S]*?\*\//g, '')), 'a display still reads cb_till_name directly');
  assert(!/STATE\.till && STATE\.till\.name/.test(PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^ *\*.*$/gm, '')), 'a display still reads STATE.till.name');
});
it('the Settings bill-number examples are built from tillId(), not typed', () => {
  assert(!/<option value="fy">C1\//.test(PAGE) && !/<option value="julian">C1\//.test(PAGE));
  assert(/prefix: tillId\(\), kind: 'sale', at: new Date\(\), seq: 3,\s*\n\s*scheme: Object\.assign/.test(PAGE));
});

console.log('TB1 · "in the combo" belongs to a combo');
it('modPaint blanks that sub-line unless the item is a combo', () => {
  assert(/if \(!cb\) \{ try \{ \[\]\.forEach\.call\(box\.querySelectorAll\('\.modopt \.mw'\)/.test(PAGE));
});

console.log('TB4 · a parked bill keeps, and gives back, its own payment and order type');
it('parkBill stores pay + order; unpark restores them or resets to the defaults', () => {
  const p = srcOf('parkBill'), u = srcOf('unpark');
  assert(/pay: \{ picked: PICKED, asked: !!PAY_ASKED/.test(p) && /otype: orderKind\(\)/.test(p));
  assert(/PICKED = pp\.picked \|\| 'Cash'/.test(u) && /setOrderKind\(pp\.otype \|\| 'dine'\)/.test(u));
});

console.log('TB9 · the day close says whether the day is closed, and closing is its own button');
it('the sheet carries a state line, the dialog a Close the day button apart from Print, and only the day report shows it', () => {
  assert(/till-day-state/.test(srcOf('dayCloseHTML')) && /DAY CLOSED at/.test(srcOf('dayCloseHTML')) && /NOT closed yet/.test(srcOf('dayCloseHTML')));
  assert(/id="slipdayclose"[^>]*onclick="dayCloseDo\(\)"[^>]*hidden>Close the day<\/button>/.test(PAGE));
  assert(/getElementById\('slipdayclose'\); if \(dc\) dc\.hidden = true;/.test(srcOf('slipDocButtons')));
  assert(/ls\.set\(shopLs\('cb_till_dayclosed'\)/.test(srcOf('dayCloseDo')));
});

console.log('K1 · Know your business reads the GSTIN the bill prints');
it('a pending GST Registration row becomes declared (not NOT HELD) when the shop has a GSTIN; nothing else changes', () => {
  const { adoptBillGstin } = require('../lib/readiness');
  const items = [{ standard: 'gst-registration', doc: 'gstn', status: 'pending', rung: null }, { standard: 'x', doc: 'y', status: 'pending', rung: null }];
  assert.strictEqual(adoptBillGstin(items, { gstin: '29ABCPE1234F1Z7' }), true);
  assert.strictEqual(items[0].status, 'gathered'); assert.strictEqual(items[0].rung, 'declared');
  assert(/not yet verified/.test(items[0].guidance) && /29ABCPE1234F1Z7/.test(items[0].guidance));
  assert.strictEqual(items[1].status, 'pending');
});
it('no GSTIN, or an already-gathered row (real evidence), is left exactly as it is', () => {
  const { adoptBillGstin } = require('../lib/readiness');
  const a = [{ standard: 'gst-registration', doc: 'gstn', status: 'pending', rung: null }];
  assert.strictEqual(adoptBillGstin(a, { gstin: null }), false); assert.strictEqual(a[0].status, 'pending');
  const b = [{ standard: 'gst-registration', doc: 'gstn', status: 'gathered', rung: 'verified' }];
  assert.strictEqual(adoptBillGstin(b, { gstin: '29ABCPE1234F1Z7' }), false); assert.strictEqual(b[0].rung, 'verified');
});

console.log('\n' + pass + ' passed');
