'use strict';
/**
 * tests/assign1.realstack.cjs — ASSIGN-1 on a REAL server and a REAL Postgres (RLS on, as cb_app): the job chit opener, the widened assign-bulk, the W3 gate and the holds() gate of the books look, and (sections 9-17, cb-accounting) the practice list and the baseline under the switch: holders, exclusion from rows and totals, byte for byte under `all` (T1 T2 T4 T7 T8 T9 T10 T11 T12, W12 acct1).
 *
 * HAND-COMPUTED (N clients C0..C{N-1}, all network members of the firm P with a live adviser grant; D is linked but gave nothing; X is nobody's; staff of P: A act, B act, M manager, V view only):
 *   1 T14   V and A (hat view / act) open a job: 403 CHIT_NOT_PERMITTED and ZERO job chits exist; M (manager) opens C0: opened 1.
 *   2 T15   the owner opens all N: opened N-1, existing 1, then again: opened 0, existing N, and the firm's job chits are still N.
 *   3 S35   [C0, unknown, X, D]: existing 1; unknown and X answer THE SAME skip code and sentence (JOB_CLIENT_NOT_YOURS); D answers JOB_ROLE_NOT_GRANTED.
 *   4       a client holds a received copy with no holder; the firm's sent copy sits at delivered; nothing of the holder is in the client's rows.
 *   5 T18   mode least_loaded, M on break, A and B at 0: open period p2 for 10 clients: A 5 and B 5.
 *   6 T19   mode default_assignee = A: open period p3 for 10 clients: A holds all 10.
 *   7       bulk by subject: M hands C0..C2's open jobs (3 clients x 3 periods = 9 copies) to B with a note: assigned 9, the note is in the log; A (act) asking the same is refused WHOLE (403) and nothing moves;
 *           an unknown subject = JOB_NOT_OPEN; target null returns C0 to the pool.
 *   8 T13   the firm switch absent: B opens C7 (A holds it): looks logged 'allowed' (W12 untouched). Switch `assigned`: B on C7 = 403 BOOKS_GRANT_NOT_ASSIGNED and a 'not_assigned' log row; B on C8 (B holds) allowed;
 *           A on C7 allowed; the owner on C7 allowed. 'banana' = assigned (fail closed); 'all' = open again. The firm's copy closed (T17) = B loses C8.
 * Run: DATABASE_URL=postgres://cb_app:cbapp@127.0.0.1:55421/cb_a1 JWT_SECRET=... node tests/assign1.realstack.cjs --base http://127.0.0.1:3611   (the server's PORT and CB_SELF_URL point at the same base; a throwaway database on a SIT box)
 * CARD 01-rail-core-the-chit/assign
 */
const path = require('path');
const jsonWebToken = require('jsonwebtoken');
const API = path.join(__dirname, '..');
const arg = (name) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : null; };
const BASE = arg('--base');
const OLD = arg('--old'); /* optional: a pre-change server on the SAME database, for the byte-for-byte rows */
const N = Number(arg('--n') || process.env.A1_N || 12);
if (!BASE || !process.env.DATABASE_URL || !process.env.JWT_SECRET) { console.error('needs --base, DATABASE_URL (cb_app, throwaway) and JWT_SECRET'); process.exit(3); }
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(process.env.DATABASE_URL);
if (!parts || parts[1] !== 'cb_app' || !/^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/.test(parts[2])) { console.error('REFUSED: cb_app on localhost or a SIT host only'); process.exit(3); }
process.env.NODE_ENV = 'test';
const networkService = require(path.join(API, 'src', 'services', 'network'));
const { query, withEntity } = require(path.join(API, 'db'));
const grants = require(path.join(API, 'lib', 'books-grant.js'));

let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 500) : '')); } };
const RUN = 'a1' + (Date.now() % 1e9).toString(36).padStart(6, '0');
const tokenFor = (claims) => jsonWebToken.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

async function business(tag) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [identity] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'IN', 'INR', $3) RETURNING identity_id, display_name`, [bridgeId, 'A1 ' + tag + ' ' + RUN, bridgeId.toLowerCase()]);
  return { id: identity.identity_id, bridgeId, name: identity.display_name, node: await networkService.nodeOf(identity.identity_id, { ensure: true }), token: tokenFor({ identity_id: identity.identity_id, identity_type: 'entity', bridge_id: bridgeId, display_name: identity.display_name }) };
}
async function person(firm, tag, hat, level) {
  const { rows: [row] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, parent_entity_id, country, currency_code, user_id, access_level, whole_entity, can_see_costs, hat) VALUES ($1, $2, 'actor', $3, 'IN', 'INR', $4, $5, true, true, $6) RETURNING identity_id, display_name`, [firm.bridgeId + tag, 'Staff ' + tag + ' ' + RUN, firm.id, (firm.bridgeId + tag).toLowerCase(), level || 'editor', hat]);
  return { id: row.identity_id, name: row.display_name, token: tokenFor({ identity_id: row.identity_id, identity_type: 'actor', bridge_id: firm.bridgeId, display_name: row.display_name, parent_entity_id: firm.id }) };
}
async function call(token, method, route, body, headers, base) {
  const res = await fetch((base || BASE) + route, { method, headers: Object.assign({ 'content-type': 'application/json', authorization: 'Bearer ' + token }, headers || {}), body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch (e) { /* no body */ }
  return { status: res.status, body: json };
}
const link = async (parent, child) => { const asked = await networkService.requestConnect({ parentId: parent.node.id, childId: child.node.id }, parent.node); await networkService.approve({ edgeId: asked.id }, child.node); };
const grantAdviser = (client, firm) => withEntity(client.id, (db) => db.query(`INSERT INTO books_access_grant (grantor_entity, grantee_entity, preset, can_see_costs, purpose, granted_by, expires_at) VALUES ($1, $2, 'adviser', false, 'assign1 test', $1, now() + interval '1 year')`, [client.id, firm.id]));
const settings = (firm, set) => withEntity(firm.id, (db) => db.query(`INSERT INTO entity_actor_settings (entity_id, assignment_model, auto_assign_mode, default_assignee_actor_id, default_max_tasks) VALUES ($1, 'both', $2, $3, 100) ON CONFLICT (entity_id) DO UPDATE SET auto_assign_mode = EXCLUDED.auto_assign_mode, default_assignee_actor_id = EXCLUDED.default_assignee_actor_id, default_max_tasks = 100`, [firm.id, set.mode, set.dflt || null]));
const switchTo = (firm, value) => withEntity(firm.id, (db) => db.query(`UPDATE entity_actor_settings SET client_access = $2 WHERE entity_id = $1`, [firm.id, value]));
const heldBy = (firm, actorId, period) => withEntity(firm.id, async (db) => (await db.query(`SELECT count(*)::int n FROM chit_status cs JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id WHERE cs.entity_id = $1 AND cs.direction = 'sent' AND cs.assigned_to_actor_id = $2 AND ch.business_json -> 'job' ->> 'period' = $3`, [firm.id, actorId, period])).rows[0].n);
const jobCount = (firm) => withEntity(firm.id, async (db) => (await db.query(`SELECT count(*)::int n FROM chit_header WHERE entity_id = $1 AND business_json ? 'job'`, [firm.id])).rows[0].n);
const open = (token, ids, period, extra) => call(token, 'POST', '/api/chits/jobs/open', Object.assign({ plug: 'client', role: 'adviser', period, subject_ids: ids }, extra || {}));
const logOf = async (client, actorId) => (await grants.looks(client.id, { limit: 200 })).filter((row) => row.actor_identity_id === actorId);
const lookAt = (token, client) => call(token, 'GET', '/api/books/accounts', null, { 'x-books-for': client.id, 'x-books-role': 'adviser' });

(async () => {
  const P = await business('p');
  const C = [];
  for (let n = 0; n < N; n++) { const c = await business('c' + n); await link(P, c); await grantAdviser(c, P); C.push(c); }
  const D = await business('d'); await link(P, D);
  const X = await business('x');
  const A = await person(P, 'a', 'act'), B = await person(P, 'b', 'act'), M = await person(P, 'm', 'manager'), V = await person(P, 'v', 'view_only', 'viewer');
  await withEntity(P.id, (db) => db.query(`UPDATE identities SET max_tasks = 100 WHERE identity_id = ANY($1::uuid[])`, [[A.id, B.id, M.id]])); /* the cap is the business's own number (D3): raised so the counts below are the rule's, not the cap's */
  const UNKNOWN = '99999999-9999-4999-8999-999999999999';
  const ids = C.map((c) => c.id);
  await settings(P, { mode: 'off' });
  console.log('world: firm + ' + N + ' clients + D + X; staff A B M V');

  /* 1 T14 */
  for (const [who, person_] of [['V (view_only)', V], ['A (act)', A]]) {
    const r = await open(person_.token, [ids[0]], 'standing');
    ok('1 T14: ' + who + ' is refused 403 in the Problem shape' + (person_ === A ? ' with CHIT_NOT_PERMITTED' : ' (the read-only level answers first)'), r.status === 403 && r.body && typeof r.body.status === 'number' && (person_ !== A || r.body.code === 'CHIT_NOT_PERMITTED'), JSON.stringify(r));
  }
  ok('1 T14: nothing was opened by the refused calls', (await jobCount(P)) === 0);
  const m1 = await open(M.token, [ids[0]], 'standing');
  ok('1 the manager opens C0: 200, opened 1, existing 0, assigned 0 (mode off), no skip', m1.status === 200 && m1.body.opened === 1 && m1.body.existing === 0 && m1.body.assigned === 0 && m1.body.skipped.length === 0 && m1.body.jobs.length === 1, JSON.stringify(m1));
  const anon = await fetch(BASE + '/api/chits/jobs/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  ok('1 no sign-in is 401', anon.status === 401);
  ok('1 a body naming both or neither of subject_ids / filter is 422 INVALID_INPUT', (await call(P.token, 'POST', '/api/chits/jobs/open', { plug: 'client', role: 'adviser', period: 'standing' })).status === 422 && (await call(P.token, 'POST', '/api/chits/jobs/open', { plug: 'client', role: 'adviser', period: 'standing', subject_ids: [ids[0]], filter: { list: 'practice' } })).status === 422);
  ok('1 an extra key is refused 422', (await call(P.token, 'POST', '/api/chits/jobs/open', { plug: 'client', role: 'adviser', period: 'standing', subject_ids: [ids[0]], holder: A.id })).status === 422);

  /* 2 T15 */
  const t1 = await open(P.token, ids, 'standing');
  ok('2 T15: the owner opens all ' + N + ': opened ' + (N - 1) + ', existing 1, nothing skipped', t1.status === 200 && t1.body.opened === N - 1 && t1.body.existing === 1 && t1.body.skipped.length === 0 && t1.body.jobs.length === N, JSON.stringify(t1.body).slice(0, 300));
  const t2 = await open(P.token, ids, 'standing');
  ok('2 T15: again: opened 0, existing ' + N + ', assigned 0', t2.status === 200 && t2.body.opened === 0 && t2.body.existing === N && t2.body.assigned === 0);
  ok('2 T15: the firm still holds exactly ' + N + ' job chits', (await jobCount(P)) === N);
  ok('2 the answer carries no holder, no name (a closed allowlist)', !/assigned_to|holder|display_name/.test(JSON.stringify(t2.body)) && Object.keys(t2.body).sort().join() === 'assigned,existing,jobs,opened,skipped');
  const filt = await call(P.token, 'POST', '/api/chits/jobs/open', { plug: 'client', role: 'adviser', period: 'standing', filter: { list: 'practice', without_job: true } });
  ok('2 a filter "without a job" finds none left: opened 0, existing 0', filt.status === 200 && filt.body.opened === 0 && filt.body.existing === 0 && filt.body.skipped.length === 0, JSON.stringify(filt));
  const filt2 = await call(P.token, 'POST', '/api/chits/jobs/open', { plug: 'client', role: 'adviser', period: 'standing', filter: { list: 'practice' } });
  ok('2 a filter naming the whole practice list answers every client as existing', filt2.status === 200 && filt2.body.existing === N, JSON.stringify(filt2.body).slice(0, 200));

  /* 3 S35 */
  const mix = await open(P.token, [ids[0], UNKNOWN, X.id, D.id], 'standing');
  const sk = (id) => mix.body.skipped.find((item) => item.subject_id === id);
  ok('3 S35: existing 1; unknown and X answer THE SAME code and sentence; D answers JOB_ROLE_NOT_GRANTED', mix.status === 200 && mix.body.existing === 1 && sk(UNKNOWN) && sk(X.id) && sk(UNKNOWN).code === 'JOB_CLIENT_NOT_YOURS' && sk(UNKNOWN).code === sk(X.id).code && sk(UNKNOWN).reason === sk(X.id).reason && sk(D.id).code === 'JOB_ROLE_NOT_GRANTED', JSON.stringify(mix.body));
  ok('3 nothing was opened for the skipped (still ' + N + ' job chits)', (await jobCount(P)) === N);

  /* 4 copies */
  const received = await withEntity(C[1].id, async (db) => (await db.query(`SELECT cs.assigned_to_actor_id, cs.direction, cs.current_status, ch.purpose FROM chit_status cs JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id WHERE cs.entity_id = $1 AND ch.business_json ? 'job'`, [C[1].id])).rows);
  ok('4 the client holds ONE received copy of purpose general with no holder', received.length === 1 && received[0].direction === 'received' && received[0].purpose === 'general' && received[0].assigned_to_actor_id === null, JSON.stringify(received));
  const sent = await withEntity(P.id, async (db) => (await db.query(`SELECT cs.direction, cs.current_status FROM chit_status cs JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id WHERE cs.entity_id = $1 AND ch.business_json ? 'job' AND ch.business_json ->> 'client_ref' = $2`, [P.id, 'job:client:adviser:' + ids[1] + ':standing'])).rows);
  ok('4 the firm\'s copy is SENT at delivered, one row', sent.length === 1 && sent[0].direction === 'sent' && sent[0].current_status === 'delivered', JSON.stringify(sent));

  /* 5 T18 */
  await withEntity(P.id, (db) => db.query(`UPDATE identities SET break_status = 'short_break' WHERE identity_id = $1`, [M.id]));
  await settings(P, { mode: 'least_loaded' });
  const r5 = await open(P.token, ids.slice(0, 10), 'p2');
  const a5 = await heldBy(P, A.id, 'p2'), b5 = await heldBy(P, B.id, 'p2');
  ok('5 T18: least_loaded, two assistants, open 10: assigned 10, A holds 5 and B holds 5', r5.body.opened === 10 && r5.body.assigned === 10 && a5 === 5 && b5 === 5, 'A ' + a5 + ' B ' + b5 + ' ' + JSON.stringify(r5.body).slice(0, 200));

  /* 6 T19 */
  await settings(P, { mode: 'default_assignee', dflt: A.id });
  const r6 = await open(P.token, ids.slice(0, 10), 'p3');
  ok('6 T19: default_assignee A, open 10: A holds all 10', r6.body.opened === 10 && r6.body.assigned === 10 && (await heldBy(P, A.id, 'p3')) === 10, JSON.stringify(r6.body).slice(0, 200));

  /* 7 bulk */
  const sub = ids.slice(0, 3);
  const bulkAsA = await call(A.token, 'POST', '/api/chits/assign-bulk', { plug: 'client', role: 'adviser', subject_ids: sub, target_actor_id: B.id });
  ok('7 W3: A (act) naming the plug is refused WHOLE: 403 CHIT_NOT_PERMITTED', bulkAsA.status === 403 && bulkAsA.body.code === 'CHIT_NOT_PERMITTED', JSON.stringify(bulkAsA));
  const oneJob = await withEntity(P.id, async (db) => (await db.query(`SELECT cs.chit_id FROM chit_status cs JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id WHERE cs.entity_id = $1 AND cs.direction = 'sent' AND ch.business_json ->> 'client_ref' = $2`, [P.id, 'job:client:adviser:' + ids[5] + ':p3'])).rows[0].chit_id);
  const listedAsA = await call(A.token, 'POST', '/api/chits/assign-bulk', { chit_ids: [oneJob], target_actor_id: B.id });
  ok('7 W3: A listing a job chit by id is refused WHOLE too (the answer never depends on the ids)', listedAsA.status === 403 && listedAsA.body.code === 'CHIT_NOT_PERMITTED', JSON.stringify(listedAsA));
  ok('7 W3: nothing moved (A still holds its 10 p3 jobs)', (await heldBy(P, A.id, 'p3')) === 10);
  const preHeld = await withEntity(P.id, async (db) => (await db.query(`SELECT count(*)::int n FROM chit_status cs JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id WHERE cs.entity_id = $1 AND cs.direction = 'sent' AND cs.assigned_to_actor_id = $2 AND ch.business_json ->> 'client_ref' LIKE ANY($3::text[])`, [P.id, B.id, sub.map((id) => 'job:client:adviser:' + id + ':%')])).rows[0].n);
  const bulk = await call(M.token, 'POST', '/api/chits/assign-bulk', { plug: 'client', role: 'adviser', subject_ids: sub.concat([UNKNOWN]), target_actor_id: B.id, note: 'hand over ' + RUN });
  ok('7 M hands C0..C2 (3 clients x 3 periods = 9 copies) to B: assigned 3 clients (copies 9: the answer counts clients, 18 Nov A3), one skip for the unknown, NAMED by the opener own reason (not your client)', bulk.status === 200 && bulk.body.assigned === 3 && bulk.body.copies === 9 && bulk.body.previous.length > 0 && bulk.body.previous.length <= 9 && bulk.body.assigned_to === B.name && bulk.body.skipped.length === 1 && bulk.body.skipped[0].code === 'JOB_CLIENT_NOT_YOURS' && bulk.body.skipped[0].subject_id === UNKNOWN, JSON.stringify(bulk));
  const note = await withEntity(P.id, async (db) => (await db.query(`SELECT count(*)::int n FROM state_log WHERE entity_id = $1 AND action = 'assigned' AND detail LIKE $2`, [P.id, '%hand over ' + RUN + '%'])).rows[0].n);
  ok('7 the note is in the assigning entity own log once per copy that MOVED (9 minus the ' + preHeld + ' B already held: no change, no cost, no row)', note === 9 - preHeld, 'rows ' + note + ' preHeld ' + preHeld);
  const pool = await call(M.token, 'POST', '/api/chits/assign-bulk', { plug: 'client', role: 'adviser', subject_ids: [ids[0]], target_actor_id: null });
  ok('7 target null returns the set to the pool: assigned_to null, C0\'s 3 copies hold nobody', pool.status === 200 && pool.body.assigned_to === null && pool.body.assigned === 1 && pool.body.copies === 3 && (await withEntity(P.id, async (db) => (await db.query(`SELECT count(*)::int n FROM chit_status cs JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id WHERE cs.entity_id = $1 AND cs.direction = 'sent' AND cs.assigned_to_actor_id IS NULL AND ch.business_json ->> 'client_ref' LIKE $2`, [P.id, 'job:client:adviser:' + ids[0] + ':%'])).rows[0].n)) === 3, JSON.stringify(pool));
  const single = await call(A.token, 'PUT', '/api/actors/assign/' + oneJob, { action: 'return' });
  const singleHolder = await call(A.token, 'PUT', '/api/actors/assign/' + oneJob, { action: 'push', target_actor_id: B.id, note: 'over to you' });
  ok('7 single door: A is the CURRENT holder of C5\'s p3 job, so A may hand it over (200) ; a non-holder act is refused', single.status === 200 && singleHolder.status === 403, JSON.stringify([single, singleHolder]).slice(0, 300));

  /* 9 W1 (cb-people): ONE assignable rule. Z = hat audit, level commenter (an auditor-seat assistant); Y = hat act but level viewer (the hat and the level disagree) */
  const Z = await person(P, 'z', 'audit', 'commenter'), Y = await person(P, 'y', 'act', 'viewer');
  await settings(P, { mode: 'off' });
  const toZ = await call(M.token, 'POST', '/api/chits/assign-bulk', { plug: 'client', role: 'adviser', subject_ids: [ids[0]], target_actor_id: Z.id, note: 'read-only seat ' + RUN });
  ok('9 W1: M hands the jobs of C0 to Z (auditor seat, commenter): 200, assigned 3, nothing skipped', toZ.status === 200 && toZ.body.assigned === 1 && toZ.body.copies === 3 && toZ.body.skipped.length === 0, JSON.stringify(toZ).slice(0, 300));
  ok('9 W1: Z now HOLDS those 3 jobs (chit_status.assigned_to_actor_id)', (await withEntity(P.id, async (db) => (await db.query(`SELECT count(*)::int n FROM chit_status cs JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id WHERE cs.entity_id = $1 AND cs.direction = 'sent' AND cs.assigned_to_actor_id = $2 AND ch.business_json ? 'job'`, [P.id, Z.id])).rows[0].n)) === 3);
  const oneZ = await withEntity(P.id, async (db) => (await db.query(`SELECT cs.chit_id FROM chit_status cs WHERE cs.entity_id = $1 AND cs.assigned_to_actor_id = $2 LIMIT 1`, [P.id, Z.id])).rows[0].chit_id);
  const viaPush = await call(M.token, 'PUT', '/api/actors/assign/' + oneZ, { action: 'push', target_actor_id: Y.id });
  ok('9 A5: the single door refuses to push a job to Y (level viewer, a view-only seat): 400, and Y holds nothing', viaPush.status === 400, JSON.stringify(viaPush).slice(0, 200));
  const toY = await call(M.token, 'POST', '/api/chits/assign-bulk', { plug: 'client', role: 'adviser', subject_ids: [ids[1]], target_actor_id: Y.id, note: 'view-only ' + RUN });
  ok('9 A5: assign-bulk to the view-only seat Y is refused: 400, nothing written', toY.status === 400, JSON.stringify(toY).slice(0, 200));
  const writes = await call(Z.token, 'POST', '/api/forms/any-form/issue', {}), editorWrites = await call(A.token, 'POST', '/api/forms/any-form/issue', {});
  ok('9 W1: Z holds jobs and still cannot WRITE: a write door (access.writeGate) is 403 for Z, and not 403 for the editor A (the level answers, not the job)', writes.status === 403 && editorWrites.status !== 403, JSON.stringify([writes, editorWrites]).slice(0, 300));
  const asDefault = await call(P.token, 'PUT', '/api/actors/settings', { auto_assign_mode: 'default_assignee', default_assignee_actor_id: Z.id });
  ok('9 W1: but a read-only person is NOT a default assignee of TASKS (the task rule is an editor): 400', asDefault.status === 400, JSON.stringify(asDefault).slice(0, 200));
  const asEditor = await call(P.token, 'PUT', '/api/actors/settings', { auto_assign_mode: 'off', default_assignee_actor_id: A.id });
  ok('9 W1: an editor (A) still is: 200', asEditor.status === 200, JSON.stringify(asEditor).slice(0, 200));
  const list = await call(M.token, 'GET', '/api/actors?limit=100');
  ok('9 A2: GET /api/actors carries the verdict: the manager may_assign true and may_take true, the assistant A both false (staff taking stays off)', list.body.may_assign === true && list.body.may_take === true && (await call(A.token, 'GET', '/api/actors?limit=100')).body.may_assign === false, JSON.stringify([list.body.may_assign, list.body.may_take]));
  const swBad = await call(P.token, 'PUT', '/api/actors/settings', { client_access: 'nobody' }), swStaff = await call(A.token, 'PUT', '/api/actors/settings', { client_access: 'assigned' });
  ok('9 A1: PUT /api/actors/settings client_access: a bad word 400, a staff member 403', swBad.status === 400 && swStaff.status === 403, JSON.stringify([swBad.status, swStaff.status]));
  const swOn = await call(P.token, 'PUT', '/api/actors/settings', { client_access: 'assigned' }), swRead = await call(P.token, 'GET', '/api/actors/settings');
  ok('9 A1: the owner sets the switch to assigned through the route: 200 and GET reads it back as assigned', swOn.status === 200 && swOn.body.settings.client_access === 'assigned' && swRead.body.settings.client_access === 'assigned', JSON.stringify([swOn.status, swRead.body.settings && swRead.body.settings.client_access]));
  const swOff = await call(P.token, 'PUT', '/api/actors/settings', { client_access: 'all' });
  ok('9 A1: and back to all through the route: 200, reads all', swOff.status === 200 && swOff.body.settings.client_access === 'all', JSON.stringify(swOff.status));
  const flag = (who) => (list.body.actors || []).find((row) => row.identity_id === who.id);
  ok('9 W1: the list answers the rule, so the web does not compute it: A editor true/true, Z commenter false/true, Y (hat act, level viewer) false/false (A5: a view-only seat holds no client)',
    flag(A) && flag(A).assignable === true && flag(A).job_assignable === true && flag(Z) && flag(Z).assignable === false && flag(Z).job_assignable === true && flag(Y) && flag(Y).assignable === false && flag(Y).job_assignable === false,
    JSON.stringify([flag(A), flag(Z), flag(Y)].map((row) => row && [row.assignable, row.job_assignable])));

  /* 8 T13 + the gate */
  await settings(P, { mode: 'off' });
  const clearAll = await call(M.token, 'POST', '/api/chits/assign-bulk', { plug: 'client', role: 'adviser', subject_ids: ids, target_actor_id: null, note: 'start clean' });
  ok('8 setup: every client back in the pool in one call (target null)', clearAll.status === 200 && clearAll.body.assigned_to === null && clearAll.body.skipped.length === 0, JSON.stringify(clearAll.body).slice(0, 300));
  await call(M.token, 'POST', '/api/chits/assign-bulk', { plug: 'client', role: 'adviser', subject_ids: [ids[7]], target_actor_id: A.id });
  await call(M.token, 'POST', '/api/chits/assign-bulk', { plug: 'client', role: 'adviser', subject_ids: [ids[8]], target_actor_id: B.id });
  const outcomes = async (client, actor) => (await logOf(client, actor.id)).map((row) => row.outcome);
  const b7 = await lookAt(B.token, C[7]);
  ok('8 T13 / W12: the switch absent: B (not the holder of C7) is NOT refused as unassigned, and the look is logged allowed', b7.status !== 403 && (await outcomes(C[7], B)).includes('allowed') && !(await outcomes(C[7], B)).includes('not_assigned'), JSON.stringify(b7).slice(0, 200));
  await switchTo(P, 'assigned');
  const b7b = await lookAt(B.token, C[7]);
  ok('8 assigned: B on C7 (A holds it) is 403 BOOKS_GRANT_NOT_ASSIGNED with the sentence', b7b.status === 403 && b7b.body.code === 'BOOKS_GRANT_NOT_ASSIGNED' && /not assigned to you/.test(b7b.body.detail || b7b.body.message || ''), JSON.stringify(b7b));
  ok('8 assigned: the refusal left an outcome not_assigned log row, 403', (await logOf(C[7], B.id)).some((row) => row.outcome === 'not_assigned' && Number(row.status) === 403));
  const b8 = await lookAt(B.token, C[8]);
  ok('8 assigned: B on C8 (B holds it) is let through (not 403)', b8.status !== 403 && b8.status !== 401, JSON.stringify(b8).slice(0, 200));
  ok('8 assigned: A on C7 is let through; the owner on C7 is let through', (await lookAt(A.token, C[7])).status !== 403 && (await lookAt(P.token, C[7])).status !== 403);
  await switchTo(P, 'banana');
  ok('8 fail closed: a garbage switch value reads as assigned', (await lookAt(B.token, C[7])).status === 403 && (await lookAt(B.token, C[8])).status !== 403);
  await switchTo(P, 'all');
  ok('8 the value `all` opens it again for B on C7', (await lookAt(B.token, C[7])).status !== 403);
  await switchTo(P, 'assigned');
  await withEntity(P.id, (db) => db.query(`UPDATE chit_status SET current_status = 'cancelled' WHERE entity_id = $1 AND direction = 'sent' AND chit_id IN (SELECT chit_id FROM chit_header WHERE entity_id = $1 AND business_json ->> 'client_ref' LIKE $2)`, [P.id, 'job:client:adviser:' + ids[8] + ':%']));
  ok('8 T17: when the firm\'s copy is closed the holder loses access (F2 default): B on C8 is now 403', (await lookAt(B.token, C[8])).status === 403);
  await switchTo(P, null);

  /* ═══ ACCT-1 · the practice list and the baseline under the switch (cb-accounting, 17 Nov): sections 9-17 ═══════════════════════════════════════════════════════════════════════════════════ */
  const grantAs = (client, firm, preset) => withEntity(client.id, (db) => db.query(`INSERT INTO books_access_grant (grantor_entity, grantee_entity, preset, can_see_costs, purpose, granted_by, expires_at) VALUES ($1, $2, $3, $4, 'assign1 acct test', $1, now() + interval '1 year')`, [client.id, firm.id, preset, preset === 'auditor']));
  const practiceOf = (token) => call(token, 'GET', '/api/books-grants/practice');
  const idsOf = (res) => ((res.body && res.body.clients) || []).map((c) => c.entity_id).sort();
  const sortIds = (list) => list.map((c) => c.id).sort();
  const volatile = (res) => JSON.stringify(res.body, (key, value) => (key === 'last_look' || key === 'today' ? undefined : value));
  const toPool = () => call(M.token, 'POST', '/api/chits/assign-bulk', { plug: 'client', role: 'adviser', subject_ids: ids, target_actor_id: null, note: 'acct1 reset' });
  const give = (subjects, who) => call(M.token, 'POST', '/api/chits/assign-bulk', { plug: 'client', role: 'adviser', subject_ids: subjects.map((c) => c.id), target_actor_id: who.id });
  await switchTo(P, null);
  await toPool();
  /* hand-computed: A holds C0..C4 (5), B holds C5..C7 (3); C8 closed its copy at T17 (no open job), C9..C{N-1} never assigned: unheld = N - 8 */
  await give(C.slice(0, 5), A); await give(C.slice(5, 8), B);
  const unheld = N - 8, aSet = sortIds(C.slice(0, 5).concat(C.slice(8))), bSet = sortIds(C.slice(5, 8).concat(C.slice(8))), allSet = sortIds(C); /* STAFFPICK (Athi 21 Nov): under `assigned` a seat reads its own clients AND the unheld ones (to pick up) */

  /* 9 W12 acct1: switch `all` = today's answer, byte for byte */
  const allP = await practiceOf(P.token), allA = await practiceOf(A.token), allB = await practiceOf(B.token);
  ok('9 W12 acct1, switch all: the partner reads all ' + N + ' clients and an assistant who holds few still reads all ' + N + ' (A and B alike)', allP.status === 200 && allP.body.total === N && allA.status === 200 && allA.body.total === N && allB.body.total === N && JSON.stringify(idsOf(allA)) === JSON.stringify(allSet), JSON.stringify([allP.status, allA.status, allB.body && allB.body.total]));
  ok('9 switch all: holders are sent all the same (A1, 18 Nov): every client row has the key and the 8 held ones name their holder', allP.body.clients.every((c) => Array.isArray(c.holders)) && allP.body.clients.filter((c) => c.holders.length).length === 8, JSON.stringify(allP.body.clients.filter((c) => c.holders.length).length));
  ok('9 A2: the practice answer carries the server verdict: the partner may_assign true, may_take false (holds nothing); an assistant both false', allP.body.may_assign === true && allP.body.may_take === false && allA.body.may_assign === false && allA.body.may_take === false, JSON.stringify([allP.body.may_assign, allP.body.may_take, allA.body.may_assign, allA.body.may_take]));
  const bAll = await call(B.token, 'POST', '/api/books-grants/practice/baseline', { client: C[0].id, seen_to: new Date(Date.now() - 1000).toISOString() });
  ok('9 W12, switch all: B marks C0 (held by A) as checked: 201, the keys client / made_at / seen_to only', bAll.status === 201 && Object.keys(bAll.body).sort().join() === 'client,made_at,seen_to', JSON.stringify(bAll));
  if (OLD) {
    const oldP = await call(P.token, 'GET', '/api/books-grants/practice', null, null, OLD), oldA = await call(A.token, 'GET', '/api/books-grants/practice', null, null, OLD);
    ok('9 BYTE FOR BYTE: under switch all the new server\'s practice answer equals the pre-change server\'s on the same data (partner and assistant; only last_look and today, which move with the clock, left out)', oldP.status === 200 && volatile(oldP) === volatile(allP) && volatile(oldA) === volatile(allA), 'old ' + volatile(oldP).length + ' new ' + volatile(allP).length);
    const oldBase = await call(B.token, 'POST', '/api/books-grants/practice/baseline', { client: C[0].id, seen_to: new Date(Date.now() - 1000).toISOString() }, null, OLD);
    ok('9 BYTE FOR BYTE: the baseline answer has the same status and the same keys on both servers', oldBase.status === bAll.status && Object.keys(oldBase.body).sort().join() === Object.keys(bAll.body).sort().join());
  } else console.log('  skip 9 byte-for-byte against the pre-change server: no --old base given');

  /* 10 T1: switch assigned */
  await switchTo(P, 'assigned');
  const looksOnC6 = (await logOf(C[6], A.id)).length; /* the switch-all lists above DID log A on every client; from here only the held and the unheld ones (C6 is B's) */
  const pP = await practiceOf(P.token), pA = await practiceOf(A.token), pB = await practiceOf(B.token), pM = await practiceOf(M.token);
  ok('10 T1: assigned: A reads C0..C4 and the ' + unheld + ' unheld (total ' + (5 + unheld) + '), B C5..C7 and the unheld (total ' + (3 + unheld) + '); never a client another seat holds', pA.body.total === 5 + unheld && JSON.stringify(idsOf(pA)) === JSON.stringify(aSet) && pB.body.total === 3 + unheld && JSON.stringify(idsOf(pB)) === JSON.stringify(bSet), JSON.stringify([pA.status, pA.body && pA.body.total, pB.body && pB.body.total]));
  ok('10 T1: the partner (the firm owner) reads all ' + N + ' and sees the ' + unheld + ' unheld as holders []', pP.body.total === N && pP.body.clients.filter((c) => Array.isArray(c.holders) && c.holders.length === 0).length === unheld, JSON.stringify(pP.body && pP.body.total));
  const holder = (res, id) => ((res.body.clients.find((c) => c.entity_id === id) || {}).holders || []).map((h) => h.name).join();
  ok('10 the holder column names who holds each client: C0 = A, C6 = B, C9 = nobody', holder(pP, C[0].id) === A.name && holder(pP, C[6].id) === B.name && holder(pP, C[9].id) === '', holder(pP, C[0].id) + '|' + holder(pP, C[6].id));
  ok('10 the assistant\'s own list names only the assistant as holder (an unheld client names nobody)', pA.body.clients.every((c) => c.holders.length === 0 || (c.holders.length === 1 && c.holders[0].name === A.name)));
  ok('10 the band is over the kept clients only (A\'s band: no number above ' + (5 + unheld) + ', never N)', Object.values(pA.body.band).filter((v) => typeof v === 'number').every((v) => v <= 5 + unheld), JSON.stringify(pA.body.band).slice(0, 300));
  ok('10 an unassigned client is NOT counted as ended (ended is access that ran out: 0)', pA.body.ended === 0 && pP.body.ended === 0);
  ok('10 the list wrote look rows only for the clients it showed: A\'s list left no NEW look on C6 (B holds it) and an allowed one on C0', (await logOf(C[6], A.id)).length === looksOnC6 && (await logOf(C[0], A.id)).some((row) => row.outcome === 'allowed'));
  console.log('  info 10 M (a manager, not the firm owner) reads ' + (pM.body && pM.body.total) + ' clients under assigned (status ' + pM.status + '); not asserted: whether a manager sees the whole practice is the coordinator\'s call');
  const bNo = await call(B.token, 'POST', '/api/books-grants/practice/baseline', { client: C[0].id, seen_to: new Date(Date.now() - 1000).toISOString() });
  const bYes = await call(B.token, 'POST', '/api/books-grants/practice/baseline', { client: C[5].id, seen_to: new Date(Date.now() - 1000).toISOString() });
  const bOwner = await call(P.token, 'POST', '/api/books-grants/practice/baseline', { client: C[0].id, seen_to: new Date(Date.now() - 1000).toISOString() });
  ok('10 baseline under assigned: B marks C0 (A holds it): 403 BOOKS_GRANT_NONE; B marks C5 (B holds it): 201; the owner marks C0: 201', bNo.status === 403 && bNo.body.code === 'BOOKS_GRANT_NONE' && bYes.status === 201 && bOwner.status === 201, JSON.stringify([bNo, bYes.status, bOwner.status]).slice(0, 300));
  await switchTo(P, 'banana');
  ok('10 fail closed: a garbage switch value cuts the list the same way (A ' + (5 + unheld) + ', B ' + (3 + unheld) + ')', (await practiceOf(A.token)).body.total === 5 + unheld && (await practiceOf(B.token)).body.total === 3 + unheld);
  await switchTo(P, 'assigned');

  /* 11 T2: A opens one of B's clients */
  const tBoth = await lookAt(A.token, C[6]);
  ok('11 T2: A opens C6 (B holds it): 403 BOOKS_GRANT_NOT_ASSIGNED in words; the log has a not_assigned row for A', tBoth.status === 403 && tBoth.body.code === 'BOOKS_GRANT_NOT_ASSIGNED' && /not assigned to you/.test(tBoth.body.detail || tBoth.body.message || '') && (await logOf(C[6], A.id)).some((row) => row.outcome === 'not_assigned' && Number(row.status) === 403), JSON.stringify(tBoth));

  /* 12 T4: the manager reassigns 4 of A's to B */
  const copiesOf = (who, subjects) => withEntity(P.id, async (db) => (await db.query(`SELECT count(*)::int n FROM chit_status cs JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id WHERE cs.entity_id = $1 AND cs.direction = 'sent' AND cs.assigned_to_actor_id = $2 AND ch.business_json ->> 'client_ref' LIKE ANY($3::text[])`, [P.id, who.id, subjects.map((c) => 'job:client:adviser:' + c.id + ':%')])).rows[0].n);
  const four = C.slice(0, 4), moving = await copiesOf(A, four);
  const moved = await call(M.token, 'POST', '/api/chits/assign-bulk', { plug: 'client', role: 'adviser', subject_ids: four.map((c) => c.id), target_actor_id: B.id, note: 'T4 ' + RUN });
  const logged = await withEntity(P.id, async (db) => (await db.query(`SELECT count(*)::int n FROM state_log WHERE entity_id = $1 AND action = 'assigned' AND detail LIKE $2`, [P.id, '%T4 ' + RUN + '%'])).rows[0].n);
  const t4A = await practiceOf(A.token), t4B = await practiceOf(B.token);
  ok('12 T4: the manager moves 4 of A\'s to B: assigned = the copies A held of those 4 (' + moving + '), and the same number of state_log rows carry the note', moved.status === 200 && moved.body.copies === moving && moving > 0 && logged === moving, JSON.stringify([moved.body && moved.body.assigned, moving, logged]));
  ok('12 T4: A now reads C4 and the ' + unheld + ' unheld, B reads C0..C3, C5..C7 and the unheld; the partner still reads ' + N, t4A.body.total === 1 + unheld && JSON.stringify(idsOf(t4A)) === JSON.stringify(sortIds([C[4]].concat(C.slice(8)))) && t4B.body.total === 7 + unheld && (await practiceOf(P.token)).body.total === N, JSON.stringify([t4A.body.total, t4B.body.total]));
  ok('12 T4: A opening any of the 4 moved: 403 BOOKS_GRANT_NOT_ASSIGNED; B opens them', (await Promise.all(four.map((c) => lookAt(A.token, c)))).every((r) => r.status === 403 && r.body.code === 'BOOKS_GRANT_NOT_ASSIGNED') && (await lookAt(B.token, C[0])).status !== 403);

  /* 13 T8 + T9 */
  const fake = Array.from({ length: 201 }, (_, n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0'));
  const before8 = await jobCount(P);
  const big = await call(M.token, 'POST', '/api/chits/assign-bulk', { plug: 'client', role: 'adviser', subject_ids: fake, target_actor_id: B.id });
  const bigOpen = await open(P.token, fake, 'standing');
  ok('13 T8: 201 subjects in one call: assign-bulk 400 CHIT_TOO_MANY, jobs/open 400 CHIT_TOO_MANY too (the opener cap, as the contract says); nothing written', big.status === 400 && big.body.code === 'CHIT_TOO_MANY' && bigOpen.status === 400 && bigOpen.body.code === 'CHIT_TOO_MANY' && (await jobCount(P)) === before8, JSON.stringify([big.status, big.body && big.body.code, bigOpen.status, bigOpen.body && bigOpen.body.code]));
  const heldChit = await withEntity(P.id, async (db) => (await db.query(`SELECT cs.chit_id FROM chit_status cs WHERE cs.entity_id = $1 AND cs.direction = 'sent' AND cs.assigned_to_actor_id = $2 AND cs.current_status NOT IN ('cancelled','closed','void') LIMIT 1`, [P.id, A.id])).rows[0]);
  if (heldChit) {
    const pull = await call(B.token, 'PUT', '/api/actors/assign/' + heldChit.chit_id, { action: 'pull' });
    console.log('  info 13 T9: B pulls a job A holds: status ' + pull.status + ' ' + JSON.stringify(pull.body).slice(0, 160) + ' (recorded; the requirement wants a "take over?" question, not built)');
  }

  /* 14 T7: the cap */
  const R = await business('r'); const E = await person(R, 'e', 'act');
  await withEntity(R.id, (db) => db.query(`UPDATE identities SET max_tasks = 10 WHERE identity_id = $1`, [E.id]));
  const RC = [];
  for (let n = 0; n < 12; n++) { const c = await business('rc' + n); await link(R, c); await grantAdviser(c, R); RC.push(c); }
  await settings(R, { mode: 'off' });
  await call(R.token, 'POST', '/api/chits/jobs/open', { plug: 'client', role: 'adviser', period: 'standing', subject_ids: RC.map((c) => c.id) });
  const capped = await call(R.token, 'POST', '/api/chits/assign-bulk', { plug: 'client', role: 'adviser', subject_ids: RC.map((c) => c.id), target_actor_id: E.id });
  ok('14 T7 (d, 18 Nov): max_tasks 10, the partner assigns 12 single-job clients to E: assigned 12, skipped 0 (a job is not a task: no cap), and the task count stays 0', capped.status === 200 && capped.body.assigned === 12 && capped.body.skipped.length === 0 && (await withEntity(R.id, async (db) => (await db.query(`SELECT current_task_count n FROM identities WHERE identity_id = $1`, [E.id])).rows[0].n)) === 0, JSON.stringify(capped.body).slice(0, 300));

  /* 14b (d, 18 Nov): N clients, a seat with max_tasks = 10 holds N job chits (N = 150 on SIT); a task still counts and the cap still stops tasks */
  const W = await business('w'); const S = await person(W, 's', 'act');
  await withEntity(W.id, (db) => db.query(`UPDATE identities SET max_tasks = 10 WHERE identity_id = $1`, [S.id]));
  const WC = [];
  for (let n = 0; n < N; n++) { const c = await business('wc' + n); await link(W, c); await grantAdviser(c, W); WC.push(c); }
  await settings(W, { mode: 'off' });
  await withEntity(W.id, (db) => db.query(`UPDATE entity_actor_settings SET default_max_tasks = 10 WHERE entity_id = $1`, [W.id]));
  const wOpen = await call(W.token, 'POST', '/api/chits/jobs/open', { plug: 'client', role: 'adviser', period: 'standing', subject_ids: WC.map((c) => c.id) });
  const wGive = [];
  for (let at = 0; at < N; at += 200) wGive.push(await call(W.token, 'POST', '/api/chits/assign-bulk', { plug: 'client', role: 'adviser', subject_ids: WC.slice(at, at + 200).map((c) => c.id), target_actor_id: S.id }));
  const wHeld = await withEntity(W.id, async (db) => (await db.query(`SELECT count(*)::int n FROM chit_status WHERE entity_id = $1 AND direction = 'sent' AND assigned_to_actor_id = $2`, [W.id, S.id])).rows[0].n);
  const wCount = await withEntity(W.id, async (db) => (await db.query(`SELECT current_task_count n FROM identities WHERE identity_id = $1`, [S.id])).rows[0].n);
  ok('14b (d): a seat with max_tasks 10 holds ' + N + ' job chits: opened ' + N + ', assigned ' + N + ', no skip, held ' + N + ', current_task_count 0', wOpen.body.opened === N && wGive.reduce((sum, r) => sum + r.body.assigned, 0) === N && wGive.every((r) => r.status === 200 && r.body.skipped.length === 0) && wHeld === N && wCount === 0, JSON.stringify([wOpen.status, wOpen.body && wOpen.body.opened, wGive.map((r) => r.body && r.body.assigned), wHeld, wCount]));

  /* 15-17 T10 T11 T12: the auditor firm Q */
  const Q = await business('q'); const QC = await person(Q, 'c', 'act', 'commenter'), QD = await person(Q, 'd', 'act', 'commenter');
  await withEntity(Q.id, (db) => db.query(`UPDATE identities SET max_tasks = 100 WHERE identity_id = ANY($1::uuid[])`, [[QC.id, QD.id]]));
  const K = [];
  for (let n = 0; n < 6; n++) { const k = await business('k' + n); await link(Q, k); await grantAs(k, Q, 'auditor'); K.push(k); }
  await settings(Q, { mode: 'off' });
  const qOpen = await call(Q.token, 'POST', '/api/chits/jobs/open', { plug: 'client', role: 'auditor', period: 'standing', subject_ids: K.map((k) => k.id) });
  const qGive = await call(Q.token, 'POST', '/api/chits/assign-bulk', { plug: 'client', role: 'auditor', subject_ids: K.slice(0, 5).map((k) => k.id), target_actor_id: QC.id });
  await switchTo(Q, 'assigned');
  const audit = (token, k, route, method, body) => call(token, method || 'GET', route, body || null, { 'x-books-for': k.id, 'x-books-role': 'auditor' });
  const cList = await practiceOf(QC.token), dList = await practiceOf(QD.token);
  ok('15 T10: Q assigns 5 of 6 to C (auditor staff): opened 6, assigned 5; C\'s practice list reads those 5 and the unassigned K5 (STAFFPICK, Athi 21 Nov)', qOpen.body.opened === 6 && qGive.body.assigned === 5 && cList.status === 200 && cList.body.total === 6 && JSON.stringify(idsOf(cList)) === JSON.stringify(sortIds(K)), JSON.stringify([qOpen.status, qOpen.body && qOpen.body.opened, qGive.body, cList.status, cList.body && cList.body.total]).slice(0, 300));
  const cPl = await audit(QC.token, K[0], '/api/books/accounts'), cPost = await audit(QC.token, K[0], '/api/books/events', 'POST', { type: 'sale', amount_minor: 100 }), cUn = await audit(QC.token, K[5], '/api/books/accounts');
  ok('15 T10: C opens an assigned client\'s accounts: not refused (the gate lets the held client through); POST /api/books/events: 403 (auditor reads only); the unassigned K5 is NOT refused as unassigned (STAFFPICK: a seat may open what nobody holds, to pick it up)', cPl.status !== 403 && cPl.status !== 401 && cPost.status === 403 && cUn.status !== 401 && !(cUn.body && cUn.body.code === 'BOOKS_GRANT_NOT_ASSIGNED'), JSON.stringify([cPl.status, cPost.status, cUn.status, cUn.body && cUn.body.code]));
  const dPl = await audit(QD.token, K[0], '/api/books/pl');
  ok('16 T11: D (auditor staff, nothing assigned): practice list is the one unassigned client (K5) and a client C holds (K0) is 403 BOOKS_GRANT_NOT_ASSIGNED in words', dList.status === 200 && dList.body.total === 1 && JSON.stringify(idsOf(dList)) === JSON.stringify([K[5].id]) && dPl.status === 403 && dPl.body.code === 'BOOKS_GRANT_NOT_ASSIGNED', JSON.stringify([dList.status, dList.body && dList.body.total, dPl.status]));
  await withEntity(K[0].id, (db) => db.query(`UPDATE books_access_grant SET revoked_at = now() WHERE grantor_entity = $1 AND grantee_entity = $2`, [K[0].id, Q.id]));
  const rC = await audit(QC.token, K[0], '/api/books/pl'), rQ = await audit(Q.token, K[0], '/api/books/pl'), rList = await practiceOf(QC.token);
  ok('17 T12: K0 revokes: C 403 BOOKS_GRANT_ENDED, the owner Q 403 BOOKS_GRANT_ENDED; C\'s list is 5 of the 6 (K1..K4 and the unassigned K5) and `ended` counts the revoked one (1)', rC.status === 403 && rC.body.code === 'BOOKS_GRANT_ENDED' && rQ.status === 403 && rQ.body.code === 'BOOKS_GRANT_ENDED' && rList.body.total === 5 && rList.body.ended === 1, JSON.stringify([rC.status, rC.body && rC.body.code, rQ.status, rList.body && rList.body.total, rList.body && rList.body.ended]));
  await switchTo(P, null);

  /* 18-20 (d) follow-up, 18 Nov: job chits are not counted, so the leaver gate and the auto door must still SEE them. Firm L: 9 clients, seats S1 S2 S3 (act) and a leaver J. HAND-COMPUTED:
       18 round robin: least_loaded, 3 seats at 0, open 9 clients: 3 / 3 / 3.
       19 job load steers: S3 is handed 6 jobs and made the stalest by last_assigned_at; open 6 more: S3 gets 0 (it holds 6 open, S1 and S2 hold 3 each), S1 and S2 take 3 each.
       20 leaver: J holds 4 job chits and ZERO tasks (current_task_count 0): switching J off with no task_action is 400 TASKS_TO_ROUTE (it was 200 and orphaned the 4); with task_action actor to S1: 200, tasks_routed 4,
          J holds 0, S1 holds 4 more, and S1's current_task_count is still 0 (a job chit is never counted). Then a seat with 2 jobs and 1 task: goes on leave to S2: S2's count grows by 1, not 3. */
  const L = await business('l');
  const LC = [];
  for (let n = 0; n < 9; n++) { const c = await business('lc' + n); await link(L, c); await grantAdviser(c, L); LC.push(c); }
  const S1 = await person(L, 's1', 'act'), S2 = await person(L, 's2', 'act'), S3 = await person(L, 's3', 'act'), J = await person(L, 'j', 'act'), K2 = await person(L, 'k2', 'act');
  await withEntity(L.id, (db) => db.query(`UPDATE identities SET max_tasks = 100 WHERE identity_id = ANY($1::uuid[])`, [[S1.id, S2.id, S3.id, J.id, K2.id]]));
  const lIds = LC.map((c) => c.id);
  const holdsNow = (id) => withEntity(L.id, async (db) => (await db.query(`SELECT count(*)::int n FROM chit_status WHERE entity_id = $1 AND direction = 'sent' AND assigned_to_actor_id = $2 AND current_status NOT IN ('completed','cancelled','rejected')`, [L.id, id])).rows[0].n);
  const countOf = (id) => withEntity(L.id, async (db) => (await db.query(`SELECT current_task_count n FROM identities WHERE identity_id = $1`, [id])).rows[0].n);
  await withEntity(L.id, (db) => db.query(`UPDATE identities SET break_status = 'short_break' WHERE identity_id = ANY($1::uuid[])`, [[J.id, K2.id]])); /* the auto door must not pick the leavers */
  await settings(L, { mode: 'least_loaded' });
  const r18 = await open(L.token, lIds, 'p1');
  const h18 = [await holdsNow(S1.id), await holdsNow(S2.id), await holdsNow(S3.id)];
  ok('18 round robin: 9 jobs over 3 seats at 0: 3 / 3 / 3', r18.body.opened === 9 && r18.body.assigned === 9 && h18.join() === '3,3,3', JSON.stringify(h18) + JSON.stringify(r18.body).slice(0, 160));
  await settings(L, { mode: 'default_assignee', dflt: S3.id });
  await open(L.token, lIds.slice(0, 6), 'p2');
  await withEntity(L.id, (db) => db.query(`UPDATE identities SET last_assigned_at = NULL WHERE identity_id = $1`, [S3.id])); /* the stalest seat by the old tie-break */
  await settings(L, { mode: 'least_loaded' });
  const r19 = await open(L.token, lIds.slice(0, 6), 'p3');
  const h19 = [await holdsNow(S1.id), await holdsNow(S2.id), await holdsNow(S3.id)];
  ok('19 job load steers: S3 held 9 open, so the 6 new jobs go to S1 and S2: 3 + 3 each, S3 stays at 9', r19.body.assigned === 6 && h19.join() === '6,6,9', JSON.stringify(h19) + JSON.stringify(r19.body).slice(0, 160));

  await settings(L, { mode: 'off' });
  await withEntity(L.id, (db) => db.query(`UPDATE identities SET break_status = 'active' WHERE identity_id = ANY($1::uuid[])`, [[J.id, K2.id]]));
  const toJ = await call(L.token, 'POST', '/api/chits/assign-bulk', { plug: 'client', role: 'adviser', subject_ids: lIds.slice(0, 4), target_actor_id: J.id });
  const jBefore = [await holdsNow(J.id), await countOf(J.id)], s1Before = await holdsNow(S1.id);
  ok('20 setup: J holds 4 job chits and a task count of 0', toJ.body.assigned >= 4 && jBefore[0] >= 4 && jBefore[1] === 0, JSON.stringify([toJ.status, toJ.body, jBefore]));
  const gate = await call(L.token, 'PUT', '/api/actors/' + J.id + '/status', { action: 'deactivate' });
  ok('20 a seat holding only job chits is ASKED where its work goes: 400 TASKS_TO_ROUTE, nothing switched off', gate.status === 400 && gate.body.code === 'TASKS_TO_ROUTE' && (await holdsNow(J.id)) === jBefore[0], JSON.stringify(gate.body).slice(0, 200));
  const movedJ = await call(L.token, 'PUT', '/api/actors/' + J.id + '/status', { action: 'deactivate', task_action: 'actor', target_actor_id: S1.id });
  ok('20 task_action actor: 200, tasks_routed ' + jBefore[0] + ', J holds 0, S1 holds ' + jBefore[0] + ' more, S1 count still 0', movedJ.status === 200 && movedJ.body.tasks_routed === jBefore[0] && (await holdsNow(J.id)) === 0 && (await holdsNow(S1.id)) === s1Before + jBefore[0] && (await countOf(S1.id)) === 0, JSON.stringify(movedJ.body).slice(0, 200));
  const mixTask = await withEntity(L.id, async (db) => (await db.query(`SELECT chit_id FROM chit_status WHERE entity_id = $1 AND direction = 'sent' AND assigned_to_actor_id = $2 LIMIT 2`, [L.id, S3.id])).rows.map((r) => r.chit_id));
  ok('20 setup: K2 is handed 2 jobs', (await call(L.token, 'POST', '/api/chits/assign-bulk', { chit_ids: mixTask, target_actor_id: K2.id })).body.assigned === 2);
  const leave = await call(L.token, 'PUT', '/api/actors/break', { break_type: 'leave', actor_id: K2.id });
  ok('20 leave: a seat holding only jobs is asked too: 400, not put on leave', leave.status === 400 && (await holdsNow(K2.id)) === 2, JSON.stringify(leave.body).slice(0, 200));
  const leaveTo = await call(L.token, 'PUT', '/api/actors/break', { break_type: 'leave', actor_id: K2.id, task_action: 'actor', target_actor_id: S2.id });
  ok('20 leave to S2: 200, K2 holds 0, S2 count still 0 (2 jobs moved, none counted)', leaveTo.status === 200 && (await holdsNow(K2.id)) === 0 && (await countOf(S2.id)) === 0, JSON.stringify(leaveTo.body).slice(0, 200));

  console.log('assign1.realstack: ' + pass + ' passed, ' + fail + ' failed (N=' + N + ')');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL threw ' + (e && e.stack)); process.exit(1); });
