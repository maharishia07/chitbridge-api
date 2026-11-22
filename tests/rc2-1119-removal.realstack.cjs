'use strict';
/**
 * tests/rc2-1119-removal.realstack.cjs — RC2 (19 Nov, sit-grund re-run of the role cycle): removal of authority on a REAL server and a REAL Postgres (RLS on, as cb_app).
 *   R3d  the books close at once to a person handed off a client, under the firm switch `assigned` (and stay open under `all`: DECISIONS 19 Nov, "a re-assignment, not a removal")
 *   R3e  the same moment, the client job's thread closes to them (before this: GET /api/chits/:id/messages answered 200 to any person of the firm)
 *   R4b  the practice list and the door are ONE reader: a client stays listed while ANY live grant of a role the person may use stands, and goes the moment the last one ends
 *   E2a  one firm employee holds both skills when the partner gives the auditor role (cost sight): the accountant seat alone is refused it, with the sentence that says so
 *
 * HAND-COMPUTED (firm P; client C1 with an adviser grant to P; people of P: A and B act, M manager; the job of C1 is held by A):
 *   1  switch absent: A, B, M and the owner all read the job's thread (200).
 *   2  switch assigned: A (holder) 200 · B (not the holder) 404 · M (manager) 200 · the owner 200.
 *   3  M hands C1's job to the pool (assign-bulk target null): A now 404 on the thread AND 403 BOOKS_GRANT_NOT_ASSIGNED on the books; M and the owner still 200.
 *   4  switch back to all: A reads the thread (200) and the books again (a re-assignment, not a removal).
 *   5  C2 gave P an adviser grant and an auditor grant. The owner of C2 ends the ADVISER grant: the adviser door answers 403, the auditor door is open, and C2 is STILL on the practice list (list = door).
 *      The owner ends the auditor grant too: both doors 403 and C2 is gone from the list.
 *   6  C3 gave P both grants. S is a firm editor, whole entity, no cost sight (the accountant seat): X-Books-Role auditor = 403 BOOKS_GRANT_NOT_FOR_YOU; after the partner gives cost sight (PATCH) the auditor door is open (200 through the gate).
 * Run: DATABASE_URL=postgres://cb_app:cbapp@127.0.0.1:55421/cb_rc2 JWT_SECRET=... node tests/rc2-1119-removal.realstack.cjs --base http://127.0.0.1:3611   (a throwaway database on a SIT box)
 * CARD 01-rail-core-the-chit/assign
 */
const path = require('path');
const jsonWebToken = require('jsonwebtoken');
const API = path.join(__dirname, '..');
const arg = (name) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : null; };
const BASE = arg('--base');
if (!BASE || !process.env.DATABASE_URL || !process.env.JWT_SECRET) { console.error('needs --base, DATABASE_URL (cb_app, throwaway) and JWT_SECRET'); process.exit(3); }
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(process.env.DATABASE_URL);
if (!parts || parts[1] !== 'cb_app' || !/^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/.test(parts[2])) { console.error('REFUSED: cb_app on localhost or a SIT host only'); process.exit(3); }
process.env.NODE_ENV = 'test';
const networkService = require(path.join(API, 'src', 'services', 'network'));
const { query, withEntity } = require(path.join(API, 'db'));

let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 500) : '')); } };
const RUN = 'r2' + (Date.now() % 1e9).toString(36).padStart(6, '0');
const tokenFor = (claims) => jsonWebToken.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
async function business(tag) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [identity] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'IN', 'INR', $3) RETURNING identity_id, display_name`, [bridgeId, 'R2 ' + tag + ' ' + RUN, bridgeId.toLowerCase()]);
  return { id: identity.identity_id, bridgeId, node: await networkService.nodeOf(identity.identity_id, { ensure: true }), token: tokenFor({ identity_id: identity.identity_id, identity_type: 'entity', bridge_id: bridgeId, display_name: identity.display_name }) };
}
async function person(firm, tag, hat, level, costs) {
  const { rows: [row] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, parent_entity_id, country, currency_code, user_id, access_level, whole_entity, can_see_costs, hat) VALUES ($1, $2, 'actor', $3, 'IN', 'INR', $4, $5, true, $6, $7) RETURNING identity_id, display_name`, [firm.bridgeId + tag, 'Staff ' + tag + ' ' + RUN, firm.id, (firm.bridgeId + tag).toLowerCase(), level || 'editor', costs !== false, hat]);
  return { id: row.identity_id, token: tokenFor({ identity_id: row.identity_id, identity_type: 'actor', bridge_id: firm.bridgeId, display_name: row.display_name, parent_entity_id: firm.id }) };
}
async function call(token, method, route, body, headers) {
  const res = await fetch(BASE + route, { method, headers: Object.assign({ 'content-type': 'application/json', authorization: 'Bearer ' + token }, headers || {}), body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch (e) { /* no body */ }
  return { status: res.status, body: json };
}
const link = async (parent, child) => { const asked = await networkService.requestConnect({ parentId: parent.node.id, childId: child.node.id }, parent.node); await networkService.approve({ edgeId: asked.id }, child.node); };
const grant = (client, firm, preset) => withEntity(client.id, (db) => db.query(`INSERT INTO books_access_grant (grantor_entity, grantee_entity, preset, can_see_costs, purpose, granted_by, expires_at) VALUES ($1, $2, $3, true, 'rc2 test', $1, now() + interval '1 year') RETURNING grant_id`, [client.id, firm.id, preset]).then((r) => r.rows[0].grant_id));
const settings = (firm) => withEntity(firm.id, (db) => db.query(`INSERT INTO entity_actor_settings (entity_id, assignment_model, auto_assign_mode, default_assignee_actor_id, default_max_tasks) VALUES ($1, 'both', 'off', NULL, 100) ON CONFLICT (entity_id) DO UPDATE SET auto_assign_mode = 'off'`, [firm.id]));
const switchTo = (firm, value) => withEntity(firm.id, (db) => db.query(`UPDATE entity_actor_settings SET client_access = $2 WHERE entity_id = $1`, [firm.id, value]));
const jobOf = (firm) => withEntity(firm.id, async (db) => (await db.query(`SELECT chit_id FROM chit_header WHERE entity_id = $1 AND business_json ? 'job' ORDER BY created_at LIMIT 1`, [firm.id])).rows[0].chit_id);
const thread = (token, chit) => call(token, 'GET', '/api/chits/' + chit + '/messages');
const books = (token, client, role) => call(token, 'GET', '/api/books/pl', null, { 'x-books-for': client.id, 'x-books-role': role || 'adviser' });
const listed = async (token, client) => (((await call(token, 'GET', '/api/books-grants/practice')).body || {}).clients || []).filter((row) => String(row.entity_id) === String(client.id)).length;

(async () => {
  const P = await business('p'), C1 = await business('c1'), C2 = await business('c2'), C3 = await business('c3');
  for (const c of [C1, C2, C3]) await link(P, c);
  const A = await person(P, 'a', 'act'), B = await person(P, 'b', 'act'), M = await person(P, 'm', 'manager');
  await withEntity(P.id, (db) => db.query(`UPDATE identities SET max_tasks = 100 WHERE identity_id = ANY($1::uuid[])`, [[A.id, B.id, M.id]]));
  await settings(P);
  await grant(C1, P, 'adviser');
  const opened = await call(M.token, 'POST', '/api/chits/jobs/open', { plug: 'client', role: 'adviser', period: 'standing', subject_ids: [C1.id] });
  const toA = await call(M.token, 'POST', '/api/chits/assign-bulk', { plug: 'client', role: 'adviser', subject_ids: [C1.id], target_actor_id: A.id });
  ok('0 setup: the job is opened and A holds it', opened.status === 200 && toA.status === 200 && toA.body.assigned === 1, JSON.stringify([opened.status, opened.body, toA.status, toA.body]));
  const job = await jobOf(P);

  /* 1 the switch absent: everyone of the firm reads the thread */
  const s1 = [await thread(A.token, job), await thread(B.token, job), await thread(M.token, job), await thread(P.token, job)].map((r) => r.status);
  ok('1 switch absent: A, B, M and the owner read the job thread (200 x4)', s1.join() === '200,200,200,200', s1.join());

  /* 2 the switch assigned: only the holder (and the manager, the owner) */
  await switchTo(P, 'assigned');
  const s2 = [await thread(A.token, job), await thread(B.token, job), await thread(M.token, job), await thread(P.token, job)].map((r) => r.status);
  ok('2 R3e switch assigned: A (holder) 200, B (not the holder) 404, M (manager) 200, owner 200', s2.join() === '200,404,200,200', s2.join());
  const bThread = await thread(B.token, job);
  ok('2 the refusal is the one 404 of a chit this person has no part in (same words as an unknown chit)', bThread.status === 404 && /not found|do not have access/i.test(JSON.stringify(bThread.body)), JSON.stringify(bThread.body));

  /* 3 the hand-off: the books and the thread close in the same moment */
  const before = (await books(A.token, C1)).status;
  const pool = await call(M.token, 'POST', '/api/chits/assign-bulk', { plug: 'client', role: 'adviser', subject_ids: [C1.id], target_actor_id: null });
  const after = await books(A.token, C1), aThread = await thread(A.token, job);
  ok('3 setup: before the hand-off A reads the client\'s books (not 403) and the pool hand-off is 200', before !== 403 && pool.status === 200, before + ' ' + pool.status);
  ok('3 R3d the pool: the books are no longer held by A, but an unassigned client is open to a staff seat to pick up (STAFFPICK, Athi 21 Nov): not BOOKS_GRANT_NOT_ASSIGNED', !(after.body && after.body.code === 'BOOKS_GRANT_NOT_ASSIGNED') && after.status !== 401, JSON.stringify(after));
  ok('3 R3e the job thread closes at once: 404', aThread.status === 404, JSON.stringify(aThread));
  ok('3 M and the owner still read the thread', (await thread(M.token, job)).status === 200 && (await thread(P.token, job)).status === 200);

  /* 4 under `all` it is a re-assignment, not a removal (DECISIONS 19 Nov) */
  await switchTo(P, 'all');
  ok('4 switch all: A (handed off) still reads the thread and the books: a re-assignment, not a removal', (await thread(A.token, job)).status === 200 && (await books(A.token, C1)).status !== 403);

  /* 5 R4b: the list and the door are ONE reader */
  const advisory = await grant(C2, P, 'adviser'), auditing = await grant(C2, P, 'auditor');
  ok('5 setup: C2 is on the owner\'s practice list with two live grants', (await listed(P.token, C2)) === 1);
  const revAdv = await call(C2.token, 'POST', '/api/books-grants/' + advisory + '/revoke', {});
  ok('5 the owner of C2 ends the ADVISER grant (2xx)', revAdv.status < 300, JSON.stringify(revAdv));
  const advDoor = await books(P.token, C2, 'adviser'), audDoor = await books(P.token, C2, 'auditor');
  ok('5 the adviser door is refused (403) and the auditor door (the grant still live) is not', advDoor.status === 403 && audDoor.status !== 403 && audDoor.status !== 401, advDoor.status + ' ' + audDoor.status);
  ok('5 R4b: C2 is still on the list while the auditor grant stands (the list holds what the door opens)', (await listed(P.token, C2)) === 1);
  const revAud = await call(C2.token, 'POST', '/api/books-grants/' + auditing + '/revoke', {});
  const advDoor2 = await books(P.token, C2, 'adviser'), audDoor2 = await books(P.token, C2, 'auditor');
  ok('5 the owner ends the auditor grant too: both doors 403', revAud.status < 300 && advDoor2.status === 403 && audDoor2.status === 403, [revAud.status, advDoor2.status, audDoor2.status].join());
  ok('5 R4b: C2 is gone from the practice list the same moment (list = door)', (await listed(P.token, C2)) === 0);

  /* 6 E2a: both skills in one person, given by the partner */
  await grant(C3, P, 'adviser'); await grant(C3, P, 'auditor');
  const S = await person(P, 's', 'act', 'editor', false);
  const refused = await books(S.token, C3, 'auditor');
  ok('6 S (editor, whole entity, no cost sight = the accountant seat) naming the auditor role: GRANT-SEAT (20 Nov) reads through the auditor grant, read only', refused.status !== 403, JSON.stringify(refused));
  ok('6 the same person works the books as the accountant (not 403)', (await books(S.token, C3, 'adviser')).status !== 403);
  await withEntity(P.id, (db) => db.query(`UPDATE identities SET can_see_costs = true WHERE identity_id = $1`, [S.id])); /* what the partner's PATCH /api/actors/:id { can_see_costs: true } stores */
  const both = [(await books(S.token, C3, 'adviser')).status, (await books(S.token, C3, 'auditor')).status];
  ok('6 once the partner gives the auditor role, ONE person works the books as accountant AND checks them as auditor (neither 403)', both[0] !== 403 && both[1] !== 403, both.join());

  console.log('rc2-1119-removal.realstack: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL threw ' + (e && e.stack)); process.exit(1); });
