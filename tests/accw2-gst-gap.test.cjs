/**
 * accw2-gst-gap.test.cjs — FW-32 (walk 25 Nov 2026, Moonee Espresso): taxable sales that carry no GST are said on the return, and the figures are not changed.
 * Hand figures (the walk's own, A$): Sales 4000 = 38,950.00 -> GST at 10% = 3,895.00; GST collected 2200 = 3,860.00; gap = 35.00 (10% of a 350.00 sale posted with no GST).
 * Run: node tests/accw2-gst-gap.test.cjs
 * CARD      14-accounting/README
 */
'use strict';
const assert = require('assert');
const E = require('../lib/books-engines');
const gap = require('../lib/books-return-gst-gap');
const au = E.packs().packFor('AU'),
  ae = E.packs().packFor('AE');
const rows = (salesCr, returnsDr, other) => [
  { code: '4000', role: 'sales', cr_minor: salesCr, dr_minor: 0 },
  { code: '4020', role: 'sales_gst_free', cr_minor: 693000, dr_minor: 0 },
  { code: '4090', role: 'sales_returns', cr_minor: 0, dr_minor: returnsDr || 0 }
].concat(other || []);
const boxes = (collected) => [
  { code: 'G1', label: 'Total sales', amount_minor: 4974000, roles: ['sales', 'gst_collected'] },
  { code: '1A', label: 'GST on sales', amount_minor: collected, roles: ['gst_collected'] },
  { code: '1B', label: 'GST on purchases', amount_minor: 384748, roles: ['gst_paid'] }
];
const mark = (r, b, need) => gap.markGap(au, r, b, 'AUD', need);
const oneA = (m) => m.boxes.find((b) => b.code === '1A');

/* the walk's case: 3,895.00 expected, 3,860.00 collected -> 35.00 short, said on 1A and in the notes, no figure moved */
let m = mark(rows(3895000), boxes(386000));
assert.ok(/AUD 35\.00 of tax missing on sales/.test(oneA(m).note), oneA(m).note);
assert.strictEqual(oneA(m).amount_minor, 386000, 'the box figure is not changed');
assert.ok(/AUD 38950\.00|AUD 38,950\.00/.test(m.notes[0]) && /3895\.00|3,895\.00/.test(m.notes[0]) && /3860\.00|3,860\.00/.test(m.notes[0]), m.notes[0]);
assert.strictEqual(m.boxes.find((b) => b.code === 'G1').note, undefined, 'only the tax box carries it');
assert.strictEqual(gap.gapOf(au, rows(3895000), boxes(386000), 'AUD').gap_minor, 3500);

/* tax matches: nothing said */
m = mark(rows(3895000), boxes(389500));
assert.strictEqual(oneA(m).note, undefined);
assert.deepStrictEqual(m.notes, []);
/* under one whole unit is per-line rounding: 3,895.00 vs 3,894.50 collected (50 cents) says nothing; 1.00 short does */
assert.strictEqual(gap.gapOf(au, rows(3895000), boxes(389450), 'AUD'), null);
assert.strictEqual(gap.gapOf(au, rows(3895000), boxes(389400), 'AUD').gap_minor, 100);
/* returns reduce the base: 38,950.00 - 1,000.00 returns = 37,950.00 -> 3,795.00 */
assert.strictEqual(gap.gapOf(au, rows(3895000, 100000), boxes(379500), 'AUD'), null);
/* tax collected ABOVE the rate (taxed income on another ledger): never a warning */
assert.strictEqual(gap.gapOf(au, rows(3895000), boxes(400000), 'AUD'), null);
/* taxed income on a non-sales ledger joins the base: 100.00 more -> 3,905.00 expected */
assert.strictEqual(gap.gapOf(au, rows(3895000, 0, [{ code: '4800', role: 'sales_taxed_other', cr_minor: 10000, dr_minor: 0 }]), boxes(389500), 'AUD').gap_minor, 1000);
/* the 0%-no-kind answer already names the 350.00: not said twice (its 350.00 x 10% = 35.00 covers the 35.00) */
assert.strictEqual(gap.gapOf(au, rows(3895000), boxes(386000), 'AUD', { total_minor: 35000 }), null);
/* ... but a gap larger than the answer covers is still said (a 20.00 answer covers 2.00 of the 35.00) */
assert.strictEqual(gap.gapOf(au, rows(3895000), boxes(386000), 'AUD', { total_minor: 2000 }).gap_minor, 3500);
/* a pack with no single head (AE names its own tax head and kinds) is not checked here: no guess */
assert.strictEqual(gap.gapOf(ae, rows(3895000), boxes(386000), 'AEDX'), null, 'AE: no single tax box, not checked');
assert.strictEqual(gap.gapOf(Object.assign({}, au, { taxHeads: ['cgst', 'sgst'] }), rows(3895000), boxes(386000), 'AUD'), null);
assert.strictEqual(gap.gapOf(Object.assign({}, au, { tax: Object.assign({}, au.tax, { standard_rate: null }) }), rows(3895000), boxes(386000), 'AUD'), null);
console.log('accw2-gst-gap: 15 passed');
