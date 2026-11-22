/**
 * tests/till-slip-read-1129.test.cjs — THE SLIP, SPLIT INTO NAMED STEPS, PRINTS BYTE FOR BYTE WHAT IT DID (batch 1129, till-slip.js readability).
 *
 * OWNS      the proof that slipHTML (header · who · lines · count · tax block · tender · footer) still renders exactly the golden slips written from the
 *           code BEFORE it was split: India (every kind), Australia (credit-note-style negative, cash rounding), the Emirates (simplified, zero-rated · exempt lines,
 *           a foreign buyer over the invoice line), Japan (multi-rate, ※), a credit-terms bill, a reprint of a renumbered sale — plus the named steps one by one.
 * CALLED BY scripts/guards.cjs (offline gate) · by hand: node tests/till-slip-read-1129.test.cjs
 * FLOW      the page's own functions out of till.html + the whole of till-slip.js ──▶ a vm with the REAL packs and money engine ──▶ render each bill in the table
 *           ──▶ compare with tests/fixtures/till-slip-read-1129.golden.json (written from the old file: CB_SLIP_SRC=<old till-slip.js> CB_WRITE_GOLDEN=1 node tests/till-slip-read-1129.test.cjs)
 * CARD      09-counter/bill-slip
 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const KIT = path.join(__dirname, '../tools/tally-connector');
const PAGE = fs.readFileSync(path.join(KIT, 'till.html'), 'utf8').replace(/\r\n/g, '\n');
const SLIP_SOURCE = fs.readFileSync(process.env.CB_SLIP_SRC || path.join(KIT, 'till-slip.js'), 'utf8').replace(/\r\n/g, '\n');
const GOLDEN = path.join(__dirname, 'fixtures/till-slip-read-1129.golden.json');
const WRITE = process.env.CB_WRITE_GOLDEN === '1';
const T = require('../lib/tax');

/** a page function's source by brace count (till.html's own helpers the slip calls); '' when the page has none and `optional` */
function grab(name, optional) {
  let at = PAGE.indexOf('\nfunction ' + name + '(');
  if (at < 0) at = PAGE.indexOf('\nvar ' + name + ' = ');
  if (at < 0) { assert.ok(optional, name + ' is gone from till.html'); return ''; }
  const oneLine = PAGE.slice(at + 1, PAGE.indexOf('\n', at + 1));
  if (/^var \w+ = [^{]*;$/.test(oneLine)) return oneLine;
  let i = PAGE.indexOf('{', at), depth = 0;
  for (; i < PAGE.length; i++) { if (PAGE[i] === '{') depth++; else if (PAGE[i] === '}' && --depth === 0) break; }
  return PAGE.slice(at, i + 1);
}
const PAGE_FNS = ['esc', 'r2', 'rmoney', 'money', 'shopCur', 'docCountry', 'shopPack', 'registryTaxId', 'taxIdLabel', 'countryWords', 'schemeWord', 'invoiceRule', 'NOT_DECIDED', 'taxFigure',
  'shopMinor', 'booksMajor', 'buyerFromMajor', 'unratedOnBill', 'taxSummaryHTML', 'rewardOnSlip', 'slipCheckedHTML', 'shopTax', 'bandWordsOf', 'packKinds', 'kindWord', 'kindWordsOf', 'kindRowsOf',
  'classesOf', 'reducedNoteHTML', 'unratedBaseOf', 'unratedApart', 'noRateWord', 'noReasonZeroWord', 'kindLabelOf', 'borderKindsPack', 'packSplitsByState', 'zeroKindIdOf', 'zeroKindWord', 'lineZeroWordOf', 'taxHeadWord', 'domesticFootHTML', 'perRateFootHTML', 'packCollectsWithoutId',
  'cashRule', 'payWayId', 'cashDue', 'cashRoundWords', 'restBeforeLast', 'changeOf', 'cashRoundOf'];

/** a till page for one shop: the real packs and money engine, the page's own helpers, the whole slip file, plain stand-ins for the rest */
function page(country, currency, shop) {
  const MONEY = require('../lib/money');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../lib/locale.browser.js'), 'utf8'), sandbox);
  const ctx = {
    window: { CBRegulation: require('../lib/regulation'), CBCountries: require('../lib/country'), CBMoney: MONEY, CBLocale: sandbox.CBLocale, CBTax: T },
    Number, String, Math, Object, Array, JSON, isFinite,
    S: { shop: Object.assign({ country, currency, name: 'Test Shop', address: '1 Main St', phone: '99999', tax_id_word: require('../lib/profile').taxIdWordOf(country) }, shop || {}) },
    MONEY: () => MONEY,
    cbQuiet: () => {}, counterName: () => 'Counter 1', atShop: (d, part) => (part === 'date' ? '17 Oct 2026' : part === 'time' ? '10:00 am' : '17 Oct 2026 10:00'),
    billOrderRow: (bill, row) => (bill.order_word ? row('Table', bill.order_word) : ''), billSendTo: (bill) => bill.sent_to || null,
    modWordsPlain: (m) => m.join(', '), posWords: (c) => c + ' Karnataka', rwProg: () => null,
    cartCount: (lines) => ({ products: lines.length, items: lines.reduce((a, l) => a + l.qty, 0), measured: lines.some((l) => l.unit === 'kg') ? { kg: 2.25 } : {} }),
  };
  ctx.CBMoney = MONEY; ctx.CBLocale = sandbox.CBLocale; ctx.CBRegulation = ctx.window.CBRegulation; ctx.CBCountries = ctx.window.CBCountries; ctx.CBTax = T;
  vm.createContext(ctx);
  vm.runInContext(PAGE_FNS.map((n) => grab(n, true)).join('\n') + '\n' + SLIP_SOURCE + '\nthis.__fns = { slipHTML' + (WRITE ? '' : ', slipRowHTML, slipWhoRowsHTML, slipCountBlockHTML, slipTenderHTML, slipLinesHTML, slipLineHTML, slipOfferRowsHTML, slipOffersOf, slipIndentedRowHTML, slipTaxBlockHTML') + ' };', ctx);
  return ctx.__fns;
}

const line = (o) => Object.assign({ name: 'Rice 5kg', qty: 1, unit: 'pc', price: 590, mrp: 620, gross: 590, save: 0, net: 590, gst_rate: 5, offers: [] }, o);
const pay = (how, amount) => [{ how, amount }];
const WALK = { name: 'Walk-in' };
const aeSale = (rows) => T.determine({ seller: { Country: 'AE', LglNm: 'Al Noor Trading LLC' }, buyer: { Country: 'AE' }, lines: rows, priceIncludesTax: true });
const AE_ZERO_INVOICE = aeSale([{ name: 'Std', qty: 1, price: 105, rate: 5 }, { name: 'Rice', qty: 1, price: 30, gst_rate: 0, tax_kind: 'exempt' }, { name: 'Gold', qty: 1, price: 50, gst_rate: 0, tax_kind: 'zero_rated' }]);

/** the table: every bill goes through slipHTML once, under the shop that issued it */
const IN_SHOP = { gstin: '29AAAAA0000A1Z5', reg_type: 'regular' };
const AE_SHOP = { gstin: '100123456700003', reg_type: 'regular' };
const TABLE = [
  ['IN tax intra, offer, change', 'IN', 'INR', IN_SHOP, { no: 'C1-0007', at: '2026-10-17T04:30:00Z', kind: 'tax', total: 1180, taxable: 1123.81, tax: 56.19, saved: 10, supply: 'intra', pos_state: '29',
    lines: [line({ offers: [{ label: 'Diwali 10 off', off: 10 }], gross: 600, net: 590, hsn: '7323', mods: ['extra spicy'] }), line({ name: 'Dal', net: 590, save_unnamed: 3 })],
    by_rate: { 5: { base: 1123.81, tax: 56.19, cgst: 28.09, sgst: 28.10 } }, payments: pay('Cash', 1180), change: 20, customer: WALK, by: { name: 'Asha' } }],
  ['IN tax inter, registered buyer with address', 'IN', 'INR', IN_SHOP, { no: 'C1-0008', at: '2026-10-17T04:31:00Z', kind: 'tax', total: 590, taxable: 561.9, tax: 28.1, supply: 'inter', pos_state: '33',
    lines: [line({ hsn: '9987' })], by_rate: { 5: { base: 561.9, tax: 28.1, igst: 28.1 } }, payments: pay('UPI', 590), customer: { name: 'Ravi', gstin: '33AAAAA0000A1Z5', address: '4 Race Course Rd' } }],
  ['IN bill of supply, registered buyer', 'IN', 'INR', IN_SHOP, { no: 'C1-0009', at: '2026-10-17T04:32:00Z', kind: 'supply', total: 590, taxable: 590, tax: 0, lines: [line({ gst_rate: null })], payments: pay('Cash', 590), customer: { name: 'Ravi', gstin: '33AAAAA0000A1Z5' } }],
  ['IN cash memo, weighed line', 'IN', 'INR', IN_SHOP, { no: 'C1-0010', at: '2026-10-17T04:33:00Z', kind: 'cash', total: 590, taxable: 590, tax: 0, lines: [line({ gst_rate: null, unit: 'kg', qty: 2.25 })], payments: pay('Cash', 590), customer: WALK }],
  ['IN not a tax invoice (shop details)', 'IN', 'INR', IN_SHOP, { no: 'C1-0011', at: '2026-10-17T04:34:00Z', kind: 'tax', not_invoice: 'shop_details', total: 590, taxable: 561.9, tax: 28.1, supply: 'intra',
    lines: [line()], by_rate: { 5: { base: 561.9, tax: 28.1 } }, payments: pay('Cash', 590), customer: WALK }],
  ['IN unrated line', 'IN', 'INR', IN_SHOP, { no: 'C1-0012', at: '2026-10-17T04:35:00Z', kind: 'tax', total: 590, taxable: 590, tax: 0, supply: 'intra', lines: [line({ gst_rate: null, name: 'Poori' })], by_rate: {}, payments: pay('Cash', 590), customer: WALK }],
  ['IN credit bill, due date, table, reprint of a renumbered sale, sent to', 'IN', 'INR', IN_SHOP, { no: 'C1-0013', printed_as: 'C1-0001', at: '2026-10-17T04:36:00Z', kind: 'tax', total: 590, taxable: 561.9, tax: 28.1, supply: 'intra', pos_state: '29',
    lines: [line()], by_rate: { 5: { base: 561.9, tax: 28.1 } }, payments: [], terms: { due_date: '2026-11-01' }, order_word: 'Table 4', sent_to: { name: 'Ravi' }, customer: { name: 'Ravi', gstin: '33AAAAA0000A1Z5' } }],
  ['IN credit note (negative)', 'IN', 'INR', IN_SHOP, { no: 'C1-0014', at: '2026-10-17T04:37:00Z', kind: 'tax', total: -590, taxable: -561.9, tax: -28.1, supply: 'intra', pos_state: '29',
    lines: [line({ qty: -1, net: -590, gross: -590 })], by_rate: { 5: { base: -561.9, tax: -28.1 } }, payments: pay('Cash', -590), customer: WALK }],
  ['AE simplified, 5%', 'AE', 'AED', AE_SHOP, { no: 'D1-0001', at: '2026-10-17T06:00:00Z', kind: 'tax', total: 105, taxable: 100, tax: 5, supply: 'domestic', heads: [{ name: 'VAT', rate: 5, amount: 5 }],
    lines: [line({ name: 'Dates', net: 105, mrp: null })], by_rate: { 5: { base: 100, tax: 5 } }, payments: pay('Cash', 105), customer: WALK }],
  ['AE zero-rated and exempt lines', 'AE', 'AED', AE_SHOP, { no: 'D1-0002', at: '2026-10-17T06:01:00Z', kind: 'tax', total: 185, taxable: 180, tax: 5, supply: 'domestic', invoice: AE_ZERO_INVOICE,
    lines: [line({ name: 'Std', net: 105, mrp: null }), line({ name: 'Rice', gst_rate: 0, net: 30, mrp: null }), line({ name: 'Gold', gst_rate: 0, net: 50, mrp: null })],
    by_rate: { 5: { base: 100, tax: 5 }, 0: { base: 80, tax: 0 } }, payments: pay('Card', 185), customer: WALK }],
  ['AE foreign buyer over the invoice line, full title', 'AE', 'AED', AE_SHOP, { no: 'D1-0003', at: '2026-10-17T06:02:00Z', kind: 'tax', total: 12000, taxable: 11428.57, tax: 571.43, supply: 'domestic',
    lines: [line({ name: 'Furniture', net: 12000, mrp: null })], by_rate: { 5: { base: 11428.57, tax: 571.43 } }, payments: pay('Card', 12000), customer: { name: 'Gulf Co LLC', gstin: '100999999900003' } }],
  ['AE no buyer over the line', 'AE', 'AED', AE_SHOP, { no: 'D1-0004', at: '2026-10-17T06:03:00Z', kind: 'tax', not_invoice: 'buyer_identity', total: 12000, taxable: 11428.57, tax: 571.43, supply: 'domestic',
    lines: [line({ name: 'Furniture', net: 12000, mrp: null })], by_rate: { 5: { base: 11428.57, tax: 571.43 } }, payments: pay('Card', 12000), customer: WALK }],
  ['AU tax, cash rounding, change', 'AU', 'AUD', { gstin: '51824753556', reg_type: 'regular' }, { no: 'A1-1', at: '2026-10-17T06:00:00Z', kind: 'tax', total: 10.03, taxable: 9.12, tax: 0.91, supply: 'domestic', heads: [{ name: 'GST', rate: 10, amount: 0.91 }],
    lines: [line({ gst_rate: 10, net: 10.03, price: 10.03, mrp: null })], by_rate: { 10: { base: 9.12, tax: 0.91 } }, payments: pay('Cash', 10.05), cash_round: 0.02, change: 9.95, customer: WALK }],
  ['AU credit note (negative tax and total)', 'AU', 'AUD', { gstin: '51824753556', reg_type: 'regular' }, { no: 'A1-2', at: '2026-10-17T06:05:00Z', kind: 'tax', total: -10.03, taxable: -9.12, tax: -0.91, supply: 'domestic', heads: [{ name: 'GST', rate: 10, amount: -0.91 }],
    lines: [line({ gst_rate: 10, qty: -1, net: -10.03, price: 10.03, mrp: null })], by_rate: { 10: { base: -9.12, tax: -0.91 } }, payments: pay('Card', -10.03), customer: WALK }],
  ['JP multi-rate, ※ on the reduced line', 'JP', 'JPY', { gstin: 'T1234567890123', reg_type: 'regular' }, { no: 'J1-0001', at: '2026-10-17T06:00:00Z', kind: 'tax', total: 1188, taxable: 1100, tax: 88, supply: 'domestic',
    heads: [{ name: 'JCT', rate: 10, amount: 80 }, { name: 'JCT', rate: 8, amount: 8 }], lines: [line({ name: 'Onigiri', gst_rate: 8, net: 108, mrp: null }), line({ name: 'Towel', gst_rate: 10, net: 1080, mrp: null })],
    by_rate: { 8: { base: 100, tax: 8 }, 10: { base: 800, tax: 80 } }, payments: pay('Cash', 1188), customer: WALK }],
  ['US receipt with sales tax, no EIN', 'US', 'USD', { gstin: '', reg_type: 'regular' }, { no: 'U1-1', at: '2026-10-17T06:00:00Z', kind: 'cash', total: 10.83, taxable: 10, tax: 0.83, supply: 'domestic', heads: [{ name: 'STAX', rate: 8.25, amount: 0.83 }],
    lines: [line({ gst_rate: 8.25, net: 10, mrp: null })], by_rate: { 8.25: { base: 10, tax: 0.83 } }, payments: pay('Card', 10.83), customer: WALK }],
];
const render = (row) => page(row[1], row[2], row[3]).slipHTML(row[4], { gross: row[4].total + (row[4].saved || 0) });

if (WRITE) {
  const out = {};
  TABLE.forEach((row) => { out[row[0]] = render(row); });
  fs.writeFileSync(GOLDEN, JSON.stringify(out, null, 1) + '\n');
  console.log('wrote ' + path.relative(process.cwd(), GOLDEN) + ' (' + TABLE.length + ' slips)');
  process.exit(0);
}

let count = 0;
const ok = (what, fn) => { fn(); count++; console.log('  ok  ' + what); };
const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));

TABLE.forEach((row) => ok('byte for byte as before: ' + row[0], () => assert.strictEqual(render(row), golden[row[0]], row[0] + ' changed')));

const fns = page('IN', 'INR', IN_SHOP);
ok('slipRowHTML: a plain row and the bold total row', () => {
  assert.strictEqual(fns.slipRowHTML('a', 'b'), '<div style="display:flex;justify-content:space-between"><span>a</span><span>b</span></div>');
  assert.match(fns.slipRowHTML('TOTAL', '1', true), /font-weight:700;font-size:1\.15em/);
});
ok('slipOffersOf: the stored list, the pre-offers[] single offer, or none', () => {
  assert.strictEqual(JSON.stringify(fns.slipOffersOf({ offers: [{ label: 'A', off: 1 }] })), JSON.stringify([{ label: 'A', off: 1 }]));
  assert.strictEqual(JSON.stringify(fns.slipOffersOf({ off: 2, save: 2, off_label: 'Old' })), JSON.stringify([{ label: 'Old', off: 2 }]));
  assert.strictEqual(JSON.stringify(fns.slipOffersOf({ off: 3, save: 3 })), JSON.stringify([{ label: 'Offer', off: 3 }]));
  assert.strictEqual(JSON.stringify(fns.slipOffersOf({})), JSON.stringify([]));
});
ok('slipOfferRowsHTML: nothing for a line with no offer; Gross + the scheme + the bill offer share for one with both', () => {
  assert.strictEqual(fns.slipOfferRowsHTML(line()), '');
  const html = fns.slipOfferRowsHTML(line({ offers: [{ label: 'Diwali', off: 10 }], save_unnamed: 3 }));
  assert.match(html, /Gross/); assert.match(html, /Diwali/); assert.match(html, /share of bill offer/);
});
ok('slipTenderHTML: the total, each tender, the change; no change row when none was given', () => {
  const html = fns.slipTenderHTML({ total: 100, payments: pay('Cash', 120), change: 20 }, fns.slipRowHTML);
  assert.ok(html.indexOf('TOTAL') < html.indexOf('Cash') && html.indexOf('Cash') < html.indexOf('Change'));
  assert.ok(!/Change/.test(fns.slipTenderHTML({ total: 100, payments: pay('UPI', 100), change: 0 }, fns.slipRowHTML)));
});
ok('slipCountBlockHTML: Products first, then Items', () => {
  const html = fns.slipCountBlockHTML({ lines: [line(), line()] }, fns.slipRowHTML);
  assert.ok(html.indexOf('Products') < html.indexOf('Items'));
});
console.log('\n' + count + ' passed');
