/**
 * tests/ctry-148-gstr3b-composition.test.cjs — CTRY-148: A GSTR-3B FOR A COMPOSITION SHOP IS REFUSED (the route answers 422 GSTR_REFUSED), NOT ANSWERED 200 WITH ZEROS.
 *
 * OWNS      the proof that lib/tax-lines gstr3b refuses a composition shop in words that name CMP-08 and GSTR-4, and that a regular shop's answer is unchanged.
 *           Source: CGST Rules 2017 r.62 and Part B forms (cbic-gst.gov.in); GST portal CMP-08 FAQ 2, 11 (tutorial.gst.gov.in).
 *           Hand example: a sale of 3000.00 at 18% = 270.00 CGST + 270.00 SGST for a regular shop; the composition shop gets no file.
 * CALLED BY scripts/guards.cjs · CI. No database.
 * Run: node tests/ctry-148-gstr3b-composition.test.cjs
 */
'use strict';
const assert = require('node:assert/strict');
const T = require('../lib/tax-lines');

const GSTIN = '33AAAAA0000A1Z5';
const ledger = T.ledger(
  [{ chit_id: 'a', direction: 'sent', invoice: T.invoiceFor({ lines: [{ name: 'Brake pad', quantity: 1, price: 3000, gst_rate: 18, hsn: '8708' }], seller: { Country: 'IN', Gstin: GSTIN, State: '33' }, buyer: { Pos: '33' }, chit_id: 'a', at: '2026-09-04' }).invoice, provisional: false, seller: { Country: 'IN', entity_id: 'me' }, buyer: { entity_id: 'b' }, at: '2026-09-04' }],
  { RegType: 'regular' }
);
let fail = 0;
const check = (name, fn) => {
  try { fn(); console.log('   ok   ' + name); } catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + String(e.message).split('\n')[0]); }
};
console.log('\n== CTRY-148: GSTR-3B FOR A COMPOSITION SHOP ==\n');
check('composition shop with a GSTIN: refused, names CMP-08 and GSTR-4, no figures', () => {
  const out = T.gstr3b(ledger, { Country: 'IN', Gstin: GSTIN, RegType: 'composition' }, '092026');
  assert.equal(out.ok, false);
  assert.match(out.why, /composition scheme/);
  assert.match(out.why, /CMP-08/);
  assert.match(out.why, /GSTR-4/);
  assert.equal(out.sup_details, undefined);
});
check('regular shop: unchanged, files 3000.00 taxable, 270.00 + 270.00 tax', () => {
  const out = T.gstr3b(ledger, { Country: 'IN', Gstin: GSTIN, RegType: 'regular' }, '092026');
  assert.equal(out.ok, undefined);
  assert.deepEqual([out.sup_details.osup_det.txval, out.sup_details.osup_det.camt, out.sup_details.osup_det.samt], [3000, 270, 270]);
});
check('no RegType stated: treated as regular, unchanged', () => {
  assert.equal(T.gstr3b(ledger, { Country: 'IN', Gstin: GSTIN }, '092026').ok, undefined);
});
console.log(fail ? '\n' + fail + ' failed' : '\nall passed');
process.exit(fail ? 1 : 0);
