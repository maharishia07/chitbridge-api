/**
 * vol-2026-11-20-books-doors.test.cjs — VOLUME walk 20 Nov defects 2 + 5 (books side).
 * (a) a counter sale never reads "rung by <identity uuid>": the till's id gives the identity's name (read in the same query), else nothing.
 * (b) POST /api/books/entries with a null / non-object line answers 422 BOOKS_REFUSED, never 500, and posts nothing.
 * Run: node tests/vol-2026-11-20-books-doors.test.cjs   (BOOKS_ENGINES_SRC=<chitbridge-engines/src>)
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 */
'use strict';
const { rig, counter } = require('./support/books-manual-rig.cjs');
const { ok, done } = counter();
const Daybook = require('../lib/books-daybook');

const ID = '85d308d2-bc35-4f0a-9c1e-1a2b3c4d5e6f';
const base = { source_chit_id: 'c1', src_chit_id: 'c1', event_type: 'sale_bill', covers: 0 };
const by = (extra) => Daybook.sourceOf(Object.assign({}, base, extra)).by;
ok('till.by is an identity id with a resolved name -> the name', by({ src_by: ID, src_by_ident: 'Asha' }) === 'Asha');
ok('till.by is an id with no name -> never the id (falls to the entry maker, else null)', by({ src_by: ID }) === null && by({ src_by: ID, by_name: 'Ravi' }) === 'Ravi');
ok('till.by_name still wins; a plain name is kept; a key { name } is kept', by({ src_by: ID, src_by_name: 'Meena' }) === 'Meena' && by({ src_by: 'Till 2' }) === 'Till 2' && by({ src_by: { name: 'Key A' } }) === 'Key A');

(async () => {
  const R = await rig(); if (!R) return;
  const { q, X } = R, T = X.T;
  const n0 = T.entries.length;
  const lines = [{ code: '1400', dr_minor: 500 }, null, { code: '3000', cr_minor: 500 }];
  for (const [what, list] of [['a null line', lines], ['a number line', [1, 2]], ['an array line', [[1], [2]]], ['a string line', ['x']]]) {
    const r = await q('POST', '/entries', { narration: 'junk', date: '2026-10-05', client_ref: 'j-' + what.slice(0, 5), lines: list });
    ok(what + ' -> 422 BOOKS_REFUSED, nothing written', r.status === 422 && r.body.code === 'BOOKS_REFUSED' && T.entries.length === n0, r.status + ' ' + JSON.stringify(r.body).slice(0, 160));
  }
  R.close(); done();
})().catch((x) => { console.error(x); process.exit(1); });
