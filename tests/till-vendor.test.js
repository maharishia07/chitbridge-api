/**
 * till-vendor.test.js — ONE COUNTER SCREEN, AND THE ARITHMETIC IT DOES (2026-09-07).
 *
 * The page is served by two hosts — the little program on a shop PC, and the web for a phone or tablet — so the first thing to hold is
 * that there is ONE of it. The second is the money: a counter's total, its offer and the split out of a tax-inclusive shelf price are
 * computed in the page, and a mistake there is money, not pixels. The page's own functions are lifted out and exercised here rather
 * than trusted to a screenshot.
 *
 * Run: node tests/till-vendor.test.js   · no DB, no browser, no network.
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { execFileSync } = require('child_process');

const API = path.join(__dirname, '..');
const PAGE = path.join(API, 'tools', 'tally-connector', 'till.html');
let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

console.log('— the counter —');

it('every copy of the screen is current (the master is the kit\'s till.html)', () => {
  try { execFileSync(process.execPath, [path.join(API, 'scripts', 'vendor-till.cjs'), '--check'], { encoding: 'utf8' }); }
  catch (e) { throw new Error((e.stdout || '').trim() || 'scripts/vendor-till.cjs --check failed'); }
});

it('the page never talks to the internet except through the two hosts', () => {
  const html = fs.readFileSync(PAGE, 'utf8');
  /* every fetch is either a local path (the program) or CloudHost.api + a path — a hard-coded third address would be a leak */
  const bad = (html.match(/fetch\(\s*['"]https?:\/\/[^'"]+/g) || []);
  assert.deepStrictEqual(bad, [], 'a hard-coded address in a fetch: ' + bad.join(', '));
});

it('it declares what it will not do — the boundary is written where the next person edits', () => {
  const html = fs.readFileSync(PAGE, 'utf8');
  for (const word of ['never blocks a sale', 'never sends a bill twice', 'never invents money'])
    assert.ok(html.indexOf(word) >= 0, 'the page no longer says it ' + word);
});

/* ── the money, lifted out of the page and run ─────────────────────────────────────────────────────────────── */
function load() {
  const html = fs.readFileSync(PAGE, 'utf8');
  const js = html.slice(html.indexOf('/* ═══ 0 · state'), html.lastIndexOf('applyLook();'));
  const sandbox = {
    window: {}, document: { getElementById: () => null, addEventListener: () => {}, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem: () => {} }, navigator: { onLine: false }, location: { origin: 'http://x', hash: '', protocol: 'http:' },
    indexedDB: { open: () => ({}) }, fetch: () => Promise.reject(new Error('no network in a test')), setInterval: () => {}, addEventListener: () => {},
    console,
  };
  sandbox.window = sandbox; vm.createContext(sandbox);
  vm.runInContext(js, sandbox);
  return sandbox;
}
const P = load();

it('a bill with no offer and no tax adds up to what the customer pays', () => {
  P.CART = [{ price: 200, qty: 2, gross: 400, net: 400, save: 0 }, { price: 30, qty: 3, gross: 90, net: 90, save: 0 }];
  P.S = { shop: { reg_type: 'unregistered' } };
  const m = P.billMoney();
  assert.strictEqual(m.net, 490); assert.strictEqual(m.tax, 0); assert.strictEqual(m.save, 0);
});

it('an offer comes off the total and is shown as a saving, never as a lower price', () => {
  P.CART = [{ price: 30, qty: 3, gross: 90, net: 81, save: 9 }];
  P.S = { shop: { reg_type: 'unregistered' } };
  const m = P.billMoney();
  assert.strictEqual(m.gross, 90); assert.strictEqual(m.save, 9); assert.strictEqual(m.net, 81);
});

it('a registered shop splits the tax OUT of the shelf price — the customer pays what the shelf said', () => {
  P.CART = [{ price: 118, qty: 1, gross: 118, net: 118, save: 0, gst_rate: 18 }];
  P.S = { shop: { reg_type: 'regular' } };
  const m = P.billMoney();
  assert.strictEqual(m.net, 118, 'the total is the shelf price');
  assert.strictEqual(m.base, 100); assert.strictEqual(m.tax, 18);
});

it('mixed rates and a zero-rated line, to the paisa', () => {
  P.CART = [
    { price: 250, qty: 1, gross: 250, net: 250, save: 0, gst_rate: 5 },
    { price: 200, qty: 2, gross: 400, net: 400, save: 0, gst_rate: 0 },
    { price: 30, qty: 3, gross: 90, net: 81, save: 9, gst_rate: 18 },
  ];
  P.S = { shop: { reg_type: 'regular' } };
  const m = P.billMoney();
  assert.strictEqual(m.net, 731);
  assert.strictEqual(Math.round((m.base + m.tax) * 100) / 100, 731, 'taxable plus tax is the total, always');
  assert.ok(m.byRate['5'] && m.byRate['18'], 'each rate is reported on its own, as a slip must show it');
});

it('the financial year in a bill number starts in April, as India\'s does', () => {
  assert.strictEqual(P.fyOf(new Date('2026-03-31T00:00:00Z')), '25-26');
  assert.strictEqual(P.fyOf(new Date('2026-04-01T00:00:00Z')), '26-27');
});

it('the chit a bill becomes carries the bill number as client_ref, so a replay cannot bill twice', () => {
  const chit = P.chitOf({ no: 'C1/26-27/0007', at: '2026-09-07T10:00:00Z', till: 'C1', total: 100, payments: [{ how: 'Cash', amount: 100 }],
    customer: { name: 'Walk-in' }, lines: [{ name: 'Oil', qty: 1, unit: 'litre', price: 100, net: 100 }] });
  assert.strictEqual(chit.client_ref, 'C1/26-27/0007');
  assert.strictEqual(chit.business_json.bill_no, 'C1/26-27/0007');
  assert.strictEqual(chit.recipients[0].self, true, 'a counter sale is the shop\'s own record');
  assert.strictEqual(chit.line_items[0].total, 100);
});

it('a discounted line travels with its offer, so the server does not apply one again', () => {
  const chit = P.chitOf({ no: 'C1/26-27/0008', at: '2026-09-07T10:00:00Z', lines: [{ name: 'Soap', qty: 3, unit: 'piece', price: 30, net: 81, off: true, save: 9, off_label: 'Diwali' }] });
  /* the object comes from the page's own context, so compare the values rather than the prototype */
  assert.strictEqual(chit.line_items[0].offer.off, 9);
  assert.strictEqual(chit.line_items[0].offer.label, 'Diwali');
});

/* ── the quantity typed in front of the name (2026-09-08) ───────────────────────────────────────────────────── */
function typing(text) { P.document.getElementById = () => ({ value: text }); return P.typed(); }

it('"3*rice" is three of what you choose, and the search is for "rice"', () => {
  const t = typing('3*rice');
  assert.strictEqual(t.qty, 3); assert.strictEqual(t.text, 'rice');
});

it('a weight off the scale reaches the bill: "0.75 x tomato"', () => {
  const t = typing('0.75 x tomato');
  assert.strictEqual(t.qty, 0.75); assert.strictEqual(t.text, 'tomato');
});

it('⚠️ a product called "2x4 nail" is still searched for, not read as two of a "4 nail"', () => {
  const t = typing('2x4 nail');
  assert.strictEqual(t.qty, 1); assert.strictEqual(t.text, '2x4 nail');
});

it('an ordinary word is an ordinary search', () => {
  const t = typing('  rice  ');
  assert.strictEqual(t.qty, 1); assert.strictEqual(t.text, 'rice');
});

/* ── the day-close sheet ────────────────────────────────────────────────────────────────────────────────────── */
const DAY = [
  { no: 'C1/26-27/0001', at: '2026-09-08T04:00:00Z', kind: 'tax', total: 236, taxable: 200, tax: 36, saved: 0,
    payments: [{ how: 'Cash', amount: 236 }], by: { id: 'a1', name: 'Kavitha' },
    lines: [{ name: 'Oil 1 L', qty: 2, unit: 'litre', price: 118, net: 236, gst_rate: 18 }] },
  { no: 'C1/26-27/0002', at: '2026-09-08T05:00:00Z', kind: 'tax', total: 105, taxable: 100, tax: 5, saved: 9,
    payments: [{ how: 'UPI', amount: 105 }], by: { id: 'a2', name: 'Murugan' },
    lines: [{ name: 'Rice 5 kg', qty: 1, unit: 'bag', price: 105, net: 105, gst_rate: 5 }] },
];

it('a day close says from which bill to which, and what was taken', () => {
  P.WHO = { id: 'a1', name: 'Kavitha', float: 500 };
  const d = P.dayCloseSheet(DAY);
  assert.strictEqual(d.bills, 2);
  assert.strictEqual(d.first, 'C1/26-27/0001');
  assert.strictEqual(d.last, 'C1/26-27/0002');
  assert.strictEqual(d.total, 341);
  assert.strictEqual(d.saved, 9);
  assert.strictEqual(d.gross, 350, 'what the shelf said, before what the shop gave away');
});

it('the tax is split BY RATE — the figure a return has to be reconciled against', () => {
  const d = P.dayCloseSheet(DAY);
  assert.strictEqual(d.rate[18].base, 200); assert.strictEqual(d.rate[18].tax, 36);
  assert.strictEqual(d.rate[5].base, 100); assert.strictEqual(d.rate[5].tax, 5);
  assert.strictEqual(d.tax, 41);
});

it('⭐ only cash is expected in the drawer, and the float is part of it', () => {
  P.WHO = { id: 'a1', name: 'Kavitha', float: 500 };
  const d = P.dayCloseSheet(DAY);
  assert.strictEqual(d.modes.Cash, 236);
  assert.strictEqual(d.modes.UPI, 105);
  assert.strictEqual(d.expected_cash, 736, 'UPI is not in the drawer');
});

it('who billed is on the sheet, per person', () => {
  const d = P.dayCloseSheet(DAY);
  assert.strictEqual(d.people.Kavitha.bills, 1);
  assert.strictEqual(d.people.Murugan.total, 105);
});

it('a day with nothing on it still closes, and says nothing was taken', () => {
  P.WHO = null;
  const d = P.dayCloseSheet([]);
  assert.strictEqual(d.bills, 0); assert.strictEqual(d.total, 0); assert.strictEqual(d.expected_cash, 0);
  assert.ok(P.dayCloseHTML(d).indexOf('nothing taken') > 0, 'an empty day must say so on the paper');
});

console.log(pass + ' checks');
