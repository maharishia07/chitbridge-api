/**
 * acc-215-half-step.test.cjs — ACC-215 (Athi 2026-11-07, HALF step): an AU cash gap posts as round-off only up to ceil(step/2)-1
 * (2c on a 5c step: the most nearest-5c rounding can make). A 3c+ gap is a real short/over and WAITS with the gap named, never absorbed.
 * The limit is derived from the pack's cashRounding.step_minor (AU and MY read the field; IN and AE have none = exact).
 * A$10.03 invoice. Run: node tests/acc-215-half-step.test.cjs   (CB_ENGINES_DIR = a current engines checkout)
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const eq = (name, got, want) => { const good = JSON.stringify(got) === JSON.stringify(want); good ? pass++ : fail++; console.log((good ? '   ok   ' : '   FAIL ') + name + (good ? '' : '\n          got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want))); };
const S_AU = { enabled: true, walkin_grain: 'day', country: 'AU', functional_currency: 'AUD' };
const inv = { currency: 'AUD', _cb: { scheme: 'GST' }, ItemList: [{ GstRt: 10, AssAmt: 9.12, CgstAmt: 0, SgstAmt: 0, IgstAmt: 0, TaxAmt: 0.91, CesAmt: 0 }], ValDtls: { TotInvVal: 10.03 } };
const X = H.load();
if (!X.src.dir) { console.log('SKIP: ' + X.src.why); process.exit(0); }
const K = require(path.join(H.API, 'lib', 'books-hooks'));
const au = (cash) => K.classify({ chit: { chit_id: 'c1', purpose: 'order', currency_code: 'AUD', business_json: { bill_no: 'C1-1', till: { id: 'C1' }, billed_at: '2026-10-17T05:00:00Z', payment: { parts: [{ how: 'Cash', amount: cash }] } } }, entry: { sells: true, invoice: inv }, setting: S_AU });
const cents = (gap) => Math.round((10.03 * 100 + gap)) / 100; /* cash paid = 10.03 + gap */
console.log('\n══ ACC-215 · AU cash round-off only up to the half step ══\n');
for (const g of [0, 1, 2]) {
  for (const sign of g ? [1, -1] : [1]) {
    const r = au(cents(sign * g));
    eq('AU · gap ' + (sign * g) + 'c → posts, round-off ' + (sign * g / 100), [r.kind, r.bill && r.bill.round_off], ['walkin', sign * g / 100]);
  }
}
for (const g of [3, 5, 6]) {
  for (const sign of [1, -1]) {
    const r = au(cents(sign * g));
    eq('AU · gap ' + (sign * g) + 'c → WAITS as ' + (sign > 0 ? 'over' : 'short'), [r.kind, r.gap_minor, new RegExp((sign > 0 ? 'over' : 'short') + ' by AUD 0\.0' + g).test(r.why || '')], ['queue', sign * g, true]);
  }
}
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
