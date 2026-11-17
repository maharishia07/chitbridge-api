'use strict';
/**
 * tests/assign1.realstack.cjs — ASSIGN-1 on a REAL server and a REAL Postgres (RLS on, as cb_app): the job chit opener, the widened assign-bulk, the W3 gate and the holds() gate of the books look.
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
const RUN = 'a1' + (Date.now() % 1e9).toString(36);
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
async function call(token, method, route, body, headers) {
  const res = await fetch(BASE + route, { method, headers: Object.assign({ 'content-type': 'application/json', authorization: 'Bearer ' + token }, headers || {}), body: body ? JSON.stringify(body) : undefined });
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
  const A = await person(P, 'a', 'act'), B = await person(P, 'b', 'act'), M = await person(P, 'm', 'manager'), V = await person(P, 'v', 'view', 'viewer');
  const UNKNOWN = '99999999-9999-4999-8999-999999999999';
  const ids = C.map((c) => c.id);
  await settings(P, { mode: 'off' });
  console.log('world: firm + ' + N + ' clients + D + X; staff A B M V');

  /* 1 T14 */
  for (const [who, person_] of [['V (view)', V], ['A (act)', A]]) {
    const r = await open(person_.token, [ids[0]], 'standing');
    ok('1 T14: ' + who + ' is refused 403 CHIT_NOT_PERMITTED, in the Problem shape', r.status === 403 && r.body && r.body.code === 'CHIT_NOT_PERMITTED' && typeof r.body.status === 'number', JSON.stringify(r));
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
  await withEntity(P.id, (db) => db.query(`UPDATE identities SET break_status = 'break' WHERE identity_id = $1`, [M.id]));
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
  const bulk = await call(M.token, 'POST', '/api/chits/assign-bulk', { plug: 'client', role: 'adviser', subject_ids: sub.concat([UNKNOWN]), target_actor_id: B.id, note: 'hand over ' + RUN });
  ok('7 M hands C0..C2 (3 clients x 3 periods = 9 copies) to B: assigned 9, one JOB_NOT_OPEN for the unknown', bulk.status === 200 && bulk.body.assigned === 9 && bulk.body.assigned_to === B.name && bulk.body.skipped.length === 1 && bulk.body.skipped[0].code === 'JOB_NOT_OPEN' && bulk.body.skipped[0].subject_id === UNKNOWN, JSON.stringify(bulk));
  const note = await withEntity(P.id, async (db) => (await db.query(`SELECT count(*)::int n FROM state_log WHERE entity_id = $1 AND action = 'assigned' AND detail LIKE $2`, [P.id, '%hand over ' + RUN + '%'])).rows[0].n);
  ok('7 the note is in the assigning entity\'s own log, once per copy (9)', note === 9, 'rows ' + note);
  const pool = await call(M.token, 'POST', '/api/chits/assign-bulk', { plug: 'client', role: 'adviser', subject_ids: [ids[0]], target_actor_id: null });
  ok('7 target null returns the set to the pool: assigned_to null, C0\'s 3 copies hold nobody', pool.status === 200 && pool.body.assigned_to === null && pool.body.assigned === 3 && (await withEntity(P.id, async (db) => (await db.query(`SELECT count(*)::int n FROM chit_status cs JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id WHERE cs.entity_id = $1 AND cs.direction = 'sent' AND cs.assigned_to_actor_id IS NULL AND ch.business_json ->> 'client_ref' LIKE $2`, [P.id, 'job:client:adviser:' + ids[0] + ':%'])).rows[0].n)) === 3, JSON.stringify(pool));
  const single = await call(A.token, 'PUT', '/api/actors/assign/' + oneJob, { action: 'return' });
  const singleHolder = await call(A.token, 'PUT', '/api/actors/assign/' + oneJob, { action: 'push', target_actor_id: B.id, note: 'over to you' });
  ok('7 single door: A is the CURRENT holder of C5\'s p3 job, so A may hand it over (200) ; a non-holder act is refused', single.status === 200 && singleHolder.status === 403, JSON.stringify([single, singleHolder]).slice(0, 300));

  /* 8 T13 + the gate */
  await settings(P, { mode: 'off' });
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

  console.log('assign1.realstack: ' + pass + ' passed, ' + fail + ' failed (N=' + N + ')');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL threw ' + (e && e.stack)); process.exit(1); });
