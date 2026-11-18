/**
 * tests/assign-holds.test.cjs — ASSIGN-NET L11 + L9: what a person holds, hand over all, my work. No database: a stand-in shop (rows in memory) answers the statements.
 *
 * HAND-COMPUTED (the lane's sentence, not a read-back of the code):
 *   A holds 3 clients + 2 follow-ups, hands over all to B   -> B holds 5, A holds 0, previous[] has 5 entries (3 chit, 2 follow-up), no skips
 *   the same to a view-only V                                -> nothing moves, 5 named skips (code TARGET_CANNOT_HOLD), the holder still holds 5, previous[] empty
 *   back to the pool (to null)                               -> 5 moved, the holder holds 0, previous 5
 *   a closed (completed) chit A holds is NOT held             -> not counted, not moved
 *   my work: A holds 3 clients + 2 follow-ups                -> total 5, plugs client 3 + followup 2, rows newest first
 *   the ONE writer: the module never writes chit_status itself (source scan of lib/assign-holds.js)
 * Run: node tests/assign-holds.test.cjs
 * CARD 01-rail-core-the-chit/assign
 */
'use strict';
const fs = require('fs');
const path = require('path');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
let pass = 0;
let fail = 0;
const check = (name, ok, extra) => {
  if (ok) pass++;
  else {
    fail++;
    console.log('  FAIL ' + name + (extra ? '\n       ' + extra : ''));
  }
};
const FIRM = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const V = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

/* the shop: 3 open client jobs + 1 closed client job held by A, 2 open follow-ups + 1 done held by A */
const chits = [1, 2, 3].map((n) => ({ chit_id: id(n), holder: A, status: 'pending', plug: 'client', subject: id(100 + n), at: '2026-11-1' + n }));
chits.push({ chit_id: id(4), holder: A, status: 'completed', plug: 'client', subject: id(104), at: '2026-11-10' });
const fups = [
  { followup_id: id(11), holder: A, done: false, what: 'call', at: '2026-11-15' },
  { followup_id: id(12), holder: A, done: false, what: 'chase', at: '2026-11-16' },
  { followup_id: id(13), holder: A, done: true, what: 'old', at: '2026-11-01' }
];
const open = (row) => row.status !== 'completed';
const team = [
  { id: A, display_name: 'Anna' },
  { id: B, display_name: 'Ben' },
  { id: V, display_name: 'Vee (view only)' }
];
const heldBy = (actor) => chits.filter((row) => row.holder === actor && open(row));

/* the stand-in connection: answers by the statement's own words */
const client = {
  query: async (sql, args) => {
    if (/FROM identities WHERE parent_entity_id/.test(sql)) return { rows: team };
    if (/to_regclass/.test(sql)) return { rows: [{ i: true, f: true }] };
    if (/unnest\(\$2::uuid\[\]\)/.test(sql)) {
      const by = {};
      for (const actor of args[1]) for (const row of heldBy(actor)) by[actor + '|' + row.plug] = (by[actor + '|' + row.plug] || 0) + 1;
      return { rows: Object.keys(by).map((key) => ({ actor_id: key.split('|')[0], plug: key.split('|')[1], n: by[key] })) };
    }
    if (/COUNT\(\*\)::int AS n FROM party_followup/.test(sql)) {
      const by = {};
      for (const row of fups.filter((item) => !item.done && item.holder)) by[row.holder] = (by[row.holder] || 0) + 1;
      return { rows: Object.keys(by).filter((actor) => args[1].includes(actor)).map((actor) => ({ actor_id: actor, n: by[actor] })) };
    }
    if (/cs\.current_status AS status/.test(sql)) {
      return { rows: heldBy(args[0]).sort((x, y) => y.at.localeCompare(x.at)).map((row) => ({ chit_id: row.chit_id, plug: row.plug, status: row.status, assigned_at: row.at, subject: 'Job ' + row.chit_id.slice(-2), subject_id: row.subject })) };
    }
    if (/SELECT cs\.chit_id, /.test(sql)) return { rows: heldBy(args[0]).map((row) => ({ chit_id: row.chit_id, plug: row.plug, subject_id: row.subject })) };
    if (/SELECT followup_id, what, party_id/.test(sql)) return { rows: fups.filter((row) => row.holder === args[1] && !row.done).map((row) => ({ followup_id: row.followup_id, what: row.what, party_id: null, updated_at: row.at })) };
    if (/SELECT followup_id FROM party_followup/.test(sql)) return { rows: fups.filter((row) => row.holder === args[1] && !row.done).map((row) => ({ followup_id: row.followup_id })) };
    if (/UPDATE party_followup SET assignee_user_id/.test(sql)) {
      const moved = fups.filter((row) => row.holder === args[1] && !row.done);
      moved.forEach((row) => {
        row.holder = args[2];
      });
      return { rowCount: moved.length, rows: [] };
    }
    throw new Error('stand-in does not know: ' + sql.slice(0, 90));
  }
};

/* the db, and the ONE writer's stand-in (its own behaviour is assign-bulk's tests): a view-only target is the writer's own 400; otherwise the holder changes */
const db = require('../db');
db.withEntity = async (entity, fn) => fn(client);
const bulk = require('../lib/assign-bulk');
const writerCalls = [];
bulk.bulkAssign = async (req) => {
  writerCalls.push(req.body);
  if (req.body.target_actor_id === V) throw Object.assign(new Error('Target co-assist not found, not on shift, or not allowed to hold this work (a task needs someone who can edit)'), { status: 400 });
  const moved = chits.filter((row) => req.body.chit_ids.includes(row.chit_id));
  const previous = moved.map((row) => ({ chit_id: row.chit_id, subject_id: undefined, actor_id: row.holder || null }));
  moved.forEach((row) => {
    row.holder = req.body.target_actor_id;
  });
  return { assigned: moved.map((row) => row.chit_id), skipped: [], previous };
};
const followups = require('../lib/crm-followups');
followups.migrated = async () => true;
followups.mustBeAssignable = async (handle, owner, person) => {
  if (person === V) throw Object.assign(new Error('That person can only view, so cannot hold a follow-up.'), { status: 400, code: 'ASSIGNEE_VIEW_ONLY' });
};
const auth = require('../middleware/auth');
auth.entityOf = () => FIRM;
const holds = require('../lib/assign-holds');
const req = { identity: { identity_id: FIRM, display_name: 'Firm', identity_type: 'entity' }, body: {} };

(async () => {
  /* holds: A has 3 clients + 2 follow-ups = 5; the closed job and the done follow-up are not held */
  const before = await holds.holdsAnswer(FIRM, null);
  const anna = before.people.find((person) => person.actor_id === A);
  check('holds: A total 5', anna && anna.total === 5, JSON.stringify(anna));
  check('holds: A = client 3 + followup 2', anna && anna.plugs.some((p) => p.plug === 'client' && p.count === 3) && anna.plugs.some((p) => p.plug === 'followup' && p.count === 2) && anna.followups === 2);
  check('holds: B and V (holding nothing) are not listed in the all-people answer', before.people.length === 1);
  const one = await holds.holdsAnswer(FIRM, B);
  check('holds: one person asked for is answered with zeros', one.people.length === 1 && one.people[0].total === 0 && one.people[0].plugs.length === 0);

  /* my work: 5, newest first */
  const mine = await holds.myWork(client, FIRM, A, 50);
  check('my work: total 5 = the Holds count', mine.total === 5 && mine.total === anna.total);
  check('my work: per plug client 3 + followup 2', mine.by_plug.some((p) => p.plug === 'client' && p.count === 3) && mine.by_plug.some((p) => p.plug === 'followup' && p.count === 2));
  const order = mine.rows.map((row) => row.assigned_at);
  check('my work: newest first', mine.rows.length === 5 && order.every((value, at) => !at || order[at - 1] >= value), order.join(','));
  check('my work: a client row names its client, a follow-up its words', mine.rows.some((row) => row.plug === 'client' && row.subject_id === id(103)) && mine.rows.some((row) => row.kind === 'followup' && row.subject === 'chase'));

  /* hand over all A -> B */
  const done = await holds.handOverAll(req, { from: A, to: B, note: 'leave' });
  check('hand over to B: 5 moved, no skips', done.moved === 5 && done.skipped.length === 0, JSON.stringify(done));
  check('hand over to B: previous has 5 (3 chit + 2 follow-up), each says A', done.previous.length === 5 && done.previous.filter((p) => p.chit_id).length === 3 && done.previous.filter((p) => p.followup_id).length === 2 && done.previous.every((p) => p.actor_id === A));
  check('hand over to B: a client previous carries its client', done.previous.filter((p) => p.chit_id).every((p) => p.subject_id && p.plug === 'client'));
  const after = await holds.holdsAnswer(FIRM, null);
  const ben = after.people.find((person) => person.actor_id === B);
  check('after: B holds 5, A holds 0 (not listed)', ben && ben.total === 5 && !after.people.some((person) => person.actor_id === A));
  check('the closed job did not move (still A, completed)', chits.find((row) => row.chit_id === id(4)).holder === A && !writerCalls.some((body) => body.chit_ids.includes(id(4))));
  check('the writer was the ONE assign-bulk, with the target and the note', writerCalls.length === 1 && writerCalls[0].target_actor_id === B && writerCalls[0].note === 'leave');
  check('names: from Anna to Ben', done.from === 'Anna' && done.to === 'Ben');

  /* B -> view-only V: all 5 named skips, nothing moves */
  const refused = await holds.handOverAll(req, { from: B, to: V });
  check('to view-only V: 0 moved, 5 skips, all coded', refused.moved === 0 && refused.skipped.length === 5 && refused.skipped.every((skip) => skip.code === 'TARGET_CANNOT_HOLD' && skip.reason), JSON.stringify(refused.skipped.map((skip) => skip.code)));
  check('to view-only V: 3 chits + 2 follow-ups named', refused.skipped.filter((skip) => skip.chit_id).length === 3 && refused.skipped.filter((skip) => skip.followup_id).length === 2);
  check('to view-only V: previous is empty and B still holds 5', refused.previous.length === 0 && (await holds.holdsAnswer(FIRM, B)).people[0].total === 5);

  /* B -> the pool */
  const pooled = await holds.handOverAll(req, { from: B, to: null });
  check('to the pool: 5 moved, to null, previous 5', pooled.moved === 5 && pooled.to === null && pooled.previous.length === 5);
  check('to the pool: B holds 0', (await holds.holdsAnswer(FIRM, B)).people[0].total === 0);

  /* refusals */
  let err;
  try {
    await holds.handOverAll(req, { from: id(999), to: B });
  } catch (e) {
    err = e;
  }
  check('a stranger is 404 ACTOR_NOT_FOUND', err && err.status === 404 && err.code === 'ACTOR_NOT_FOUND');
  err = null;
  try {
    await holds.handOverAll(req, { from: A, to: A });
  } catch (e) {
    err = e;
  }
  check('to oneself is 400', err && err.status === 400);

  /* the ONE writer: this module writes no holder itself */
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'assign-holds.js'), 'utf8');
  check('no second writer: no UPDATE chit_status, no SET assigned_to_actor_id in assign-holds.js', !/UPDATE\s+chit_status/i.test(source) && !/SET\s+assigned_to_actor_id/i.test(source));
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'chits-holds.js'), 'utf8');
  check('holds and hand-over-all are behind managerGate; my-work is not', /router\.get\('\/holds', auth, managerGate\(\)/.test(route) && /router\.post\('\/hand-over-all', auth, managerGate\(\)/.test(route) && /router\.get\('\/my-work', auth, checked/.test(route));

  /* the contract: every route declares its seats; the manager doors refuse a plain seat and fail closed; a body with an extra key or a bad id is refused by the schema */
  const contract = require('../lib/chits-holds-contract');
  const matrix = require('../lib/role-matrix');
  const seatsOf = (route) => contract.operationFor(route)['x-seats'];
  check('contract: three routes, each with well-formed seats', ['GET /holds', 'GET /my-work', 'POST /hand-over-all'].every((route) => contract.operationFor(route) && !matrix.problemsOf(seatsOf(route)).length));
  check('refusal path: holds and hand-over-all deny a plain staff seat, an adviser and an auditor (fail closed); my-work allows every signed-in seat', ['GET /holds', 'POST /hand-over-all'].every((route) => seatsOf(route).staff === 'manager' && seatsOf(route).adviser === 'deny' && seatsOf(route).auditor === 'deny') && seatsOf('GET /my-work').staff === 'allow');
  const ownerLib = require('../lib/owner');
  check('fail closed: a plain actor is refused by the same gate assign-bulk uses (mayAt manager)', !ownerLib.mayAt({ identity: { identity_type: 'actor', parent_entity_id: FIRM, hat: 'act' } }, 'manager').ok);
  const bodySchema = contract.operationFor('POST /hand-over-all').requestBody.content['application/json'].schema;
  check('contract: from_actor_id is required, an extra key is refused, to_actor_id may be null (the pool)', bodySchema.required.includes('from_actor_id') && bodySchema.additionalProperties === false && JSON.stringify(bodySchema.properties.to_actor_id).includes('null'));

  console.log('assign-holds: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log(e);
  process.exit(1);
});
