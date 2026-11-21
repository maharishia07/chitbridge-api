/**
 * walkac-moved-note.test.cjs - walk AC 1129 AC-F-02: a document that a locked month moved to the first open day SAYS so, in one sentence.
 * Hand: a credit note dated 28 Nov 2026, November locked -> posts 1 Dec 2026 and its narration holds
 * "Dated 28 Nov; November is locked, so it is in the books on 1 Dec" (once, never twice); a day that did not move says nothing.
 * Run: node tests/walkac-moved-note.test.cjs   (BOOKS_ENGINES_SRC=<chitbridge-engines/src>)
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 */
'use strict';
const { rig, counter, SUPP } = require('./support/books-manual-rig.cjs');
const { ok, eq, done } = counter();
const N = require('../lib/books-lock-note');
(async () => {
  console.log('\n== AC-F-02 - the moved document says so ==\n');
  eq('the sentence', N.movedWords('2026-11-28', '2026-12-01'), 'Dated 28 Nov; November is locked, so it is in the books on 1 Dec');
  eq('not moved -> no sentence', N.movedWords('2026-12-03', '2026-12-03'), '');
  eq('said once', N.notedMoved(N.notedMoved('Credit note', '2026-11-28', '2026-12-01'), '2026-11-28', '2026-12-01'), 'Credit note — Dated 28 Nov; November is locked, so it is in the books on 1 Dec');
  const R = await rig(); if (!R) return;
  const { X, q } = R, T = X.T;
  const lock = await q('POST', '/periods/2026-27/6/lock', { reason: 'BAS filed' });
  ok('September locked (soft)', lock.status === 200, lock.status + ' ' + JSON.stringify(lock.body).slice(0, 200));
  const post = await X.B.postEntry(X.db, R.SHOP || '11111111-1111-4111-8111-111111111111', { type: 'purchase_bill', date: '2026-09-28', currency: 'INR', party: SUPP, narration: 'Bill CN-1', source_chit_id: 'c0000000-0000-4000-8000-0000000000a1', source_ref: 'chit:cn1', by_rate: [{ rate: 5, taxable: 100, cgst: 2.5, sgst: 2.5, igst: 0 }], paid: {}, round_off: 0 }).catch((e) => ({ err: String(e.message) }));
  ok('a document dated 28 Sep posts on 1 Oct, moved', post && String(post.posting_date).slice(0, 10) === '2026-10-01' && post.moved === true, JSON.stringify(post).slice(0, 300));
  const e = T.entries.find((x) => x.source_ref === 'chit:cn1');
  ok('its narration says so, once', e && e.narration && e.narration.split('is locked, so it is in the books on 1 Oct').length === 2, e && e.narration);
  R.close();
  done();
})().catch((e) => { console.log('   FAIL ' + (e && e.stack || e)); process.exit(1); });
