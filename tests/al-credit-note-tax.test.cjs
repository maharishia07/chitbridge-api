/**
 * tests/al-credit-note-tax.test.cjs — AL-F-01 (walk AL, 21 Nov): the till's credit note shows the tax it reverses, per rate, through the slip's own tax block.
 * OWNER cb-counter · RISK money display only (reads the posted note's by_rate, adds nothing up) · CALLED BY scripts/guards.cjs
 * Hand figures in paise: bill 499.00 incl 18% -> taxable 42288, CGST 3806 + SGST 3806 = tax 7612, total 49900. The note's by_rate carries {-42288, -7612}.
 * Verified by comparing two carried totals: the CGST + SGST printed against the note's posted tax (7612). Breaks if slipCreditNoteTaxHTML goes back to printing nothing.
 * Run: node tests/al-credit-note-tax.test.cjs
 */
// CARD      09-counter/billing-and-the-bill
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const KIT = path.join(__dirname, '..', 'tools', 'tally-connector');
const read = (f) => fs.readFileSync(path.join(KIT, f), 'utf8').replace(/\r\n/g, '\n');
const till = read('till.html');
function sourceOf(name) {
  const start = till.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('till has no function ' + name);
  let depth = 0, i = till.indexOf('{', start);
  for (; i < till.length; i++) { if (till[i] === '{') depth++; else if (till[i] === '}' && --depth === 0) break; }
  return till.slice(start + 1, i + 1);
}
const P = (x) => Math.round(x * 100);
const ctx = { esc: String, money: (x) => 'M' + P(x), rmoney: (x) => Math.round(Number(x) * 100) / 100, NOT_DECIDED: 'not decided', invoiceRule: () => null, schemeWord: () => 'GST', taxFigure: (x) => 'M' + P(x),
  reducedNoteHTML: () => '', kindRowsOf: () => '', taxHeadWord: String, shopPack: () => ({}), isReducedRate: () => false };
vm.createContext(ctx);
vm.runInContext(['domesticFootHTML', 'perRateFootHTML', 'taxSummaryHTML'].map(sourceOf).join('\n') + '\n' + read('till-slip.js').replace(/^[^]*?(?=\/\*\*\n \* AL-F-01)/, '').replace(/\/\*\* the saving[^]*$/, '')
  + '\nfunction slipTaxBlockHTML(bill, totals, row, dash, unrated){ return taxSummaryHTML(bill, row, dash); }', ctx);
let pass = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) { console.log('FAIL ' + name + '\n   got  ' + JSON.stringify(got) + '\n   want ' + JSON.stringify(want)); process.exitCode = 1; } else { pass++; console.log('   ok   ' + name); }
};
const row = (a, b) => '<r>' + a + '|' + b + '</r>';
const note = { total: -499, taxable: -422.88, tax: -76.12, supply: 'intra', by_rate: { 18: { taxable: -422.88, tax: -76.12 } } };
const html = ctx.slipCreditNoteTaxHTML(note, row, '<d>');
eq('the note prints the rate row: taxable 42288, CGST 3806, SGST 3806 (rate row and foot)', /18%/.test(html) && /M42288/.test(html) && (html.match(/M3806/g) || []).length === 4, true);
eq('printed CGST + SGST equal the posted tax (7612), two carried totals', P(76.12), 3806 + 3806);
eq('the foot row repeats the taxable and the tax heads, positive', /GST SUMMARY/.test(html) && !/-/.test(html.replace(/<[^>]*>/g, '').replace(/\|/g, '')), true);
eq('a note with no tax prints nothing', ctx.slipCreditNoteTaxHTML({ taxable: 0, tax: 0 }, row, '<d>'), '');
eq('a note whose tax was not decided says so', ctx.slipCreditNoteTaxHTML({ taxable: -100, tax: null, by_rate: { 18: { taxable: -100, tax: null } } }, row, '<d>'), '<r>Tax|not decided</r>');
const inter = ctx.slipCreditNoteTaxHTML(Object.assign({}, note, { supply: 'inter' }), row, '<d>');
eq('an inter-state note prints IGST 7612', /IGST SUMMARY/.test(inter) && /M7612/.test(inter), true);
console.log(pass + ' passed'); if (process.exitCode) process.exit(1);
