/**
 * tests/walkf-setoff-1128.test.cjs — F-F-08 (WALK F, batch 1128): the ledger / GSTR-3B net applies the s.49 / Rule 88A set-off order.
 * CGST Act s.49(5): IGST credit → IGST, CGST, SGST; CGST credit → CGST, IGST; SGST credit → SGST, IGST (CGST credit never pays SGST and the reverse).
 * Hand case (rupees): IGST credit 600.00 vs IGST 160.16, CGST 247.50, SGST 247.50 → IGST 0, CGST 0, SGST 55.16 (total 55.16, as before).
 * Run: node tests/walkf-setoff-1128.test.cjs
 */
'use strict';
const assert = require('node:assert/strict');
const TL = require('../lib/tax-lines');
let pass = 0, fail = 0;
const test = (name, fn) => { try { fn(); pass++; console.log('   ok   ' + name); } catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + String(e.message).split('\n').slice(0, 6).join('\n          ')); } };
const netOf = TL.netOf;
test('hand case: IGST credit 600.00 → IGST 0, CGST 0, SGST 55.16', () => {
  const n = netOf({ cgst: 247.5, sgst: 247.5, igst: 160.16, cess: 0 }, { cgst: 0, sgst: 0, igst: 600, cess: 0 });
  assert.deepEqual(n, { cgst: 0, sgst: 55.16, igst: 0, cess: 0, vat: 0, total: 55.16 });
});
test('CGST credit 180 pays CGST 100 then IGST 50, carries 30, never SGST', () => {
  const n = netOf({ cgst: 100, sgst: 100, igst: 50, cess: 0 }, { cgst: 180, sgst: 0, igst: 0, cess: 0 });
  assert.deepEqual(n, { cgst: -30, sgst: 100, igst: 0, cess: 0, vat: 0, total: 70 });
});
test('SGST credit beyond SGST pays IGST; the rest is carried (negative head), total unchanged', () => {
  const n = netOf({ cgst: 0, sgst: 100, igst: 50, cess: 0 }, { cgst: 0, sgst: 300, igst: 0, cess: 0 });
  assert.deepEqual(n, { cgst: 0, sgst: -150, igst: 0, cess: 0, vat: 0, total: -150 });
});
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
