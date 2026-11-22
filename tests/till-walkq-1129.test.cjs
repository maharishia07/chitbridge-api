/**
 * tests/till-walkq-1129.test.cjs — WALK Q (IN, 21 Nov): Q-F-02 credit note carries the original bill's taxable/tax · Q-F-03 a return into a closed day asks to reopen ·
 * Q-F-05 a view-only seat is greyed with its reason · Q-F-07 the day close's per-rate rows read the invoice (the books' figures).
 *
 * OWNS      the proof of the till master's retLineOf · retMoney · retTaxRowsHTML · tillViewOnly · dayRepRows, lifted by name and run over hand figures.
 * CALLED BY scripts/guards.cjs · CI. No browser. Hand figures in PAISE:
 *   Bill 499.00 incl 18% (the walk's): taxable 42288, CGST 3806 + SGST 3806 -> tax 7612, total 49900. The server's bill line has net only (no taxable, no tax).
 *   A whole return -> credit note taxable -42288, tax -7612, by_rate 18 = {-42288, -7612}.  Half of a 2-unit line -> 21144 / 3806.
 *   Day close: 5% bill whose header says by_rate {50792, 2540} but whose invoice says {50794, 2538} -> the row shows 50794 / 2538 (the books').
 *   Viewer token -> view-only; editor token -> not.
 * Break check: take the retLineOf call out of retMoney (taxable 0), or the issuedRates arm out of dayRepRows (50792).
 * Run: node tests/till-walkq-1129.test.cjs
 */
// CARD      09-counter/billing-and-the-bill
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const till = (fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till-slip.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till-dayrep.js'), 'utf8')) /* the part files the till loads beside till.html (1128-1129 split) */.replace(/\r\n/g, '\n');
function sourceOf(name) {
  let start = till.indexOf('\nfunction ' + name + '(');
  if (start < 0) start = till.indexOf('\nasync function ' + name + '(');
  if (start < 0) throw new Error('till has no function ' + name);
  let depth = 0, i = till.indexOf('{', start);
  for (; i < till.length; i++) { if (till[i] === '{') depth++; else if (till[i] === '}' && --depth === 0) break; }
  return till.slice(start + 1, i + 1);
}
const P = (x) => Math.round(x * 100);                         /* rupees -> paise, for the checks */
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
const token = (level) => 'h.' + b64({ access_level: level }) + '.s';
function page(extra) {
  const ctx = Object.assign({ rmoney: (x) => Math.round(Number(x) * 100) / 100, r2: (x) => Math.round(x * 100) / 100, esc: String, money: (x) => 'M' + P(x), cbQuiet() {},
    retBack: () => ({ net: 0, taxable: 0, tax: 0, save: 0, gross: 0 }), retLeft: (b, n) => b.lines[n].qty - (b.taken || 0), retKindOf: () => undefined,
    isReturnRow: (b) => b.kind === 'credit_note', Buffer, atob: (s) => Buffer.from(s, 'base64').toString(), CloudHost: { person: null },
    window: { CBTax: { moneyOf: (inv) => inv && inv._money } }, CBTax: { moneyOf: (inv) => inv && inv._money }, RET_FOR: null, RET_QTY: null }, extra || {});
  vm.createContext(ctx);
  vm.runInContext(['retLineOf', 'retRateOf', 'retMoney', 'appSessionClaims', 'tillViewOnly', 'dayRateFigures', 'dayRepRows'].map(sourceOf).join('\n'), ctx);
  return ctx;
}
let pass = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) { console.log('FAIL ' + name + '\n   got  ' + JSON.stringify(got) + '\n   want ' + JSON.stringify(want)); process.exitCode = 1; } else { pass++; console.log('   ok   ' + name); }
};
const serverBill = (qty) => ({ no: 'C1/1', lines: [{ name: 'Steel bottle', qty, net: 499, gst_rate: 18 }],
  invoice: { ItemList: [{ GstRt: 18, AssAmt: 422.88, CgstAmt: 38.06, SgstAmt: 38.06 }] } });

/* Q-F-02 */
let p = page(); p.RET_FOR = serverBill(1); p.RET_QTY = [1];
let m = p.retMoney();
eq('Q-F-02 whole return: total 49900, taxable 42288, tax 7612', [P(m.total), P(m.taxable), P(m.tax)], [49900, 42288, 7612]);
eq('Q-F-02 by_rate 18 = 42288 / 7612', [P(m.byRate[18].taxable), P(m.byRate[18].tax)], [42288, 7612]);
eq('Q-F-02 the credit line carries its taxable and tax (negative)', [P(m.lines[0].taxable), P(m.lines[0].tax)], [-42288, -7612]);
p = page(); p.RET_FOR = serverBill(2); p.RET_QTY = [1]; m = p.retMoney();
eq('Q-F-02 one of two: taxable is half of the line', [P(m.taxable), P(m.tax)], [21144, 3806]);
p = page(); const own = { name: 'X', qty: 1, net: 118, taxable: 100, tax: 18, gst_rate: 18 };
eq('Q-F-02 a line that carries its own figures is read as it is', p.retLineOf({ invoice: { ItemList: [{ AssAmt: 1 }] } }, 0, own), own);
/* the slip's tax rows moved to till-slip.js slipCreditNoteTaxHTML (AL-F-01): tests/al-credit-note-tax.test.cjs */

/* Q-F-03 / Q-F-05 are wired in the page: the order matters, so it is read from the source */
const ri = sourceOf('retIssue'), fi = sourceOf('finish');
eq('Q-F-03 retIssue asks dayReopenAsk before the confirmation', ri.indexOf('dayReopenAsk(') > 0 && ri.indexOf('dayReopenAsk(') < ri.indexOf('retConfirm('), true);
eq('Q-F-05 finish refuses a view-only seat before any number is taken', fi.indexOf('tillViewOnly()') > 0 && fi.indexOf('tillViewOnly()') < fi.indexOf('tillStopped()'), true);
eq('Q-F-05 paintSaving greys Save for a view-only seat', /button\.disabled = busy \|\| !CART\.length \|\| tillViewOnly\(\)/.test(till), true);
p = page(); p.CloudHost = { person: { token: token('viewer') } };
eq('Q-F-05 viewer token is view-only', p.tillViewOnly(), true);
p = page(); p.CloudHost = { person: { token: token('editor') } };
eq('Q-F-05 editor token is not', p.tillViewOnly(), false);
eq('Q-F-05 a key (no person) is not', page().tillViewOnly(), false);

/* Q-F-07 */
const day = (inv, hdr) => ({ by_rate: hdr, payments: [], lines: [], invoice: inv });
p = page();
let agg = p.dayRepRows([day({ _money: { by_rate: { 5: { taxable: 507.94, tax: 25.38 } } } }, { 5: { taxable: 507.92, tax: 25.4 } })]);
eq('Q-F-07 the 5% row reads the invoice (the books): 50794 / 2538', [P(agg.byRate[5].taxable), P(agg.byRate[5].tax)], [50794, 2538]);
agg = p.dayRepRows([{ by_rate: { 18: { taxable: -422.88, tax: -76.12 } }, payments: [], lines: [] }]);
eq('Q-F-07 a credit note (no invoice) keeps its own by_rate', [P(agg.byRate[18].taxable), P(agg.byRate[18].tax)], [-42288, -7612]);
console.log(pass + ' passed' + (process.exitCode ? ' — FAILURES above' : ''));
