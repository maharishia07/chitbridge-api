/**
 * w4acc-bas-wages-boxes.test.cjs — W4-09 (walk 4, 25 Nov 2026): the BAS names the boxes it does not fill. W1 (gross payments subject to withholding) and W2 (amount withheld)
 * need a payroll calculation that is not built: they show as greyed boxes with a null amount and a sentence (never a blank that reads as zero). Simpler BAS says why G2/G3/G10/G11 are left out.
 * Hand check: GST collected 100,000 less GST paid 40,000 = net 60,000; GST-free sales posted 200,000 = G3 on the Full BAS.
 * Run: node tests/w4acc-bas-wages-boxes.test.cjs
 * CARD      14-accounting/gst-returns
 */
'use strict';
const assert = require('assert');
const E = require('../lib/books-engines');
const returns = require('../lib/gst-returns');
const au = E.packs().packFor('AU');
const ledger = [
  { code: '4000', role: 'sales', cr_minor: 1000000, dr_minor: 0 },
  { code: '4010', role: 'sales_gst_free', cr_minor: 200000, dr_minor: 0 },
  { code: '2200', role: 'gst_collected', cr_minor: 100000, dr_minor: 0 },
  { code: '1400', role: 'gst_paid', dr_minor: 40000, cr_minor: 0 }
];
const simple = returns.returnFor(au, '2026-Q1', ledger, {});
const full = returns.returnFor(au, '2026-Q1', ledger, { simpler: false });
const codes = (r) => r.boxes.map((b) => b.code);
assert.deepStrictEqual(codes(simple).slice(0, 3), ['G1', '1A', '1B'], 'Simpler BAS keeps its three GST boxes first, in the form order');
['W1', 'W2'].forEach((code) => {
  [simple, full].forEach((r) => {
    const b = r.boxes.find((x) => x.code === code);
    assert.ok(b, code + ' is listed');
    assert.strictEqual(b.amount_minor, null, code + ' is null, never 0');
    assert.ok(/not worked out here yet/.test(b.note) && /payroll/.test(b.note), code + ' says why');
  });
});
assert.ok(simple.notes.some((n) => /G3/.test(n) && /Full/.test(n)), 'Simpler BAS names the boxes it leaves out and where to see them');
assert.strictEqual(full.boxes.find((b) => b.code === 'G3').amount_minor, 200000, 'Full BAS G3 = the GST-free sales posted (hand: 200,000)');
assert.strictEqual(simple.net_minor, 60000, 'net 1A 100,000 - 1B 40,000 = 60,000 unchanged by the added boxes');
console.log('ok 8 checks');
