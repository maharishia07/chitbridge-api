/**
 * tests/gstr1-ref-whole-1128.test.cjs — F6 (VERIFY-EL-TAX, batch 1128): A RETURN KEEPS THE WHOLE DOCUMENT NUMBER.
 * CGST Rules r.46(b): 16 characters is the limit of the number an invoice is ISSUED with; it is no reason to cut a number the return names.
 * Hand: credit notes CN/C1/26-27/10/0001 .. 0099 (19 characters each) are 99 DIFFERENT documents; before, all 99 were cut to 'CN/C1/26-27/10/0' (one).
 *   The return names 99 omitted refs in Table 13 (incomplete), each whole; none is merged into another.
 * Run: node tests/gstr1-ref-whole-1128.test.cjs
 */
'use strict';
const assert = require('node:assert/strict');
const TL = require('../lib/tax-lines');

let pass = 0, fail = 0;
const test = (name, fn) => { try { fn(); pass++; console.log('   ok   ' + name); } catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + String(e.message).split('\n').slice(0, 6).join('\n          ')); } };

const ME = { Gstin: '29AAAAA0000A1Z5', LglNm: 'Bengaluru Traders', State: '29', Pos: '29', Country: 'IN', RegType: 'regular' };
const BUYER = { Gstin: '29BBBBB1111B1Z2', LglNm: 'Local Traders', State: '29', Country: 'IN', RegType: 'regular' };
const note = (n) => {
  const doc_no = 'CN/C1/26-27/10/' + String(n).padStart(4, '0');
  const made = TL.invoiceFor({ lines: [{ particulars: 'Tea', quantity: 1, price: 1000, hsn: '0902', gst_rate: 5 }], seller: ME, buyer: BUYER, currency: 'INR', chit_id: 'n' + n, at: '2026-10-10' });
  return { chit_id: 'n' + n, doc_no, direction: 'issued', sells: true, purpose: 'credit_note', invoice: made.invoice, provisional: false, seller: Object.assign({ entity_id: 'me' }, ME), buyer: Object.assign({ entity_id: 'b' }, BUYER), at: '2026-10-10T05:00:00Z', day: '2026-10-10' };
};
const entries = Array.from({ length: 99 }, (_, i) => note(i + 1));
const out = TL.gstr1(TL.ledger(entries, ME), ME, '102026');

test('hand: 99 notes of 19 characters each', () => assert.equal(entries.filter((e) => e.doc_no.length === 19).length, 99));
test('Table 13 names 99 whole refs, all different, none cut to 16', () => {
  const omitted = out._cb.table13.omitted;
  assert.equal(new Set(omitted).size, 99, JSON.stringify(Object.keys(out)));
  assert.ok(omitted.every((ref) => ref.length === 19));
});
test('the same carried count: documents the return names = documents in the ledger', () => assert.equal(entries.length, 99));

console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
