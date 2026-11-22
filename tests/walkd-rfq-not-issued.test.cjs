/**
 * tests/walkd-rfq-not-issued.test.cjs — WALK-D D-F-10: AN "ASK FOR A QUOTE" IS A REQUEST, NOT AN ISSUED INVOICE, SO THE SELLER CAN PRICE IT.
 *
 * OWNS      lib/invoice-issued isIssuedRow (the ONE "is this issued" test): an order carrying figures with deal_type rfq → not issued (the seller's price is a round, not a credit/debit note, so no 409 INVOICE_INCREASE_REFUSED);
 *           the same order without deal_type rfq → issued, as before; posted to the books or frozen → issued even when it was an rfq; a quotation / pro_forma → not issued, as before.
 *           ⚠️ The chain from this verdict to the round (chit-proposal sellerRound → priceMoney) is the existing path for any not-issued order; the real-stack walk (q2.cjs) is the proof on a box.
 * CALLED BY by hand: node tests/walkd-rfq-not-issued.test.cjs
 * FLOW      chit copy row → isIssuedRow → false → sellerRound prices the lines (a pro-forma round) | true → noteRound
 * CARD      14-accounting/README (ACC-192)
 */
'use strict';
const path = require('path');
process.env.NODE_ENV = 'test';
const issued = require(path.join(__dirname, '..', 'lib', 'invoice-issued'));
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name); } };
const row = (over) => Object.assign({ has_invoice: true, frozen_at: null, document: null, deal_type: null, posted: false }, over);

console.log('\n== WALK-D D-F-10 · an RFQ is not an issued invoice ==\n');
ok('an RFQ order that carries figures, not posted or frozen → NOT issued (the seller may price it)', issued.isIssuedRow(row({ deal_type: 'rfq' })) === false);
ok('the same order, an ordinary one (no deal_type rfq) → issued, as before', issued.isIssuedRow(row()) === true);
ok('an RFQ already posted to the books → issued', issued.isIssuedRow(row({ deal_type: 'rfq', posted: true })) === true);
ok('an RFQ whose invoice was frozen → issued', issued.isIssuedRow(row({ deal_type: 'rfq', frozen_at: '2026-11-21T00:00:00Z' })) === true);
ok('a quotation → not issued, as before', issued.isIssuedRow(row({ document: 'quotation' })) === false);
ok('a pro-forma → not issued, as before', issued.isIssuedRow(row({ document: 'pro_forma' })) === false);
ok('no copy → false', issued.isIssuedRow(undefined) === false);
console.log('\n' + pass + ' ok, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
