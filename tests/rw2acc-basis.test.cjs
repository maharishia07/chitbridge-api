/**
 * rw2acc-basis.test.cjs — RW2-04 (re-walk 2, 25 Nov 2026): the BAS says which basis each amount box is read on and why two quarters differ; no figure changes.
 * Hand check: FY27 Q1 (period 2026-Q1, Jul-Sep 2026) reads purchases GST-exclusive, FY27 Q2 (2026-Q2) GST-inclusive; the change date is the pack's row (1 Oct 2026).
 * Run: node tests/rw2acc-basis.test.cjs
 * CARD      14-accounting/README
 */
'use strict';
const assert = require('assert');
const E = require('../lib/books-engines');
const returns = require('../lib/gst-returns');
const basis = require('../lib/books-return-basis');
const au = E.packs().packFor('AU'),
  ae = E.packs().packFor('AE');
const ledger = [
  { code: '4000', role: 'sales', cr_minor: 1000000, dr_minor: 0 },
  { code: '2200', role: 'gst_collected', cr_minor: 100000, dr_minor: 0 },
  { code: '5000', role: 'purchases', dr_minor: 400000, cr_minor: 0 },
  { code: '1400', role: 'gst_paid', dr_minor: 40000, cr_minor: 0 }
];
const read = (period) => {
  const filed = returns.returnFor(au, period, ledger, { simpler: false });
  assert.ok(filed.ok, 'the BAS reads');
  return { filed, marked: basis.markBasis(au, period, filed.boxes) };
};
const box = (m, code) => m.marked.boxes.find((b) => b.code === code);
const q1 = read('2026-Q1'),
  q2 = read('2026-Q2');
assert.ok(/exclusive/.test(box(q1, 'G11').note) && /inclusive/.test(box(q2, 'G11').note), 'each period carries its own basis on G10 and G11');
assert.ok(/inclusive/.test(box(q1, 'G1').note) && /inclusive/.test(box(q2, 'G1').note), 'the total-sales box says it includes the tax, in both periods');
assert.strictEqual(q1.marked.notes.length, 1, 'one line says why');
assert.ok(/1 Oct 2026/.test(q1.marked.notes[0]) && /exclusive/.test(q1.marked.notes[0]) && /inclusive/.test(q1.marked.notes[0]) && /Step 3/.test(q1.marked.notes[0]), 'the line names the date and the pack row reason');
assert.ok(!/Athi|DECISIONS/.test(q1.marked.notes[0]), 'no internal names in the shopkeeper line');
assert.deepStrictEqual(q1.marked.boxes.map((b) => b.amount_minor), q1.filed.boxes.map((b) => b.amount_minor), 'figures untouched (carried totals equal)');
assert.deepStrictEqual(q2.marked.boxes.map((b) => b.amount_minor), q2.filed.boxes.map((b) => b.amount_minor));
const vat = returns.returnFor(ae, '2026-Q1', [], {});
if (vat.ok) assert.deepStrictEqual(basis.markBasis(ae, '2026-Q1', vat.boxes), { boxes: vat.boxes, notes: [] }, 'a pack with one basis says nothing');
console.log('rw2acc-basis: ok');
