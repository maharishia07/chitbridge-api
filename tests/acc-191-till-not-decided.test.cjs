/**
 * acc-191-till-not-decided.test.cjs — ACC-191 (till twin): an UNDECIDED tax (moneyOf gives null) is said "not decided" on the till, never 0.00, NaN or -0.
 * The four sites: the slip money(m.tax) row, the credit note -m.tax, and the stored bill (billOf / slipOfRow) that keeps the engine's null.
 * The page functions are cut out of tools/tally-connector/till.html and run here against stand-ins for the few page globals they read.
 * Expectations are hand-computed: a bill of 45,000 (5 x 9,000 at 18%) whose place of supply is not decided has total 45,000 and tax null.
 * Run: node tests/acc-191-till-not-decided.test.cjs
 * CARD      09-counter/bill-slip
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8');
/** a top-level function's text, from "function name(" to its closing brace on a line of its own (or its own line when it is one line) */
function grab(name) {
  const i = SRC.indexOf('\nfunction ' + name + '(');
  assert.ok(i >= 0, name + ' is not on the page');
  const one = SRC.indexOf('\n', i + 1);
  const first = SRC.slice(i + 1, one);
  if (/\}\s*$/.test(first) && !/\{\s*$/.test(first)) return first;
  return SRC.slice(i + 1, SRC.indexOf('\n}\n', i + 1) + 2);
}
const NOT_DECIDED_LINE = SRC.split('\n').find((line) => line.startsWith('var NOT_DECIDED ='));
assert.ok(NOT_DECIDED_LINE, 'the page has one word for an undecided tax');
const BODY = [NOT_DECIDED_LINE, grab('taxFigure'), grab('domesticFootHTML'), grab('perRateFootHTML'), grab('retMoney')].join('\n')
  + '\nreturn { taxFigure, domesticFootHTML, perRateFootHTML, retMoney, setReturn: function(bill, qty){ RET_FOR = bill; RET_QTY = qty; } };';
const make = new Function('money', 'r2', 'schemeWord', 'invoiceRule', 'taxHeadWord', 'reducedNoteHTML', 'esc', 'retBack', 'retLeft',
  'var RET_FOR = null; var RET_QTY = {};\n' + BODY);
const page = make((n) => '₹' + Number(n).toFixed(2), (n) => Math.round(n * 100) / 100, () => 'GST', () => null, () => 'GST', () => '', (v) => String(v),
  () => ({ net: 0, taxable: 0, tax: 0, save: 0, gross: 0 }), () => 1000);
const row = (label, value) => label + '=' + value + ';';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++; } catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message.split('\n').slice(0, 3).join('\n      ')); fail++; }
};

console.log('\nacc-191 · the till says "not decided", never 0.00');
t('taxFigure: null is "not decided", a real 0 is 0.00, a figure is a figure', () => {
  assert.strictEqual(page.taxFigure(null), 'not decided');
  assert.strictEqual(page.taxFigure(undefined), 'not decided');
  assert.strictEqual(page.taxFigure(0), '₹0.00');
  assert.strictEqual(page.taxFigure(180), '₹180.00');
});
t('the slip foot (stored bill, no heads): tax null prints "not decided", not 0.00 or NaN', () => {
  const html = page.domesticFootHTML({ taxable: 45000, tax: null, total: 45000, heads: [] }, row);
  assert.ok(html.includes('GST=not decided;'), html);
  assert.ok(!/0\.00|NaN/.test(html.replace('Taxable=₹45000.00;', '')), html);
});
t('the slip foot with heads: the total row says "not decided" for a null tax', () => {
  const html = page.domesticFootHTML({ taxable: 45000, tax: null, total: 45000, heads: [{ rate: 18, amount: 0 }] }, row);
  assert.ok(html.includes('GST total=not decided;'), html);
});
t('the slip foot, decided: unchanged (tax 180 prints 180.00)', () => {
  assert.ok(page.domesticFootHTML({ taxable: 1000, tax: 180, total: 1180, heads: [] }, row).includes('GST=₹180.00;'));
});
t('the credit note of an undecided bill: line tax, note tax and by_rate tax are null, never -0', () => {
  const original = { no: 'C1/26-27/0001', lines: [{ qty: 5, net: 45000, taxable: 45000, tax: null, save: 0, gross: 45000, gst_rate: 18 }] };
  page.setReturn(original, { 0: 5 });
  const m = page.retMoney();
  assert.strictEqual(m.tax, null);
  assert.strictEqual(m.lines[0].tax, null);
  assert.strictEqual(m.byRate[18].tax, null);
  assert.strictEqual(m.total, 45000);
  assert.ok(!Object.is(m.lines[0].tax, -0));
});
t('the credit note of a decided bill is unchanged: a line with tax 180 returns -180', () => {
  const original = { no: 'C1/26-27/0002', lines: [{ qty: 1, net: 1180, taxable: 1000, tax: 180, save: 0, gross: 1180, gst_rate: 18 }] };
  page.setReturn(original, { 0: 1 });
  const m = page.retMoney();
  assert.strictEqual(m.tax, 180);
  assert.strictEqual(m.lines[0].tax, -180);
});
t('the page sources: the slip row, the credit note body and the stored bill never turn null into 0', () => {
  assert.ok(!SRC.includes("<span>' + money(m.tax) + '</span></div>'\n              + '<div class=\"t warnrow\">"), 'the unsplit-bill slip row must not print money(m.tax)');
  assert.ok(SRC.includes('tax: negatedTax(m.tax)'), 'the credit note keeps null, never -m.tax');
  assert.ok(!SRC.includes('tax: -m.tax,'), 'no bare -m.tax is left');
  assert.ok(SRC.includes("tax: m.tax /* ACC-191: null = not decided (supply unknown), stored as the engine said it, never 0 */"), 'the stored bill keeps the engine null');
  assert.ok(SRC.includes('tax: m.tax /* ACC-191: null stays null = not decided */'), 'the reprint keeps the engine null');
  assert.ok(/var TILL_BUILD = '\d{4}-\d{2}-\d{2}\.[a-z0-9]+';/.test(SRC), 'TILL_BUILD is bumped');
});

console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
