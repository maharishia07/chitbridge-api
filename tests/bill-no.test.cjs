/**
 * tests/bill-no.test.cjs - lib/bill-no: the ONE reader of the number a bill carries (bill_no, printed_as, invoice_no, doc_no), as typed and as compared (case and spaces aside).
 * Run: node tests/bill-no.test.cjs
 */
'use strict';
const path = require('path');
const { billNoRawOf, billNoOf, BILL_NO_FIELDS } = require(path.join(__dirname, '..', 'lib', 'bill-no.js'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
ok('the fields, in order: bill_no, printed_as, invoice_no, doc_no', JSON.stringify(BILL_NO_FIELDS) === '["bill_no","printed_as","invoice_no","doc_no"]');
ok('bill_no wins', billNoRawOf({ bill_no: 'A/1', invoice_no: 'B', doc_no: 'C' }) === 'A/1');
ok('printed_as is read when there is no bill_no', billNoRawOf({ printed_as: '26-27/0043' }) === '26-27/0043');
ok('invoice_no (the forms and move-in field) is read', billNoRawOf({ invoice_no: 'INV-7' }) === 'INV-7');
ok('doc_no is read last', billNoRawOf({ doc_no: 'D9' }) === 'D9');
ok('a blank (spaces) bill_no falls through to the next field', billNoRawOf({ bill_no: '   ', invoice_no: 'INV-7' }) === 'INV-7');
ok('a number typed as a number is read as text', billNoRawOf({ bill_no: 42 }) === '42');
ok('fail closed: nothing, null, a text or a list is no number (empty), never a throw', billNoRawOf({}) === '' && billNoRawOf(null) === '' && billNoRawOf('INV') === '' && billNoRawOf([]) === '' && billNoRawOf({ bill_no: { x: 1 } }) === '');
ok('compared case and spaces aside: " inv 7" and "INV7" are one number', billNoOf({ bill_no: ' inv 7' }) === 'INV7' && billNoOf({ invoice_no: 'INV7' }) === 'INV7');
console.log(String(pass) + ' ok, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
