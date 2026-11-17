'use strict';
/**
 * r3-bell-clear.realstack.cjs — R3 (Fable re-press, 17 Nov 2026): the bell's Clear all covers the Query and reply notices derived from review marks (mark_notices): they are cleared under their own uuid in notif_dismissed (b164, per entity by RLS), the feed and the badge leave them out, a NEW reply shows again.
 * Real sign-in tokens, cb_app, RLS on. Run: DATABASE_URL=postgres://cb_app:...@127.0.0.1:<port>/<db> node tests/r3-bell-clear.realstack.cjs
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

    // ── R3 · Clear all covers the derived notices (Query / reply): one dismissal per notice under its own uuid (notif_dismissed, b164: no migration) ──
    const badge = async (who) => ((await call(who, 'GET', '/api/notifications?count=1')).body || {}).count;
    const rowsOf = async (who) => markRows((await call(who, 'GET', '/api/notifications')).body || {});
    const before = { owner: (await rowsOf(owner)).length, U: (await rowsOf(U.token)).length, A: (await rowsOf(A.token)).length };
    ok('R3-0 before the clear: the owner holds the Query and the accountant reply, the auditor holds both replies, the accountant holds the owner reply', before.owner === 2 && before.U === 2 && before.A >= 1, JSON.stringify(before));
    ok('R3-0b the badge counts them (owner 2)', (await badge(owner)) === 2, String(await badge(owner)));
    const one = (await rowsOf(owner)).find((x) => x.action === 'mark_query');
    const oneOut = await call(owner, 'POST', '/api/notifications/dismiss', { body: { log_ids: [one.log_id] } });
    ok('R3-1 clearing ONE notice by its own id (mk:<uuid>) answers 200 with 1 cleared; the other stays', oneOut.status === 200 && oneOut.body.cleared === 1 && (await rowsOf(owner)).length === 1 && (await badge(owner)) === 1, JSON.stringify(oneOut));
    for (const [name, who] of [['owner', owner], ['U (auditor)', U.token], ['A (accountant)', A.token]]) {
      const out = await call(who, 'POST', '/api/notifications/dismiss', { body: { all: true } });
      const feedAfter = (await call(who, 'GET', '/api/notifications')).body || {};
      ok('R3-2 ' + name + ': Clear all answers 200, then re-open: 0 mark notices, badge 0', out.status === 200 && markRows(feedAfter).length === 0 && (await badge(who)) === 0, JSON.stringify([out.status, out.body, markRows(feedAfter).length]));
    }
    const again = await call(owner, 'POST', '/api/notifications/dismiss', { body: { all: true } });
    ok('R3-3 Clear all twice: 200, nothing left to clear, the repeat counts once', again.status === 200 && again.body.cleared === 0, JSON.stringify(again));
    const r3 = await call(owner, 'POST', '/api/marks/' + thread + '/messages', { body: { message_text: 'One more thing: the slip is scanned.' } });
    const uAfter = await rowsOf(U.token);
    ok('R3-4 a NEW reply after the clear shows again for the firm (a new uuid), only that one; the badge is 1', r3.status === 201 && uAfter.length === 1 && /slip is scanned/.test(uAfter[0].detail || '') && (await badge(U.token)) === 1, JSON.stringify([r3.status, uAfter.length]));
    const r4 = await call(A.token, 'POST', '/api/marks/' + thread + '/messages', { member: M1.id, role: 'adviser', body: { message_text: 'Banked on the 3rd.' } });
    const oAfter = await rowsOf(owner);
    ok('R3-5 and a new reply from the firm shows again for the owner, who had cleared', r4.status === 201 && oAfter.length === 1 && /Banked on the 3rd/.test(oAfter[0].detail || ''), JSON.stringify([r4.status, oAfter.length]));
    const alien = await call(owner, 'POST', '/api/notifications/dismiss', { body: { log_ids: ['mk:00000000-0000-0000-0000-000000000000'] } });
    ok('R3-6 an id nobody has clears as before: 200, and a made-up prefix is no id (cleared 0 or 1, never a 500)', alien.status === 200, JSON.stringify(alien));
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
