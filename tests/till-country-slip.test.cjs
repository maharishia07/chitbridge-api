/**
 * tests/till-country-slip.test.cjs — THE COUNTER SLIP PER COUNTRY (till batch 2, 2026-10-17).
 *
 * OWNS      the slip's title in the shop's languages (pack.slip), the one-head tax word, Japan's per-rate foot and ※ mark,
 *           a US shop charging sales tax with no EIN, Australia's 5c cash rounding — and INDIA PRINTING BYTE FOR BYTE AS BEFORE.
 * CALLED BY scripts/guards.cjs (offline gate) · by hand: node tests/till-country-slip.test.cjs
 * FLOW      grab the page's own functions out of till.html ──▶ run them in a vm with the REAL packs (lib/regulation, lib/country)
 *           and the REAL money engine (lib/locale.browser) ──▶ render slipHTML ──▶ compare India with tests/fixtures/till-slip-in.golden.json
 *           (written from the code BEFORE this round: CB_WRITE_GOLDEN=1 node tests/till-country-slip.test.cjs).
 * CARD      counter/bill-slip
 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const HTML = fs.readFileSync(path.join(__dirname, '../tools/tally-connector/till.html'), 'utf8').replace(/\r\n/g, '\n');
const GOLDEN = path.join(__dirname, 'fixtures/till-slip-in.golden.json');
const WRITE = process.env.CB_WRITE_GOLDEN === '1';

/** a function's source by brace count; `optional` answers '' when the page has no such function (the golden run on the old code) */
function grab(name, optional) {
  let at = HTML.indexOf('\nfunction ' + name + '(');
  if (at < 0) at = HTML.indexOf('\nvar ' + name + ' = ');   /* a var-function (esc, money) or a table (SLIP_TITLE_EN) */
  if (at < 0) { assert.ok(optional, name + ' is gone from till.html'); return ''; }
  let i = HTML.indexOf('{', at), depth = 0;
  for (; i < HTML.length; i++) { if (HTML[i] === '{') depth++; else if (HTML[i] === '}' && --depth === 0) break; }
  return HTML.slice(at, i + 1);
}
const PAGE_FNS = ['esc', 'r2', 'money', 'shopCur', 'docCountry', 'shopPack', 'registryTaxId', 'taxIdLabel', 'countryWords', 'schemeWord', 'invoiceRule',
  'shopMinor', 'booksMajor', 'buyerFromMajor', 'slipHeadHTML', 'slipBuyerHTML', 'unratedOnBill', 'taxSummaryHTML', 'rewardOnSlip', 'slipHTML', 'shopTax'];
const NEW_FNS = ['SLIP_TITLE_EN', 'slipTitleKey', 'slipTitleLines', 'slipTitleHTML', 'slipTitleOf', 'taxHeadWord', 'domesticFootHTML', 'perRateFootHTML', 'reducedMark', 'reducedNoteHTML', 'slipTaxed',
  'packCollectsWithoutId', 'cashRule', 'payWayId', 'cashDue', 'cashRoundWords', 'slipCashRoundHTML', 'restBeforeLast', 'changeOf', 'cashRoundOf'];

/** a till page for one shop: the real packs and money engine, the page's own slip functions, plain stand-ins for the rest */
function page(country, currency, shop) {
  const MONEY = require('../lib/money');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../lib/locale.browser.js'), 'utf8'), sandbox);
  const ctx = {
    window: { CBRegulation: require('../lib/regulation'), CBCountries: require('../lib/country'), CBMoney: MONEY, CBLocale: sandbox.CBLocale },
    Number, String, Math, Object, Array, JSON, isFinite,
    S: { shop: Object.assign({ country, currency, name: 'Test Shop', address: '1 Main St', tax_id_word: require('../lib/profile').taxIdWordOf(country) }, shop || {}) },
    MONEY: () => MONEY,
    cbQuiet: () => {}, counterName: () => 'Counter 1', atShop: () => '17 Oct 2026 10:00', billOrderRow: () => '', billSendTo: () => null,
    modWordsPlain: (m) => m.join(', '), posWords: (c) => c + ' Karnataka', rwProg: () => null,
    cartCount: (lines) => ({ products: lines.length, items: lines.reduce((a, l) => a + l.qty, 0), measured: {} }),
  };
  ctx.CBMoney = MONEY; ctx.CBLocale = sandbox.CBLocale; ctx.CBRegulation = ctx.window.CBRegulation; ctx.CBCountries = ctx.window.CBCountries;
  vm.createContext(ctx);
  const src = PAGE_FNS.map((n) => grab(n)).concat(NEW_FNS.map((n) => grab(n, WRITE))).join('\n');
  vm.runInContext(src + '\nthis.__fns = { slipHTML, shopTax' + NEW_FNS.filter((n) => n !== 'SLIP_TITLE_EN' && grab(n, true)).map((n) => ', ' + n).join('') + ' };', ctx);
  return ctx.__fns;
}

/* ── India's bills: every title, both splits, an offer, an unrated line, change given ── */
const line = (o) => Object.assign({ name: 'Rice 5kg', qty: 1, unit: 'pc', price: 590, mrp: 620, gross: 590, save: 0, net: 590, gst_rate: 5, offers: [] }, o);
const INDIA = {
  tax_intra: { no: 'C1-0007', at: '2026-10-17T04:30:00Z', kind: 'tax', total: 1180, taxable: 1123.81, tax: 56.19, saved: 10, supply: 'intra', pos_state: '29',
    lines: [line({ offers: [{ label: 'Diwali 10 off', off: 10 }], gross: 600, net: 590 }), line({ name: 'Dal', gst_rate: 5, net: 590 })],
    by_rate: { 5: { base: 1123.81, tax: 56.19, cgst: 28.09, sgst: 28.10 } }, payments: [{ how: 'Cash', amount: 1180 }], change: 20, customer: { name: 'Walk-in' } },
  tax_inter: { no: 'C1-0008', at: '2026-10-17T04:31:00Z', kind: 'tax', total: 590, taxable: 561.9, tax: 28.1, supply: 'inter', pos_state: '33',
    lines: [line()], by_rate: { 5: { base: 561.9, tax: 28.1, igst: 28.1 } }, payments: [{ how: 'UPI', amount: 590 }], customer: { name: 'Ravi', gstin: '33AAAAA0000A1Z5' } },
  supply: { no: 'C1-0009', at: '2026-10-17T04:32:00Z', kind: 'supply', total: 590, taxable: 590, tax: 0, lines: [line({ gst_rate: null })], payments: [{ how: 'Cash', amount: 590 }], customer: { name: 'Walk-in' } },
  cash: { no: 'C1-0010', at: '2026-10-17T04:33:00Z', kind: 'cash', total: 590, taxable: 590, tax: 0, lines: [line({ gst_rate: null })], payments: [{ how: 'Cash', amount: 590 }], customer: { name: 'Walk-in' } },
  not_invoice: { no: 'C1-0011', at: '2026-10-17T04:34:00Z', kind: 'tax', not_invoice: 'shop_details', total: 590, taxable: 561.9, tax: 28.1, supply: 'intra',
    lines: [line()], by_rate: { 5: { base: 561.9, tax: 28.1 } }, payments: [{ how: 'Cash', amount: 590 }], customer: { name: 'Walk-in' } },
  unrated: { no: 'C1-0012', at: '2026-10-17T04:35:00Z', kind: 'tax', total: 590, taxable: 590, tax: 0, supply: 'intra',
    lines: [line({ gst_rate: null, name: 'Poori' })], by_rate: {}, payments: [{ how: 'Cash', amount: 590 }], customer: { name: 'Walk-in' } },
};
const IN_SHOP = { gstin: '29AAAAA0000A1Z5', reg_type: 'regular' };

if (WRITE) {
  const p = page('IN', 'INR', IN_SHOP), out = {};
  Object.keys(INDIA).forEach((k) => { out[k] = p.slipHTML(INDIA[k], { gross: INDIA[k].total + (INDIA[k].saved || 0) }); });
  fs.writeFileSync(GOLDEN, JSON.stringify(out, null, 1) + '\n');
  console.log('wrote ' + path.relative(process.cwd(), GOLDEN) + ' (' + Object.keys(out).length + ' slips)');
  process.exit(0);
}

let count = 0;
const ok = (what, fn) => { fn(); count++; console.log('  ok  ' + what); };
const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));

ok('India: every slip (tax intra/inter, bill of supply, cash memo, not a tax invoice, unrated) prints BYTE FOR BYTE as before', () => {
  const p = page('IN', 'INR', IN_SHOP);
  Object.keys(INDIA).forEach((k) => assert.strictEqual(p.slipHTML(INDIA[k], { gross: INDIA[k].total + (INDIA[k].saved || 0) }), golden[k], 'India ' + k + ' changed'));
});
ok('India: the titles come from the pack and uppercase to today\'s words', () => {
  const p = page('IN', 'INR', IN_SHOP);
  assert.deepEqual(p.slipTitleLines('tax', null).map((x) => x.text), ['TAX INVOICE']);
  assert.deepEqual(p.slipTitleLines('supply', null).map((x) => x.text), ['BILL OF SUPPLY']);
  assert.deepEqual(p.slipTitleLines('cash', null).map((x) => x.text), ['CASH MEMO']);
});
ok('no pack (no country stated) → today\'s English words', () => {
  const p = page(null, null, {});
  assert.deepEqual(p.slipTitleLines('tax', null).map((x) => x.text), ['TAX INVOICE']);
  assert.deepEqual(p.slipTitleLines('cash', null).map((x) => x.text), ['CASH MEMO']);
});

const AE_BILL = { no: 'D1-0001', at: '2026-10-17T06:00:00Z', kind: 'tax', total: 105, taxable: 100, tax: 5, supply: 'domestic',
  heads: [{ name: 'VAT', rate: 5, amount: 5 }], lines: [line({ name: 'Dates', gst_rate: 5, net: 105, mrp: null })], by_rate: { 5: { base: 100, tax: 5 } },
  payments: [{ how: 'Cash', amount: 105 }], customer: { name: 'Walk-in' } };
ok('UAE: Arabic first (rtl, lang ar), English after — a walk-in gets the SIMPLIFIED tax invoice (ER Art. 59(5))', () => {
  const p = page('AE', 'AED', { gstin: '100123456700003', reg_type: 'regular' });
  const html = p.slipHTML(AE_BILL, {});
  assert.match(html, /<div dir="rtl" lang="ar"[^>]*>فاتورة ضريبية مبسطة<\/div>/);
  assert.match(html, /<div lang="en"[^>]*>SIMPLIFIED TAX INVOICE<\/div>/);
  assert.ok(html.indexOf('فاتورة ضريبية مبسطة') < html.indexOf('SIMPLIFIED TAX INVOICE'), 'Arabic is the main line');
  assert.ok(!/GST SUMMARY|CGST/.test(html), 'no Indian grid');
});
ok('UAE: a registered buyer over AED 10,000 → the full "Tax Invoice" title', () => {
  const p = page('AE', 'AED', { gstin: '100123456700003', reg_type: 'regular' });
  const big = Object.assign({}, AE_BILL, { total: 12000, customer: { name: 'Co LLC', gstin: '100999999900003' } });
  assert.match(p.slipHTML(big, {}), />TAX INVOICE<\/div>/);
});

const JP_BILL = { no: 'J1-0001', at: '2026-10-17T06:00:00Z', kind: 'tax', total: 1188, taxable: 1100, tax: 88, supply: 'domestic',
  heads: [{ name: 'JCT', rate: 10, amount: 80 }, { name: 'JCT', rate: 8, amount: 8 }],
  lines: [line({ name: 'Onigiri', gst_rate: 8, net: 108, mrp: null }), line({ name: 'Towel', gst_rate: 10, net: 1080, mrp: null })],
  by_rate: { 8: { base: 100, tax: 8 }, 10: { base: 800, tax: 80 } }, payments: [{ how: 'Cash', amount: 1188 }], customer: { name: 'Walk-in' } };
ok('Japan: Japanese title first (lang ja), one foot row per rate (base + tax), ※ on the 8% line and the note', () => {
  const p = page('JP', 'JPY', { gstin: 'T1234567890123', reg_type: 'regular' });
  const html = p.slipHTML(JP_BILL, {});
  assert.match(html, /<div lang="ja"[^>]*>適格簡易請求書<\/div>/);
  assert.match(html, /<span>Onigiri ※<\/span>/);
  assert.match(html, /<span>Towel<\/span>/, 'the standard-rate line carries no mark');
  assert.match(html, /data-testid="till-slip-rate-8"/);
  assert.match(html, /data-testid="till-slip-rate-10"/);
  assert.match(html, /※ reduced rate \(軽減税率対象\)/);
  assert.match(html, /Consumption tax total/);
  assert.ok(!/JCT/.test(html), 'the scheme code is never printed');
});
ok('Japan: a credit note\'s negative `taxable` per rate prints negative, never 0', () => {
  const p = page('JP', 'JPY', { gstin: 'T1234567890123', reg_type: 'regular' });
  const cn = Object.assign({}, JP_BILL, { by_rate: { 8: { taxable: -100, tax: -8 } }, total: -108, tax: -8, taxable: -100 });
  assert.match(p.slipHTML(cn, {}), /-¥100|−¥100|¥-100/);
});

ok('Singapore: up to S$1,000 the simplified tax invoice, above it the full one — both "TAX INVOICE"; one head says GST', () => {
  const p = page('SG', 'SGD', { gstin: '201912345A', reg_type: 'regular' });
  const bill = { no: 'S1-1', at: '2026-10-17T06:00:00Z', kind: 'tax', total: 109, taxable: 100, tax: 9, supply: 'domestic', heads: [{ name: 'GST', rate: 9, amount: 9 }],
    lines: [line({ gst_rate: 9, net: 109, mrp: null })], by_rate: { 9: { base: 100, tax: 9 } }, payments: [{ how: 'Card', amount: 109 }], customer: { name: 'Walk-in' } };
  assert.strictEqual(p.slipTitleLines('tax', { kind: 'simplified' })[0].text, 'TAX INVOICE');
  assert.strictEqual(p.slipTitleLines('tax', { kind: 'full' })[0].text, 'TAX INVOICE');
  assert.match(p.slipHTML(bill, {}), /GST 9%/);
});

ok('United States: no EIN, sales tax still charged — kind cash, title RECEIPT, and the tax printed as "Sales tax"', () => {
  const p = page('US', 'USD', { gstin: '', reg_type: 'regular' });
  const tax = p.shopTax();
  assert.strictEqual(tax.charges, true);
  assert.strictEqual(tax.kind, 'cash');
  const bill = { no: 'U1-1', at: '2026-10-17T06:00:00Z', kind: 'cash', total: 10.83, taxable: 10, tax: 0.83, supply: 'domestic', heads: [{ name: 'STAX', rate: 8.25, amount: 0.83 }],
    lines: [line({ gst_rate: 8.25, net: 10, mrp: null })], by_rate: { 8.25: { base: 10, tax: 0.83 } }, payments: [{ how: 'Card', amount: 10.83 }], customer: { name: 'Walk-in' } };
  const html = p.slipHTML(bill, {});
  assert.match(html, />RECEIPT<\/div>/);
  assert.match(html, /Sales tax 8.25%/);
  assert.ok(!/STAX/.test(html), 'the scheme code is never printed');
});
ok('India: a shop with no GSTIN still charges nothing (collect_without_tax_id is the US pack\'s, not a default)', () => {
  const tax = page('IN', 'INR', { gstin: '', reg_type: 'regular' }).shopTax();
  assert.strictEqual(tax.charges, false);
  assert.strictEqual(tax.kind, 'cash');
});

ok('Australia: cash rounds to the nearest 5c — 10.03 → 10.05, 10.02 → 10.00; card pays exact; the slip says it', () => {
  const p = page('AU', 'AUD', { gstin: '51824753556', reg_type: 'regular' });
  assert.strictEqual(p.cashDue(10.03, 'cash'), 10.05);
  assert.strictEqual(p.cashDue(10.02, 'cash'), 10);
  assert.strictEqual(p.cashDue(10.03, 'card'), 10.03);
  assert.match(p.cashRoundWords(10.03), /A\$10\.05 · rounded from A\$10\.03/);
  const bill = { no: 'A1-1', at: '2026-10-17T06:00:00Z', kind: 'tax', total: 10.03, taxable: 9.12, tax: 0.91, supply: 'domestic', heads: [{ name: 'GST', rate: 10, amount: 0.91 }],
    lines: [line({ gst_rate: 10, net: 10.03, mrp: null })], by_rate: { 10: { base: 9.12, tax: 0.91 } }, payments: [{ how: 'Cash', amount: 10.05 }], cash_round: 0.02, change: 9.95, customer: { name: 'Walk-in' } };
  const html = p.slipHTML(bill, {});
  assert.match(html, /data-testid="till-slip-cashround"/);
  assert.match(html, /Cash rounding<\/span><span>\+?A\$0\.02/);
});
ok('India and Japan: no cashRounding in the pack → cash pays exact', () => {
  assert.strictEqual(page('IN', 'INR', IN_SHOP).cashDue(10.03, 'cash'), 10.03);
  assert.strictEqual(page('JP', 'JPY', {}).cashDue(1003, 'cash'), 1003);
  const india = page('IN', 'INR', IN_SHOP), paid = [{ how: 'Cash', amount: 10.03 }];
  assert.strictEqual(india.cashRoundOf(paid, 10.03), 0);
  assert.strictEqual(india.changeOf(20, 10.03, paid), 9.97);
});
ok('Australia: the bill stores what the cash took — cash_round +0.02, change against the rounded A$10.05; a card part pays exact', () => {
  const p = page('AU', 'AUD', { gstin: '51824753556', reg_type: 'regular', pay: [{ id: 'cash', label: 'Cash' }, { id: 'card', label: 'Card' }] });
  const cash = [{ how: 'Cash', amount: 10.05 }];
  assert.strictEqual(p.cashRoundOf(cash, 10.03), 0.02);
  assert.strictEqual(p.changeOf(20, 10.03, cash), 9.95);
  assert.strictEqual(p.cashRoundOf([{ how: 'Cash', amount: 10 }], 10.02), -0.02);
  assert.strictEqual(p.cashRoundOf([{ how: 'Card', amount: 10.03 }], 10.03), 0);
  assert.strictEqual(p.cashRoundOf([{ how: 'Card', amount: 5 }, { how: 'Cash', amount: 5.05 }], 10.03), 0.02, 'the cash that pays the rest rounds');
  assert.strictEqual(p.cashRoundOf([{ how: 'Cash', amount: 4 }], 10.03), 0, 'a short cash part is not a rounding');
});

ok('Australia → the books: the cash taken at A$10.05 on a A$10.03 invoice posts +0.02 as round-off by the EXISTING path (books-hooks · daySummary)', () => {
  const K = require('../lib/books-hooks');
  /* an AU bill as the engine freezes it: ONE head (scheme GST, the line's TaxAmt), never IGST */
  const invoice = { currency: 'AUD', _cb: { scheme: 'GST' }, ItemList: [{ GstRt: 10, AssAmt: 9.12, CgstAmt: 0, SgstAmt: 0, IgstAmt: 0, TaxAmt: 0.91, CesAmt: 0 }], ValDtls: { TotInvVal: 10.03 } };
  const walk = K.classify({ chit: { chit_id: 'c1', purpose: 'order', currency_code: 'AUD', business_json: { bill_no: 'A1-1', till: { id: 'C1' }, billed_at: '2026-10-17T05:00:00Z',
    payment: { parts: [{ how: 'Cash', amount: 10.05 }], cash_round: 0.02 } } }, entry: { sells: true, invoice }, setting: { enabled: true, walkin_grain: 'day', country: 'AU', functional_currency: 'AUD' } });
  assert.strictEqual(walk.kind, 'walkin');
  assert.strictEqual(walk.bill.round_off, 0.02);
  const day = require('../lib/books-engines').posting().daySummary([walk.bill], { ref: 'walkin C1 2026-10-17', date: '2026-10-17', counter: 'C1' }, { pack: require('../lib/regulation').packFor('AU') });
  assert.strictEqual(day.round_off, 0.02);
  assert.strictEqual(day.by_rate[0].gst, 0.91, 'the AU day posts its one GST head (ACC-201: the pack is the engine\'s THIRD argument, never the head)');
  assert.strictEqual('cgst' in day.by_rate[0], false, 'no India head on an AU day');
  assert.strictEqual(day.modes.cash, 10.05);
});
ok('shelf price default (lib/policy.flagOf, the ONE place): unset → the country\'s convention — US excludes tax, MY the shop\'s default, a stored value wins', () => {
  const policy = require('../lib/policy');
  assert.strictEqual(policy.flagOf({}, 'price_includes_tax', 'US'), 'no');
  assert.strictEqual(policy.flagOf({}, 'price_includes_tax', 'us'), 'no');
  assert.strictEqual(policy.flagOf({ price_includes_tax: 'yes' }, 'price_includes_tax', 'US'), 'yes', 'what the shop set is never overridden');
  ['IN', 'AU', 'AE', 'SG', 'JP', 'MY'].forEach((c) => assert.strictEqual(policy.flagOf({}, 'price_includes_tax', c), 'yes', c));
  assert.strictEqual(policy.flagOf({}, 'price_includes_tax'), 'yes', 'no country → the flag\'s own default, as before');
  assert.strictEqual(policy.flagOf({}, 'price_includes_tax', 'ZZ'), 'yes', 'no pack → the flag\'s own default');
});

console.log('till-country-slip: ' + count + ' checks');
process.exit(0);
