'use strict';
// prove-assign-live.js — b143 on the live rail. Division of labour, and the privacy that makes it safe.
//
// The two claims that matter:
//   1. a line can be handed to a person, with a task and a date, and reassigned — with the history intact
//   2. ⭐ the counterparty NEVER sees any of it. Athi, 2026-08-12: assignment private, delivery shared.
// Plus the payoff: one person's work list assembled across chits, which a chit-level model cannot express.
//
// Run: node scripts/prove-assign-live.js
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

  console.log('\n── b143 live · division of labour ───────────────────────────────────────────\n');
  console.log('0 · two chits, so the work list has something to assemble');
  const mk = async (subj, items) => {
    const s = await j('/api/chits/send', { method: 'POST', token: A, body: {
      recipients: [{ entity_id: eid(B), role: 'to' }], manual_subject: subj, purpose: 'order', line_items: items } });
    return s.b && (s.b.chit_id || (s.b.chit && s.b.chit.chit_id));
  };
  const c1 = await mk('assign A ' + stamp, [
    { particulars: 'Onion', quantity: 25, unit: 'kg', price: 40 },
    { particulars: 'Potato', quantity: 20, unit: 'kg', price: 30 }]);
  const c2 = await mk('assign B ' + stamp, [{ particulars: 'Tomato', quantity: 9, unit: 'crate', price: 474 }]);
  ok('two chits created', !!c1 && !!c2);
  if (!c1 || !c2) { process.exitCode = 1; return; }

  const get = async (tok, id) => (await j('/api/chits/' + id, { token: tok })).b || {};
  const d1 = await get(A, c1), d2 = await get(A, c2);
  const ids1 = (d1.live_set || []).map((e) => e.line_id);
  const ids2 = (d2.live_set || []).map((e) => e.line_id);
  ok('lines carry ids (b142)', ids1.length === 2 && !!ids1[0] && !!ids2[0]);

  console.log('\n1 · hand each line to somebody, with a task and a date');
  const MURUGAN = eid(A);   // a real uuid; the roster join is not what is under test here
  const a1 = await j('/api/chits/' + c1 + '/assign-lines', { method: 'POST', token: A, body: { edits: [
    { line_id: ids1[0], assignee_actor_id: MURUGAN, assignee_name: 'Murugan', assignee_type: 'human', task: 'packing', due_date: '2026-08-16' },
    { line_id: ids1[1], assignee_actor_id: null, assignee_name: null, task: 'sourcing' } ] } });
  ok('assign accepted', a1.status === 200, 'status ' + a1.status + ' ' + JSON.stringify(a1.b).slice(0, 200));
  await j('/api/chits/' + c2 + '/assign-lines', { method: 'POST', token: A, body: { edits: [
    { line_id: ids2[0], assignee_actor_id: MURUGAN, assignee_name: 'Murugan', assignee_type: 'human', task: 'loading', due_date: '2026-08-16' } ] } });

  const withAssign = await get(A, c1);
  const map = withAssign.line_assignment || {};
  eq('★ the line knows who has it', (map[ids1[0]] || {}).assignee_name, 'Murugan');
  eq('★ …and what they are doing', (map[ids1[0]] || {}).task, 'packing');
  ok('★ an explicit UNASSIGN is a real state, not an absent row',
     Object.prototype.hasOwnProperty.call(map, ids1[1]) && map[ids1[1]].assignee_actor_id === null,
     JSON.stringify(map[ids1[1]]));

  console.log('\n2 · reassignment keeps the history');
  await j('/api/chits/' + c1 + '/assign-lines', { method: 'POST', token: A, body: { edits: [
    { line_id: ids1[0], assignee_actor_id: MURUGAN, assignee_name: 'Selvam', assignee_type: 'human', task: 'packing', due_date: '2026-08-16', note: 'Murugan off' } ] } });
  const re = (await get(A, c1)).line_assignment || {};
  eq('★★ Selvam holds it now', (re[ids1[0]] || {}).assignee_name, 'Selvam');
  eq('★★ …and it remembers Murugan had it', ((re[ids1[0]] || {}).history || []).map((h) => h.assignee_name), ['Murugan']);
  eq('  seq advanced server-side', (re[ids1[0]] || {}).seq, 2);

  console.log('\n3 · ⭐⭐ THE COUNTERPARTY SEES NONE OF IT');
  const theirs = await get(B, c1);
  ok('★ they hold their own copy of the chit', !!theirs.header);
  eq('★★ …with NO line_assignment at all', theirs.line_assignment, undefined);
  const theirList = await j('/api/folders/worklist', { token: B });
  eq('★★ …and their work list is empty of my people', ((theirList.b || {}).people || []).length, 0);
  /* ⚠️ THE POINT. Who does the work is headcount, capacity and who is behind — disclosing it would leak the
     seller's internal operation to the buyer. Delivery crosses; assignment does not. */

  console.log('\n4 · ⭐ the work list — one person, every chit');
  const wl = await j('/api/folders/worklist?due_on=2026-08-16', { token: A });
  ok('worklist answers', wl.status === 200, 'status ' + wl.status);
  const sel = ((wl.b || {}).people || []).find((p) => p.name === 'Selvam');
  const mur = ((wl.b || {}).people || []).find((p) => p.name === 'Murugan');
  ok('★★ Selvam\'s line is on his list', sel && sel.lines.some((l) => l.chit_id === c1), JSON.stringify(sel));
  ok('★★ Murugan still has the OTHER chit\'s line — assembled ACROSS chits', mur && mur.lines.some((l) => l.chit_id === c2), JSON.stringify(mur));
  /* ⚠️ A reassigned line must appear on exactly ONE list. Two people picking the same crate means one customer
     gets nothing, and the picking list is where that error would be born. */
  ok('★★ the reassigned line is NOT still on Murugan\'s list',
     !mur || !mur.lines.some((l) => l.line_id === ids1[0]), JSON.stringify(mur && mur.lines));

  console.log('\n5 · a removed line is not work anybody owes');
  await j('/api/chits/' + c2 + '/amend', { method: 'POST', token: A, body: { edits: [
    { line_index: 0, line_id: ids2[0], line: null, reason_code: 'stock_unavailable' } ] } });
  const wl2 = await j('/api/folders/worklist?due_on=2026-08-16', { token: A });
  const mur2 = ((wl2.b || {}).people || []).find((p) => p.name === 'Murugan');
  ok('★★ the struck line drops off the picking list', !mur2 || !mur2.lines.some((l) => l.chit_id === c2),
     'still listed — someone would go looking for cancelled goods');

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + pass + ' passed, ' + fail + ' failed\x1b[0m');
  console.log('  chits left for inspection: ' + c1 + ' · ' + c2 + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
