'use strict';
/**
 * tests/flags-trips.realstack.cjs — THE ROUND TRIPS OF THE PRIVATE-FLAG WRITES AND OF THE PRACTICE CHECK POINT, measured on a REAL Postgres through the REAL sign-in (middleware/auth is NOT replaced; every call carries a signed token).
 * OWNS      the live X-DB-Trips measure behind the round-trips.budget.json lines of POST /api/flags, /query, /clear, /:id/resolve, /:id/reopen, /:id/share, /:id/remove and POST /api/books-grants/practice/baseline (S38 trips_budgeted). A budget line is a MEASURED ceiling (the dearest successful call), never a guess.
 * CALLED BY by hand on a SIT host against a throwaway database (see Run); prints the dearest successful call of each route as `trips {...}`.
 * FLOW      a firm P with an auditor person and an adviser person, a client C that grants P both seats → every route fired as the firm person (the dearer path: the live-grant read) and as the owner of the books (own books) → the dearest X-DB-Trips per route
 * CARD      PM/REQ-PRIVATE-NOTES-BOOKMARKS-2026-11-17.md
 * Needs b868, b870, b876 and b877 applied (tools/fresh-db-check.cjs builds all of them).
 * Run: DATABASE_URL=postgres://cb_app:...@db:5432/<scratch built by tools/fresh-db-check.cjs> node tests/flags-trips.realstack.cjs
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.CB_TRIPS = '1'; /* the round trips of the new flag routes and the bell are measured here (X-DB-Trips) for round-trips.budget.json */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'flags_trips_secret_at_least_32_chars_padding';
const path = require('path');
const express = require('express');
const jsonWebToken = require('jsonwebtoken');
const API = path.join(__dirname, '..');
const net = require(path.join(API, 'src', 'services', 'network'));
const { query, withEntity } = require(path.join(API, 'db'));
const reqctx = require(path.join(API, 'lib', 'reqctx'));
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 600) : '')); } };
const RUN = 'ftr' + (Date.now() % 1e10).toString(36);
const madeIdentities = [];
const tokenFor = (claims) => jsonWebToken.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

async function business(tag) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [identity] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'IN', 'INR', $3) RETURNING identity_id, display_name`, [bridgeId, 'FlagTrips ' + tag + ' ' + RUN, bridgeId.toLowerCase()]);
  madeIdentities.push(identity.identity_id);
  return { tag, bridgeId, id: identity.identity_id, name: identity.display_name, node: await net.nodeOf(identity.identity_id, { ensure: true }) };
}
const ownerToken = (biz) => tokenFor({ identity_id: biz.id, identity_type: 'entity', bridge_id: biz.bridgeId, display_name: biz.name });
async function person(biz, tag, level, whole) {
  const { rows: [row] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, parent_entity_id, country, currency_code, user_id, access_level, whole_entity, can_see_costs, hat) VALUES ($1, $2, 'actor', $3, 'IN', 'INR', $4, $5, $6, true, 'act') RETURNING identity_id, display_name`, [biz.bridgeId + tag, 'Person ' + tag + ' ' + RUN, biz.id, (biz.bridgeId + tag).toLowerCase(), level, whole !== false]);
  madeIdentities.push(row.identity_id);
  return { id: row.identity_id, biz, token: tokenFor({ identity_id: row.identity_id, identity_type: 'actor', bridge_id: biz.bridgeId, display_name: row.display_name, parent_entity_id: biz.id }) };
}
let base = '';
const TRIPS = {}; /* the dearest successful call of each route */
const WARM = {}; /* the last successful call of each route: the one after the first call has probed the migration (a cached read) */
async function call(token, method, route, opts) {
  const o = opts || {};
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  if (o.member) headers['x-books-for'] = o.member;
  if (o.role) headers['x-books-role'] = o.role;
  const res = await fetch(base + route, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  if (res.status < 300 && res.headers.get('x-db-trips')) { const k = method + ' ' + route.replace(/[0-9]+/g, ':n').split('?')[0]; TRIPS[k] = Math.max(TRIPS[k] || 0, Number(res.headers.get('x-db-trips'))); WARM[k] = Number(res.headers.get('x-db-trips')); }
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body };
}

async function main() {
  const P = await business('p'), C = await business('c');
  const asked = await net.requestConnect({ parentId: P.node.id, childId: C.node.id }, P.node);
  await net.approve({ edgeId: asked.id }, C.node);
  const aud1 = await person(P, 'a', 'commenter'), acct1 = await person(P, 'b', 'editor');
  const partner = ownerToken(P), cOwner = ownerToken(C);
  const app = express();
  app.use(require(path.join(API, 'lib', 'trips')).middleware());
  app.use(express.json());
  for (const [mount, file] of [['/api/books', 'books.js'], ['/api/books-grants', 'books-grants.js'], ['/api/flags', 'flags.js']]) app.use(mount, require(path.join(API, 'routes', file)));
  app.use((err, req, res, next) => res.status(500).json({ code: 'TEST_500', message: String(err && err.message) }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    await withEntity(C.id, (h) => require(path.join(API, 'lib', 'country-setup.js')).save(h, C.id, { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: '33AAAAA0000A1Z9', scheme: 'regular' }, source: { tax: 'typed' } }, C.id));
    const on = await call(cOwner, 'POST', '/api/books/enable', { body: {} });
    const gA = await call(cOwner, 'POST', '/api/books-grants', { body: { grantee: P.id, purpose: 'audit of the books', consent: true } });
    const gV = await call(cOwner, 'POST', '/api/books-grants', { body: { grantee: P.id, purpose: 'adviser of the books', consent: true, preset: 'adviser', posting: 'owner_approves' } });
    ok('0 client C: ledger on, P holds an auditor grant and an adviser grant', on.status === 200 && gA.status === 201 && gV.status === 201, JSON.stringify([on.status, gA.status, gV.status]));
    const uuid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
    const items = (from, count) => Array.from({ length: count }, (_, i) => ({ id: uuid(from + i), label: 'Entry ' + (from + i) }));
    const NOW = new Date(Date.now() - 1000).toISOString();

    for (const [who, token, subject] of [['firm person on a client', aud1.token, C.id], ['firm adviser on a client', acct1.token, C.id], ['owner on his own books', partner, P.id]]) {
      const bm = await call(token, 'POST', '/api/flags', { body: { kind: 'bookmark', subject_kind: 'posting', subject_entity: subject, items: items(1000 + (subject === C.id ? 0 : 500), 200) } });
      ok('1 ' + who + ' bookmarks 200 records in one write: 201 and 200 made', bm.status === 201 && bm.body.created === 200, JSON.stringify(bm).slice(0, 300));
      const note = await call(token, 'POST', '/api/flags', { body: { kind: 'note', visibility: 'org', subject_kind: 'posting', subject_entity: subject, items: items(5000 + (subject === C.id ? 0 : 500), 1), note: 'Check this before sign-off' } });
      const noteId = note.body && note.body.flags && note.body.flags[0] && note.body.flags[0].flag_id;
      ok('2 ' + who + ' writes a My-firm note: 201', note.status === 201 && !!noteId, JSON.stringify(note).slice(0, 300));
      const q = await call(token, 'POST', '/api/flags/query', { body: { subject_kind: 'posting', subject_entity: subject, ids: items(1000 + (subject === C.id ? 0 : 500), 200).map((x) => x.id) } });
      ok('3 ' + who + ' reads the flags of 200 records in one read: 200', q.status === 200 && Object.keys(q.body.flags).length === 200, JSON.stringify(q).slice(0, 200));
      const resolved = await call(token, 'POST', '/api/flags/' + noteId + '/resolve', { body: {} });
      const reopened = await call(token, 'POST', '/api/flags/' + noteId + '/reopen', { body: {} });
      ok('4 ' + who + ' resolves and reopens the note: 200 and 200', resolved.status === 200 && reopened.status === 200, JSON.stringify([resolved.status, reopened.status]));
      const mine = await call(token, 'POST', '/api/flags', { body: { kind: 'note', visibility: 'me', subject_kind: 'posting', subject_entity: subject, items: items(6000 + (subject === C.id ? 0 : 500), 1), note: 'Only for me' } });
      const meId = mine.body && mine.body.flags && mine.body.flags[0] && mine.body.flags[0].flag_id;
      const shared = await call(token, 'POST', '/api/flags/' + meId + '/share', { body: {} });
      ok('5 ' + who + ' shares an Only-me note: 201 then 200', mine.status === 201 && shared.status === 200, JSON.stringify([mine.status, shared.status]));
      const removed = await call(token, 'POST', '/api/flags/' + noteId + '/remove', { body: {} });
      ok('6 ' + who + ' removes the note: 200', removed.status === 200, JSON.stringify(removed).slice(0, 200));
      const cleared = await call(token, 'POST', '/api/flags/clear', { body: { subject_entity: subject, from: '2020-01-01', to: '2099-12-31' } });
      ok('7 ' + who + ' clears the 200 bookmarks of the client in one act: 200 and 200 cleared', cleared.status === 200 && cleared.body.cleared === 200, JSON.stringify(cleared).slice(0, 200));
    }
    const base1 = await call(aud1.token, 'POST', '/api/books-grants/practice/baseline', { body: { client: C.id, seen_to: NOW } });
    const base2 = await call(acct1.token, 'POST', '/api/books-grants/practice/baseline', { body: { client: C.id, seen_to: NOW } });
    ok('8 the auditor and the adviser mark the client as checked: 201 and 201', base1.status === 201 && base2.status === 201, JSON.stringify([base1.status, base1.body, base2.status]));
    console.log('  trips ' + JSON.stringify(TRIPS));
    console.log('  warm  ' + JSON.stringify(WARM));
  } finally {
    server.close();
  }
}
async function cleanup() {
  const nodes = (await query(`SELECT e.id FROM cb_entity e JOIN identities i ON upper(i.bridge_id) = upper(e.bridge_id) WHERE i.identity_id = ANY($1::uuid[])`, [madeIdentities])).rows.map((x) => x.id);
  await query(`DELETE FROM cb_edge WHERE parent_id = ANY($1::uuid[]) OR child_id = ANY($1::uuid[])`, [nodes]);
  await query(`DELETE FROM cb_entity WHERE id = ANY($1::uuid[])`, [nodes]);
  await query(`DELETE FROM identities WHERE identity_id = ANY($1::uuid[])`, [madeIdentities]);
}
(async () => {
  console.log('\n── FLAG WRITES AND PRACTICE CHECK POINT: round trips through the REAL sign-in (cb_app, RLS on) · run ' + RUN + ' ──');
  try { await main(); } catch (e) { ok('the run reached its end', false, e && e.stack); } finally { await cleanup().catch((e) => console.log('  note  the throwaway businesses stay: ' + (e && e.code))); }
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
