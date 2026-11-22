/**
 * tests/till-zero-lines-1129.test.cjs — WALK AE R-F-02 / AU P-F-08 / AE R-F-05 (21 Nov): a 0% line says WHY, and the taxable is split by class (standard · zero-rated · exempt), in the pack's words.
 *
 * OWNS      the proof of the till master's lineZeroWordOf · kindRowsOf · kindLabelOf · slipRateOf (the slip line and foot) and dayAddKinds · dayKindRows · dayTaxSection (the day close), run in a vm with the ENGINES' own tax and
 *           packs (the api's adopted copies in lib/). The slip line words are the same facts lib/tax-lines lineTaxStatusOf reads (parity case at the end, when tax-lines loads).
 * CALLED BY scripts/guards.cjs · CI. No browser. Hand figures in MINOR units (fils / cents), prices include tax:
 *   AE  Std 105.00 (5%) -> taxable 10000 tax 500 · Rice 30.00 exempt -> 3000 · Gold 50.00 zero-rated -> 5000 · Notes 20.00 explicit 0%, no kind -> 2000
 *   AU  Std 22.00 (10%) -> taxable 2000 tax 200 · Milk 11.00 GST-free -> 1100
 * Break check: take the `lineZeroWordOf` call out of slipRateOf (line words fail), or the borderKindsPack arm out of kindRowsOf (the 0% split fails).
 * Run: node tests/till-zero-lines-1129.test.cjs
 */
// CARD      09-counter/bill-slip
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const engines = path.join(__dirname, '..', 'lib'); /* the ADOPTED engine copies the till is vendored from (lib/tax.js, regulation.js and the packs) — no engines checkout needed */
const T = require(path.join(engines, 'tax')), R = require(path.join(engines, 'regulation'));
const till = (fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till-slip.js'), 'utf8')).replace(/\r\n/g, '\n');
function sourceOf(name) {
  const start = till.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('till has no function ' + name);
  let depth = 0, i = till.indexOf('{', start);
  for (; i < till.length; i++) { if (till[i] === '{') depth++; else if (till[i] === '}' && --depth === 0) break; }
  return till.slice(start + 1, i + 1);
}
const NAMES = ['packKinds', 'kindWord', 'kindWordsOf', 'classesOf', 'noReasonZeroWord', 'kindLabelOf', 'borderKindsPack', 'packSplitsByState', 'kindRowsOf', 'lineZeroWordOf', 'bandWordsOf', 'slipRateOf', 'dayAddKinds', 'dayKindRows', 'dayTaxSection', 'daySlipRow'];
const ARABIC = { exempt: { ar: '\u0645\u0639\u0641\u0627\u0629', en: 'Exempt' }, zero_rated: { ar: '\u0628\u0646\u0633\u0628\u0629 \u0635\u0641\u0631', en: 'Zero-rated' } };
function tillWith(country, arabic) {
  const base = R.packFor(country);
  const pack = arabic ? Object.assign({}, base, { slip: Object.assign({}, base.slip, { reasons: ARABIC }) }) : base;
  const money = (x) => 'M' + Math.round(Number(x) * 100);
  const context = { cbQuiet: () => {}, window: { CBTax: T }, CBTax: T, shopPack: () => pack, schemeWord: () => (country === 'AE' ? 'VAT' : 'GST'), esc: (x) => String(x), money, rmoney: (x) => Math.round(x * 100) / 100,
    isReturnRow: (b) => b.kind === 'credit_note', isExpenseRow: () => false };
  vm.createContext(context);
  vm.runInContext(NAMES.map(sourceOf).join('\n'), context);
  return context;
}
let pass = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { console.log('FAIL ' + name + '\n   got  ' + JSON.stringify(got) + '\n   want ' + JSON.stringify(want)); process.exitCode = 1; } else { pass++; console.log('   ok   ' + name); }
};
const strip = (html) => html.replace(/<[^>]+>/g, '|').split('|').filter(Boolean).map((x) => x.trim());
const rows = (html) => strip(html).filter((x) => /=/.test(x)).map((x) => x.replace(/;$/, '')).sort();
const row = (a, b) => a + ' = ' + b + ';';
const sale = (country, lines) => T.determine({ seller: { Country: country, LglNm: 'Al Noor Trading LLC' }, buyer: { Country: country }, lines, priceIncludesTax: true });

console.log('\n== AE: Rice exempt, Gold zero-rated, a 0% with no kind, one 5% line ==\n');
const ae = tillWith('AE');
const inv = sale('AE', [{ name: 'Std', qty: 1, price: 105, rate: 5 }, { name: 'Rice', qty: 1, price: 30, gst_rate: 0, tax_kind: 'exempt' }, { name: 'Gold', qty: 1, price: 50, gst_rate: 0, tax_kind: 'zero_rated' }, { name: 'Notes', qty: 1, price: 20, gst_rate: 0 }]);
const bill = { kind: 'tax', invoice: inv };
eq('line words: the 5% line none of its own, Rice Exempt, Gold Zero-rated, the unkinded 0% reads VAT 0% · reason not stated', [0, 1, 2, 3].map((i) => ae.lineZeroWordOf(inv, i)), ['', 'Exempt', 'Zero-rated', 'VAT 0% · reason not stated']);
eq('slipRateOf puts the word on the line', [1, 2, 3].map((i) => ae.slipRateOf(bill, { gst_rate: 0 }, i).trim()), ['Exempt', 'Zero-rated', 'VAT 0% · reason not stated']);
eq('a rated line keeps "VAT 5%"', ae.slipRateOf(bill, { gst_rate: 5 }, 0).trim(), 'VAT 5%');
eq('the foot splits Taxable by class in minor units', rows(ae.kindRowsOf(inv, row)), ['Exempt = M3000', 'Standard-rated 5% = M10000', 'VAT 0% · reason not stated = M2000', 'Zero-rated = M5000']);
eq('no row is called Taxable', /Taxable/.test(ae.kindRowsOf(inv, row)), false);
const noKinds = sale('AE', [{ name: 'Std', qty: 1, price: 105, rate: 5 }, { name: 'Notes', qty: 1, price: 20, gst_rate: 0 }]);
eq('two classes with no kind named still split', rows(ae.kindRowsOf(noKinds, row)), ['Standard-rated 5% = M10000', 'VAT 0% · reason not stated = M2000']);
eq('one class alone prints the single Taxable row as before (the caller falls back)', ae.kindRowsOf(sale('AE', [{ name: 'Std', qty: 1, price: 105, rate: 5 }]), row), '');

console.log('\n== Arabic beside English, from the pack own words (slip.reasons) ==\n');
const arabic = tillWith('AE', true);
eq('Rice and Gold lines carry the Arabic after the English', [1, 2].map((i) => arabic.lineZeroWordOf(inv, i)), ['Exempt \u00B7 ' + ARABIC.exempt.ar, 'Zero-rated \u00B7 ' + ARABIC.zero_rated.ar]);
eq('a pack that carries no Arabic words prints English alone (never an invented translation)', ae.lineZeroWordOf(inv, 1), 'Exempt');

console.log('\n== AU P-F-08: GST-free on its own row, not inside Taxable ==\n');
const au = tillWith('AU');
const auInv = sale('AU', [{ name: 'Std', qty: 1, price: 22, rate: 10 }, { name: 'Milk', qty: 1, price: 11, gst_rate: 0, tax_kind: 'gst_free' }]);
eq('AU line word', au.lineZeroWordOf(auInv, 1), 'GST-free');
eq('AU foot (cents): GST-free 1100 on its own row, Taxable 10% 2000', rows(au.kindRowsOf(auInv, row)), ['GST-free = M1100', 'Taxable 10% = M2000']);

console.log('\n== India: unchanged (state-split pack) ==\n');
const inIn = tillWith('IN');
const inInv = T.determine({ seller: { Country: 'IN', LglNm: 'Shop', Gstin: '29AABCU9603R1ZM', State: '29' }, buyer: { Country: 'IN' }, lines: [{ name: 'A', qty: 1, price: 105, rate: 5 }, { name: 'B', qty: 1, price: 20, gst_rate: 0 }], priceIncludesTax: true });
eq('India: no zero word on a line, no kind rows', [inIn.lineZeroWordOf(inInv, 1), inIn.kindRowsOf(inInv, row)], ['', '']);

console.log('\n== the day close (R-F-05): the class split, the pack word, in minor units ==\n');
const dc = tillWith('AE'), sheet = { taxable: 0, tax: 0, rate: { 5: { base: 100, tax: 5 } }, taxed: true, returns: 0 };
dc.dayAddKinds(sheet, { kind: 'tax', invoice: inv });
const day = strip(dc.dayTaxSection(sheet, '<hr>')).join(' ');
eq('the day close holds the four classes', Object.keys(sheet.kinds).sort(), ['exempt|0', 'standard|0', 'standard|5', 'zero_rated|0']);
eq('the class rows carry the same words and fils', ['Exempt', 'Zero-rated', 'VAT 0% · reason not stated', 'Standard-rated 5%'].every((w) => day.includes(w)) && ['M3000', 'M5000', 'M2000', 'M10000'].every((m) => day.includes(m)), true);
eq('and the rate row says VAT, never GST', /GST/.test(day), false);

console.log('\n== parity: the till word is the api status (lineTaxStatusOf), same invoice ==\n');
try {
  const L = require('../lib/tax-lines');
  const mapped = L.lineTaxStatusOf(inv, []).map((s) => (s.status === 'RATED' ? '' : s.reason === 'zero_reason_missing' ? 'VAT 0% · reason not stated' : s.reason === 'zero_rated' ? 'Zero-rated' : s.reason === 'exempt' ? 'Exempt' : '?'));
  eq('lineTaxStatusOf and lineZeroWordOf agree line by line', [0, 1, 2, 3].map((i) => ae.lineZeroWordOf(inv, i)), mapped);
} catch (e) { console.log('   skip parity (tax-lines did not load: ' + String(e.message).split('\n')[0] + ')'); }
console.log('\n== ZERO-REASON (1129): the till asks for the reason of a 0% line before the bill can be sent ==\n');
{
  /* the api refuses a 0% line with no reason (lib/tax-lines lineTaxStatusOf zero_reason_missing); the till must stop on the same line, with its words. Fails on the parent: the till had no such question. */
  const ctx = (country, charges) => {
    const pack = R.packFor(country);
    const context = { shopPack: () => pack, shopTax: () => ({ charges }), schemeWord: () => (country === 'AE' ? 'VAT' : 'GST'), CART: [] };
    vm.createContext(context);
    vm.runInContext(['packKinds', 'lineKindOf', 'zeroNoReasonLines', 'zeroNoReasonNames', 'noZeroReasonWords'].map(sourceOf).join('\n'), context);
    return context;
  };
  const ind = ctx('IN', true), uae = ctx('AE', true), off = ctx('IN', false);
  const bare = { name: 'Notes', gst_rate: 0 };
  eq('a 0% line with no reason is asked', ind.zeroNoReasonNames([bare, { name: 'Rice', gst_rate: 5 }]), ['Notes']);
  eq('a 0% line the slab calls exempt / nil / non_gst is answered', ['exempt', 'nil', 'non_gst'].map((nil) => ind.zeroNoReasonNames([{ name: 'X', gst_rate: 0, nil_kind: nil }]).length), [0, 0, 0]);
  eq('a 0% line the pack names a kind for (AE zero_rated) is answered', uae.zeroNoReasonNames([{ name: 'Gold', gst_rate: 0, tax_kind: 'zero_rated' }]), []);
  eq('a line with no rate at all is the OTHER question (unratedLines), not this one', ind.zeroNoReasonNames([{ name: 'Poori', gst_rate: null }]), []);
  eq('a shop that charges nothing has no zero to explain', off.zeroNoReasonNames([bare]), []);
  eq('the sentence says why and names the line', /Say why Notes is GST 0%/.test(ind.noZeroReasonWords(['Notes'])), true);
  eq('the sale is stopped on it before tender', /zeroNoReasonNames\(\)[\s\S]{0,200}saleStopNote\(noWhySay\)/.test(till), true);
  eq('the ask opens the reason menu (0% slabs that name a reason), not the rate menu', /Number\(row\.rate\) === 0 && \(row\.nil_kind \|\| row\.tax_kind\)/.test(till), true);
  eq('the slip never prints a bare "VAT 0%" for a reasonless line', /return schemeWord\(\) \+ ' 0%';/.test(till), false);
}
console.log(pass + ' passed');
