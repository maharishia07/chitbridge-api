/* CTRY-139 (till twin): India apparel and footwear GST by price per piece or pair. The LAW's band is applied by the engine and SHOWN by the counter.
   Lifts the page's own functions (billMoney, the slip line, the duplicate) over the real engine (lib/tax.js, v1.86.0) and a settable clock.
   Goldens (intra-state, exclusive): hsn 6109 at 2,500.00 on 22 Sep 2025 = 5%, total 2,625.00 · 2,500.01 = 18%, total 2,950.01 · 00:10 IST on 22 Sep reads the 22nd ·
   footwear 6403 per pair, same figures · a 6406 line keeps its stated rate. A credit note never re-rates: the page calls CBTax.determine once, in billMoney. */
// CARD      09-counter/billing-and-the-bill
'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const h = fs.readFileSync(__dirname + '/../tools/tally-connector/till.html', 'utf8').replace(/\r\n/g, '\n');
/** a function's source by brace count */
function grab(n) {
  const at = h.indexOf('function ' + n + '(');
  assert.ok(at >= 0, n + ' is gone from till.html');
  let i = h.indexOf('{', at), d = 0;
  for (; i < h.length; i++) { if (h[i] === '{') d++; else if (h[i] === '}' && --d === 0) break; }
  return h.slice(at, i + 1);
}
const FNS = ['billMoney', 'moneyOf', 'noCountryMoney', 'walkInNote', 'moneyStop', 'billWhen', 'shopDayOf', 'tzOpt', 'shopTz', 'shopPack', 'docCountry',
  'bandWordsOf', 'rateNoteOf', 'slipRateOf', 'pinBillMoment', 'slipOfRow', 'stampBands'];
const SHOP = { name: 'Kolkata Garments', gstin: '19AABCK1234F1Z6', state_code: '19', country: 'IN', reg_type: 'regular' };

/** the page with a clock stopped at `now` (an ISO instant); `taxed` false = a shop that charges no GST */
function page(now, cart, taxed) {
  const T0 = Date.parse(now);
  class Clock extends Date { constructor(...a) { if (a.length) super(...a); else super(T0); } static now() { return T0; } }
  const ctx = {
    window: { CBTax: require('../lib/tax'), CBRegulation: require('../lib/regulation') }, Date: Clock,
    Number, String, Math, Object, Array, isNaN, S: { shop: SHOP }, CART: cart.map((c) => Object.assign({ unit: 'piece', save: 0 }, c)),
    BILL_DELIVERY: null, shopTax: () => ({ charges: taxed !== false }), taxIncluded: () => false, packSplitsByState: () => true,
    custKnown: () => null, document: { getElementById: () => null }, cbQuiet() {}, schemeWord: () => 'GST', esc: (v) => String(v),
  };
  ctx.CBTax = ctx.window.CBTax; ctx.CBRegulation = ctx.window.CBRegulation;
  vm.createContext(ctx);
  vm.runInContext(FNS.map(grab).join('\n'), ctx);
  return ctx;
}
const line = (hsn, price, rate) => ({ key: 'k' + hsn, name: 'Item ' + hsn, hsn, qty: 1, price, unitPrice: price, gst_rate: rate });
const RANG = '2025-09-22T10:00:00.000Z';   /* 15:30 IST on 22 Sep 2025 */
let n = 0; const ok = (what, fn) => { fn(); n++; console.log('  ok  ' + what); };
const band = (m) => (m.invoice.ItemList[0] || {})._band || '';

ok('6109 at 2,500.00 on 22 Sep 2025: 5%, total 2,625.00, the engine words shown on the cart row', () => {
  const p = page(RANG, [line('6109', 2500, 12)]), m = p.billMoney();
  assert.strictEqual(m.net, 2625); assert.strictEqual(m.tax, 125);
  assert.strictEqual(p.CART[0].band, band(m)); assert.ok(/^5% · price up to Rs 2,500 per piece/.test(p.CART[0].band), p.CART[0].band);
  assert.ok(/GST 5% · price up to/.test(p.rateNoteOf(p.CART[0])), 'the row says the law');
  assert.ok(!/12%/.test(p.rateNoteOf(p.CART[0])), 'the old catalogue rate is not printed beside it');
});
ok('6109 at 2,500.01: 18%, total 2,950.01', () => {
  const p = page(RANG, [line('6109', 2500.01, 5)]), m = p.billMoney();
  assert.strictEqual(m.net, 2950.01);
  assert.ok(/^18% · price above Rs 2,500 per piece/.test(p.CART[0].band), p.CART[0].band);
});
ok('the rate cannot be lowered: a line that says 0% or 5% at 3,000 is billed at 18%', () => {
  for (const said of [0, 5, 12]) {
    const p = page(RANG, [line('6109', 3000, said)]), m = p.billMoney();
    assert.strictEqual(m.net, 3540, 'said ' + said); assert.ok(/^18%/.test(p.CART[0].band));
  }
});
ok('00:10 IST on 22 Sep 2025 reads the 22nd (a UTC slice would say the 21st and pick the old 12% row)', () => {
  const at = '2025-09-21T18:40:00.000Z';
  assert.strictEqual(at.slice(0, 10), '2025-09-21');
  const p = page(at, [line('6109', 2500, 12)]);
  assert.strictEqual(p.shopDayOf(), '2025-09-22'); assert.strictEqual(p.billWhen().day, '2025-09-22');
  assert.strictEqual(p.billMoney().net, 2625, 'the 22nd: 5%');
});
ok('23:50 IST on 21 Sep 2025 still reads the 21st: the old row (12% above Rs 1,000)', () => {
  const p = page('2025-09-21T18:20:00.000Z', [line('6109', 2500, 12)]);
  assert.strictEqual(p.shopDayOf(), '2025-09-21'); assert.strictEqual(p.billMoney().net, 2800);
  assert.ok(/^12%/.test(p.CART[0].band), 'the old row is shown too');
});
ok('footwear 6403 per pair: the same figures', () => {
  assert.strictEqual(page(RANG, [line('6403', 2500, 18)]).billMoney().net, 2625);
  const p = page(RANG, [line('6403', 2500.01, 12)]); assert.strictEqual(p.billMoney().net, 2950.01);
  assert.ok(/per pair/.test(p.CART[0].band), p.CART[0].band);
});
ok('a 6406 line (parts of footwear) keeps its stated rate and shows no band', () => {
  const p = page(RANG, [line('6406', 3000, 12)]), m = p.billMoney();
  assert.strictEqual(m.net, 3360); assert.strictEqual(p.CART[0].band, '');
  assert.strictEqual(p.rateNoteOf(p.CART[0]), ' · GST 12%');
});
ok('a shop that charges no GST shows no band and no tax', () => {
  const p = page(RANG, [line('6109', 3000, 18)], false), m = p.billMoney();
  assert.strictEqual(m.net, 3000); assert.strictEqual(p.CART[0].band, '');
});
ok('the bill slip and the duplicate print the same band words, read off the invoice (no sentence rebuilt)', () => {
  const p = page(RANG, [line('6109', 2500.01, 12)]), m = p.billMoney();
  const bill = { kind: 'tax', invoice: m.invoice, lines: [{ name: 'Item', gst_rate: 12 }] };
  const live = p.slipRateOf(bill, bill.lines[0], 0);
  assert.strictEqual(live, '  GST ' + band(m));
  const dup = p.slipOfRow(Object.assign({}, bill, { lines: [{ name: 'Item', gst_rate: 12 }] }));
  assert.strictEqual(p.slipRateOf(dup, dup.lines[0], 0), live, 'the duplicate says what the bill said');
  assert.strictEqual(p.slipRateOf({ kind: 'cash', invoice: m.invoice }, { gst_rate: 12 }, 0), '', 'a cash memo names no rate');
  assert.strictEqual(p.slipRateOf({ kind: 'tax', lines: [] }, { gst_rate: 12 }, 0), '  GST 12%', 'an old bill without an invoice keeps its line rate');
});
ok('billed_at and the band read the SAME day: a bill priced at 23:59 IST and saved after midnight keeps the priced moment', () => {
  const p = page('2025-09-22T18:29:00.000Z', [line('6109', 2500, 12)]), m = p.billMoney();   /* 23:59 IST on the 22nd */
  assert.strictEqual(m.when.day, '2025-09-22');
  const same = {}; p.pinBillMoment(same, m); assert.ok(!('at' in same), 'same day: nothing to pin, billed_at is the moment it is saved');
  const later = page('2025-09-22T18:31:00.000Z', []);   /* 00:01 IST on the 23rd */
  const body = {}; later.pinBillMoment(body, m); assert.strictEqual(body.at, m.when.at);
});
ok('a credit note is never re-rated: CBTax.determine is called once in the page, in billMoney (retMoney prorates the stored figures)', () => {
  const calls = h.match(/CBTax\.determine\(\{/g) || [];
  assert.strictEqual(calls.length, 1, 'one determine call in the page');
  assert.ok(grab('billMoney').includes('CBTax.determine({'), 'and it is billMoney');
  assert.ok(!/determine|billMoney|asOf/.test(grab('retMoney')), 'retMoney reads the stored figures only');
});
ok('the shop day has one reader: sinceWord and billMoney both use shopDayOf; dayKeyOf (day close) is not the bill\'s day', () => {
  assert.ok(grab('sinceWord').includes('shopDayOf'));
  assert.ok(/asOf: when\.day/.test(grab('billMoney')));
  assert.ok(!/dayKeyOf/.test(grab('billMoney')));
});
console.log(n + ' passed');
