'use strict';
/**
 * tests/books-baseline-route.realstack.cjs — AUDITOR RANK 10, the two ROUTES on a REAL Postgres, through the REAL routes/books.js and routes/books-grants.js (only the sign-in is a stand-in, as in acc-176-books-grant.realstack.cjs):
 *   GET /api/books/daybook?since=mine (under a live auditor grant) and POST /api/books-grants/practice/baseline.
 * Run on a THROWAWAY migrated database, as the app role:  DATABASE_URL=postgres://cb_app:...@host/db ADMIN=postgres://postgres:...@host/db node tests/books-baseline-route.realstack.cjs
 * ADMIN seeds the client's journal rows (the books are insert-only for the app). Without both variables it says so and exits 0.
 * HAND-COMPUTED  firm P with two auditor-seat people A and B; client M (an India shop, ledger switched on, a live auditor grant to P). M's books: three entries E1 (5 days ago), E2 (2 days ago), E3 (1 day ago, posting date a year back).
 *   A reads ?since=mine: total 3, newest posted first (E3, E2, E1), each with recorded_at, seen_to = E3's created_at, since.never = true; from/to are ignored (E3 is outside any current period).
 *   A marks checked with that seen_to: 201; the read says 0 entries; one more entry E4: 1.   B (never marked) still reads 4.   M's own owner asking ?since=mine: 400 BOOKS_SINCE_FIRM_ONLY.
 *   Look log: A's reads are logged as GET /daybook with the query shape 'since' (a key, never a moment); the mark wrote NO look row; a future seen_to is 400; the client is not told of any baseline.
 */
const assert = require('assert');
const crypto = require('crypto');
if (!process.env.ADMIN || !process.env.DATABASE_URL) { console.log('skipped: needs DATABASE_URL (cb_app) and ADMIN (a throwaway migrated database)'); process.exit(0); }
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'rank10_test_secret_at_least_32_chars_padding';
const path = require('path');
const express = require('express');
const API = path.join(__dirname, '..');
const authPath = require.resolve(path.join(API, 'middleware', 'auth.js'));
const reqctx = require(path.join(API, 'lib', 'reqctx'));
const fakeAuth = (req, res, next) => { /* as middleware/auth: the rest of the request runs with the identity as the database actor (after a grant swap, the synthetic one) */
  if (!req.identity) { try { req.identity = JSON.parse(String(req.headers['x-test-as'] || '')); } catch (_) { return res.status(401).json({ error: 'no test identity' }); } }
  return reqctx.runWithActor(req.identity.identity_id, () => next());
};
fakeAuth.entityOf = (req) => req.identity.parent_entity_id || req.identity.identity_id;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };
const { Client } = require('pg');
const net = require(path.join(API, 'src', 'services', 'network'));
const { query, withEntity } = require(path.join(API, 'db'));
const grants = require(path.join(API, 'lib', 'books-grant.js'));

let pass = 0;
const ok = (what, cond, info) => { assert.ok(cond, what + (info ? ' :: ' + String(info).slice(0, 400) : '')); pass++; console.log('  ok   ' + what); };
const RUN = 'rk10r' + (Date.now() % 1e10).toString(36).padStart(6, '0');
const made = [];
async function business(tag, country, currency) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [identity] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', $4, $5, $3) RETURNING identity_id`, [bridgeId, 'RK10 ' + tag + ' ' + RUN, bridgeId.toLowerCase(), country, currency]);
  made.push(identity.identity_id);
  return { tag, bridgeId, id: identity.identity_id, node: await net.nodeOf(identity.identity_id, { ensure: true }) };
}
const ownerOf = (biz) => ({ identity_id: biz.id, bridge_id: biz.bridgeId, identity_type: 'entity', parent_entity_id: null, display_name: biz.tag });
const AUDITOR = { access_level: 'commenter', whole_entity: true, can_see_costs: true };
const staffOf = (biz, name) => Object.assign({ identity_id: crypto.randomUUID(), identity_type: 'actor', parent_entity_id: biz.id, bridge_id: biz.bridgeId, display_name: name, access_level: 'editor', whole_entity: false, can_see_costs: false }, AUDITOR);
let base = '';
async function call(who, method, route, o) {
  const opts = o || {};
  const headers = { 'content-type': 'application/json', 'x-test-as': JSON.stringify(who) };
  if (opts.member) headers['x-books-for'] = opts.member;
  const res = await fetch(base + route, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body };
}

(async () => {
  const admin = new Client({ connectionString: process.env.ADMIN });
  await admin.connect();
  const q = (sql, params) => admin.query(sql, params);
  const P = await business('p', 'AU', 'AUD'), M = await business('m', 'IN', 'INR');
  const A = staffOf(P, 'Auditor A'), B = staffOf(P, 'Auditor B');
  const app = express(); app.use(express.json());
  app.use('/api/books', require(path.join(API, 'routes', 'books.js')));
  app.use('/api/books-grants', require(path.join(API, 'routes', 'books-grants.js')));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    const asEdge = await net.requestConnect({ parentId: P.node.id, childId: M.node.id }, P.node); await net.approve({ edgeId: asEdge.id }, M.node);
    await withEntity(M.id, (h) => require(path.join(API, 'lib', 'country-setup.js')).save(h, M.id, { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: '33AAAAA0000A1Z9', scheme: 'regular' }, source: { tax: 'typed' } }, M.id));
    const enabled = await call(ownerOf(M), 'POST', '/api/books/enable', { body: {} });
    ok('the client switches its real ledger on', enabled.status === 200, JSON.stringify(enabled.body));
    const given = await call(ownerOf(M), 'POST', '/api/books-grants', { body: { grantee: P.id, purpose: 'audit of the books', consent: true } });
    ok('the client grants the firm (auditor)', given.status === 201, JSON.stringify(given.body));
    await q("UPDATE books_access_grant SET granted_at = now() - interval '10 days' WHERE grantor_entity = $1", [M.id]); /* the grant began 10 days ago: the three entries below came after it */
    const accounts = (await q('SELECT account_id FROM ledger_account WHERE entity_id = $1 ORDER BY code LIMIT 2', [M.id])).rows;
    ok('the switched-on ledger has a chart', accounts.length === 2);
    let n = 0;
    const post = async (ago, posting) => {
      const e = (await q(`INSERT INTO journal_entry (entity_id, entry_no, posting_date, fiscal_year, period, event_type, currency, total_minor, created_at) VALUES ($1,$2,$3,'FY2025-26',4,'manual','INR',10000, now() - $4::interval) RETURNING entry_id, created_at`, [M.id, 'RK10R-' + RUN + '-' + ++n, posting, ago])).rows[0];
      /* b904: one statement carries both sides, so the entry balances at its own commit */
      await q(`INSERT INTO journal_line (line_id, entry_id, entity_id, line_no, account_id, dr_minor, cr_minor, currency) SELECT (SELECT COALESCE(max(line_id),0) FROM journal_line)+n, $1, $2, n, CASE n WHEN 1 THEN $3::uuid ELSE $4::uuid END, CASE n WHEN 1 THEN 10000 ELSE 0 END, CASE n WHEN 1 THEN 0 ELSE 10000 END, 'INR' FROM generate_series(1,2) n`, [e.entry_id, M.id, accounts[0].account_id, accounts[1].account_id]);
      return e;
    };
    const E1 = await post('5 days', '2026-11-12'), E2 = await post('2 days', '2026-11-15'), E3 = await post('1 day', '2025-11-17');
    const looks = async () => (await grants.looks(M.id, { limit: 500 })).length;

    let r = await call(A, 'GET', '/api/books/daybook?since=mine', { member: M.id });
    ok('A reads ?since=mine: 200, total 3, newest posted first (E3, E2, E1)', r.status === 200 && r.body.total === 3 && r.body.entries.map((x) => x.entry_id).join() === [E3, E2, E1].map((x) => x.entry_id).join(), JSON.stringify(r.body).slice(0, 300));
    ok('the back-dated E3 (posting date a year ago, outside any current period) is listed: the filter ignores from/to', r.body.entries[0].entry_id === E3.entry_id && r.body.entries[0].posting_date === '2025-11-17');
    ok('each entry says when it was posted (recorded_at)', r.body.entries.every((x) => !!x.recorded_at));
    ok('seen_to is the newest created_at of the client\'s entries (E3 is not the newest: E3 was posted 1 day ago, the newest is E3)', new Date(r.body.seen_to).getTime() === new Date(E3.created_at).getTime(), r.body.seen_to + ' vs ' + E3.created_at);
    ok('no baseline yet: since.never = true (counted from the start of the grant)', r.body.since && r.body.since.never === true);
    const afterRead = await looks();
    const rows = await grants.looks(M.id, { limit: 50 });
    ok('the read is logged as GET /daybook with the query shape "since" (a key, never a moment)', rows.some((x) => x.route_pattern === 'GET /daybook' && x.query_shape && /since/.test(x.query_shape) && !/\d{4}-\d\d/.test(x.query_shape)), JSON.stringify(rows[0]));

    const future = await call(A, 'POST', '/api/books-grants/practice/baseline', { body: { client: M.id, seen_to: new Date(Date.now() + 864e5).toISOString() } });
    ok('a seen_to in the future: 400 BOOKS_BASELINE_SEEN_TO', future.status === 400 && future.body.code === 'BOOKS_BASELINE_SEEN_TO', JSON.stringify(future));
    const stranger = await call(A, 'POST', '/api/books-grants/practice/baseline', { body: { client: crypto.randomUUID(), seen_to: r.body.seen_to } });
    ok('a client the firm has no grant on: 403 BOOKS_GRANT_NONE', stranger.status === 403 && stranger.body.code === 'BOOKS_GRANT_NONE', JSON.stringify(stranger));
    const owner = await call(ownerOf(M), 'POST', '/api/books-grants/practice/baseline', { body: { client: M.id, seen_to: r.body.seen_to } });
    ok('the client\'s own owner cannot mark its own books checked: 403', owner.status === 403, JSON.stringify(owner));
    const marked = await call(A, 'POST', '/api/books-grants/practice/baseline', { body: { client: M.id, seen_to: r.body.seen_to } });
    ok('A marks checked at the watermark: 201', marked.status === 201 && marked.body.client === M.id && !!marked.body.made_at, JSON.stringify(marked));
    ok('the mark wrote no look row (the client never sees a baseline)', (await looks()) === afterRead);

    r = await call(A, 'GET', '/api/books/daybook?since=mine', { member: M.id });
    ok('A reads again: 0 entries, total 0, since.never = false', r.status === 200 && r.body.total === 0 && r.body.entries.length === 0 && r.body.since.never === false, JSON.stringify(r.body).slice(0, 300));
    const E4 = await post('0 seconds', '2026-11-17');
    r = await call(A, 'GET', '/api/books/daybook?since=mine', { member: M.id });
    ok('one more entry E4: 1', r.body.total === 1 && r.body.entries[0].entry_id === E4.entry_id, JSON.stringify(r.body).slice(0, 200));
    const other = await call(B, 'GET', '/api/books/daybook?since=mine', { member: M.id });
    ok('B never marked: still counts from the start of the grant (4), A\'s mark is not shared', other.body.total === 4 && other.body.since.never === true, JSON.stringify(other.body.total));
    const ownRead = await call(ownerOf(M), 'GET', '/api/books/daybook?since=mine');
    ok('the client\'s own session asking ?since=mine: 400 BOOKS_SINCE_FIRM_ONLY', ownRead.status === 400 && ownRead.body.code === 'BOOKS_SINCE_FIRM_ONLY', JSON.stringify(ownRead));
    const plain = await call(A, 'GET', '/api/books/daybook?from=2026-11-01&to=2026-11-30', { member: M.id });
    ok('the ordinary Day book is unchanged: no seen_to, no since keys', plain.status === 200 && plain.body.seen_to === undefined && plain.body.since === undefined && Array.isArray(plain.body.entries), Object.keys(plain.body).join());
    const base0 = await query('SELECT 1');
    ok('the baseline table holds only the firm\'s rows: the client\'s own session reads none', (await withEntity(M.id, (h) => h.query('SELECT count(*)::int AS n FROM books_review_baseline'))).rows[0].n === 0 && base0.rows.length === 1);
    console.log('\n' + pass + ' passed, 0 failed');
  } finally {
    server.close();
    await admin.end();
  }
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.stack || e); process.exit(1); });
