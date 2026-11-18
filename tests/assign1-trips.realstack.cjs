'use strict';
/**
 * tests/assign1-trips.realstack.cjs — ASSIGN-1 · what POST /api/chits/jobs/open costs in database round trips (X-DB-Trips; the server runs with CB_TRIPS=1), at N=1 and N=150, mode off and least_loaded.
 * Throwaway database on a SIT box only (cb_app on localhost or a SIT host). The budget line is trips = 3 + N x (S + 1) (DECISIONS-SLICE1 api contract, section 6): S = one send, +1 per opened job = the auto door.
 * Run: DATABASE_URL=... JWT_SECRET=... node tests/assign1-trips.realstack.cjs --base http://127.0.0.1:3611 [--n 150]
 * CARD 28-platform-and-operations/performance-and-round-trips
 */
const path = require('path');
const jsonWebToken = require('jsonwebtoken');
const API = path.join(__dirname, '..');
const arg = (name) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : null; };
const BASE = arg('--base');
const N = Number(arg('--n') || 150);
if (!BASE || !process.env.DATABASE_URL || !process.env.JWT_SECRET) { console.error('needs --base, DATABASE_URL (cb_app, throwaway) and JWT_SECRET'); process.exit(3); }
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(process.env.DATABASE_URL);
if (!parts || parts[1] !== 'cb_app' || !/^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/.test(parts[2])) { console.error('REFUSED: cb_app on localhost or a SIT host only'); process.exit(3); }
process.env.NODE_ENV = 'test';
const networkService = require(path.join(API, 'src', 'services', 'network'));
const { query, withEntity } = require(path.join(API, 'db'));

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
async function timed(token, ids, period) {
  const started = Date.now();
  const res = await fetch(BASE + '/api/chits/jobs/open', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ plug: 'client', role: 'adviser', period, subject_ids: ids }) });
  let json = null; try { json = await res.json(); } catch (e) { /* none */ }
  return { status: res.status, trips: Number(res.headers.get('x-db-trips')), ms: Number(res.headers.get('x-db-ms')), wall: Date.now() - started, opened: json && json.opened, existing: json && json.existing, assigned: json && json.assigned, skipped: json && json.skipped && json.skipped.length, code: json && json.code };
}
(async () => {
  const P = await business('p');
  const C = [];
  for (let n = 0; n < N; n++) { const c = await business('c' + n); await link(P, c); await grantAdviser(c, P); C.push(c); }
  const A = await person(P, 'a', 'act'), B = await person(P, 'b', 'act');
  await withEntity(P.id, (db) => db.query(`UPDATE identities SET max_tasks = 1000 WHERE identity_id = ANY($1::uuid[])`, [[A.id, B.id]]));
  const ids = C.map((c) => c.id);
  const show = (what, r) => console.log('MEASURE ' + what + ' ' + JSON.stringify(r));
  await settings(P, { mode: 'off' });
  show('off N=1 opened', await timed(P.token, ids.slice(0, 1), 'm1'));
  show('off N=1 existing (repeat)', await timed(P.token, ids.slice(0, 1), 'm1'));
  show('off N=2 opened', await timed(P.token, ids.slice(1, 3), 'm2'));
  show('off N=' + N + ' opened', await timed(P.token, ids, 'm3'));
  show('off N=' + N + ' existing (repeat)', await timed(P.token, ids, 'm3'));
  await settings(P, { mode: 'least_loaded' });
  show('least_loaded N=1 opened', await timed(P.token, ids.slice(0, 1), 'm4'));
  show('least_loaded N=2 opened', await timed(P.token, ids.slice(1, 3), 'm5'));
  show('least_loaded N=' + N + ' opened', await timed(P.token, ids, 'm6'));
  console.log('MEASURE done');
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
