'use strict';
/**
 * tests/msg2-before-b877.realstack.cjs — THE API BEFORE THE FILE RUNS (REQ-FIRM-MESSAGING test 19): on a database WITHOUT b877 (every other migration applied) the bell, the watermark and the note thread answer in words, never a 500, and behave as they did before.
 * Needs a scratch database built by tools/fresh-db-check.cjs from a migrations/ folder that LACKS b877_firm_messaging.sql (the SIT recipe in the report builds it).
 *   1 the firm's bell, the count and the feed answer 200 for the auditor seat and for the owner login (the three-parameter mark_notices is not there: the two-parameter call takes over).
 *   2 a colleague's reply does NOT ring (the person is unknown) but the owner's reply does: the old organisation rule, exactly as before.
 *   3 opening the bell stamps the organisation's mark (200), the badge goes to 0.
 *   4 a My-firm note: the thread reads with no messages and says in words that replies are not switched on; a reply is a 503 FLAG_REPLIES_NOT_MIGRATED, not a 500.
 * Run: DATABASE_URL=postgres://cb_app:...@db:5432/<scratch without b877> node tests/msg2-before-b877.realstack.cjs
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'msg2_realauth_secret_at_least_32_chars_padding';
const path = require('path');
const express = require('express');
const jsonWebToken = require('jsonwebtoken');
const API = path.join(__dirname, '..');
const net = require(path.join(API, 'src', 'services', 'network'));
const { query, withEntity } = require(path.join(API, 'db'));

let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 500) : '')); } };
const RUN = 'm2b' + (Date.now() % 1e10).toString(36);
const made = [];
const tokenFor = (claims) => jsonWebToken.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
async function business(tag) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [identity] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'IN', 'INR', $3) RETURNING identity_id, display_name`, [bridgeId, 'Pre ' + tag + ' ' + RUN, bridgeId.toLowerCase()]);
  made.push(identity.identity_id);
  return { bridgeId, id: identity.identity_id, name: identity.display_name, node: await net.nodeOf(identity.identity_id, { ensure: true }) };
}
const ownerToken = (biz) => tokenFor({ identity_id: biz.id, identity_type: 'entity', bridge_id: biz.bridgeId, display_name: biz.name });
async function person(biz, tag, level) {
  const { rows: [row] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, parent_entity_id, country, currency_code, user_id, access_level, whole_entity, can_see_costs, hat) VALUES ($1, $2, 'actor', $3, 'IN', 'INR', $4, $5, true, true, 'act') RETURNING identity_id, display_name`, [biz.bridgeId + tag, 'Person ' + tag + ' ' + RUN, biz.id, (biz.bridgeId + tag).toLowerCase(), level]);
  made.push(row.identity_id);
  return { id: row.identity_id, token: tokenFor({ identity_id: row.identity_id, identity_type: 'actor', bridge_id: biz.bridgeId, display_name: row.display_name, parent_entity_id: biz.id }) };
}
let base = '';
async function call(token, method, route, opts) {
  const o = opts || {};
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  if (o.member) headers['x-books-for'] = o.member;
  if (o.role) headers['x-books-role'] = o.role;
  const res = await fetch(base + route, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body };
}
const markReplies = (bell) => ((bell && bell.notifications) || []).filter((x) => x.action === 'mark_reply');

async function main() {
  const P = await business('p'), C = await business('c');
  const asked = await net.requestConnect({ parentId: P.node.id, childId: C.node.id }, P.node); await net.approve({ edgeId: asked.id }, C.node);
  const aud1 = await person(P, 'a', 'commenter'), acct1 = await person(P, 'b', 'editor'), cOwner = ownerToken(C), pOwner = ownerToken(P);
  const app = express();
  app.use(express.json());
  for (const [mount, file] of [['/api/books', 'books.js'], ['/api/books-grants', 'books-grants.js'], ['/api/marks', 'marks.js'], ['/api/notifications', 'notifications.js'], ['/api/flags', 'flags.js']]) app.use(mount, require(path.join(API, 'routes', file)));
  app.use((err, req, res, next) => res.status(500).json({ code: 'TEST_500', message: String(err && err.message) }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    const gone = (await query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'mark_notices' AND pronargs = 3`)).rows[0].n;
    ok('0 the scratch database really lacks b877 (no three-parameter mark_notices)', gone === 0, gone);
    await withEntity(C.id, (h) => require(path.join(API, 'lib', 'country-setup.js')).save(h, C.id, { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: '33AAAAA0000A1Z9', scheme: 'regular' }, source: { tax: 'typed' } }, C.id));
    await call(cOwner, 'POST', '/api/books/enable', { body: {} });
    const gA = await call(cOwner, 'POST', '/api/books-grants', { body: { grantee: P.id, purpose: 'audit of the books', consent: true } });
    const gV = await call(cOwner, 'POST', '/api/books-grants', { body: { grantee: P.id, purpose: 'adviser of the books', consent: true, preset: 'adviser', posting: 'owner_approves' } });
    ok('0b P holds an auditor grant and an adviser grant', gA.status === 201 && gV.status === 201);
    const day = new Date().toISOString().slice(0, 10);
    const accounts = (await call(cOwner, 'GET', '/api/books/accounts')).body;
    const list = accounts.accounts || accounts.rows || accounts || [];
    const cash = (list.find((x) => /cash/i.test(x.name || '')) || {}).code || '1000';
    const sales = (list.find((x) => /^sales/i.test(x.name || '')) || {}).code || '4000';
    const E1 = (await call(cOwner, 'POST', '/api/books/entries', { body: { narration: 'pre ' + RUN, date: day, client_ref: RUN + 'e1', lines: [{ code: cash, dr_minor: 10000 }, { code: sales, cr_minor: 10000 }] } })).body;
    const q = await call(aud1.token, 'POST', '/api/marks', { member: C.id, role: 'auditor', body: { adopter: 'acc.audit', subject_id: E1.entry_id, kind: 'query', note: 'Which bank?' } });
    const thread = q.body && q.body.mark && q.body.mark.thread_id;
    ok('1a aud1 raises a Query: 201', q.status === 201 && !!thread, JSON.stringify(q).slice(0, 300));
    await call(cOwner, 'POST', '/api/marks/' + thread + '/messages', { body: { message_text: 'Owner words.' } });
    await call(acct1.token, 'POST', '/api/marks/' + thread + '/messages', { member: C.id, role: 'adviser', body: { message_text: 'Colleague words.' } });
    const feed = await call(aud1.token, 'GET', '/api/notifications'), count = await call(aud1.token, 'GET', '/api/notifications?count=1'), ownerFeed = await call(pOwner, 'GET', '/api/notifications'), ownerCount = await call(pOwner, 'GET', '/api/notifications?count=1');
    ok('1 the bell, the count and the feed answer 200 for the auditor seat and the owner login', [feed, count, ownerFeed, ownerCount].every((r) => r.status === 200), JSON.stringify([feed.status, count.status, ownerFeed.status, ownerCount.status]));
    ok('2 as before: the owner\'s reply rings, the colleague\'s does not', markReplies(feed.body).some((x) => /Owner words/.test(x.detail || '')) && !markReplies(feed.body).some((x) => /Colleague words/.test(x.detail || '')) && count.body.count >= 1, JSON.stringify(markReplies(feed.body)).slice(0, 300));
    const seen = await call(aud1.token, 'POST', '/api/notifications/seen'), after = await call(aud1.token, 'GET', '/api/notifications?count=1');
    ok('3 opening the bell: 200 and the badge reads 0', seen.status === 200 && after.body.count === 0, JSON.stringify([seen.status, after.body]));
    const note = await call(aud1.token, 'POST', '/api/flags', { body: { kind: 'note', visibility: 'org', subject_kind: 'posting', subject_entity: C.id, items: [{ id: E1.entry_id, label: 'pre test' }], note: 'A note' } });
    const flagId = note.body && note.body.flags && note.body.flags[0] && note.body.flags[0].flag_id;
    const thr = await call(acct1.token, 'GET', '/api/flags/' + flagId + '/messages'), rep = await call(acct1.token, 'POST', '/api/flags/' + flagId + '/messages', { body: { message_text: 'hello' } });
    ok('4a the thread reads (200) with no replies and says in words that replies are not switched on', thr.status === 200 && thr.body.messages.length === 0 && thr.body.may.reply.ok === false && /not switched on/.test(thr.body.may.reply.why || ''), JSON.stringify(thr).slice(0, 300));
    ok('4b a reply is a 503 in words, not a 500', rep.status === 503 && /not switched on/.test(JSON.stringify(rep.body)), JSON.stringify(rep).slice(0, 300));
  } finally {
    server.close();
  }
}
async function cleanup() {
  const nodes = (await query(`SELECT e.id FROM cb_entity e JOIN identities i ON upper(i.bridge_id) = upper(e.bridge_id) WHERE i.identity_id = ANY($1::uuid[])`, [made])).rows.map((x) => x.id);
  await query(`DELETE FROM cb_edge WHERE parent_id = ANY($1::uuid[]) OR child_id = ANY($1::uuid[])`, [nodes]);
  await query(`DELETE FROM cb_entity WHERE id = ANY($1::uuid[])`, [nodes]);
  await query(`DELETE FROM identities WHERE identity_id = ANY($1::uuid[])`, [made]);
}
(async () => {
  console.log('\n── THE API BEFORE b877 (cb_app, RLS on) · run ' + RUN + ' ──');
  try { await main(); } catch (e) { ok('the run reached its end', false, e && e.stack); } finally { await cleanup().catch((e) => console.log('  note  the throwaway businesses stay: ' + (e && e.code))); }
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
