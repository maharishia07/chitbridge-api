/**
 * tests/walkl-measure-credit-note-sign-1128.test.cjs — WALK L L-F-08: a pile's money subtracts credit notes (lib/measure signedValue), so GET /api/folders/reconcile's total is signed.
 * Offline. Hand figures in fils (UAE, AED): 400.00 + 110.09 + 210.00 − 33.33 − 33.33 = 65343 (the walk's hand 653.43, not 786.75 = 78675).
 */
'use strict';
const assert = require('assert');
const measure = require('../lib/measure');

const row = (id, purpose, value) => ({ chit_id: id, purpose, value, currency: 'AED', current_status: 'accepted' });
const rows = [row('a', 'invoice', 400), row('b', 'invoice', 110.09), row('c', 'invoice', 210), row('d', 'credit_note', 33.33), row('e', 'credit_note', 33.33)];
const fils = (list) => Math.round(measure.measure(list).money.by_currency[0].total * 100);
let fails = 0;
const t = (name, fn) => { try { fn(); console.log('   ok   ' + name); } catch (e) { fails++; console.log('   FAIL ' + name + '\n          ' + e.message); } };

t('credit notes subtract: the pile totals 65343 fils, not 78675', () => assert.strictEqual(fils(rows), 65343));
t('the chit count stays 5 (a credit note is still a chit, only its money is signed)', () => assert.strictEqual(measure.measure(rows).money.by_currency[0].chits, 5));
t('two carried totals agree: the pile 65343 = invoices alone 72009 minus the notes 6666', () => assert.deepStrictEqual([fils(rows.slice(0, 3)), fils(rows)], [72009, 72009 - 6666]));
t('a credit note stored as a negative still subtracts once (never adds back)', () => assert.strictEqual(measure.signedValue(row('x', 'credit_note', -33.33)), -33.33));
t('a debit note adds', () => assert.strictEqual(measure.signedValue(row('y', 'debit_note', 12.5)), 12.5));
console.log('\n5 checks' + (fails ? ', ' + fails + ' FAILED' : ''));
process.exit(fails ? 1 : 0);
