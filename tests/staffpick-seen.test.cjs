#!/usr/bin/env node
// @type: unit
/**
 * tests/staffpick-seen.test.cjs — STAFFPICK (Athi 21 Nov): under the firm's switch `assigned` a staff seat of the practice reaches the clients it holds PLUS the clients nobody holds; never a client another staff member holds.
 * The partner (owner) and a manager still see everyone. ONE rule: grants.liveAmong (the list) and grants.finalOutcome (a direct read) both ask lib/assign-register holds/holdsAmong.
 * HAND-COMPUTED  a firm with a partner and two staff (A, B) and 150 clients: A holds 8 (c000-c007), B holds 5 (c008-c012), 137 unassigned (c013-c149).
 *   A's list = 8 + 137 = 145 · B's list = 5 + 137 = 142 · the partner's list = 150 (the held test is skipped, no statement) · a manager = 150.
 *   A reading c008 (B's client) directly = not_assigned (refused) · A reading c020 (unassigned) = allowed · A reading c003 (own) = allowed.
 *   A picks up c020 and c021 (the ONE writer puts A on their job chits) → A's list = 10 mine + 135 unassigned = 145, mine = 10; B now reads c020 = not_assigned (B's list 140); the partner still 150.
 *   Someone else holds it meanwhile: B picks c030 first, then A's read of c030 = not_assigned and A's list = 144 (the refusal in words is assign-bulk's ASSIGN_HELD_BY_OTHER, checked below by its text).
 *   Switch `all` (the stand-in answers everyone: true) = every one of the 150 for A, as before. No actor = nothing (fail closed).
 * The stand-in database answers the register's statements from a holder table; it reads the predicate FROM THE SQL TEXT (a holder who is not the actor and not null), so a change of the SQL's rule changes the answer.
 * It does not run Postgres: the real-statement run is tests/assign1.realstack.cjs on a SIT box.
 * OWNS the offline checks of the staff-seen rule.   CALLED BY scripts/guards.cjs.   CARD 01-rail-core-the-chit/assign
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const path = require('path');
const fs = require('fs');
const grants = require(path.join(__dirname, '..', 'lib', 'books-grant.js'));
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) pass++; else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };

const FIRM = '11111111-1111-4111-8111-111111111111', A = '33333333-3333-4333-8333-333333333333', B = '44444444-4444-4444-8444-444444444444';
const idOf = (n) => '9000000' + String(n).padStart(4, '0') + '-0000-4000-8000-000000000000';
const CLIENTS = Array.from({ length: 150 }, (unused, n) => idOf(n));
const holder = new Map(); /* subject → actor id (an open job chit's holder); absent = no holder */
CLIENTS.slice(0, 8).forEach((c) => holder.set(c, A));
CLIENTS.slice(8, 13).forEach((c) => holder.set(c, B));
let switchOff = false, statements = 0;
/** the stand-in: answers holdsAmong ("AS everyone") and holds ("AS ok") from the holder table, by the predicate the SQL text carries */
const db = { query: async (sql, params) => {
  statements++;
  const actor = params[1];
  const byOther = /cs\.assigned_to_actor_id IS NOT NULL AND cs\.assigned_to_actor_id <> \$2::uuid/.test(sql); /* the rule, read from the statement */
  const blocked = (subject) => !!actor && byOther && holder.has(subject) && holder.get(subject) !== actor;
  if (/AS everyone/.test(sql)) return { rows: [{ everyone: switchOff, held: switchOff || !actor || !byOther ? [] : params[4].filter((m) => !blocked(m)) }] };
  return { rows: [{ ok: switchOff || (!!actor && byOther && !blocked(String(params[4]))) }] };
} };
const rowOf = (subject) => ({ grant_id: 'g-' + subject, grantor_entity: subject, grantee_entity: FIRM, preset: 'adviser', revoked_at: null, unexpired: true, edge_live: true });
const ROWS = CLIENTS.map(rowOf);
const asStaff = (actor) => ({ method: 'GET', listed: true, actor });
const countFor = async (request) => (await grants.liveAmong(db, ROWS, request)).kept.length;
const mineFor = async (request) => (await grants.liveAmong(db, ROWS, request)).kept.filter((r) => holder.get(r.grantor_entity) === request.actor).length;

(async () => {
  check('the harness: 8 + 5 held, 137 unassigned = 150', CLIENTS.length === 150 && [...holder.values()].filter((v) => v === A).length === 8 && [...holder.values()].filter((v) => v === B).length === 5 && 150 - holder.size === 137);
  check('staff A sees 145 (8 mine + 137 unassigned), B sees 142 (5 + 137)', (await countFor(asStaff(A))) === 145 && (await countFor(asStaff(B))) === 142);
  check('the partner sees 150 and a manager sees 150, with no held statement at all', await (async () => { statements = 0; const o = await countFor({ method: 'GET', listed: true, actor: FIRM, owner: true }); const m = await countFor({ method: 'GET', listed: true, actor: B, manager: true }); return o === 150 && m === 150 && statements === 0; })());
  check("A's direct read of one of B's clients (c008) is refused: not_assigned", (await grants.finalOutcome(db, rowOf(CLIENTS[8]), asStaff(A))) === 'not_assigned');
  check('A reads an unassigned client (c020) and an own client (c003): allowed', (await grants.finalOutcome(db, rowOf(CLIENTS[20]), asStaff(A))) === 'allowed' && (await grants.finalOutcome(db, rowOf(CLIENTS[3]), asStaff(A))) === 'allowed');
  check("the list and the direct read agree for every one of the 150 (one rule): A's kept set = the allowed set", await (async () => { const kept = new Set((await grants.liveAmong(db, ROWS, asStaff(A))).kept.map((r) => r.grantor_entity)); for (const c of CLIENTS) if (kept.has(c) !== ((await grants.finalOutcome(db, rowOf(c), asStaff(A))) === 'allowed')) return false; return true; })());
  holder.set(CLIENTS[20], A); holder.set(CLIENTS[21], A); /* A picks up two (the ONE writer, lib/assign-bulk, does this on the job chits) */
  check('A picks up 2: mine 10, still 145 in all (135 unassigned)', (await mineFor(asStaff(A))) === 10 && (await countFor(asStaff(A))) === 145);
  check('B no longer reaches c020 (A holds it now, B sees 140); the partner still sees 150', (await grants.finalOutcome(db, rowOf(CLIENTS[20]), asStaff(B))) === 'not_assigned' && (await countFor({ method: 'GET', listed: true, actor: FIRM, owner: true })) === 150 && (await countFor(asStaff(B))) === 140);
  holder.set(CLIENTS[30], B); /* B got there first */
  check('B picked c030 meanwhile: A is refused it, on a read and in the list (144 now)', (await grants.finalOutcome(db, rowOf(CLIENTS[30]), asStaff(A))) === 'not_assigned' && (await countFor(asStaff(A))) === 144);
  check('no actor: nothing is reached (fail closed)', (await countFor({ method: 'GET', listed: true, actor: null })) === 0);
  switchOff = true;
  check('switch `all`: every one of the 150 for A, as before', (await countFor(asStaff(A))) === 150);
  /* ── release and hand over (Athi 21 Nov, the ONE writer lib/assign-bulk: its gate staffGateIn decides, the move is assign-chit's) ── */
  switchOff = false;
  const assignBulk = require(path.join(__dirname, '..', 'lib', 'assign-bulk.js'));
  const owner = require(path.join(__dirname, '..', 'lib', 'owner.js'));
  let pickUp = 'on'; /* the firm's pick-up switch */
  const gateDb = { query: async (sql, params) => (/staff_pick_up/.test(sql) ? { rows: [{ v: pickUp }] } : { rows: params[1].map((c) => ({ assigned_to_actor_id: holder.get(c) || null })) }) }; /* the chit copies of the named clients (a client id stands for its job chit) */
  const seat = (id) => ({ identity: { identity_id: id, identity_type: 'actor', parent_entity_id: FIRM, hat: 'act', access_level: 'editor' } });
  const partner = { identity: { identity_id: FIRM, identity_type: 'entity' } };
  const gate = (who, ids, target) => assignBulk.staffGateIn(gateDb, who, FIRM, { plug: 'client', target_actor_id: target }, ids).then(() => 'ok', (e) => e.code);
  for (const c of CLIENTS) holder.delete(c);
  CLIENTS.slice(0, 8).forEach((c) => holder.set(c, A));
  CLIENTS.slice(8, 13).forEach((c) => holder.set(c, B));
  const unassigned = () => CLIENTS.filter((c) => !holder.has(c)).length;
  check('a seat may try a release (target null) and a hand-over, the partner is no staff, a key is not a seat', assignBulk.staffMayTry(seat(A), { target_actor_id: null }) && assignBulk.staffMayTry(seat(A), { target_actor_id: B }) && !assignBulk.staffMayTry(partner, { target_actor_id: B }) && !assignBulk.staffMayTry(seat(A), {}));
  check('the partner is the owner level: mayAt manager passes, so the staff gate is never asked', owner.mayAt(partner, 'manager').ok && !owner.mayAt(seat(A), 'manager').ok);
  check('A releases 3 of its own (c000-c002): the gate passes, unassigned goes 137 → 140', await (async () => { const before = unassigned(); if ((await gate(seat(A), CLIENTS.slice(0, 3), null)) !== 'ok') return false; CLIENTS.slice(0, 3).forEach((c) => holder.delete(c)); return before === 137 && unassigned() === 140 && (await mineFor(asStaff(A))) === 5; })());
  check('A hands 1 (c003) to B: the gate passes, B sees it and A no longer does', await (async () => { if ((await gate(seat(A), [CLIENTS[3]], B)) !== 'ok') return false; holder.set(CLIENTS[3], B); const a = (await grants.liveAmong(db, ROWS, asStaff(A))).kept.map((r) => r.grantor_entity), b = (await grants.liveAmong(db, ROWS, asStaff(B))).kept.map((r) => r.grantor_entity); return b.includes(CLIENTS[3]) && !a.includes(CLIENTS[3]) && (await mineFor(asStaff(B))) === 6; })());
  check("B cannot release A's client (c004): refused whole, ASSIGN_HELD_BY_OTHER, nothing moved; nor hand it on", (await gate(seat(B), [CLIENTS[4]], null)) === 'ASSIGN_HELD_BY_OTHER' && (await gate(seat(B), [CLIENTS[4]], B)) === 'ASSIGN_HELD_BY_OTHER' && holder.get(CLIENTS[4]) === A);
  check('a batch with ONE of another staff member clients among A own is refused whole', (await gate(seat(A), [CLIENTS[4], CLIENTS[8]], null)) === 'ASSIGN_HELD_BY_OTHER');
  pickUp = 'off';
  check('pick-up switch off: taking an unassigned client is refused ASSIGN_PICKUP_OFF, but releasing or handing over your own is not', (await gate(seat(A), [CLIENTS[40]], A)) === 'ASSIGN_PICKUP_OFF' && (await gate(seat(A), [CLIENTS[4]], null)) === 'ok' && (await gate(seat(A), [CLIENTS[5]], B)) === 'ok');
  pickUp = 'on';
  check('the partner reassigns any client to anyone (c008 from B to A): no staff gate, the holder becomes A, B loses it', await (async () => { if (assignBulk.staffMayTry(partner, { target_actor_id: A })) return false; holder.set(CLIENTS[8], A); return (await grants.finalOutcome(db, rowOf(CLIENTS[8]), asStaff(B))) === 'not_assigned' && (await grants.finalOutcome(db, rowOf(CLIENTS[8]), asStaff(A))) === 'allowed'; })());
  const writer = fs.readFileSync(path.join(__dirname, '..', 'lib', 'assign-bulk.js'), 'utf8');
  check("every move writes the task path's own history: moveOne puts an 'assigned' state_log line (Picked up · Bulk-assigned · Returned to the pool) through assignChit, no second writer", /INSERT INTO state_log/.test(writer) && /Returned to the pool by/.test(writer) && /Bulk-assigned to/.test(writer) && /Picked up by/.test(writer) && /assignChit[(]client/.test(writer));
  const bulk = fs.readFileSync(path.join(__dirname, '..', 'lib', 'assign-bulk.js'), 'utf8');
  check('the pick-up is assign-bulk (the ONE writer); a client held meanwhile is refused in words (ASSIGN_HELD_BY_OTHER)', /ASSIGN_HELD_BY_OTHER/.test(bulk) && /Someone else already holds one of these/.test(bulk) && !/UPDATE chit_status/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'assign-register.js'), 'utf8')));
  console.log('\n' + (pass + fail) + ' checks (' + pass + ' passed, ' + fail + ' failed)');
  process.exit(fail ? 1 : 0);
})();
