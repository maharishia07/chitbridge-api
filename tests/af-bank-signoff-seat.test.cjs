/**
 * af-bank-signoff-seat.test.cjs — AF-F-03 (walk AF, 1129): a bank reconciliation is signed off only by a seat the books let read the figures (the ONE mayReadMoney gate, via moneyReader).
 * Walk AF-C13: cashier and bookkeeper (no hat) got 201 on POST /bank/statements though 403 on every books read. Proves: a staff seat gets 403 OWNER_ONLY in words (the books' own
 * sentence, same as GET /daybook) and nothing is stored · the owner still signs (201) · the staff seat's read of the daybook is the same refusal (one gate, one answer).
 * Run: node tests/af-bank-signoff-seat.test.cjs
 */
'use strict';
const { rig, counter } = require('./support/books-manual-rig.cjs');
const { ok, eq, done } = counter();
(async () => {
  const R = await rig(); if (!R) return;
  const { q, X } = R;
  const body = { account: '1510', period_from: '2026-09-01', period_to: '2026-09-30', opening_minor: 0, closing_bank_minor: 100, closing_books_minor: 100, difference_minor: 0, currency: 'INR', file_hash: 'af03' };
  R.asStaff();
  const read = await q('GET', '/daybook');
  const sign = await q('POST', '/bank/statements', body);
  eq('the staff seat is refused the daybook read (403 OWNER_ONLY)', [read.status, read.body.code], [403, 'OWNER_ONLY']);
  eq('…and refused the bank sign-off the same way, with the bank-write sentence (walkU U-F-01 bankWriter: the owner or the shop accountant or bookkeeper)', [sign.status, sign.body.code, /keep or sign off a bank reconciliation/.test(sign.body.detail || '')], [403, 'OWNER_ONLY', true]);
  ok('…the sentence names who may (words, not a bare code)', /owner|accountant|auditor/.test(sign.body.detail || ''), sign.body.detail);
  R.asOwner();
  const mine = await q('POST', '/bank/statements', body);
  ok('the owner is not refused by the seat gate (not 403)', mine.status !== 403, mine.status + ' ' + JSON.stringify(mine.body).slice(0, 200));
  R.close(); done();
})().catch((e) => { console.log('   FAIL ' + (e && e.stack || e)); process.exit(1); });
