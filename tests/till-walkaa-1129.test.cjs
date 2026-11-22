/**
 * tests/till-walkaa-1129.test.cjs — WALK AA (21 Nov) words on the slip: AA-F-02 Taxable never holds a zero-rated or unrated line, AA-F-05 the credit note's title in both languages,
 * and the "reason not stated" word read from the pack's scheme word (GST in IN / AU, VAT in AE).
 *
 * OWNS      the till master's kindRowsOf (unrated row) · creditNoteTitleLines · noReasonZeroWord, run in a vm with the engines' own tax and packs (the api's adopted copies in lib/).
 * CALLED BY scripts/guards.cjs · CI. No browser. Hand figures (walk AA bill 1, prices include 5% VAT): Std 54.33 -> taxable 51.74 tax 2.59 · Gold 130.00 zero-rated · Notes 50.00 no rate at all.
 *   Taxable at 5% = 51.74; zero-rated 130.00; no rate 50.00; the three are never one "Taxable AED 231.74".
 * Break check: take unratedApart out of kindRowsOf (the 50.00 falls under "reason not stated" again), or slip.titles.credit_note out of creditNoteTitleLines (Arabic goes).
 * Run: node tests/till-walkaa-1129.test.cjs
 */
// CARD      09-counter/bill-slip
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const lib = path.join(__dirname, '..', 'lib');
const T = require(path.join(lib, 'tax')), R = require(path.join(lib, 'regulation'));
const till = (fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till-slip.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till-dayrep.js'), 'utf8')) /* the part files the till loads beside till.html (1128-1129 split) */.replace(/\r\n/g, '\n');
function sourceOf(name) {
  const start = till.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('till has no function ' + name);
  let depth = 0, i = till.indexOf('{', start);
  for (; i < till.length; i++) { if (till[i] === '{') depth++; else if (till[i] === '}' && --depth === 0) break; }
  return till.slice(start + 1, i + 1);
}
const NAMES = ['packKinds', 'kindWord', 'kindWordsOf', 'classesOf', 'noReasonZeroWord', 'noRateWord', 'unratedBaseOf', 'unratedApart', 'kindLabelOf', 'borderKindsPack', 'packSplitsByState', 'kindRowsOf',
  'creditNoteTitle', 'creditNoteTitleLines', 'slipTitleHTML', 'schemeWord'];
function tillWith(country, packOver) {
  const base = R.packFor(country), pack = packOver ? packOver(base) : base;
  const context = { window: { CBTax: T }, CBTax: T, shopPack: () => pack, countryWords: () => ({}), esc: (x) => String(x), money: (x) => 'M' + Math.round(Number(x) * 100),
    rmoney: (x) => Math.round(x * 100) / 100, cbQuiet() {} };
  vm.createContext(context);
  vm.runInContext(NAMES.map(sourceOf).join('\n'), context);
  return context;
}
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { console.log('FAIL ' + name + '\n   got  ' + JSON.stringify(got) + '\n   want ' + JSON.stringify(want)); process.exitCode = 1; } else console.log('   ok   ' + name);
};
const strip = (html) => html.replace(/<[^>]+>/g, '|').split('|').filter(Boolean).map((x) => x.trim());
const row = (a, b) => a + ' = ' + b + ';';
const rows = (html) => strip(html).filter((x) => /=/.test(x)).map((x) => x.replace(/;$/, '')).sort();

console.log('\n== AA-F-02: the walk AA bill - 5% 51.74 · zero-rated 130.00 · no rate 50.00 ==\n');
const ae = tillWith('AE');
const inv = T.determine({ seller: { Country: 'AE', LglNm: 'Al Noor Trading LLC' }, buyer: { Country: 'AE' }, priceIncludesTax: true,
  lines: [{ name: 'Std', qty: 1, price: 54.33, rate: 5 }, { name: 'Gold', qty: 1, price: 130, gst_rate: 0, tax_kind: 'zero_rated' }, { name: 'Notes', qty: 1, price: 50 }] });
eq('three rows: zero-rated 13000, no VAT rate set 5000, standard-rated 5% 5174', rows(ae.kindRowsOf(inv, row)), ['No VAT rate set = M5000', 'Standard-rated 5% = M5174', 'Zero-rated = M13000']);
eq('no row is called Taxable, none says "reason not stated" for the unrated line', /Taxable|reason not stated/.test(ae.kindRowsOf(inv, row)), false);
const reasonless = T.determine({ seller: { Country: 'AE', LglNm: 'X' }, buyer: { Country: 'AE' }, priceIncludesTax: true, lines: [{ name: 'Std', qty: 1, price: 105, rate: 5 }, { name: 'Notes', qty: 1, price: 20, gst_rate: 0 }] });
eq('an explicit 0% with no reason still reads "VAT 0% · reason not stated" (not the unrated row)', rows(ae.kindRowsOf(reasonless, row)), ['Standard-rated 5% = M10000', 'VAT 0% · reason not stated = M2000']);

console.log('\n== reason-not-stated word: the pack\'s scheme word, per country ==\n');
eq('IN GST · AU GST · AE VAT', ['IN', 'AU', 'AE'].map((c) => tillWith(c).noReasonZeroWord()), ['GST 0% · reason not stated', 'GST 0% · reason not stated', 'VAT 0% · reason not stated']);

console.log('\n== AA-F-05: the credit note title, both languages from the pack ==\n');
const withTitle = tillWith('AE', (base) => Object.assign({}, base, { slip: Object.assign({}, base.slip, { titles: Object.assign({}, base.slip.titles, { credit_note: { ar: '\u0625\u0634\u0639\u0627\u0631 \u062F\u0627\u0626\u0646 \u0636\u0631\u064A\u0628\u064A', en: 'Tax Credit Note' } }) }) }));
eq('Arabic first, then English, as on the tax invoice', withTitle.creditNoteTitleLines().map((l) => l.lang), ['ar', 'en']);
eq('the English line is the pack words, upper case', withTitle.creditNoteTitleLines()[1].text, 'TAX CREDIT NOTE');
eq('the Arabic line is set right to left', /dir="rtl"/.test(withTitle.slipTitleHTML(withTitle.creditNoteTitleLines())), true);
eq('a pack with no credit_note title keeps the one English line', tillWith('AE').creditNoteTitleLines().map((l) => l.lang + ':' + l.text), ['en:TAX CREDIT NOTE']);
eq('the return slip prints the lines, not a typed title', /slipTitleHTML\(creditNoteTitleLines\(\)\)/.test(till), true);
console.log('');
