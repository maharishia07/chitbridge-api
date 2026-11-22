/**
 * tests/till-day-returns-1129.test.cjs — WALK U (U-F-02): after a return the day close must equal the books.
 *
 * OWNS      the proof of the till master's dayRateFigures · dayRepRows · dayAddIssued · dayRepSummary (lifted by name) and the api reader creditNoteMoney's by_rate.
 * CALLED BY scripts/guards.cjs · CI. No browser. Hand figures in CENTS:
 *   AU walk U : 10% base 5000 / tax 500 (the sale) less one coffee back, base 1000 / tax 100  ->  rate row 10% = 4000 / 400; GST-free base 1000 stays out of the rate rows.
 *   IN two rates : 5% bill 10000 / 500 and 18% bill 20000 / 3600; a return hits 18% only, base 10000 / tax 1800
 *                  ->  5% row 10000 / 500 (untouched), 18% row 10000 / 1800, total taxable 20000, tax 2300.
 *   A note the server read (no sign, or the ORIGINAL bill's positive invoice) is still taken back: the row is the books', never the sale's.
 * Break check: take dayRateFigures out of dayRepRows (the positive note adds, 18% row 30000 / 5400) or out of dayAddIssued.
 * Run: node tests/till-day-returns-1129.test.cjs
 */
// CARD      09-counter/billing-and-the-bill
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const till = (fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till-slip.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till-dayrep.js'), 'utf8')) /* the part files the till loads beside till.html (1128-1129 split) */.replace(/\r\n/g, '\n');
function sourceOf(name) {
  let start = till.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('till has no function ' + name);
  let depth = 0, i = till.indexOf('{', start);
  for (; i < till.length; i++) { if (till[i] === '{') depth++; else if (till[i] === '}' && --depth === 0) break; }
  return till.slice(start + 1, i + 1);
}
const C = (x) => Math.round(x * 100);
const ctx = { rmoney: (x) => Math.round(Number(x) * 100) / 100, r2: (x) => Math.round(x * 100) / 100, esc: String, money: (x) => 'M' + C(x), cbQuiet() {},
  isReturnRow: (b) => b.kind === 'credit_note', window: { CBTax: { moneyOf: (inv) => inv && inv._money } }, CBTax: { moneyOf: (inv) => inv && inv._money },
  dayRepTable: (title, cols, rows) => ({ title, rows }) };
vm.createContext(ctx);
vm.runInContext(['dayRateFigures', 'dayRepAddKinds', 'dayRepAddLines', 'dayRepAddRates', 'dayRepAddPays', 'dayRepRows', 'dayAddIssued', 'dayRepCount', 'dayRepSummary'].map(sourceOf).join('\n'), ctx);
let pass = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) { console.log('FAIL ' + name + '\n   got  ' + JSON.stringify(got) + '\n   want ' + JSON.stringify(want)); process.exitCode = 1; } else { pass++; console.log('   ok   ' + name); }
};
const row = (r) => r ? [C(r.taxable), C(r.tax)] : null;
const sale = (by) => ({ kind: 'tax', by_rate: by, payments: [], lines: [], taxable: 0, tax: 0 });

/* AU walk U */
let rows = [sale({ 10: { taxable: 50, tax: 5 } }), { kind: 'credit_note', by_rate: { 10: { taxable: -10, tax: -1 } }, lines: [], payments: [] }];
let agg = ctx.dayRepRows(rows);
eq('AU walk: 10% row = sale less the return: 4000 / 400', row(agg.byRate[10]), [4000, 400]);
/* the server's read once dropped the sign: the note must still come off */
rows[1].by_rate = { 10: { taxable: 10, tax: 1 } };
agg = ctx.dayRepRows(rows);
eq('AU walk: a note read without its sign still comes off: 4000 / 400', row(agg.byRate[10]), [4000, 400]);
/* the note's own invoice (positive, the original's) must not out-vote its by_rate */
rows[1].invoice = { _money: { by_rate: { 10: { taxable: 50, tax: 5 } } } };
agg = ctx.dayRepRows(rows);
eq('AU walk: a note carrying the original invoice still comes off the return figures: 4000 / 400', row(agg.byRate[10]), [4000, 400]);

/* IN two rates, the return hits 18% only */
const inRows = [sale({ 5: { taxable: 100, tax: 5 } }), sale({ 18: { taxable: 200, tax: 36 } }), { kind: 'credit_note', by_rate: { 18: { taxable: -100, tax: -18 } }, lines: [], payments: [] }];
agg = ctx.dayRepRows(inRows);
eq('IN 5%: untouched 10000 / 500', row(agg.byRate[5]), [10000, 500]);
eq('IN 18%: 20000 / 3600 less 10000 / 1800 = 10000 / 1800', row(agg.byRate[18]), [10000, 1800]);
eq('IN rows sum to taxable 20000 and tax 2300', [Object.keys(agg.byRate).reduce((a, k) => a + C(agg.byRate[k].taxable), 0), Object.keys(agg.byRate).reduce((a, k) => a + C(agg.byRate[k].tax), 0)], [20000, 2300]);

/* the F10 day close sheet: dayAddIssued */
const sheet = { rate: {} };
inRows.forEach((b) => ctx.dayAddIssued(sheet, b));
eq('IN day close sheet 5%: 10000 / 500', [C(sheet.rate[5].base), C(sheet.rate[5].tax)], [10000, 500]);
eq('IN day close sheet 18%: 10000 / 1800', [C(sheet.rate[18].base), C(sheet.rate[18].tax)], [10000, 1800]);

/* the returns line */
const lines = ctx.dayRepSummary({ bills: [sale({}), { kind: 'credit_note', taxable: -10, tax: -1, by_rate: {} }], count: 1, qty: 1, total: 54, saved: 0, taxable: 50, tax: 4 }).rows;
eq('the summary names the returns line', lines.filter((r) => /^Returns \(1 credit note\)/.test(r[0])).map((r) => r[1]), ['\u2212M1000 \u00b7 \u2212M100']);
eq('a day with no return has no returns line', ctx.dayRepSummary({ bills: [sale({})], count: 1, qty: 1, total: 1, saved: 0, taxable: 1, tax: 0 }).rows.some((r) => /^Returns/.test(r[0])), false);

/* the api reader: the note's stored by_rate comes back as signs */
const rd = { f: require('../lib/till-credit-note-money').creditNoteMoney }; /* read1129routes: the reader moved from routes/till.js to its own module */
const got = rd.f({ slip: 'credit_note', taxable: 10, tax: 1, refund: { total: 11, parts: [] }, by_rate: { 10: { taxable: 10, tax: 1 }, 0: { taxable: 5, tax: 0 } } });
eq('api creditNoteMoney returns by_rate as signs (0 stays 0)', got.by_rate, { 0: { taxable: -5, tax: 0 }, 10: { taxable: -10, tax: -1 } });
eq('api creditNoteMoney with no stored by_rate answers null', rd.f({ slip: 'credit_note', refund: { total: 1 } }).by_rate, null);
eq('api a sale row is untouched ({})', rd.f({ slip: 'cash' }), {});
console.log(pass + ' passed' + (process.exitCode ? ' — FAILURES above' : ''));
