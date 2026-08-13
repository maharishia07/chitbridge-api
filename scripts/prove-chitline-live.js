'use strict';
// prove-chitline-live.js — b142 on the live rail. A line is a row now.
//
// What no offline test can reach: that chit_deliver() writes per-line rows for EVERY copy in the transaction that
// creates it, that both copies agree on line_id (the precondition for co-held per-line delivery), that RLS keeps
// one entity's rows off another's, that order is stated rather than incidental, and that a correction moves the
// live row and the audit row together.
//
// Run: node scripts/prove-chitline-live.js
const { j, signIn } = require('./_proof');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { console.log('  \x1b[32mok\x1b[0m  ' + n); pass++; } else { console.log('  \x1b[31mXX\x1b[0m  ' + n + (x ? '\n        ' + x : '')); fail++; } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), 'got  ' + JSON.stringify(g) + '\n        want ' + JSON.stringify(w));

(async () => {
  const stamp = Date.now().toString().slice(-6);
  const A = await signIn('beta@test-cb.com', 'Beta Fresh');
  const B = await signIn('gamma@test-cb.com', 'Gamma Document Services');
  if (!A || !B) { console.log('\n  could not sign in\n'); process.exitCode = 2; return; }
  const eid = (t) => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString()).identity_id; } catch (_) { return null; } };

  console.log('\n── b142 live · a line is a row ──────────────────────────────────────────────\n');
  console.log('0 · send a chit with three lines');
  const snd = await j('/api/chits/send', { method: 'POST', token: A, body: {
    recipients: [{ entity_id: eid(B), role: 'to' }],
    manual_subject: 'chitline ' + stamp, purpose: 'order',
    line_items: [
      { particulars: 'Tomato', quantity: 3, unit: 'kg', price: 30 },
      { particulars: 'Milk',   quantity: 2, unit: 'packet', price: 25 },
      { particulars: 'Onion',  quantity: 1, unit: 'kg', price: 40 },
    ] } });
  const id = snd.b && (snd.b.chit_id || (snd.b.chit && snd.b.chit.chit_id));
  ok('chit created', !!id, JSON.stringify(snd.b).slice(0, 200));
  if (!id) { process.exitCode = 1; return; }

  const get = async (tok) => (await j('/api/chits/' + id, { token: tok })).b || {};
  const mine = await get(A), theirs = await get(B);

  console.log('\n1 · every line was stamped with an identity and an order');
  const ls = mine.live_set || [];
  eq('three lines', ls.length, 3);
  const ids = ls.map((e) => (e.live || e.original || {}).line_id);
  ok('★★ every line carries a line_id', ids.every(Boolean), JSON.stringify(ids));
  ok('…and they are distinct', new Set(ids).size === 3);
  eq('★ seq is STATED, gapped by 10', ls.map((e) => (e.live || e.original || {}).seq), [10, 20, 30]);
  eq('…and they come back in that order', ls.map((e) => (e.live || e.original || {}).particulars), ['Tomato', 'Milk', 'Onion']);

  console.log('\n2 · ⭐ BOTH COPIES AGREE ON WHAT A LINE IS');
  const theirIds = (theirs.live_set || []).map((e) => (e.live || e.original || {}).line_id);
  /* ⚠️ THE PRECONDITION FOR CO-HELD PER-LINE DELIVERY. If the two copies minted different ids, "line 2 was
     delivered" would be unsayable across the boundary — each side would mean a different row. */
  eq('★★ the counterparty\'s copy carries the SAME line_ids', theirIds, ids);
  ok('  …and its own rows, per copy', (theirs.live_set || []).length === 3);

  console.log('\n3 · a correction moves the LIVE row, by line_id');
  const am = await j('/api/chits/' + id + '/amend', { method: 'POST', token: A, body: { edits: [
    { line_index: 0, line_id: ids[0], line: { particulars: 'Tomato', quantity: 8, unit: 'kg', price: 30 }, reason_code: 'misread_by_ai' } ] } });
  ok('amend accepted', am.status === 200, 'status ' + am.status + ' ' + JSON.stringify(am.b).slice(0, 180));
  eq('★ the amendment records the line_id, not just a position', (am.b.amendments || [])[0].line_id, ids[0]);
  const after = await get(A);
  eq('★★ the live line reads 8', (after.live_set[0].live || {}).quantity, 8);
  eq('★★ …and the ORIGINAL still says 3 — the delivered payload is untouched', after.live_set[0].original.quantity, 3);
  /* ⚠️ THE ASSERTION THAT WAS MISSING. Every earlier check read live/original, which are built from chit_line and
     the frozen payload — so an empty history was invisible. Athi's first screenshot showed a corrected line with
     NO struck-through original, because amend.list() never selected line_id and the chain filter matched nothing. */
  eq('★★★ the history carries the ORIGINAL, for the strike-through', (after.live_set[0].history || []).map((h) => h.quantity), [3]);

  console.log('\n4 · ⭐ RLS — a correction is MY reading of MY copy');
  const theirsAfter = await get(B);
  eq('★★ their copy still reads the original 3', (theirsAfter.live_set[0].live || {}).quantity, 3);
  eq('★★ …and sees none of my amendments', (theirsAfter.amendments || []).length, 0);

  console.log('\n5 · removal is a state on the row, not a delete');
  await j('/api/chits/' + id + '/amend', { method: 'POST', token: A, body: { edits: [
    { line_index: 1, line_id: ids[1], line: null, reason_code: 'stock_unavailable' } ] } });
  const rm = await get(A);
  eq('★★ still three lines — the removed one is EVIDENCE', (rm.live_set || []).length, 3);
  ok('★★ …flagged removed', rm.live_set[1].removed === true);
  eq('★ …and it remembers why', rm.live_set[1].reason_code, 'stock_unavailable');

  console.log('\n6 · ⭐ the group sum totals the LIVE lines');
  const gs = await j('/api/folders/groupsum?scope=order', { token: A });
  const seen = [];
  ((gs.b || {}).requirement || []).forEach((l) => (l.breakdown || []).forEach((b) => { if (b.chit_id === id) seen.push({ p: b.phrase, q: b.qty }); }));
  ((((gs.b || {}).flags) || {}).unmatched || []).forEach((u) => { if (u.chit_id === id) seen.push({ p: u.phrase, q: u.qty }); });
  eq('★★ the corrected 8 counts, not the misread 3', seen.filter((s) => /tomato/i.test(s.p)).map((s) => s.q), [8]);
  eq('★★ the removed line counts nowhere at all', seen.filter((s) => /milk/i.test(s.p)).length, 0);
  eq('  the untouched line is still there', seen.filter((s) => /onion/i.test(s.p)).map((s) => s.q), [1]);

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + pass + ' passed, ' + fail + ' failed\x1b[0m');
  console.log('  chit left for inspection: ' + id + '  (subject "chitline ' + stamp + '")\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
