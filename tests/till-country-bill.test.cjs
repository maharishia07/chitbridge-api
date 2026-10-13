/* CX1 (2026-10-13) — the counter's bill follows the SHOP's pack: reg-au / reg-ae taxInvoice (T1), counts in the shop's grouping (T2), the
   languages it hears (T4). India's pack has no taxInvoice member, so an Indian bill is untouched (tests/tax-truth proves the bill byte for byte).
   Extracts the page's own functions from till.html; the packs are the real ones (lib/regulation); no browser. */
'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const h = fs.readFileSync(__dirname + '/../tools/tally-connector/till.html', 'utf8').replace(/\r\n/g, '\n');
/** a function's source by brace count — one-liners and long bodies alike */
function grab(n) {
  const at = h.indexOf('function ' + n + '(');
  assert.ok(at >= 0, n + ' is gone from till.html');
  let i = h.indexOf('{', at), d = 0;
  for (; i < h.length; i++) { if (h[i] === '{') d++; else if (h[i] === '}' && --d === 0) break; }
  return h.slice(at, i + 1);
}
const MONEY = require('../lib/money');
const FNS = ['docCountry', 'shopPack', 'taxIdLabel', 'invoiceRule', 'buyerNamed', 'buyerWarnWords', 'buyerFromMajor', 'slipBuyerHTML', 'shopMinor',
  'booksMajor', 'shopCount', 'voiceLangs', 'tillLang', 'langLabel'];
function page(country, currency, o) {
  o = o || {};
  const store = Object.assign({}, o.ls || {});
  const ctx = {
    window: { CBRegulation: require('../lib/regulation'), CBMoney: MONEY, CBLocale: { moneyTag: (c) => (c === 'INR' ? 'en-IN' : 'en-US'),
      REGIONS: { IN: { langs: ['en', 'hi', 'ta'] }, AE: { langs: ['ar', 'en', 'hi', 'ur', 'ml'] } }, langName: (l) => ({ en: 'English', ar: 'العربية' })[l] || l } },
    Number, String, Math, Object,
    S: { shop: { country, currency, gstin: o.gstin || null } },
    r2: (n) => MONEY.round(Number(n) || 0), esc: (v) => String(v == null ? '' : v), money: (v) => currency + ' ' + Number(v).toFixed(2),
    ls: { get: (k, d) => (k in store ? store[k] : d) },
    shopTax: () => ({ kind: 'tax', charges: true }),
    custKnown: () => o.cust || null,
    document: { getElementById: (id) => (id === 'cname' ? { value: o.name || '' } : null) },
  };
  ctx.CBRegulation = ctx.window.CBRegulation; ctx.CBMoney = MONEY; ctx.CBLocale = ctx.window.CBLocale;
  vm.createContext(ctx);
  vm.runInContext(FNS.map(grab).join('\n'), ctx);
  return ctx;
}
const t = (a, b) => a + '=' + b + ';';
let n = 0; const ok = (what, fn) => { fn(); n++; console.log('  ok  ' + what); };

ok('India: no taxInvoice member → no rule, no buyer warning, no buyer row on the slip', () => {
  const p = page('IN', 'INR', { cust: { gstin: '29BBBBB0000B1Z5' } });
  assert.strictEqual(p.invoiceRule(500000, 'X'), null);
  assert.strictEqual(p.buyerWarnWords({ net: 500000, tax: 100 }), '');
  assert.strictEqual(p.slipBuyerHTML({ kind: 'tax', total: 500000, customer: { gstin: '29BBBBB0000B1Z5' } }, t), '');
});
ok('Australia: A$1,000 or more with nobody named → the line on the bill (s.29-70(1)(c)(ii)); below it, nothing', () => {
  const p = page('AU', 'AUD');
  assert.match(p.buyerWarnWords({ net: 1000, tax: 90.91 }), /^Over AUD 1000\.00 a tax invoice names the buyer$/);
  assert.strictEqual(p.buyerWarnWords({ net: 999.99, tax: 90.9 }), '');
  assert.strictEqual(p.buyerWarnWords({ net: 1500, tax: 0 }), '', 'no tax charged → no tax invoice to make');
});
ok('Australia: a typed name or a known buyer with an ABN clears it', () => {
  assert.strictEqual(page('AU', 'AUD', { name: 'Jo Smith' }).buyerWarnWords({ net: 2000, tax: 181.82 }), '');
  assert.strictEqual(page('AU', 'AUD', { name: 'Walk-in' }).buyerWarnWords({ net: 2000, tax: 181.82 }) !== '', true);
  assert.strictEqual(page('AU', 'AUD', { cust: { gstin: '51824753556' } }).buyerWarnWords({ net: 2000, tax: 181.82 }), '');
});
ok('Australia: the slip names the buyer\'s ABN, and says why a bill saved without a buyer is not a tax invoice', () => {
  const p = page('AU', 'AUD');
  assert.strictEqual(p.slipBuyerHTML({ kind: 'tax', total: 120, customer: { name: 'Jo', gstin: '51824753556' } }, t), 'Buyer ABN=51824753556;');
  assert.match(p.slipBuyerHTML({ kind: 'tax', total: 1200, customer: { name: 'Walk-in' }, not_invoice: 'buyer_identity' }, t),
    /Over AUD 1000\.00 a tax invoice names the buyer or their ABN — none was given\./);
  assert.strictEqual(p.slipBuyerHTML({ kind: 'cash', total: 1200, customer: { gstin: '51824753556' } }, t), '');
});
ok('UAE: a registered buyer over AED 10,000 needs a FULL invoice with their TRN — the slip prints it; no buyer warning (TRN in hand)', () => {
  const p = page('AE', 'AED', { cust: { gstin: '100123456700003' } });
  assert.strictEqual(p.invoiceRule(12000, '100123456700003').kind, 'full');
  assert.strictEqual(p.invoiceRule(12000, null).kind, 'simplified');
  assert.strictEqual(p.buyerWarnWords({ net: 12000, tax: 571.43 }), '');
  assert.strictEqual(p.slipBuyerHTML({ kind: 'tax', total: 12000, customer: { gstin: '100123456700003' } }, t), 'Buyer TRN=100123456700003;');
});
ok('counts: lakh grouping for the rupee only (T2)', () => {
  assert.strictEqual(page('IN', 'INR').shopCount(100000), (100000).toLocaleString('en-IN'));
  assert.strictEqual(page('AU', 'AUD').shopCount(100000), '100,000');
  assert.strictEqual(page('AE', 'AED').shopCount(1234567), '1,234,567');
});
ok('voice: India keeps its four (the page\'s own list, en-IN by default); the UAE hears its region\'s languages, English first; Australia its English (T4)', () => {
  assert.strictEqual(page('IN', 'INR').voiceLangs(), null);
  assert.strictEqual(page('IN', 'INR').tillLang(), 'en-IN');
  assert.strictEqual(page('IN', 'INR', { ls: { cb_till_lang: 'ta-IN' } }).tillLang(), 'ta-IN');
  assert.deepStrictEqual(Array.from(page('AE', 'AED').voiceLangs()), ['ar-AE', 'en-AE', 'hi-AE', 'ur-AE', 'ml-AE']);
  assert.strictEqual(page('AE', 'AED').tillLang(), 'en-AE');
  assert.strictEqual(page('AE', 'AED', { ls: { cb_till_lang: 'en-IN' } }).tillLang(), 'en-AE', 'an India tag left on the device is not offered in Dubai');
  assert.strictEqual(page('AU', 'AUD').tillLang(), 'en-AU');
  assert.strictEqual(page('AE', 'AED').langLabel('ar-AE'), 'العربية');
  assert.strictEqual(page('IN', 'INR').langLabel('ta-IN'), 'தமிழ்');
});

/* the api side of the same bill (T5 · T6) */
ok('an invoice with no currency is in the SELLER\'s pack\'s money — AUD · AED; India (or no country) INR as before (T5)', () => {
  const T = require('../lib/tax-lines');
  assert.strictEqual(T.currencyOf({ Country: 'AU' }), 'AUD');
  assert.strictEqual(T.currencyOf({ Country: 'AE' }), 'AED');
  assert.strictEqual(T.currencyOf({ Country: 'IN' }), 'INR');
  assert.strictEqual(T.currencyOf({}), 'INR');
  assert.strictEqual(T.invoiceFor({ lines: [{ name: 'Tea', qty: 1, price: 11, gst_rate: 10 }], seller: { Country: 'AU' }, buyer: {} }).invoice.currency, 'AUD');
});
ok('a bill step label: lakh grouping for the rupee only — "AUD 100,000", never "AUD 1,00,000" (T6)', () => {
  const B = require('../lib/bill-privacy');
  assert.strictEqual(B.label({ code: B.MONEY_CODE, step: 'paid', amount_minor: 10000000, currency: 'AUD' }, true), 'Paid AUD 100,000');
  assert.strictEqual(B.label({ code: B.MONEY_CODE, step: 'paid', amount_minor: 10000000, currency: 'INR' }, true), 'Paid ₹1,00,000');
  assert.strictEqual(B.label({ code: B.MONEY_CODE, step: 'received', amount_minor: 123456, currency: 'AED' }, true), 'Received AED 1,234.56');
});
console.log('till-country-bill: ' + n + ' checks (api side included)');
process.exit(0);
