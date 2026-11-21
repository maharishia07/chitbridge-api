'use strict';
/**
 * tests/walkeve-assign.realstack.cjs — walk 19 Nov (sit-au): W12 Undo returns every row to its PREVIOUS holder · W17 a seat of the firm picks up unassigned clients through the ONE assign door (firm switch staff_pick_up, default on) · W13 a practice that has assigned clients is still offered the practice roles.
 *
 * HAND-COMPUTED (firm P, clients C0..C7 with a live adviser grant; staff: A = Arjun (act, editor), B = Priya (act), M manager):
 *   W12  M gives C0..C2 to B. Then M gives C0..C4 to A (a mixed batch: 3 held by B, 2 in the pool): previous = 3 entries B + 2 entries null. The Undo the web sends (one call per previous holder, in either order) leaves C0..C2 with B and C3,C4 in the pool.
 *   W17  A picks up C5 for himself: 200, A holds it (assignment_type pull, state_log "Picked up by"). A names B for C6 (unassigned): 200, B holds it. A asks for C0 (B holds it): 403 ASSIGN_HELD_BY_OTHER and nothing moved. A returns C5 to the pool (target null): 403 CHIT_NOT_PERMITTED (staff never un-assign).
 *        Switch off: A on C7: 403 ASSIGN_PICKUP_OFF, nothing moved; the manager still assigns C7 (200); may_take for A false (on: true).
 *   W13  the practice P has job chits of its own: GET /api/people?for=add offers bookkeeper,reviewer,view_only (not the shop roles).
 * Run: as tests/assign1.realstack.cjs (a throwaway database on a SIT box): node tests/walkeve-assign.realstack.cjs --base http://127.0.0.1:PORT
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

const holderOf = (firm, subject) => withEntity(firm.id, async (db) => (await db.query(`SELECT cs.assigned_to_actor_id AS h, cs.assignment_type AS t FROM chit_status cs JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id WHERE cs.entity_id = $1 AND cs.direction = 'sent' AND ch.business_json -> 'job' ->> 'plug' = 'client' AND ch.all_recipients @> jsonb_build_array(jsonb_build_object('entity_id', $2::text))`, [firm.id, subject])).rows);
const holder1 = async (firm, subject) => { const rows = await holderOf(firm, subject); return rows.length === 1 ? rows[0].h : rows.length ? 'MANY' : 'NONE'; };
const bulk = (token, ids, target, extra) => call(token, 'POST', '/api/chits/assign-bulk', Object.assign({ plug: 'client', role: 'adviser', subject_ids: ids, target_actor_id: target }, extra || {}));
/* what the web's Undo sends: one call per previous holder (assign-bar.js undoOf), in the order asked */
const undo = async (token, previous, order) => {
  const by = new Map();
  for (const p of previous) { const k = String(p.actor_id || ''); if (!by.has(k)) by.set(k, []); by.get(k).push(p.subject_id); }
  const keys = [...by.keys()]; if (order === 'rev') keys.reverse();
  const out = [];
  for (const k of keys) out.push(await bulk(token, by.get(k), k || null));
  return out;
};

(async () => {
  const P = await business('p');
  const C = [];
  for (let n = 0; n < 11; n++) { const c = await business('c' + n); await link(P, c); await grantAdviser(c, P); C.push(c); }
  const A = await person(P, 'a', 'act'), B = await person(P, 'b', 'act'), M = await person(P, 'm', 'manager');
  await settings(P, { mode: 'off' });
  const id = C.map((c) => c.id);

  /* W12 */
  for (const order of ['fwd', 'rev']) {
    const first = id.slice(0, 5);
    if (order === 'rev') for (const s of first) await bulk(M.token, [s], null);
    const r0 = await bulk(M.token, id.slice(0, 3), B.id);
    ok('W12 setup (' + order + '): M gives C0..C2 to B', r0.status === 200 && r0.body.assigned === 3, JSON.stringify(r0));
    const r1 = await bulk(M.token, first, A.id);
    const prev = (r1.body && r1.body.previous) || [];
    ok('W12 the mixed batch answers previous: 3 entries B and 2 entries null (' + order + ')', r1.status === 200 && prev.filter((p) => p.actor_id === B.id).length === 3 && prev.filter((p) => p.actor_id === null).length === 2, JSON.stringify(r1.body).slice(0, 400));
    ok('W12 all five are now A\'s (' + order + ')', (await Promise.all(first.map((s) => holder1(P, s)))).every((h) => h === A.id));
    const u = await undo(M.token, prev, order);
    ok('W12 the Undo calls all answer 200 (' + order + ')', u.every((x) => x.status === 200), JSON.stringify(u.map((x) => x.status + ' ' + JSON.stringify(x.body).slice(0, 160))));
    const now = await Promise.all(first.map((s) => holder1(P, s)));
    ok('W12 Undo (' + order + '): C0..C2 are back with B, C3 and C4 are back in the pool', now[0] === B.id && now[1] === B.id && now[2] === B.id && now[3] === null && now[4] === null, JSON.stringify(now));
  }

  /* W17 */
  const pick = await bulk(A.token, [id[5]], A.id);
  const row5 = await holderOf(P, id[5]);
  ok('W17 A picks up C5 for himself: 200, A holds it, assignment_type pull', pick.status === 200 && pick.body.assigned === 1 && row5.length === 1 && row5[0].h === A.id && row5[0].t === 'pull', JSON.stringify(pick));
  const said = await withEntity(P.id, async (db) => (await db.query(`SELECT count(*)::int n FROM state_log WHERE entity_id = $1 AND action = 'assigned' AND action_by_identity_id = $2 AND detail LIKE 'Picked up by %'`, [P.id, A.id])).rows[0].n);
  ok('W17 it is recorded: a state_log row "Picked up by" with who', said >= 1, said);
  const name = await bulk(A.token, [id[6]], B.id);
  ok('W17 A names B for the unassigned C6: 200, B holds it', name.status === 200 && (await holder1(P, id[6])) === B.id, JSON.stringify(name));
  const stolen = await bulk(A.token, [id[0]], A.id);
  ok('W17 A asks for C0 (B holds it): 403 ASSIGN_HELD_BY_OTHER, nothing moved', stolen.status === 403 && stolen.body.code === 'ASSIGN_HELD_BY_OTHER' && (await holder1(P, id[0])) === B.id, JSON.stringify(stolen));
  const mixed = await bulk(A.token, [id[7], id[0]], A.id);
  ok('W17 a batch with one held by someone else is refused WHOLE: C7 stays without a holder', mixed.status === 403 && ['NONE', null].includes(await holder1(P, id[7])), JSON.stringify(mixed));
  const unassign = await bulk(A.token, [id[5]], null);
  ok('W17 A cannot put a client back in the pool: 403 CHIT_NOT_PERMITTED', unassign.status === 403 && unassign.body.code === 'CHIT_NOT_PERMITTED', JSON.stringify(unassign));
  const verdictOn = await call(A.token, 'GET', '/api/actors');
  ok('W17 the verdict for A: may_take true, may_assign false', verdictOn.status === 200 && verdictOn.body.may_take === true && verdictOn.body.may_assign === false, JSON.stringify(verdictOn.body).slice(-200));
  await withEntity(P.id, (db) => db.query(`UPDATE entity_actor_settings SET staff_pick_up = 'off' WHERE entity_id = $1`, [P.id]));
  const off = await bulk(A.token, [id[7]], A.id);
  ok('W17 switch off: A on C7 is 403 ASSIGN_PICKUP_OFF and nothing moved', off.status === 403 && off.body.code === 'ASSIGN_PICKUP_OFF' && ['NONE', null].includes(await holder1(P, id[7])), JSON.stringify(off));
  const verdictOff = await call(A.token, 'GET', '/api/actors');
  ok('W17 switch off: may_take false for A', verdictOff.body.may_take === false);
  const mgr = await bulk(M.token, [id[7]], A.id);
  ok('W17 switch off: the manager still assigns (200)', mgr.status === 200 && (await holder1(P, id[7])) === A.id, JSON.stringify(mgr));
  const settingsRead = await call(M.token, 'GET', '/api/actors/settings');
  ok('W17 GET settings says staff_pick_up off', settingsRead.body.settings && settingsRead.body.settings.staff_pick_up === 'off', JSON.stringify(settingsRead.body).slice(0, 200));
  const sw = await call(P.token, 'PUT', '/api/actors/settings', { staff_pick_up: 'on' });
  ok('W17 the owner turns it on again (PUT settings): staff_pick_up on', sw.status === 200 && sw.body.settings.staff_pick_up === 'on', JSON.stringify(sw.body).slice(0, 200));
  const bad = await call(P.token, 'PUT', '/api/actors/settings', { staff_pick_up: 'maybe' });
  ok('W17 a word that is not on/off is refused (400/422)', bad.status === 422 || bad.status === 400, bad.status);

  /* W18: the seat of the employee decides, the assignment narrows (switch assigned) */
  await switchTo(P, 'assigned');
  const Ar = await person(P, 'ar', 'act', 'editor'), Au = await person(P, 'au', 'audit', 'commenter'), B2 = await person(P, 'b2', 'act', 'editor');
  ok('W18 setup: M gives C8 to Ar (Bookkeeper seat: editor, whole entity, sees costs), C9 to Au (the Auditor preset: commenter)', (await bulk(M.token, [id[8]], Ar.id)).status === 200 && (await bulk(M.token, [id[9]], Au.id)).status === 200);
  /* a client with no country setup answers 422 COUNTRY_SETUP_PENDING AFTER the grant and assignment gates: 'open' below = not refused by them (not 401/403) */
  const open = (r) => r.status !== 401 && r.status !== 403;
  const readOwn = await lookAt(Ar.token, C[8]);
  ok('W18 the assigned Bookkeeper reads the client books under the practice adviser grant: past the gates (not 401/403)', open(readOwn), JSON.stringify(readOwn).slice(0, 300));
  const readOther = await lookAt(Ar.token, C[10]);
  ok('W18 an unassigned client is OPEN to him, to pick up (STAFFPICK, Athi 21 Nov: mine + unassigned; not 401/403 on the assignment gate)', open(readOther), JSON.stringify(readOther).slice(0, 300));
  const readAuditorSeat = await lookAt(Au.token, C[9]);
  ok('W18 the same assignment under the Auditor preset (commenter) does NOT reach the adviser grant: 403 (the cause of the walk: the seat, not the assignment)', readAuditorSeat.status === 403, JSON.stringify(readAuditorSeat).slice(0, 300));
  const handed = await bulk(M.token, [id[8]], B2.id);
  ok('W18 hand-over of C8 to B2: 200', handed.status === 200 && (await holder1(P, id[8])) === B2.id);
  ok('W18 after the hand-over the old holder loses the client (403) and the new holder reads it (200)', (await lookAt(Ar.token, C[8])).status === 403 && open(await lookAt(B2.token, C[8])));
  ok('W18 the partner reaches every client (past the gates)', open(await lookAt(P.token, C[10])));

  /* W13 */
  const add = await call(P.token, 'GET', '/api/people?for=add');
  ok('W13 a practice that has assigned clients is offered the practice roles, not the shop roles', add.status === 200 && add.body.access_choices.map((c) => c.key).join() === 'bookkeeper,reviewer,view_only', JSON.stringify(add.body.access_choices && add.body.access_choices.map((c) => c.key)));

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
