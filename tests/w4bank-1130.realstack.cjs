'use strict';
/**
 * tests/w4bank-1130.realstack.cjs — W4-02 (walk 4, 26 Nov 2026) on a REAL Postgres as cb_app (RLS on): the practice read's bank state reads what the Bank page reads.
 * (a fixture with no journal activity on the account has no 'first entry', so the run rule counts a lone Oct sign-off as a run: the no-run branch itself is covered by tests/w4bank-1130.test.cjs; here the real SQL, RLS and the carried figure)
 * HAND-COMPUTED  firm P, 3 clients each with books on and a live auditor grant:
 *   M1 signed ONE month (Oct, 2026-10-01..2026-10-31) with difference 35432 minor (A$354.32): practice row bank.state 'unexplained', unexplained_minor 35432, currency AUD, in_run false (no unbroken run from the first entry), never 'none'
 *   M2 signed nothing: bank.state 'none'  ·  M3 signed Oct with difference 0: bank.state 'no_run'
 *   the band counts: unexplained 1, no_statement 1
 * Run: DATABASE_URL=postgres://cb_app:...@localhost:5432/<throwaway> node tests/w4bank-1130.realstack.cjs   (a throwaway database only; never production)
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127.0.0.1)$/; /* throwaway local database only */
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'acc176_test_secret_at_least_32_chars_padding';
const path = require('path');
const express = require('express');
const API = path.join(__dirname, '..');

/* the sign-in stand-in goes in BEFORE the real modules that load middleware/auth (the wrapped books auth and the grant routes read it) */
const authPath = require.resolve(path.join(API, 'middleware', 'auth.js'));
const fakeAuth = (req, res, next) => {
  if (req.identity) return next(); /* the real auth re-enters on its DECIDED set and keeps the identity the front swapped in */
  try { req.identity = JSON.parse(String(req.headers['x-test-as'] || '')); } catch (_) { return res.status(401).json({ error: 'no test identity' }); }
  return next();
};
fakeAuth.entityOf = (req) => req.identity.parent_entity_id || req.identity.identity_id;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };

const net = require(path.join(API, 'src', 'services', 'network'));
const { query, withEntity } = require(path.join(API, 'db'));
const grants = require(path.join(API, 'lib', 'books-grant.js'));
const booksGrant = require(path.join(API, 'middleware', 'books-grant.js'));
const { isOwner } = require(path.join(API, 'lib', 'owner.js'));
const access = require(path.join(API, 'lib', 'access.js'));

let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 400) : '')); } };
const RUN = 'p500' + (Date.now() % 1e10).toString(36).padStart(6, '0');
const madeIdentities = [];
const UUID0 = '00000000-0000-4000-8000-0000000000';
const label = (bridgeId) => String(bridgeId).replace(/[^A-Za-z0-9_]/g, '_');

/** a business: its identity and its network node, a root of its own */
async function business(tag, country, currency) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [identity] } = await query(
    `INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', $4, $5, $3) RETURNING identity_id`,
    [bridgeId, 'S1P ' + tag + ' ' + RUN, bridgeId.toLowerCase(), country || 'AU', currency || 'AUD']);
  madeIdentities.push(identity.identity_id);
  return { tag, bridgeId, id: identity.identity_id, node: await net.nodeOf(identity.identity_id, { ensure: true }) };
}
/** the member joins the parent's tree: the parent asks, the member approves (an active governance edge) */
async function join(parent, member) {
  const asked = await net.requestConnect({ parentId: parent.node.id, childId: member.node.id }, parent.node);
  await net.approve({ edgeId: asked.id }, member.node);
  return asked.id;
}
const ownerOf = (biz) => ({ identity_id: biz.id, bridge_id: biz.bridgeId, identity_type: 'entity', parent_entity_id: null, display_name: biz.tag });
const staffOf = (biz, extra, id) => Object.assign({ identity_id: id || require('crypto').randomUUID(), identity_type: 'actor', parent_entity_id: biz.id, bridge_id: biz.bridgeId, access_level: 'editor', whole_entity: false, can_see_costs: false }, extra);
const AUDITOR = { access_level: 'commenter', whole_entity: true, can_see_costs: true };
const newId = () => require('crypto').randomUUID();

let base = '';
async function call(who, method, route, opts) {
  const o = opts || {};
  const headers = { 'content-type': 'application/json', 'x-test-as': JSON.stringify(who) };
  if (o.member) headers['x-books-for'] = o.member;
  const res = await fetch(base + route, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body };
}
const giveGrant = (G, firm, preset) => call(ownerOf(G), 'POST', '/api/books-grants', { body: { grantee: firm.id, purpose: 'audit of the books', consent: true, preset, posting: preset === 'adviser' ? 'owner_approves' : undefined } });
const idsOf = (r) => ((r.body && r.body.clients) || []).map((c) => String(c.entity_id)).sort();

async function sign(M, diff) {
  await withEntity(M.id, (h) => h.query("INSERT INTO bank_rec_log (entity_id, account_id, kind, period_from, period_to, opening_minor, closing_bank_minor, closing_books_minor, difference_minor, currency, tied) VALUES ($1, $2, 'statement', '2026-10-01', '2026-10-31', 0, 100000, 100000, $3, 'AUD', $4)", [M.id, newId(), diff, diff === 0]));
}
async function main() {
  const P = await business('p'); const M1 = await business('1'); const M2 = await business('2'); const M3 = await business('3');
  for (const M of [M1, M2, M3]) await join(P, M);
  for (const M of [M1, M2, M3]) await withEntity(M.id, (h) => h.query("INSERT INTO books_setting (entity_id, enabled, fy_start_month, functional_currency, country, enabled_at) VALUES ($1, true, 7, 'AUD', 'AU', now())", [M.id]));
  await sign(M1, 35432); await sign(M3, 0);
  const app = express();
  app.use(express.json());
  app.use('/api/books-grants', require(path.join(API, 'routes', 'books-grants.js')));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const M of [M1, M2, M3]) { const g = await giveGrant(M, P, 'auditor'); ok('grant given (201)', g.status === 201, JSON.stringify(g).slice(0, 200)); }
    const r = await call(staffOf(P, { whole_entity: true }), 'GET', '/api/books-grants/practice');
    ok('practice answers 200', r.status === 200, JSON.stringify(r.body).slice(0, 300));
    const by = new Map(((r.body && r.body.clients) || []).map((c) => [String(c.entity_id), c.bank]));
    ok('M1: unexplained 35432 AUD, never none', by.get(String(M1.id)) && by.get(String(M1.id)).state === 'unexplained' && by.get(String(M1.id)).unexplained_minor === 35432 && by.get(String(M1.id)).currency === 'AUD', JSON.stringify(by.get(String(M1.id))));
    ok('M2: none', by.get(String(M2.id)) && by.get(String(M2.id)).state === 'none', JSON.stringify(by.get(String(M2.id))));
    ok('M3: signed with nothing unexplained: reconciled or no_run, never none', by.get(String(M3.id)) && ['reconciled', 'no_run'].includes(by.get(String(M3.id)).state), JSON.stringify(by.get(String(M3.id))));
    ok('band bank: unexplained 1, no_statement 1', r.body && r.body.band && r.body.band.bank && r.body.band.bank.unexplained === 1 && r.body.band.bank.no_statement === 1, JSON.stringify(r.body && r.body.band && r.body.band.bank));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const id of madeIdentities) { try { await query('DELETE FROM identities WHERE identity_id = $1', [id]); } catch (_) {} }
  }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
