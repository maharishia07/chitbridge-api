/**
 * tests/till-supply-kind.test.cjs — THE TILL CARRIES THE SUPPLY KIND AND PRINTS ONE ROW PER KIND (AE-F-11, finishes ACC-290; AE and AU only).
 *
 * OWNS      the proof of the till master's four helpers (lineKindOf · kindWord · kindRowsOf · packKinds in tools/tally-connector/till.html), run in a vm with the ENGINES' own tax and packs
 *           (CB_ENGINES_DIR: the vendored copies carry them only after the engines tag is adopted): a line hands the engine the catalogue's \`tax_kind\` unchanged, only for a registered shop and a
 *           kind the shop pack holds (an unknown one is left off, the till never blocks; India names none so its line is byte-identical); the slip prints one row per kind with the pack word
 *           (\`short\`, never \`slip\`); one kind alone and no kind at all print as they always did; an old engine without \`short\` still prints (fallback to the name, inside try/catch).
 * CALLED BY scripts/guards.cjs · CI. No browser. Hand figures (AED, the walk bills; prices include VAT): standard lines gross 2,086.66 -> VAT 99.38, taxable 1,987.28; zero-rated 2,000.00; exempt 3,000.00.
 * Run: CB_ENGINES_DIR=../chitbridge-engines node tests/till-supply-kind.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const engines = process.env.CB_ENGINES_DIR ? path.join(path.resolve(process.env.CB_ENGINES_DIR), 'src') : path.join(__dirname, '..', 'lib'); /* 1129: the api's adopted engine copies (what the till is vendored from), no checkout needed */
if (!fs.existsSync(path.join(engines, 'tax-slab.js'))) { console.log('skip: no engines checkout (set CB_ENGINES_DIR)'); process.exit(0); }
const T = require(path.join(engines, 'tax')), S = require(path.join(engines, 'tax-slab')), R = require(path.join(engines, 'regulation'));
const till = ['till.html', 'till-slip.js', 'till-dayrep.js'].map((part) => fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', part), 'utf8')).join('\n'); /* the page and the part files it loads (1128-1129 split) */
const slip = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till-slip.js'), 'utf8'); /* 1129: the slip's builders are the page's second part file */
const dayrep = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till-dayrep.js'), 'utf8'); /* 1128: the day report's table builders are the page's part file */

/** the source of one top-level function of the till page, by brace matching from its first line */
function sourceOf(name) {
  const start = till.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('till has no function ' + name);
  let depth = 0, i = till.indexOf('{', start), begin = start + 1;
  for (; i < till.length; i++) { if (till[i] === '{') depth++; else if (till[i] === '}' && --depth === 0) break; }
  return till.slice(begin, i + 1);
}
function tillWith(country, charges) {
  const pack = R.packFor(country);
  const money = (x) => (country === 'AE' ? 'AED ' : 'A$') + Number(x).toFixed(2);
  const context = { window: { CBTax: T }, CBTax: T, shopPack: () => pack, shopTax: () => ({ charges }), schemeWord: () => (country === 'AE' ? 'VAT' : 'GST'), esc: (x) => String(x), money };
  vm.createContext(context);
  vm.runInContext(['cbQuiet', 'packKinds', 'lineKindOf', 'kindWord', 'kindWordsOf', 'classesOf', 'unratedBaseOf', 'unratedApart', 'noRateWord', 'noReasonZeroWord', 'kindLabelOf', 'borderKindsPack', 'packSplitsByState', 'kindRowsOf', 'lineZeroWordOf'].map(sourceOf).join('\n'), context);
  return context;
}

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); process.exitCode = 1; } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const row = (label, value) => label + ' = ' + value + ';';
const strip = (html) => html.replace(/<[^>]+>/g, '');

console.log('\n== the line carries the catalogue kind, unchanged ==\n');
const ae = tillWith('AE', true);
eq('AE zero_rated on a registered shop is handed to the engine as the line\'s kind', ae.lineKindOf({ tax_kind: 'zero_rated' }), 'zero_rated');
eq('no kind on the line gives undefined (the key is absent from the line)', [ae.lineKindOf({}), ae.lineKindOf({ tax_kind: null }), ae.lineKindOf(null)], [undefined, undefined, undefined]);
eq('a kind the shop pack does not hold (an AU word on a UAE shop) is left off: the till never blocks', ae.lineKindOf({ tax_kind: 'gst_free' }), undefined);
eq('a shop that charges no tax hands none', tillWith('AE', false).lineKindOf({ tax_kind: 'exempt' }), undefined);
const india = tillWith('IN', true);
eq('India (pack 1.1.0) names nil, exempt and non_gst: the line hands the kind on; a word the pack does not hold (zero_rated) is left off', [india.lineKindOf({ tax_kind: 'exempt' }), india.lineKindOf({ tax_kind: 'zero_rated' }), Object.keys(india.packKinds())], ['exempt', undefined, ['nil', 'exempt', 'non_gst']]);

console.log('\n== the walk bill: one row per kind, the pack word ==\n');
const lines = [1000, 33.33, 10, 33.33, 10, 1000].map((p, i) => ({ name: 'Std ' + i, qty: 1, price: p, rate: 5 }))
  .concat([{ name: 'Z', qty: 1, price: 2000, gst_rate: 0, tax_kind: 'zero_rated' }, { name: 'E', qty: 1, price: 3000, gst_rate: 0, tax_kind: 'exempt' }]);
const bill = T.determine({ seller: { Country: 'AE', LglNm: 'Al Noor Trading LLC' }, buyer: { Country: 'AE' }, lines, priceIncludesTax: true });
const rows = ae.kindRowsOf(bill, row);
eq('three rows: Standard-rated 5% AED 1,987.28 · Zero-rated AED 2,000.00 · Exempt AED 3,000.00 (the word is `short`)',
  strip(rows).split(';').filter(Boolean).map((x) => x.trim()).sort(), ['Exempt = AED 3000.00', 'Standard-rated 5% = AED 1987.28', 'Zero-rated = AED 2000.00']);
ok('the word "Taxable" is not on a bill that holds exempt goods', !/Taxable/.test(rows));
const oneKind = T.determine({ seller: { Country: 'AE', LglNm: 'Al Noor Trading LLC' }, buyer: { Country: 'AE' }, lines: lines.slice(0, 6), priceIncludesTax: true });
eq('a bill with no kind prints as always (the caller keeps its single Taxable row)', ae.kindRowsOf(oneKind, row), '');
const onlyZero = T.determine({ seller: { Country: 'AE', LglNm: 'Al Noor Trading LLC' }, buyer: { Country: 'AE' }, lines: [lines[6]], priceIncludesTax: true });
eq('a bill with ONE kind alone prints as always', ae.kindRowsOf(onlyZero, row), '');
const unanswered = T.determine({ seller: { Country: 'AE', LglNm: 'Al Noor Trading LLC' }, buyer: { Country: 'AE' }, priceIncludesTax: true,
  lines: [lines[0], { name: 'Z', qty: 1, price: 2000, gst_rate: 0, tax_kind: 'zero_rated' }, { name: 'U', qty: 1, price: 500, gst_rate: 0 }] });
eq('an unanswered 0% line prints "VAT 0%" and no kind word (the slip never claims a kind nobody gave)', strip(ae.kindRowsOf(unanswered, row)).split(';').filter(Boolean).map((x) => x.trim()).sort(),
  ['Standard-rated 5% = AED 952.38', 'VAT 0% · reason not stated = AED 500.00', 'Zero-rated = AED 2000.00']);

console.log('\n== a return of a kinded line carries the kind to the books ==\n');
{
  /* the walk bill's zero-rated line (AED 2,000.00, line index 6 of 8) and its exempt line (AED 3,000.00, index 7): a credit note of the zero-rated line takes AED 2,000.00 back */
  const ctx = vm.createContext({ rmoney: (x) => Math.round(x * 100) / 100 });
  vm.runInContext(['retKindOf', 'chitOfCN'].map(sourceOf).join('\n') + '\nfunction tillStamp(){ return {}; }', ctx);
  eq('the original invoice names the kind of each line: line 6 zero_rated, line 7 exempt, line 0 none', [ctx.retKindOf({ invoice: bill }, 6), ctx.retKindOf({ invoice: bill }, 7), ctx.retKindOf({ invoice: bill }, 0)], ['zero_rated', 'exempt', undefined]);
  eq('a bill with no invoice, or none named, answers undefined (an old bill returns as it always did)', [ctx.retKindOf({}, 0), ctx.retKindOf(null, 0), ctx.retKindOf({ invoice: oneKind }, 0)], [undefined, undefined, undefined]);
  const note = ctx.chitOfCN({ no: 'CN-1', total: -2000, lines: [{ name: 'Z', qty: -1, price: 2000, net: -2000, gst_rate: 0, tax_kind: 'zero_rated' }, { name: 'S', qty: -1, price: 100, net: -100, gst_rate: 5 }] });
  eq('the credit note line_items carry tax_kind only on the kinded line', [note.line_items[0].tax_kind, 'tax_kind' in note.line_items[1]], ['zero_rated', false]);
  /* the books: the invoice built from those lines names the kind (_cb.kinds), the return event posts it with its kind, and the engine debits the KIND's ledger, not sales_returns */
  const credit = T.determine({ seller: { Country: 'AE', LglNm: 'Al Noor Trading LLC' }, buyer: { Country: 'AE' }, lines: [{ name: 'Z', qty: 1, unit_price: 2000, rate: 0, tax_kind: note.line_items[0].tax_kind }] });
  eq('the credit note invoice names the kind on its line', credit._cb.kinds.map((k) => [k.line, k.kind]), [[0, 'zero_rated']]);
  const rowsOf = require('../lib/books-hooks').byRateOf(credit).rows;
  eq('the books read one row at 0%, kind zero_rated, taxable 2,000.00', rowsOf.map((r) => [r.rate, r.kind, r.taxable]), [[0, 'zero_rated', 2000]]);
  const P = require(path.join(engines, 'posting'));
  const posted = P.post({ type: 'return', date: '2026-11-20', currency: 'AED', ref: 'CN-1', by_rate: rowsOf, refund: { cash: 2000 }, source_ref: 'chit:cn1' }, { pack: R.packFor('AE') });
  eq('Dr sales_zero_rated AED 2,000.00, Cr cash AED 2,000.00 (not sales_returns: the sale credited the kind ledger, the return debits the same one)', [posted.ok, posted.lines.map((l) => [l.role || l.account, l.dr_minor, l.cr_minor])], [true, [['sales_zero_rated', 200000, 0], ['cash', 0, 200000]]]);
}

console.log('\n== AU: GST-free and input-taxed ==\n');
const au = tillWith('AU', true);
const auBill = T.determine({ seller: { Country: 'AU', LglNm: 'Mayur Deli' }, buyer: { Country: 'AU' }, priceIncludesTax: true,
  lines: [{ name: 'A', qty: 1, price: 1100, rate: 10 }, { name: 'B', qty: 1, price: 300, gst_rate: 0, tax_kind: 'gst_free' }, { name: 'C', qty: 1, price: 200, gst_rate: 0, tax_kind: 'input_taxed' }] });
eq('Taxable 10% A$1,000.00 · GST-free A$300.00 · Input-taxed A$200.00', strip(au.kindRowsOf(auBill, row)).split(';').filter(Boolean).map((x) => x.trim()).sort(), ['GST-free = A$300.00', 'Input-taxed = A$200.00', 'Taxable 10% = A$1000.00']);

console.log('\n== an old cached engine still prints (no `short`, or no pack at all) ==\n');
const old = tillWith('AE', true);
old.shopPack = () => ({ tax: { supplyKinds: { zero_rated: { id: 'zero_rated', name: 'Zero-rated supply', rate: 0 } } } });
eq('the word falls back to the kind\'s name', old.kindWord('zero_rated'), 'Zero-rated supply');
old.shopPack = () => { throw new Error('no regulation engine'); };
eq('a pack read that throws is a quiet fallback, never a stopped sale', [old.kindWord('exempt'), old.packKinds(), old.lineKindOf({ tax_kind: 'exempt' }), /exempt = AED 3000/.test(old.kindRowsOf(bill, row))], ['exempt', null, undefined, true]);

console.log('\n== the page itself ==\n');
ok('the determine line passes tax_kind from lineKindOf, plus the slab nil_kind reason (1129 ZERO-REASON) and nothing else', till.indexOf("tax_kind: lineKindOf(c), nil_kind: (taxed && /^(nil|exempt|non_gst)$/.test(c.nil_kind)) ? c.nil_kind : undefined }; }),") > 0);
ok('the totals panel and the slip foot try the kind rows before the single Taxable row', /kindRowsOf\(billTotals\.invoice,/.test(till) && /kindRowsOf\(bill\.invoice, row\) \|\| row\('Taxable'/.test(till));
ok('the day report names the total "Sales before tax" and adds the by-kind table', /\['Sales before tax', money\(figures\.taxable\)\]/.test(dayrep) && /dayRepTable\('Sales by kind'/.test(dayrep) && !/'Taxable value'/.test(till + dayrep));
ok('no new top-level require in the till master', !/\brequire\(/.test(sourceOf('kindRowsOf') + sourceOf('packKinds') + sourceOf('lineKindOf')));

console.log(String.fromCharCode(10) + (fail ? fail + ' FAILED, ' : '') + pass + ' checks');
