'use strict';
// prove-amend-live.js — b138 against the LIVE rail. Everything prove-amend.js could not reach.
//
// prove-amend.js covers the pure layer (liveSet, liveLines, clean) with no database. This covers what it
// explicitly disclaimed: the INSERT, the seq chain, RLS isolation, the routes, and — the one that matters most —
// that a corrected quantity actually reaches the GROUP SUM. That was the defect shipped on 2026-08-11 morning:
// totals were read straight from chit_detail.line_items, so a trader could fix 5 crates to 2 and still be told
// to source 5.
//
// Run: node scripts/prove-amend-live.js
const { j, signIn } = require('./_proof');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { console.log('  \x1b[32mok\x1b[0m  ' + n); pass++; } else { console.log('  \x1b[31mXX\x1b[0m  ' + n + (x ? '\n        ' + x : '')); fail++; } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), 'got  ' + JSON.stringify(g) + '\n        want ' + JSON.stringify(w));

(async () => {
  const stamp = Date.now().toString().slice(-6);
  const A = await signIn('beta@test-cb.com', 'Beta Fresh');
  const B = await signIn('gamma@test-cb.com', 'Gamma Document Services');
  if (!A || !B) { console.log('\n  could not sign in\n'); process.exitCode = 2; return; }

  console.log('\n── b138 live ────────────────────────────────────────────────────────────────\n');
  console.log('0 · a chit to work on');
  /* The recipient is addressed by entity_id, not by display name — same as regression.js. */
  const eid = (t) => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString()).identity_id; } catch (_) { return null; } };
  const GAMMA = eid(B);
  ok('gamma entity id resolved from its token', !!GAMMA);
  const snd = await j('/api/chits/send', { method: 'POST', token: A, body: {
    recipients: [{ entity_id: GAMMA, role: 'to' }],
    manual_subject: 'amend live ' + stamp, purpose: 'order',
    line_items: [
      { particulars: 'Tomato', quantity: 3, unit: 'kg', price: 30 },
      { particulars: 'Milk',   quantity: 2, unit: 'packet', price: 25 },
      { particulars: 'Onion',  quantity: 1, unit: 'kg', price: 40 },
    ] } });
  const id = snd.b && (snd.b.chit_id || (snd.b.chit && snd.b.chit.chit_id));
  ok('chit created', !!id, JSON.stringify(snd.b).slice(0, 200));
  if (!id) { process.exitCode = 1; return; }

  const get = async (tok) => (await j('/api/chits/' + id, { token: tok })).b || {};
  let d = await get(A);
  ok('★ live_set is returned even with no amendments', Array.isArray(d.live_set) && d.live_set.length === 3);
  ok('  …and b138 is migrated on this environment', d.amendments_migrated === true,
     'amendments_migrated=' + d.amendments_migrated + ' — RUN b138 IF THIS IS FALSE');
  if (d.amendments_migrated !== true) { console.log('\n  cannot continue without b138\n'); process.exitCode = 1; return; }

  console.log('\n1 · a correction replaces the line, and the original survives');
  const am1 = await j('/api/chits/' + id + '/amend', { method: 'POST', token: A, body: { edits: [
    { line_index: 0, line: { particulars: 'Tomato', quantity: 5, unit: 'kg', price: 30 }, reason_code: 'misread_by_ai' } ] } });
  ok('amend accepted', am1.status === 200, 'status ' + am1.status + ' ' + JSON.stringify(am1.b).slice(0, 200));
  d = await get(A);
  eq('★★ the live line reads 5', d.live_set[0].live.quantity, 5);
  eq('★★ …and the ORIGINAL still says 3 — chit_detail was not touched', d.live_set[0].original.quantity, 3);
  eq('★ the original is in history, for the strike-through', d.live_set[0].history.length, 1);
  eq('  seq started at 1', d.amendments[0].seq, 1);

  console.log('\n2 · ★ the seq chain — correcting a correction');
  await j('/api/chits/' + id + '/amend', { method: 'POST', token: A, body: { edits: [
    { line_index: 0, line: { particulars: 'Tomato', quantity: 8, unit: 'kg', price: 30 }, reason_code: 'customer_clarified' } ] } });
  d = await get(A);
  eq('★★ seq was computed SERVER-SIDE as 2', d.amendments[1].seq, 2);
  eq('latest wins', d.live_set[0].live.quantity, 8);
  eq('history holds the original AND the middle step', d.live_set[0].history.map((h) => h.quantity), [3, 5]);

  console.log('\n3 · ★★ REMOVAL IS null — visible, counting nowhere');
  await j('/api/chits/' + id + '/amend', { method: 'POST', token: A, body: { edits: [
    { line_index: 1, line: null, reason_code: 'stock_unavailable' } ] } });
  d = await get(A);
  ok('★★ the removed line is STILL PRESENT — evidence', d.live_set.length === 3 && d.live_set[1].index === 1);
  ok('★★ …with live = null', d.live_set[1].live === null && d.live_set[1].removed === true);
  eq('★ …and it remembers WHY (a business event, not a misreading)', d.live_set[1].reason_code, 'stock_unavailable');

  console.log('\n4 · the shape is rejected in ONE place');
  const bad1 = await j('/api/chits/' + id + '/amend', { method: 'POST', token: A, body: { edits: [
    { line_index: 2, line: { particulars: 'Onion', quantity: '2 box' } } ] } });
  ok('★ a non-numeric quantity is REFUSED, not coerced to NaN', bad1.status === 400, 'status ' + bad1.status);
  const bad2 = await j('/api/chits/' + id + '/amend', { method: 'POST', token: A, body: { edits: [
    { line_index: 2, line: { description: 'Widget', qty: 9, rate: 5 } } ] } });
  ok('★★ the {description,qty,rate} shape is REFUSED — the gap that made 45 unreadable chits', bad2.status === 400, 'status ' + bad2.status);

  console.log('\n5 · ★★ RLS — a correction is MY reading, not the counterparty\'s');
  const gd = await get(B);
  ok('★ Gamma holds its own copy of the chit', !!gd.header, 'no header');
  eq('★★ …and sees ZERO of my amendments', (gd.amendments || []).length, 0);
  eq('★★ …its live set still reads the ORIGINAL 3', (gd.live_set || [])[0].live.quantity, 3);
  ok('★★ …and my removed line is NOT removed on its copy', !((gd.live_set || [])[1] || {}).removed);
  const cross = await j('/api/chits/' + id + '/amend', { method: 'POST', token: B, body: { edits: [
    { line_index: 0, line: { particulars: 'Tomato', quantity: 99, unit: 'kg' } } ] } });
  ok('  a participant CAN amend its own copy (not a permission test)', cross.status === 200, 'status ' + cross.status);
  d = await get(A);
  eq('★★ …and that did NOT touch mine', d.live_set[0].live.quantity, 8);

  console.log('\n6 · ⭐ THE DEFECT THAT SHIPPED THIS MORNING — group sum must total the LIVE set');
  const gs = await j('/api/folders/groupsum?scope=order', { token: A });
  ok('group sum answers', gs.status === 200, 'status ' + gs.status);

  /* ⚠️ ASSERT ACROSS BOTH SIDES, matched AND unmatched. The first version of this check looked only at the
     `requirement` totals for "Tomato" — but this entity's catalogue has no Tomato, so the line is (correctly)
     excluded as unmatched and the assertion read `[]`. That is indistinguishable from "the live set was ignored",
     which is the very thing being tested. Every line the group sum SAW lands in one of the two places, so
     searching both proves the quantity it saw regardless of whether the catalogue could match it. */
  const seen = [];
  ((gs.b || {}).requirement || []).forEach((l) => (l.breakdown || []).forEach((b) => { if (b.chit_id === id) seen.push({ where: 'totalled', phrase: b.phrase, qty: b.qty }); }));
  ((((gs.b || {}).flags) || {}).unmatched || []).forEach((u) => { if (u.chit_id === id) seen.push({ where: 'flagged', phrase: u.phrase, qty: u.qty }); });

  const tom = seen.filter((s) => /tomato/i.test(s.phrase || ''));
  eq('★★ this chit contributes the CORRECTED 8, not the misread 3', tom.map((s) => s.qty), [8]);
  ok('  (it was ' + ((tom[0] || {}).where || 'not seen') + ' — either is fine; the QUANTITY is the point)', tom.length === 1);
  /* The removed line must be absent from BOTH places — not merely absent from the totals. */
  eq('★★ the stock-removed line contributes NOTHING, and is not even flagged',
     seen.filter((s) => /milk/i.test(s.phrase || '')).length, 0);
  eq('  the untouched line is still there', seen.filter((s) => /onion/i.test(s.phrase || '')).map((s) => s.qty), [1]);

  console.log('\n7 · the correction shows in the chit\'s own history');
  ok('★ an "amended" event was logged', (d.state_log || []).some((e) => e.action === 'amended'));

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + pass + ' passed, ' + fail + ' failed\x1b[0m');
  console.log('  chit left in place for inspection: ' + id + '  (subject "amend live ' + stamp + '")\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
