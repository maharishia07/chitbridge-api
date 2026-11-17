'use strict';
const { shopToday, shopDayAt } = require('./lib/shop-day.cjs'); /* the shop's own day, never the UTC day (tzsweep) */
/**
 * tests/secmsg-flag-race-cap.realstack.cjs — the 17 Nov 2026 attack run's three findings on b877, held shut (REAL Postgres, REAL sign-in, cb_app with RLS on; needs b868, b870, b876, b877).
 *   S1 a removal racing replies on the same note leaves NO reply text (FOR SHARE OF f in lib/message-post postFlagMessage; the reply's statement and the removal cannot cross).
 *   S2 a note takes at most FLAG_REPLY_CAP replies; the next is a 409 in words and the thread reads at most that many.
 *   S3 a mark-subject message another organisation planted in ITS OWN entity does not ring the thread owner (mark_notices is a definer and reads every entity: the arm names c.entity_id = t.entity_id).
 * Run: DATABASE_URL=postgres://cb_app:...@db:5432/<scratch built by tools/fresh-db-check.cjs> node tests/secmsg-flag-race-cap.realstack.cjs
 * CARD      22-channels-capture-and-messaging/notifications-and-the-bell
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.CB_TRIPS = '1'; /* the round trips of the new flag routes and the bell are measured here (X-DB-Trips) for round-trips.budget.json */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'msg2_realauth_secret_at_least_32_chars_padding';
const path = require('path');
const express = require('express');
const jsonWebToken = require('jsonwebtoken');
const API = path.join(__dirname, '..');
const net = require(path.join(API, 'src', 'services', 'network'));
const { query, withEntity } = require(path.join(API, 'db'));
const reqctx = require(path.join(API, 'lib', 'reqctx'));

let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 600) : '')); } };
const RUN = 'm2f' + (Date.now() % 1e10).toString(36);
const madeIdentities = [];
const tokenFor = (claims) => jsonWebToken.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

async function business(tag) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [identity] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'IN', 'INR', $3) RETURNING identity_id, display_name`, [bridgeId, 'Msg2 ' + tag + ' ' + RUN, bridgeId.toLowerCase()]);
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
async function call(token, method, route, opts) {
  const o = opts || {};
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  if (o.member) headers['x-books-for'] = o.member;
  if (o.role) headers['x-books-role'] = o.role;
  const res = await fetch(base + route, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  if (res.status < 300 && res.headers.get('x-db-trips')) { const k = method + ' ' + route.replace(/[0-9]+/g, ':n').split('?')[0]; TRIPS[k] = Math.max(TRIPS[k] || 0, Number(res.headers.get('x-db-trips'))); }
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body };
}
/** a DB count in a party's OWN session: the organisation bound, the person set (as the api does for a request) */
const countIn = (entityId, actorId, sql, args) => reqctx.runWithActor(actorId || null, () => withEntity(entityId, (db) => db.query(sql, args || []))).then((r) => Number(r.rows[0].n));
const rowsOf = (bell) => ((bell && bell.notifications) || []);
const noteRows = (bell) => rowsOf(bell).filter((x) => x.action === 'note_reply');
const markReplies = (bell) => rowsOf(bell).filter((x) => x.action === 'mark_reply');
const badge = async (who) => (await call(who.token || who, 'GET', '/api/notifications?count=1')).body || {};
const feed = async (who) => (await call(who.token || who, 'GET', '/api/notifications')).body || {};

async function main() {
  const P = await business('p'), C = await business('c'), K = await business('k'), F2 = await business('f');
  for (const [parent, child] of [[P, C]]) { const asked = await net.requestConnect({ parentId: parent.node.id, childId: child.node.id }, parent.node); await net.approve({ edgeId: asked.id }, child.node); }
  const aud1 = await person(P, 'a', 'commenter'), acct1 = await person(P, 'b', 'editor'), late = await person(P, 'l', 'commenter'), seatless = await person(P, 's', 'viewer', false);
  const cashier = await person(C, 'x', 'viewer', false), f2staff = await person(F2, 'z', 'editor');
  const partner = ownerTokenOf(P), cOwner = ownerTokenOf(C), kOwner = ownerTokenOf(K), f2Owner = ownerTokenOf(F2);
  function ownerTokenOf(biz) { return { token: ownerToken(biz), id: biz.id }; }
  const app = express();
  app.use(require(path.join(API, 'lib', 'trips')).middleware());
  app.use(express.json());
  for (const [mount, file] of [['/api/books', 'books.js'], ['/api/books-grants', 'books-grants.js'], ['/api/marks', 'marks.js'], ['/api/notifications', 'notifications.js'], ['/api/folders', 'folders.js'], ['/api/flags', 'flags.js']]) app.use(mount, require(path.join(API, 'routes', file)));
  app.use((err, req, res, next) => res.status(500).json({ code: 'TEST_500', message: String(err && err.message) }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    await withEntity(C.id, (h) => require(path.join(API, 'lib', 'country-setup.js')).save(h, C.id, { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: '33AAAAA0000A1Z9', scheme: 'regular' }, source: { tax: 'typed' } }, C.id));
    const on = await call(cOwner.token, 'POST', '/api/books/enable', { body: {} });
    const gA = await call(cOwner.token, 'POST', '/api/books-grants', { body: { grantee: P.id, purpose: 'audit of the books', consent: true } });
    const gV = await call(cOwner.token, 'POST', '/api/books-grants', { body: { grantee: P.id, purpose: 'adviser of the books', consent: true, preset: 'adviser', posting: 'owner_approves' } });
    ok('0 client C: ledger on, P holds an auditor grant and an adviser grant', on.status === 200 && gA.status === 201 && gV.status === 201, JSON.stringify([on.status, gA.status, gV.status]));
    const accounts = (await call(cOwner.token, 'GET', '/api/books/accounts')).body;
    const list = accounts.accounts || accounts.rows || accounts || [];
    const cash = (list.find((a) => /cash/i.test(a.name || '')) || {}).code || '1000';
    const sales = (list.find((a) => /^sales/i.test(a.name || '')) || {}).code || '4000';
    const day = shopToday();
    const entry = async (ref) => (await call(cOwner.token, 'POST', '/api/books/entries', { body: { narration: 'msg2 ' + RUN + ref, date: day, client_ref: RUN + ref, lines: [{ code: cash, dr_minor: 10000 }, { code: sales, cr_minor: 10000 }] } })).body;
    const E1 = await entry("e1");
    const { FLAG_REPLY_CAP } = require(path.join(API, 'lib', 'message-post'));
    const note = async (entryRow, text) => (await call(aud1.token, 'POST', '/api/flags', { body: { kind: 'note', visibility: 'org', subject_kind: 'posting', subject_entity: C.id, items: [{ id: entryRow.entry_id, label: entryRow.entry_no + ' · sec' }], note: text } })).body.flags[0].flag_id;
    // S1 · removal racing replies
    let leaked = 0;
    for (let i = 0; i < 6; i++) {
      const e = i === 0 ? E1 : await entry('r' + i);
      const fid = await note(e, 'race ' + i);
      const tag = 'RACE' + RUN + i + '_';
      await Promise.all([call(aud1.token, 'POST', '/api/flags/' + fid + '/remove'), ...Array.from({ length: 10 }, (_, k) => call(acct1.token, 'POST', '/api/flags/' + fid + '/messages', { body: { message_text: tag + k } }))]);
      leaked += await countIn(P.id, aud1.id, `SELECT count(*)::int AS n FROM chit_messages WHERE message_text LIKE $1`, [tag + '%']);
    }
    ok('S1 six removals racing ten replies each: 0 reply words survive at the database', leaked === 0, leaked);
    // S2 · the cap (rows written at the database, then one reply through the api)
    const capEntry = await entry('cap');
    const capId = await note(capEntry, 'cap note');
    const capThread = (await reqctx.runWithActor(aud1.id, () => withEntity(P.id, (db) => db.query(`SELECT thread_id::text AS t FROM private_flag WHERE flag_id = $1::bigint`, [capId])))).rows[0].t;
    await reqctx.runWithActor(aud1.id, () => withEntity(P.id, (db) => db.query(`INSERT INTO chit_messages (entity_id, chit_id, subject_type, subject_id, sender_entity_id, sender_display_name, thread_type, message_text) SELECT $1, NULL, 'flag', $2::uuid, $1, 'bulk', 'internal', 'bulk ' || g FROM generate_series(1, $3::int) g`, [P.id, capThread, FLAG_REPLY_CAP - 1])));
    const last = await call(acct1.token, 'POST', '/api/flags/' + capId + '/messages', { body: { message_text: 'the last one' } });
    const over = await call(acct1.token, 'POST', '/api/flags/' + capId + '/messages', { body: { message_text: 'one too many' } });
    const th = await call(aud1.token, 'GET', '/api/flags/' + capId + '/messages');
    ok('S2 reply number ' + FLAG_REPLY_CAP + ' is taken, the next is a 409 in words, the thread reads at most ' + FLAG_REPLY_CAP, last.status === 201 && over.status === 409 && /all the replies it can take/i.test(JSON.stringify(over.body)) && th.body.messages.length === FLAG_REPLY_CAP, JSON.stringify([last.status, over.status, JSON.stringify(over.body).slice(0, 300), th.body.messages && th.body.messages.length]));
    // S3 · a planted mark message
    const q = await call(aud1.token, 'POST', '/api/marks', { member: C.id, role: 'auditor', body: { adopter: 'acc.audit', subject_id: E1.entry_id, kind: 'query', note: 'Which bank took this cash?' } });
    const thread = q.body && q.body.mark && q.body.mark.thread_id;
    const FORGED = 'FORGEDBYK' + RUN;
    await reqctx.runWithActor(K.id, () => withEntity(K.id, (db) => db.query(`INSERT INTO chit_messages (entity_id, chit_id, subject_type, subject_id, sender_entity_id, sender_display_name, thread_type, message_text) VALUES ($1, NULL, 'mark', $2::uuid, $1, 'Your Auditor Ltd', 'external', $3)`, [K.id, thread, FORGED])));
    const cFeed = await call(cOwner.token, 'GET', '/api/notifications');
    const rows = await countIn(C.id, C.id, `SELECT count(*)::int AS n FROM mark_notices(90, 50, false) WHERE note LIKE 'FORGEDBYK%'`);
    ok('S3 a mark message K planted in its own entity is no notice for the thread owner (bell and function)', !JSON.stringify(cFeed.body).includes(FORGED) && rows === 0, rows);
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
  console.log('\n── SECMSG race, cap and planted notice through the REAL sign-in (cb_app, RLS on) · run ' + RUN + ' ──');
  try { await main(); } catch (e) { ok('the run reached its end', false, e && e.stack); } finally { await cleanup().catch((e) => console.log('  note  the throwaway businesses stay: ' + (e && e.code))); }
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
