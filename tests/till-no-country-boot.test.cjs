/* CTRY-94 regression: a shop with no country must not abort the counter's boot. billMoney() (reached from paintTotals at load) called
   CBTax.determine, which now refuses a seller with no country. The counter says the engines' NO_COUNTRY words instead and makes no
   invoice (so finish() refuses the sale); a country-IN shop totals as before. Lifts the page's own functions; the engines are the real ones. */
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
const FNS = ['billMoney', 'moneyOf', 'noCountryMoney', 'walkInNote', 'moneyStop', 'billWhen', 'shopDayOf', 'tzOpt', 'shopTz', 'shopPack', 'docCountry', 'bandWordsOf'];
function page(shop) {
  const ctx = {
    window: { CBTax: require('../lib/tax'), CBRegulation: require('../lib/regulation') },
    Number, String, Math, Object, Array,
    S: { shop }, CART: [{ key: 'a', name: 'Tea', unit: 'pc', qty: 2, price: 100, unitPrice: 100, save: 0, gst_rate: 5 }],
    BILL_DELIVERY: null,
    shopTax: () => ({ charges: true }), taxIncluded: () => true, packSplitsByState: () => shop.country === 'IN',
    custKnown: () => null, document: { getElementById: () => null },
  };
  ctx.CBTax = ctx.window.CBTax; ctx.CBRegulation = ctx.window.CBRegulation;
  vm.createContext(ctx);
  vm.runInContext(FNS.map(grab).join('\n'), ctx);
  return ctx;
}
let n = 0; const ok = (what, fn) => { fn(); n++; console.log('  ok  ' + what); };

ok('no country: billMoney does not throw, makes no invoice, says the NO_COUNTRY words', () => {
  const p = page({ name: 'Fresh', gstin: '' });
  const m = p.billMoney();
  const why = require('../lib/regulation').status(null).why;
  assert.strictEqual(m.noCountry, true);
  assert.strictEqual(m.why, why);
  assert.ok(/country/i.test(m.why));
  assert.strictEqual(m.invoice, null);
  assert.strictEqual(m.net, 0);
  assert.strictEqual(m.taxed, false);
});
ok('a blank / spaces country is no country (never defaulted to India)', () => {
  assert.strictEqual(page({ name: 'Fresh', country: '  ' }).billMoney().noCountry, true);
});
ok('country IN: totals as before (an invoice, no no-country flag)', () => {
  const m = page({ name: 'Shop', country: 'IN', gstin: '33AABCK1234F1Z6', state_code: '33' }).billMoney();
  assert.ok(!m.noCountry);
  assert.ok(m.invoice && m.net > 0, 'IN shop must total');
});
ok('the guard sits in billMoney, not the paint: paintTotals/finish read m.noCountry', () => {
  assert.ok(/innerHTML = noCountryRow\(m\)/.test(h), 'paintTotals shows the row');
  assert.ok(/saleStop\(saleStopWords\(m\)\)/.test(h), 'finish() stops with the words');
  const p = page({ name: 'Fresh' }); p.esc = String;
  vm.runInContext(['noCountryRow', 'saleStopWords'].map(grab).join('\n'), p);
  const m = p.billMoney();
  assert.ok(p.noCountryRow(m).includes('till-no-country') && p.noCountryRow(m).includes(m.why));
  assert.strictEqual(p.saleStopWords(m), m.why);
  assert.strictEqual(p.noCountryRow({}), '');
});
console.log(n + ' passed');
