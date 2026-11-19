/**
 * tests/assign-gaps-undo.test.cjs — Undo of a follow-up hand-over: lib/crm-followups restoreFollowups over previous[] (through rerouteFollowups, the one mover). No database: a stand-in shop.
 *
 * HAND-COMPUTED: A held f1, f2 and f3 (f3 now done); B held f4; all four were handed to C (f3 done since). previous = f1:A f2:A f3:A f4:B plus a chit entry.
 *   -> f1, f2 go back to A (2 moved), f4 back to B (1 moved) = 3 moved; f3 is skipped ALREADY_DONE; the chit entry is not ours (ignored); an unknown id is NOT_FOUND
 *   -> a target who is view-only now (V) refuses by name TARGET_CANNOT_HOLD and the follow-up stays where it is
 *   -> an entry already with its previous holder moves nothing and says nothing; previous null -> moved 0
 *   -> the writer is rerouteFollowups: the UPDATE runs once per (current, previous) group with the id list (A,C->A: 1 statement, B: 1) = 2 statements for 3 moves
 * Run: node tests/assign-gaps-undo.test.cjs
 * CARD 01-rail-core-the-chit/assign
 */
'use strict';
process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = '';
const assert = require('assert');
const F = require('../lib/crm-followups');
const OWNER = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', V = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const rows = [{ id: id(1), holder: C, done: false }, { id: id(2), holder: C, done: false }, { id: id(3), holder: C, done: true }, { id: id(4), holder: C, done: false }, { id: id(5), holder: C, done: false }];
let updates = 0;
const handle = { query: async (sql, args) => {
  if (/to_regclass/.test(sql)) return { rows: [{ f: true, i: true, ok: true }] };
  if (/SELECT followup_id::text AS id/.test(sql)) return { rows: rows.filter((r) => args[1].includes(r.id)).map((r) => ({ id: r.id, holder: r.holder, done_at: r.done ? 'x' : null })) };
  if (/^SELECT identity_id FROM identities WHERE/.test(sql)) return { rows: args[0].map((x) => ({ identity_id: x })) }; /* the team read: everyone is on the team */
  if (/^SELECT identity_id, break_status FROM identities/.test(sql)) return { rows: args[0] === V ? [] : [{ identity_id: args[0], break_status: 'active' }] }; /* V is view-only: the one assignable rule finds no holder */
  if (/UPDATE party_followup SET assignee_user_id/.test(sql)) { updates++; const m = rows.filter((r) => !r.done && r.holder === args[1] && args[3].includes(r.id)); m.forEach((r) => { r.holder = args[2]; }); return { rowCount: m.length, rows: [] }; }
  throw new Error('stand-in does not know: ' + sql.slice(0, 80));
} };
F.migrated = async () => true;
(async () => {
  const r = await F.restoreFollowups(handle, OWNER, [
    { followup_id: id(1), plug: 'followup', actor_id: A }, { followup_id: id(2), plug: 'followup', actor_id: A }, { followup_id: id(3), plug: 'followup', actor_id: A },
    { followup_id: id(4), plug: 'followup', actor_id: B }, { chit_id: id(90), plug: 'client', actor_id: A }, { followup_id: id(99), plug: 'followup', actor_id: A }, { followup_id: id(5), plug: 'followup', actor_id: V }
  ]);
  assert.strictEqual(r.moved, 3, 'f1 f2 -> A, f4 -> B = 3');
  assert.strictEqual(rows[0].holder, A); assert.strictEqual(rows[1].holder, A); assert.strictEqual(rows[3].holder, B);
  assert.strictEqual(rows[2].holder, C, 'the done one stays');
  assert.strictEqual(rows[4].holder, C, 'the view-only target changed nothing');
  const codes = r.skipped.map((s) => s.followup_id.slice(-2) + ':' + s.code).sort();
  assert.deepStrictEqual(codes, ['03:ALREADY_DONE', '05:TARGET_CANNOT_HOLD', '99:NOT_FOUND']);
  assert.strictEqual(updates, 2, 'one statement per (current > previous) group');
  const again = await F.restoreFollowups(handle, OWNER, [{ followup_id: id(1), actor_id: A }]);
  assert.deepStrictEqual(again, { moved: 0, skipped: [] }, 'already back: silent');
  assert.deepStrictEqual(await F.restoreFollowups(handle, OWNER, null), { moved: 0, skipped: [] });
  /* back to the pool: previous actor null, from a holder */
  const pool = await F.restoreFollowups(handle, OWNER, [{ followup_id: id(4), actor_id: null }]);
  assert.strictEqual(pool.moved, 1); assert.strictEqual(rows[3].holder, null);
  /* S22: an entry that names who it expects to hold the follow-up refuses when someone else holds it (409, nothing moved); an entry that names nobody is not checked */
  const before = updates;
  await assert.rejects(F.restoreFollowups(handle, OWNER, [{ followup_id: id(1), actor_id: B, expected_holder: C }]), (e) => e.status === 409 && e.code === 'STALE_FOLLOWUP');
  assert.strictEqual(updates, before, 'a stale Undo moves nothing');
  assert.strictEqual((await F.restoreFollowups(handle, OWNER, [{ followup_id: id(1), actor_id: B, expected_holder: A }])).moved, 1, 'the expected holder: moves');
  console.log('  ok  restoreFollowups: 3 moved, 3 named skips, one statement per group, pool target');
  console.log('4 checks');
})().catch((e) => { console.error(e); process.exit(1); });
