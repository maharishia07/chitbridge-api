'use strict';
/**
 * tests/sod-grant.realstack.cjs — SEC-117 segregation of duties on the books grant, on a REAL server and a REAL Postgres (RLS on, as cb_app).
 * Fable 1117B (Employee seat): the firm's accountant read under the firm's AUDITOR grant by leaving out X-Books-Role. ISO 27001 A.5.3, ASA 220.
 *
 * HAND-COMPUTED (firm P; clients K1 gave P an AUDITOR grant only, K2 an ADVISER grant only, K3 both; people of P: ACC editor whole-entity (the accountant seat), AUD commenter whole-entity with costs (the auditor hat)):
 *   1  ACC, no header, K1 (auditor grant only): 403 BOOKS_GRANT_NONE (before the fix: 200 under the auditor grant); no marks list either.
 *   2  ACC names X-Books-Role: auditor on K1 and on K3: 403 BOOKS_GRANT_NOT_FOR_YOU, the server sentence names the accountant seat.
 *   3  ACC, no header, K2 (adviser grant): through the gate, the look is logged against the adviser grant (the seat's own role).
 *   4  AUD, no header, K1: through the gate (unchanged); AUD names adviser: 403 BOOKS_GRANT_NOT_FOR_YOU.
 *   5  the owner P, no header, K1: through the gate (unchanged); AUD passes the marks list gate under K1.
 * Run: DATABASE_URL=postgres://cb_app:...@127.0.0.1:PORT/db JWT_SECRET=... node tests/sod-grant.realstack.cjs --base http://127.0.0.1:PORT   (a throwaway database; the server's PORT and CB_SELF_URL point at the same base)
 * CARD 04-network/ACC-176-AUDITOR-GRANT
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
const grants = require(path.join(API, 'lib', 'books-grant.js'));

/* through the gate: any answer but 401/403 (a 422 for a missing period is the route's own business, as tools/role-matrix-live.cjs counts it) */
const through = (r) => r.status !== 401 && r.status !== 403;
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 500) : '')); } };
const RUN = 'sg' + (Date.now() % 1e9).toString(36);
const tokenFor = (claims) => jsonWebToken.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
async function business(tag) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [identity] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'IN', 'INR', $3) RETURNING identity_id, display_name`, [bridgeId, 'SG ' + tag + ' ' + RUN, bridgeId.toLowerCase()]);
  return { id: identity.identity_id, bridgeId, node: await networkService.nodeOf(identity.identity_id, { ensure: true }), token: tokenFor({ identity_id: identity.identity_id, identity_type: 'entity', bridge_id: bridgeId, display_name: identity.display_name }) };
}
async function person(firm, tag, hat, level) {
  const { rows: [row] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, parent_entity_id, country, currency_code, user_id, access_level, whole_entity, can_see_costs, hat) VALUES ($1, $2, 'actor', $3, 'IN', 'INR', $4, $5, true, true, $6) RETURNING identity_id, display_name`, [firm.bridgeId + tag, 'Staff ' + tag + ' ' + RUN, firm.id, (firm.bridgeId + tag).toLowerCase(), level, hat]);
  return { id: row.identity_id, token: tokenFor({ identity_id: row.identity_id, identity_type: 'actor', bridge_id: firm.bridgeId, display_name: row.display_name, parent_entity_id: firm.id }) };
}
async function call(token, route, headers) {
  const res = await fetch(BASE + route, { headers: Object.assign({ authorization: 'Bearer ' + token }, headers || {}) });
  let json = null; try { json = await res.json(); } catch (e) { /* no body */ }
  return { status: res.status, body: json };
}
const link = async (parent, child) => { const asked = await networkService.requestConnect({ parentId: parent.node.id, childId: child.node.id }, parent.node); await networkService.approve({ edgeId: asked.id }, child.node); };
const grantAs = (client, firm, preset) => withEntity(client.id, (db) => db.query(`INSERT INTO books_access_grant (grantor_entity, grantee_entity, preset, can_see_costs, purpose, granted_by, expires_at) VALUES ($1, $2, $3, $4, 'sod-grant realstack', $1, now() + interval '1 year')`, [client.id, firm.id, preset, preset === 'auditor']));

(async () => {
  const P = await business('p');
  const ACC = await person(P, 'a', 'act', 'editor'), AUD = await person(P, 'u', 'audit', 'commenter');
  const K = {};
  for (const [name, presets] of [['k1', ['auditor']], ['k2', ['adviser']], ['k3', ['auditor', 'adviser']]]) { K[name] = await business(name); await link(P, K[name]); for (const preset of presets) await grantAs(K[name], P, preset); }
  const as = (who, k, role) => call(who.token, '/api/books/pl', Object.assign({ 'x-books-for': K[k].id }, role ? { 'x-books-role': role } : {}));

  const a1 = await as(ACC, 'k1');
  ok('1 ACC, no header, K1 (auditor grant only): 403 BOOKS_GRANT_NONE, no ledger read', a1.status === 403 && a1.body && a1.body.code === 'BOOKS_GRANT_NONE', JSON.stringify(a1));
  const m1 = await call(ACC.token, '/api/marks', { 'x-books-for': K.k1.id });
  ok('1 ACC, no header, K1: the marks list is refused too (no set.ok to check what ACC prepared)', m1.status === 403 && !JSON.stringify(m1.body || {}).includes('"ok":true'), JSON.stringify(m1));
  const a2 = await as(ACC, 'k1', 'auditor'), a2b = await as(ACC, 'k3', 'auditor');
  ok('2 ACC names the auditor role on K1 and on K3: 403 BOOKS_GRANT_NOT_FOR_YOU, in words naming the accountant seat', [a2, a2b].every((r) => r.status === 403 && r.body && r.body.code === 'BOOKS_GRANT_NOT_FOR_YOU' && /accountant/.test(JSON.stringify(r.body))), JSON.stringify([a2, a2b]));
  const a3 = await as(ACC, 'k2');
  const logged = (await grants.looks(K.k2.id, { limit: 20 })).filter((row) => row.actor_identity_id === ACC.id);
  ok('3 ACC, no header, K2 (adviser grant): 200, and the look is logged against the adviser grant', through(a3) && logged.length >= 1 && logged.every((row) => !row.role || row.role === 'adviser' || row.preset === 'adviser'), JSON.stringify([a3.status, logged.slice(0, 2)]));
  const a4 = await as(AUD, 'k1'), a4b = await as(AUD, 'k2', 'adviser');
  ok('4 AUD (auditor hat), no header, K1: 200, unchanged; naming adviser: 403 BOOKS_GRANT_NOT_FOR_YOU', through(a4) && a4b.status === 403 && a4b.body.code === 'BOOKS_GRANT_NOT_FOR_YOU', JSON.stringify([a4.status, a4b]));
  const a5 = await call(P.token, '/api/books/pl', { 'x-books-for': K.k1.id }), m5 = await call(AUD.token, '/api/marks', { 'x-books-for': K.k1.id });
  ok('5 the owner P, no header, K1: through the gate, unchanged; AUD passes the marks list gate under K1', through(a5) && through(m5), JSON.stringify([a5.status, m5.status]));
  console.log('sod-grant.realstack: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL threw ' + (e && e.stack)); process.exit(1); });
