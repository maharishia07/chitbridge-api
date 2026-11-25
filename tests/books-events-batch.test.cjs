/**
 * books-events-batch.test.cjs — POST /api/books/events/batch (SPD bank Add): 50 statement lines post in ONE request through the one event writer.
 * Proves: 50 lines = 1 request and 50 entries; a bad line is named by index and client_ref while the others post; a retry of the same batch posts nothing twice (duplicate: true, same entry_no);
 * 0 or over 100 events is 400; a batch result equals the single door's answer for the same line; a shop that asks the owner to approve a Bookkeeper's entries gets 409 BOOKS_BATCH_HELD and nothing posts.
 * Run: node tests/books-events-batch.test.cjs   (BOOKS_ENGINES_SRC=<chitbridge-engines/src>)
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * UNIT      routes/books-events-batch.js
 * UNIT      lib/books-events-batch.js
 * MIN       error-never-leaks - the refused list of a failed batch names only an index and a code; the writer own message stays in the trace.
 * MIN       loud - a mid-batch writer error answers ok:false with a code and the refused index (never silent partial success); the receipt is always returned and one trace line is logged.
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
  ok('route: the body carries the receipt beside the old keys', r2.body.ok === false && r2.body.capability === 'CAP-BOOKS-EVENTS-BATCH' && r2.body.written === 3 && r2.body.held === 0 && r2.body.refused.length === 2 && 'request_id' in r2.body, JSON.stringify(r2.body.refused));
  const routeText = require('fs').readFileSync(require.resolve('../routes/books-events-batch'), 'utf8');
  ok('route: an unexpected fault answers through problem(refusalOf) and the body never carries err.message (error-never-leaks, no 500 text)', /problem\(req, res, refusalOf\(err, req\)\)/.test(routeText) && !/res\.(json|send)\([^)]*err\.message/.test(routeText));
  const { postEventsBatch } = require('../lib/books-events-batch');
  const log =require('../lib/logger'), seen = [], realWarn = log.warn;
  log.warn = (name, fields) => seen.push([name, fields]);
  const said = (err) => ({ status: err.status || 500, code: err.code || 'INTERNAL', detail: err.message });
  const writes = [];
  const flaky = async (e, b, event) => { if (event.n === 2) throw new Error('disk gone'); writes.push(event.n); return { ok: true, entry_no: event.n }; };
  const loud = await postEventsBatch({ entity: 'e', books: {}, by: 'p', request_id: 'rq1', isHeld: async () => false, said, post: flaky }, [{ n: 0 }, { n: 1 }, { n: 2 }, { n: 3 }]);
  eq('loud: a writer error mid-batch is ok:false with its index and code, the rest still counted', [loud.ok, loud.written, loud.refused, loud.code], [false, 3, [{ index: 2, code: 'INTERNAL' }], 'BOOKS_BATCH_PARTIAL']);
  ok('loud: the refused list never leaks the writer e.message (index and code only; the 500-class text stays in the trace)', !JSON.stringify(loud.refused).includes('disk gone') && loud.refused.every((r) => r.code === 'INTERNAL' && Object.keys(r).length === 2));
  ok('loud: ONE trace line names the capability and the request id, at warn level', seen.length === 1 && seen[0][1].capability === 'CAP-BOOKS-EVENTS-BATCH' && seen[0][1].id === 'rq1', JSON.stringify(seen));
  log.warn = realWarn;
  const held0 = await postEventsBatch({ entity: 'e', books: {}, request_id: 'rq2', isHeld: async () => true, said, post: flaky }, [{ n: 0 }, { n: 1 }]);
  eq('held: a receipt, nothing written, the code and the count held', [held0.ok, held0.written, held0.held, held0.refusal.code, writes.length], [false, 0, 2, 'BOOKS_BATCH_HELD', 3]);
  eq('bad size: a receipt with BOOKS_BAD_REQUEST', (await postEventsBatch({ request_id: 'rq3', isHeld: async () => false, said }, [])).refusal.code, 'BOOKS_BAD_REQUEST');
  let thrown = null;
  try { await postEventsBatch({ request_id: 'rq4', isHeld: async () => { throw Object.assign(new Error('policy read failed'), { code: 'POLICY_DOWN' }); }, said }, [{ n: 0 }]); } catch (e) { thrown = e; }
  ok('loud: a failure of the gate itself is thrown, never swallowed', !!thrown && thrown.code === 'POLICY_DOWN');
  R.close && R.close();
  done();
})();
