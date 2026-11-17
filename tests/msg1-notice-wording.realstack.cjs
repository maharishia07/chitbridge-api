'use strict';
/**
 * tests/msg1-notice-wording.realstack.cjs — MESSAGING E (wording) and D (who hears a reply) on a REAL Postgres through the REAL sign-in (middleware/auth is NOT replaced; every call carries a signed token).
 * HAND-COMPUTED  shop M1 (ledger on) gives firm P an auditor grant and an adviser grant; P has an auditor person U and an accountant person A.
 *   1 U raises a Query on entry E1 (201).  2 the owner replies (201).  3 A, the accountant, replies under the adviser door (201).
 *   4 E: the owner's bell row says mark_query and carries the entry number; the owner's Messages inbox lists the mark thread as subject_type 'mark' with the entry number (so the web words it "Query on <no>", not an order).
 *   5 the firm's bell (U's token, no door) holds the OWNER's reply (mr:).  6 D (b877 closed the gap): A's reply reaches U's bell (U raised the Query, so U is in the thread) and never A's own.
 *   7 the owner's bell holds the firm's reply of A (a different entity).
 * Run: DATABASE_URL=postgres://cb_app:...@localhost:5432/<scratch built by tools/fresh-db-check.cjs> node tests/msg1-notice-wording.realstack.cjs
 * CARD      22-channels-capture-and-messaging/notifications-and-the-bell
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'msg1_realauth_secret_at_least_32_chars_padding';
const path = require('path');
const express = require('express');
const jsonWebToken = require('jsonwebtoken');
const API = path.join(__dirname, '..');
const net = require(path.join(API, 'src', 'services', 'network'));
const { query, withEntity } = require(path.join(API, 'db'));

let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 500) : '')); } };
const RUN = 'm1w' + (Date.now() % 1e10).toString(36);
const madeIdentities = [];
const tokenFor = (claims) => jsonWebToken.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

async function business(tag) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [identity] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'IN', 'INR', $3) RETURNING identity_id, display_name`, [bridgeId, 'Msg1 ' + tag + ' ' + RUN, bridgeId.toLowerCase()]);
  madeIdentities.push(identity.identity_id);
  return { tag, bridgeId, id: identity.identity_id, name: identity.display_name, node: await net.nodeOf(identity.identity_id, { ensure: true }) };
}
const ownerToken = (biz) => tokenFor({ identity_id: biz.id, identity_type: 'entity', bridge_id: biz.bridgeId, display_name: biz.name });
async function person(biz, tag, level) {
  const { rows: [row] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, parent_entity_id, country, currency_code, user_id, access_level, whole_entity, can_see_costs, hat) VALUES ($1, $2, 'actor', $3, 'IN', 'INR', $4, $5, true, true, 'act') RETURNING identity_id, display_name`, [biz.bridgeId + tag, 'Person ' + tag + ' ' + RUN, biz.id, (biz.bridgeId + tag).toLowerCase(), level]);
  madeIdentities.push(row.identity_id);
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
const markRows = (bell) => ((bell && (bell.notifications || bell.items || bell.feed || bell.activity)) || []).filter((x) => /^mark_/.test(x.action));

async function main() {
  const P = await business('p'); const M1 = await business('1');
  const asked = await net.requestConnect({ parentId: P.node.id, childId: M1.node.id }, P.node); await net.approve({ edgeId: asked.id }, M1.node);
  const U = await person(P, 'u', 'commenter'); const A = await person(P, 'a', 'editor');
  const app = express();
  app.use(express.json());
  app.use('/api/books', require(path.join(API, 'routes', 'books.js')));
  app.use('/api/books-grants', require(path.join(API, 'routes', 'books-grants.js')));
  app.use('/api/marks', require(path.join(API, 'routes', 'marks.js')));
  app.use('/api/notifications', require(path.join(API, 'routes', 'notifications.js')));
  app.use('/api/folders', require(path.join(API, 'routes', 'folders.js')));
  app.use((err, req, res, next) => res.status(500).json({ code: 'TEST_500', message: String(err && err.message) }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    const owner = ownerToken(M1);
    await withEntity(M1.id, (h) => require(path.join(API, 'lib', 'country-setup.js')).save(h, M1.id, { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: '33AAAAA0000A1Z9', scheme: 'regular' }, source: { tax: 'typed' } }, M1.id));
    const on = await call(owner, 'POST', '/api/books/enable', { body: {} });
    const gA = await call(owner, 'POST', '/api/books-grants', { body: { grantee: P.id, purpose: 'audit of the books', consent: true } });
    const gV = await call(owner, 'POST', '/api/books-grants', { body: { grantee: P.id, purpose: 'adviser of the books', consent: true, preset: 'adviser', posting: 'owner_approves' } });
    ok('0 ledger on, the firm holds an auditor grant and an adviser grant (real tokens)', on.status === 200 && gA.status === 201 && gV.status === 201, JSON.stringify([on.status, gA.status, gV.status, gV.body]));
    const accounts = (await call(owner, 'GET', '/api/books/accounts')).body;
    const list = accounts.accounts || accounts.rows || accounts || [];
    const cash = (list.find((a) => /cash/i.test(a.name || '')) || {}).code || '1000';
    const sales = (list.find((a) => /^sales/i.test(a.name || '')) || {}).code || '4000';
    const day = new Date().toISOString().slice(0, 10);
    const E1 = (await call(owner, 'POST', '/api/books/entries', { body: { narration: 'msg1 ' + RUN, date: day, client_ref: RUN + 'e1', lines: [{ code: cash, dr_minor: 10000 }, { code: sales, cr_minor: 10000 }] } })).body;
    const q = await call(U.token, 'POST', '/api/marks', { member: M1.id, role: 'auditor', body: { adopter: 'acc.audit', subject_id: E1.entry_id, kind: 'query', note: 'Which bank took this cash?' } });
    ok('1 U raises a Query on E1: 201', q.status === 201, JSON.stringify(q));
    const thread = q.body && q.body.mark && q.body.mark.thread_id;
    const r1 = await call(owner, 'POST', '/api/marks/' + thread + '/messages', { body: { message_text: 'Cash in hand, banked on Monday.' } });
    ok('2 the owner replies: 201', r1.status === 201, JSON.stringify(r1));
    const r2 = await call(A.token, 'POST', '/api/marks/' + thread + '/messages', { member: M1.id, role: 'adviser', body: { message_text: 'Deposit slip is on file.' } });
    ok('3 A, the accountant, replies under the adviser door: 201', r2.status === 201, JSON.stringify(r2));

    const ownerBell = (await call(owner, 'GET', '/api/notifications')).body || {};
    const oRows = markRows(ownerBell);
    const oQuery = oRows.find((x) => x.action === 'mark_query');
    ok('4a the owner\'s bell holds the Query row naming the entry number (the web words it "raised a Query on <no>")', oQuery && oQuery.mark_entry && oQuery.mark_entry.entry_no === E1.entry_no, JSON.stringify(ownerBell).slice(0, 400));
    ok('7 the owner\'s bell holds the firm\'s reply of A (a different entity)', oRows.filter((x) => x.action === 'mark_reply').length === 1 && /Deposit slip/.test(JSON.stringify(oRows)), JSON.stringify(oRows).slice(0, 400));
    const inbox = (await call(owner, 'GET', '/api/folders/messages?all=1')).body || {};
    const markMsgs = (inbox.messages || []).filter((m) => m.subject_type === 'mark');
    ok('4b the owner\'s Messages inbox carries the mark thread as subject_type mark with the entry number and no track (never "the order as a whole")', markMsgs.length >= 1 && markMsgs.every((m) => m.mark_entry_no === E1.entry_no && m.track === null && m.subject_id === thread), JSON.stringify(inbox).slice(0, 500));
    const firmBell = (await call(U.token, 'GET', '/api/notifications')).body || {};
    const fRows = markRows(firmBell);
    ok('5 the firm\'s bell holds the OWNER\'s reply', fRows.some((x) => /banked on Monday/.test(x.detail || '')), JSON.stringify(firmBell).slice(0, 400));
    ok('6 D (closed by b877): the colleague reply (A) IS in the firm bell for U, who raised the Query; the person rule drops only the reader OWN words', fRows.some((x) => /Deposit slip/.test(x.detail || '')), JSON.stringify(fRows).slice(0, 400));
    const aBell = markRows((await call(A.token, 'GET', '/api/notifications')).body || {});
    ok('6b A own reply is NOT in A own bell', !aBell.some((x) => /Deposit slip/.test(x.detail || '')), JSON.stringify(aBell).slice(0, 300));
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
  console.log('\n── MESSAGING E + D through the REAL sign-in (cb_app, RLS on) · run ' + RUN + ' ──');
  try { await main(); } catch (e) { ok('the run reached its end', false, e && e.stack); } finally { await cleanup().catch((e) => console.log('  note  the throwaway businesses stay: ' + (e && e.code))); }
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
