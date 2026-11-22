/**
 * books-events-batch.test.cjs — POST /api/books/events/batch (SPD bank Add): 50 statement lines post in ONE request through the one event writer.
 * Proves: 50 lines = 1 request and 50 entries; a bad line is named by index and client_ref while the others post; a retry of the same batch posts nothing twice (duplicate: true, same entry_no);
 * 0 or over 100 events is 400; a batch result equals the single door's answer for the same line; a shop that asks the owner to approve a Bookkeeper's entries gets 409 BOOKS_BATCH_HELD and nothing posts.
 * Run: node tests/books-events-batch.test.cjs   (BOOKS_ENGINES_SRC=<chitbridge-engines/src>)
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * UNIT      routes/books.js
 */
'use strict';
const { rig, counter } = require('./support/books-manual-rig.cjs');
const { ok, eq, done } = counter();
(async () => {
  console.log('\n══ POST /api/books/events/batch ══\n');
  const R = await rig();
  if (!R) return;
  const { X, q } = R, T = X.T;
  const line = (ref, extra) => Object.assign({ kind: 'expense', class: 'rent', paid_from: 'bank', date: '2026-10-05', amount: 100, narration: 'line ' + ref, client_ref: 'bank:t:' + ref }, extra);
  const fifty = Array.from({ length: 50 }, (_, i) => line('a' + i, { amount: 100 + i }));
  const before = T.entries.length;
  const r1 = await q('POST', '/events/batch', { events: fifty });
  eq('50 lines: 200', r1.status, 200);
  eq('50 lines: posted 50, failed 0', [r1.body.posted, r1.body.failed], [50, 0]);
  eq('50 lines: 50 new entries', T.entries.length - before, 50);
  ok('every result carries its index, client_ref and an entry_no', (r1.body.results || []).every((r, i) => r.index === i && r.client_ref === 'bank:t:a' + i && r.ok === true && r.entry_no));
  const again = await q('POST', '/events/batch', { events: fifty });
  eq('retry: posts nothing twice', T.entries.length - before, 50);
  ok('retry: every line is duplicate: true with the first entry_no', (again.body.results || []).every((r, i) => r.duplicate === true && r.entry_no === r1.body.results[i].entry_no));
  const mixed = [line('m0'), line('m1', { class: 'no-such-account' }), line('m2'), 'junk', line('m4')];
  const n0 = T.entries.length;
  const r2 = await q('POST', '/events/batch', { events: mixed });
  eq('partial: 200 with posted 3, failed 2', [r2.status, r2.body.posted, r2.body.failed], [200, 3, 2]);
  const bad = (r2.body.results || []).filter((r) => r.ok !== true);
  eq('partial: the refused lines are named by index', bad.map((r) => r.index), [1, 3]);
  ok('partial: the refused line keeps its client_ref and says why', bad[0].client_ref === 'bank:t:m1' && bad[0].status >= 400 && !!bad[0].code && !!bad[0].detail, JSON.stringify(bad[0]));
  eq('partial: the others posted', T.entries.length - n0, 3);
  const single = await q('POST', '/events', line('s0', { amount: 777 }));
  const batched = await q('POST', '/events/batch', { events: [line('s0', { amount: 777 })] });
  eq('same line: the batch answers the single door\'s entry (replay)', [batched.body.results[0].entry_no, batched.body.results[0].duplicate], [single.body.entry_no, true]);
  eq('empty list: 400', (await q('POST', '/events/batch', { events: [] })).status, 400);
  eq('101 events: 400', (await q('POST', '/events/batch', { events: Array.from({ length: 101 }, (_, i) => line('z' + i)) })).status, 400);
  eq('no events key: 400', (await q('POST', '/events/batch', {})).status, 400);
  const held = require('../lib/books-approval');
  const realBinds = held.bindsRequest;
  held.bindsRequest = async () => true;
  const n1 = T.entries.length;
  const h = await q('POST', '/events/batch', { events: [line('h0')] });
  held.bindsRequest = realBinds;
  eq('held shop: 409 BOOKS_BATCH_HELD, nothing posted', [h.status, h.body.code, T.entries.length - n1], [409, 'BOOKS_BATCH_HELD', 0]);
  R.close && R.close();
  done();
})();
