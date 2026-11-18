'use strict';
const { shopToday, shopDayAt } = require('./lib/shop-day.cjs'); /* the shop's own day, never the UTC day (tzsweep) */
/**
 * tests/private-flag-account.realstack.cjs — the ACCOUNT subject of the private flags (an Explain note on a P&L account line, 'code@period end') and the Day book's country, on a REAL Postgres as cb_app (RLS on), through routes/flags.js.
 * Same fixture as private-flag-isolation.realstack.cjs (B the client, F1 adviser firm, F2 auditor firm with U1 + U2 + owner, F3 no grant).
 * HAND-COMPUTED  U1 writes ONE firm note on sales@day and ONE "Only me" note on cash@day = 2 rows. U2 and the F2 owner read 1 (the firm note); U1 reads 2; B, F1, F3 read 0 (list, query, database).
 * Run: DATABASE_URL=postgres://cb_app:cbapp@127.0.0.1:PORT/DB node tests/private-flag-account.realstack.cjs   (a scratch database built by tools/fresh-db-check.cjs; never a shared or production database)
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'private_flag_test_secret_at_least_32_chars_padding';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const API = path.join(__dirname, '..');

const authPath = require.resolve(path.join(API, 'middleware', 'auth.js'));
const { query, withEntity } = require(path.join(API, 'db'));
const reqctx = require(path.join(API, 'lib', 'reqctx.js'));
const fakeAuth = async (req, res, next) => {
  if (req.identity) return next();
  let who;
  try { who = JSON.parse(String(req.headers['x-test-as'] || '')); } catch (_) { return res.status(401).json({ error: 'no test identity' }); }
  if (who.api_key) { req.api_key = { key_id: 'test-key' }; }
  if (who.identity_type === 'actor' && /^[0-9a-f-]{36}$/i.test(String(who.identity_id))) {
    const row = (await query('SELECT break_status, access_level, whole_entity, can_see_costs FROM identities WHERE identity_id = $1', [who.identity_id])).rows[0];
    if (!row || ['removed', 'deactivated'].includes(row.break_status)) return res.status(401).json({ code: 'ACCESS_REVOKED' });
    Object.assign(who, { access_level: row.access_level, whole_entity: row.whole_entity === true, can_see_costs: row.can_see_costs === true });
  }
  req.identity = who;
  /* as the real auth does: the request runs with the REAL person as the actor, so every transaction opened under it sets app.current_actor */
  return reqctx.runWithActor(who.identity_id, () => next());
};
fakeAuth.entityOf = (req) => req.identity.parent_entity_id || req.identity.identity_id;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };

const net = require(path.join(API, 'src', 'services', 'network'));

let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 700) : '')); } };
const RUN = 'pf' + (Date.now() % 1e10).toString(36).padStart(6, '0');
const code = (r) => r.body && r.body.code;
const uuid = () => crypto.randomUUID();

async function business(tag) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [identity] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'IN', 'INR', $3) RETURNING identity_id, display_name`, [bridgeId, 'Flag ' + tag + ' ' + RUN, bridgeId.toLowerCase()]);
  return { tag, bridgeId, id: identity.identity_id, name: identity.display_name, node: await net.nodeOf(identity.identity_id, { ensure: true }) };
}
async function join(parent, member) {
  const asked = await net.requestConnect({ parentId: parent.node.id, childId: member.node.id }, parent.node);
  await net.approve({ edgeId: asked.id }, member.node);
}
const ownerOf = (biz) => ({ identity_id: biz.id, bridge_id: biz.bridgeId, identity_type: 'entity', parent_entity_id: null, display_name: biz.name });
/** a login of a business: `seat` true = whole entity, sees costs (the auditor / books-reading shape); false = shop staff with neither */
async function person(biz, tag, level, seat) {
  const { rows: [row] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, parent_entity_id, country, currency_code, user_id, access_level, whole_entity, can_see_costs, hat) VALUES ($1, $2, 'actor', $3, 'IN', 'INR', $4, $5, $6, $6, 'act') RETURNING identity_id, display_name`, [biz.bridgeId + tag, 'Person ' + tag + ' ' + RUN, biz.id, (biz.bridgeId + tag).toLowerCase(), level, seat]);
  return { identity_id: row.identity_id, identity_type: 'actor', parent_entity_id: biz.id, bridge_id: biz.bridgeId, display_name: row.display_name };
}
let base = '';
async function call(who, method, route, opts) {
  const o = opts || {};
  const headers = { 'content-type': 'application/json', 'x-test-as': JSON.stringify(who) };
  if (o.member) headers['x-books-for'] = o.member;
  if (o.role) headers['x-books-role'] = o.role;
  const res = await fetch(base + route, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body };
}
/** a statement in `entity`'s session as the real person `actor` (null = no actor at all: a job, a script), as cb_app with row security on */
const sqlAs = (entity, actor, text, params) => (actor ? reqctx.runWithActor(actor, () => withEntity(entity, (h) => h.query(text, params))) : withEntity(entity, (h) => h.query(text, params)));
const countAs = async (entity, actor, where, params) => Number((await sqlAs(entity, actor, 'SELECT count(*)::int AS n FROM private_flag WHERE ' + (where || 'true'), params || [])).rows[0].n);
const day = shopToday();
/** the masking of a recorded read: clocks and request ids differ between two runs, nothing else may */
const masked = (value) => JSON.stringify(value).replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, 'T').replace(/"(request_id|instance|trace_id)":"[^"]*"/g, '"$1":"-"');

async function main() {
  const B = await business('b'), F1 = await business('1'), F2 = await business('2'), F3 = await business('3');
  await join(F1, B); await join(F2, F1); await join(F3, await business('z')); /* tree-only: F2 is F1's parent, so it is B's ancestor: a grant of B to F2 is live, as the second firm of review-mark.realstack */
  const U1 = await person(F2, 'u1', 'commenter', true), U2 = await person(F2, 'u2', 'commenter', true), STAFF2 = await person(F2, 's2', 'editor', false);
  const A1 = await person(F1, 'a1', 'editor', true), X = await person(F3, 'x', 'commenter', true), CASH = await person(B, 'c', 'editor', false);
  const Y1 = await person(F1, 'y', 'editor', true), Y2 = await person(F2, 'y', 'commenter', true); /* one human, two firms: two logins, two identities */
  const ownerB = ownerOf(B), ownerF1 = ownerOf(F1), ownerF2 = ownerOf(F2), ownerF3 = ownerOf(F3);
  const app = express();
  app.use(express.json());
  app.use('/api/books', require(path.join(API, 'routes', 'books.js')));
  app.use('/api/books-grants', require(path.join(API, 'routes', 'books-grants.js')));
  app.use('/api/marks', require(path.join(API, 'routes', 'marks.js')));
  app.use('/api/flags', require(path.join(API, 'routes', 'flags.js')));
  app.use((err, req, res, next) => res.status(500).json({ code: 'TEST_500', message: String(err && err.message) }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    await withEntity(B.id, (h) => require(path.join(API, 'lib', 'country-setup.js')).save(h, B.id, { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: '33AAAAA0000A1Z9', scheme: 'regular' }, source: { tax: 'typed' } }, B.id));
    const on = await call(ownerB, 'POST', '/api/books/enable', { body: {} });
    ok('0 the ledger of B is on through the real gates', on.status === 200, JSON.stringify(on));
    const gA = await call(ownerB, 'POST', '/api/books-grants', { body: { grantee: F2.id, purpose: 'audit of the books', consent: true } });
    const gV = await call(ownerB, 'POST', '/api/books-grants', { body: { grantee: F1.id, purpose: 'adviser of the books', consent: true, preset: 'adviser', posting: 'owner_approves' } });
    ok('0 B gives F2 the auditor grant and F1 the adviser grant; F3 has none', gA.status === 201 && gV.status === 201, JSON.stringify([gA, gV]));
    const accounts = (await call(ownerB, 'GET', '/api/books/accounts')).body;
    const list = accounts.accounts || accounts.rows || accounts || [];
    const cash = (list.find((a) => /cash/i.test(a.name || '')) || {}).code || '1000';
    const sales = (list.find((a) => /^sales/i.test(a.name || '')) || {}).code || '4000';
    const post = async (tag) => (await call(ownerB, 'POST', '/api/books/entries', { body: { narration: 'flag ' + RUN + tag, date: day, client_ref: RUN + tag, lines: [{ code: cash, dr_minor: 10000 }, { code: sales, cr_minor: 10000 }] } })).body;
    const E1 = await post('e1'), E2 = await post('e2'), E3 = await post('e3');
    ok('0 three journals posted by the owner of B', E1 && E1.entry_id && E2.entry_id && E3.entry_id, JSON.stringify([E1, E2, E3]));
    const postFlag = (who, b, extra) => call(who, 'POST', '/api/flags', Object.assign({ body: b }, extra || {}));
    const acct = (c) => String(c).toLowerCase() + '@' + day;
    const plOf = async (who, extra) => masked((await call(who, 'GET', '/api/books/pl?from=' + day + '&to=' + day, extra)).body);
    const before = { b: await plOf(ownerB), u2: await plOf(U2, { member: B.id, role: 'auditor' }) };
    const firmNote = await postFlag(U1, { kind: 'note', subject_kind: 'account', subject_entity: B.id, items: [{ id: acct(sales), label: 'Sales' }], note: 'Explain: sales up on the festival week' });
    const meNote = await postFlag(U1, { kind: 'note', visibility: 'me', subject_kind: 'account', subject_entity: B.id, items: [{ id: acct(cash), label: 'Cash' }], note: 'my private doubt about cash' });
    ok('A1 U1 writes a firm Explain note on a P&L account line and an Only-me one: both 201, subject account', firmNote.status === 201 && meNote.status === 201 && firmNote.body.flags[0].subject_kind === 'account' && meNote.body.flags[0].visibility === 'me', JSON.stringify([firmNote, meNote]).slice(0, 400));
    const q = (who, ids, extra) => call(who, 'POST', '/api/flags/query', Object.assign({ body: { subject_kind: 'account', subject_entity: B.id, ids } }, extra || {}));
    const ids2 = [acct(sales), acct(cash)];
    const texts = (r) => JSON.stringify(r.body || {});
    const u2q = await q(U2, ids2), ownF2q = await q(ownerF2, ids2), u1q = await q(U1, ids2);
    ok('A2 a colleague (U2) and the F2 owner read the firm Explain note, never the Only-me one; U1 reads both', /festival week/.test(texts(u2q)) && !/private doubt/.test(texts(u2q)) && /festival week/.test(texts(ownF2q)) && !/private doubt/.test(texts(ownF2q)) && /festival week/.test(texts(u1q)) && /private doubt/.test(texts(u1q)), [u2q, ownF2q, u1q].map((r) => r.status).join(','));
    const u2list = await call(U2, 'GET', '/api/flags'), ownF2list = await call(ownerF2, 'GET', '/api/flags'), u1list = await call(U1, 'GET', '/api/flags');
    ok('A3 list: U2 and F2 owner see 1 account flag; U1 sees 2', u2list.body.total === 1 && ownF2list.body.total === 1 && u1list.body.total === 2, [u2list.body.total, ownF2list.body.total, u1list.body.total].join('/'));
    const strangers = [['B owner (the client)', ownerB], ['F1 owner (another firm)', ownerF1], ['A1 (F1 adviser)', A1], ['X (F3, no grant)', X], ['B cashier', CASH]];
    for (const [name, who] of strangers) {
      const l = await call(who, 'GET', '/api/flags'), qq = await q(who, ids2), qm = await q(who, ids2, { member: B.id, role: 'adviser' });
      const leaked = /festival week|private doubt/.test(texts(l) + texts(qq) + texts(qm));
      ok('A4 ' + name + ': list, query and query-as-member show 0 Explain notes (status ' + [l.status, qq.status, qm.status].join('/') + ')', !leaked && (l.status !== 200 || l.body.total === 0));
    }
    const dbAcc = "subject_kind = 'account'";
    ok('A5 DATABASE (RLS): account rows seen from B 0 · F1 0 · F3 0 · F2 as U2 1 · F2 as U1 2 · F2 owner 1 · F2 blank actor 1', (await countAs(B.id, ownerB.identity_id, dbAcc)) === 0 && (await countAs(F1.id, ownerF1.identity_id, dbAcc)) === 0 && (await countAs(F3.id, ownerF3.identity_id, dbAcc)) === 0 && (await countAs(F2.id, U2.identity_id, dbAcc)) === 1 && (await countAs(F2.id, U1.identity_id, dbAcc)) === 2 && (await countAs(F2.id, ownerF2.identity_id, dbAcc)) === 1 && (await countAs(F2.id, null, dbAcc)) === 1);
    ok('A5b DATABASE: B and F1 sessions asked for the F2 rows by subject_entity = B read 0 (the client cannot reach the firm space)', (await countAs(B.id, ownerB.identity_id, 'subject_entity = $1', [B.id])) === 0 && (await countAs(F1.id, ownerF1.identity_id, 'subject_entity = $1', [B.id])) === 0);
    ok('A6 DATABASE: the Only-me Explain row is unreadable to a colleague and the owner, readable to its author', (await countAs(F2.id, U2.identity_id, "visibility = 'me' AND " + dbAcc)) === 0 && (await countAs(F2.id, ownerF2.identity_id, "visibility = 'me' AND " + dbAcc)) === 0 && (await countAs(F2.id, U1.identity_id, "visibility = 'me' AND " + dbAcc)) === 1);
    ok('A7 the client\'s and the auditor\'s own P&L read is byte-identical before and after the notes (a note is never part of the books)', before.b === (await plOf(ownerB)) && before.u2 === (await plOf(U2, { member: B.id, role: 'auditor' })));
    const bad = await postFlag(U1, { kind: 'note', subject_kind: 'account', subject_entity: B.id, items: [{ id: 'not an account', label: 'x' }], note: 'x' });
    ok('A8 a malformed account id is 422', bad.status === 422, JSON.stringify(bad).slice(0, 200));
    const x404 = await postFlag(X, { kind: 'note', subject_kind: 'account', subject_entity: B.id, items: [{ id: acct(sales), label: 'Sales' }], note: 'forged' });
    ok('A9 F3 (no grant) cannot write an Explain on B\'s account line: 404', x404.status === 404, JSON.stringify(x404).slice(0, 200));
    const dbk = await call(U2, 'GET', '/api/books/daybook?from=' + day + '&to=' + day, { member: B.id, role: 'auditor' }), dbo = await call(ownerB, 'GET', '/api/books/daybook?from=' + day + '&to=' + day);
    ok('C1 the Day book answer carries the audited shop\'s country (IN) to the auditor and the owner', dbk.status === 200 && dbk.body.country === 'IN' && dbo.body.country === 'IN', JSON.stringify([dbk.status, dbk.body && dbk.body.country, dbo.body && dbo.body.country]));
  } finally {
    server.close();
  }
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('CRASH', e); process.exit(1); });
