#!/usr/bin/env node
// @type: unit
/**
 * tests/acct-c-f06-supplier-abn.test.cjs — Walk C C-F-06 (21 Nov): a debit note with GST in Australia asks for the supplier's ABN in the pack's word, and says which box takes it.
 * Contract: the refusal reads "ABN" (never "GST number"), carries needs = supplier_gstin, and the Note-a-difference catalogue has that field, labelled with the pack's word.
 * OWNS      the offline guard of lib/books-manual-bill-tax.js taxNumbersOf and the debit_note catalogue field.   CALLED BY scripts/guards.cjs.   CARD 14-accounting
 */
'use strict';
process.env.NODE_ENV = 'test';
const assert = require('assert');
const path = require('path');
const lib = (name) => require(path.join(__dirname, '..', 'lib', name));
let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ok   ' + name); };
const note = { lines: [{ name: 'Rate difference', qty: 2, unit_price: 55, gst_rate: 10 }] };
const args = { taxed: true, what: 'the difference', taxWhy: 'reverse', purpose: 'debit_note' };
ok('AU: no supplier number -> the ABN is asked for, in the pack\'s word, and needs = supplier_gstin', () => {
  let caught;
  try { lib('books-manual-bill-tax').taxedInvoice({ s: { country: 'AU' } }, note, 'AUD', args); } catch (e) { caught = e; }
  assert.ok(caught, 'refused');
  assert.ok(/supplier's ABN is needed to reverse GST/.test(caught.message), caught.message);
  assert.ok(!/GST number/.test(caught.message));
  assert.strictEqual(caught.needs, 'supplier_gstin');
});
ok('IN: the same question says GSTIN', () => {
  let caught;
  try { lib('books-manual-bill-tax').taxedInvoice({ s: { country: 'IN' } }, note, 'INR', args); } catch (e) { caught = e; }
  assert.ok(/supplier's GSTIN is needed/.test(caught.message), caught.message);
});
ok('the Note-a-difference form has the supplier number box, labelled with the AU pack\'s word', () => {
  const dn = lib('books-manual').catalogue({ country: 'AU' }).events.find((e) => e.kind === 'debit_note');
  const field = dn.fields.find((f) => f.key === 'supplier_gstin');
  assert.ok(field && field.required === false && field.step === 3);
  assert.ok(/ABN/.test(field.label), field.label);
});
console.log('\n  ' + pass + ' passed · ' + pass + ' checks');
