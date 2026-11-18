'use strict';
const { shopToday, shopDayAt } = require('./lib/shop-day.cjs'); /* the shop's own day, never the UTC day (tzsweep) */
/**
 * tests/biz-firm.realstack.cjs — BUSINESS SCENARIOS MNY-FIRM-* (the practice and its clients) on REAL Postgres as cb_app (RLS on), through the real routes (routes/books.js, routes/books-grants.js) and the real grant front.
 * Only the sign-in is a stand-in (x-test-as names who calls), exactly as tests/bank-split-card.realstack.cjs and tests/adviser-bank.realstack.cjs, whose harness this follows. Hand figures in minor units (AU cents), written before any run.
 * Source: toolset/sitfull/biz-money-expected.json (branch test/scenarios-money-1118). Covers the access and period rules the books enforce; leaves out the firm screens (e2e) and review marks/queries (no door in this build: see the scenario verdict).
 *   MNY-FIRM-05 the adviser seat that may not post is refused, nothing posted; the owner posts the same line.   MNY-FIRM-27 a second client of the practice stays separate.   MNY-FIRM-13 a client outside the grant answers as an id that does not exist.
 *   MNY-FIRM-15/24 revoking a grant ends the adviser's access at the next call, no figure returned.   MNY-FIRM-14 a staff member cannot widen access (only the client owner grants).   MNY-FIRM-12 a month locked refuses a late document; the reopen is a record and posting works again.
 * Run: DATABASE_URL=postgres://cb_app:...@<db host>/<throwaway db> node tests/biz-firm.realstack.cjs   CARD 16-finance/books-grants
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'banksplit_test_secret_at_least_32_chars_pad';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const API = path.join(__dirname, '..');

const authPath = require.resolve(path.join(API, 'middleware', 'auth.js'));
const { query, withEntity } = require(path.join(API, 'db'));
const fakeAuth = async (req, res, next) => {
  if (req.identity) return next();
  let who;
  try { who = JSON.parse(String(req.headers['x-test-as'] || '')); } catch (_) { return res.status(401).json({ error: 'no test identity' }); }
  if (who.identity_type === 'actor' && /^[0-9a-f-]{36}$/i.test(String(who.identity_id))) {
    const row = (await query('SELECT break_status, access_level, whole_entity, can_see_costs FROM identities WHERE identity_id = $1', [who.identity_id])).rows[0];
    if (!row || ['removed', 'deactivated'].includes(row.break_status)) return res.status(401).json({ code: 'ACCESS_REVOKED' });
    Object.assign(who, { access_level: row.access_level, whole_entity: row.whole_entity === true, can_see_costs: row.can_see_costs === true });
  }
  req.identity = who;
  return next();
};
fakeAuth.entityOf = (req) => req.identity.parent_entity_id || req.identity.identity_id;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };

const net = require(path.join(API, 'src', 'services', 'network'));
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 700) : '')); } };
const RUN = 'bf' + (Date.now() % 1e10).toString(36).padStart(6, '0');
const code = (r) => r.body && r.body.code;

async function business(tag) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [identity] } = await query("INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'AU', 'AUD', $3) RETURNING identity_id, display_name", [bridgeId, 'Card split ' + tag + ' ' + RUN, bridgeId.toLowerCase()]);
  return { tag, bridgeId, id: identity.identity_id, name: identity.display_name, node: await net.nodeOf(identity.identity_id, { ensure: true }) };
}
async function join(parent, member) {
  const asked = await net.requestConnect({ parentId: parent.node.id, childId: member.node.id }, parent.node);
  await net.approve({ edgeId: asked.id }, member.node);
}
const ownerOf = (biz) => ({ identity_id: biz.id, bridge_id: biz.bridgeId, identity_type: 'entity', parent_entity_id: null, display_name: biz.name });
async function person(biz, tag, level) {
  const { rows: [row] } = await query("INSERT INTO identities (bridge_id, display_name, identity_type, parent_entity_id, country, currency_code, user_id, access_level, whole_entity, can_see_costs, hat) VALUES ($1, $2, 'actor', $3, 'AU', 'AUD', $4, $5, true, true, 'act') RETURNING identity_id, display_name", [biz.bridgeId + tag, 'Person ' + tag + ' ' + RUN, biz.id, (biz.bridgeId + tag).toLowerCase(), level]);
  return { identity_id: row.identity_id, identity_type: 'actor', parent_entity_id: biz.id, bridge_id: biz.bridgeId, display_name: row.display_name };
}
let base = '';
async function call(who, method, route, opts) {
  const o = opts || {};
  const headers = { 'content-type': 'application/json', 'x-test-as': JSON.stringify(who), 'idempotency-key': 'bs-' + crypto.randomUUID() };
  if (o.member) headers['x-books-for'] = o.member;
  if (o.role) headers['x-books-role'] = o.role;
  const res = await fetch(base + route, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body };
}
const give = (P, M, extra) => call(ownerOf(M), 'POST', '/api/books-grants', { body: Object.assign({ grantee: P.id, purpose: 'bank reconciliation', consent: true }, extra) });
const adv = (who, M, method, route, body) => call(who, method, '/api/books' + route, { member: M.id, role: 'adviser', body });

async function ledgerOn(M) {
  await withEntity(M.id, (h) => require(path.join(API, 'lib', 'country-setup.js')).save(h, M.id, { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: true, number: '51824753556', scheme: 'regular' }, source: { tax: 'typed' } }, M.id));
  const on = await call(ownerOf(M), 'POST', '/api/books/enable', { body: {} });
  ok('the ledger of ' + M.tag + ' is on', on.status === 200, JSON.stringify(on));
}
const day = shopToday();
let n = 0;
const body = (extra) => Object.assign({ kind: 'expense', class: 'bank_charges', amount_minor: 1500, paid_from: 'bank', narration: 'ACCOUNT SERVICE FEE', date: day, client_ref: RUN + '-' + (++n) }, extra);
/** the trial balance as { code: dr - cr }, zero rows dropped, read by `who` (owner, or an adviser/auditor through the grant) */
async function tb(who, M, role) {
  const r = await call(who, 'GET', '/api/books/trial-balance?asOf=' + day + '', role ? { member: M.id, role } : {});
  if (r.status !== 200) return { status: r.status, body: r.body };
  const out = {};
  ((r.body && r.body.rows) || []).forEach((row) => { const v = (Number(row.dr_minor) || 0) - (Number(row.cr_minor) || 0); if (v) out[row.code] = v; });
  return out;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function kase(id, title, fn) { try { await fn(); ok(id + ' ' + title, true); } catch (e) { ok(id + ' ' + title, false, e.message); } }
const expect = (c, said) => { if (!c) throw new Error(said); };

async function main() {
  const P = await business('p'); const M1 = await business('1'); const M2 = await business('2'); const M3 = await business('3'); const M4 = await business('4');
  for (const M of [M1, M2, M4]) await join(P, M);
  const A = await person(P, 'a', 'editor'); const U = await person(P, 'u', 'commenter');
  const app = express();
  app.use(express.json());
  app.use('/api/books', require(path.join(API, 'routes', 'books.js')));
  app.use('/api/books-grants', require(path.join(API, 'routes', 'books-grants.js')));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const M of [M1, M2, M3, M4]) await ledgerOn(M);
    const gPost = await give(P, M1, { preset: 'adviser', posting: 'adviser_posts' });
    const gAppr = await give(P, M2, { preset: 'adviser', posting: 'owner_approves' });
    const gAud = await give(P, M1, { preset: 'auditor' });
    const gLock = await give(P, M4, { preset: 'adviser', posting: 'adviser_posts' });
    expect([gPost, gAppr, gAud, gLock].every((g) => g.status === 201), 'grants ' + JSON.stringify([gPost, gAppr, gAud, gLock].map((g) => g.status + ' ' + code(g))));

    await kase('MNY-FIRM-05', 'the adviser seat never posts directly (403 GRANT_ROUTE_NOT_LISTED: its writes go through /api/books-actions), the auditor too; nothing posted, TB unchanged; the owner posts the same 15.00 (Dr 6090 1500 / Cr 1500 1500)', async () => {
      const a = await tb(ownerOf(M2), M2);
      const r1 = await adv(A, M2, 'POST', '/events', body());
      expect(r1.status === 403 && code(r1) === 'GRANT_ROUTE_NOT_LISTED', 'adviser (no direct write on /events, ADVISER_DOORS): ' + r1.status + ' ' + JSON.stringify(r1.body).slice(0, 200));
      const r2 = await call(U, 'POST', '/api/books/events', { member: M1.id, role: 'auditor', body: body() });
      expect(r2.status === 403 && ['GRANT_READ_ONLY', 'GRANT_ROUTE_NOT_LISTED'].includes(code(r2)), 'auditor: ' + r2.status + ' ' + JSON.stringify(r2.body).slice(0, 200));
      expect(same(await tb(ownerOf(M2), M2), a) && same(await tb(ownerOf(M1), M1), {}), 'a refused seat wrote to the books');
      const mine = await call(ownerOf(M2), 'POST', '/api/books/events', { body: body() });
      expect(mine.status === 200, 'owner ' + mine.status);
      expect(same(await tb(ownerOf(M2), M2), { 1500: -1500, 6090: 1500 }), 'owner posting moved ' + JSON.stringify(await tb(ownerOf(M2), M2)));
    });

    await kase('MNY-FIRM-27', 'a second client of the practice stays separate: the owner of M1 posts 550.00 (Dr 6120 55000 / Cr 1500); M2 is unchanged; the adviser seat reads M1 55000 and M2 only its own figures', async () => {
      const m2a = await tb(ownerOf(M2), M2);
      const r = await call(ownerOf(M1), 'POST', '/api/books/events', { body: body({ class: 'professional', amount_minor: 55000, narration: 'REX PIPES DEPOSIT' }) });
      expect(r.status === 200, 'owner post on M1 ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
      expect(same(await tb(ownerOf(M1), M1), { 1500: -55000, 6120: 55000 }), 'M1 moved ' + JSON.stringify(await tb(ownerOf(M1), M1)));
      expect(same(await tb(ownerOf(M2), M2), m2a), 'M2 moved when M1 was posted');
      expect(same(await tb(A, M2, 'adviser'), m2a), 'the adviser seat on M2 reads another figure than the owner: ' + JSON.stringify(await tb(A, M2, 'adviser')));
      expect(same(await tb(A, M1, 'adviser'), { 1500: -55000, 6120: 55000 }), 'the adviser seat on M1 reads another figure than the owner');
    });

    await kase('MNY-FIRM-13', 'a client outside the grant (M3) answers the adviser exactly as an id that does not exist: same status, same code, same sentence, no figure', async () => {
      const outside = await call(A, 'GET', '/api/books/trial-balance?asOf=' + day + '', { member: M3.id, role: 'adviser' });
      const ghost = await call(A, 'GET', '/api/books/trial-balance?asOf=' + day + '', { member: '00000000-0000-4000-8000-000000000bad', role: 'adviser' });
      expect(outside.status >= 400 && outside.status === ghost.status && code(outside) === code(ghost), 'outside ' + outside.status + ' ' + code(outside) + ' vs ghost ' + ghost.status + ' ' + code(ghost));
      expect(!(outside.body && outside.body.rows), 'a figure came back for a client outside the grant');
      expect(String(outside.body && (outside.body.detail || outside.body.message)) === String(ghost.body && (ghost.body.detail || ghost.body.message)), 'the sentence differs: ' + JSON.stringify(outside.body).slice(0, 200) + ' vs ' + JSON.stringify(ghost.body).slice(0, 200));
    });

    await kase('MNY-FIRM-14', 'a staff member cannot widen access: the editor gives a grant on M3 and is refused (nothing created); the client owner gives it (201) and the seat then reads M3', async () => {
      const bad = await call(A, 'POST', '/api/books-grants', { member: M3.id, body: { grantee: P.id, preset: 'adviser', consent: true, purpose: 'self assign' } });
      expect(bad.status >= 400 && bad.status < 500, 'staff grant on M3 expected 4xx, got ' + bad.status + ' ' + JSON.stringify(bad.body).slice(0, 200));
      const still = await call(A, 'GET', '/api/books/trial-balance?asOf=' + day + '', { member: M3.id, role: 'adviser' });
      expect(still.status >= 400, 'after the refused self-assign the seat reads M3: ' + still.status);
      await join(P, M3); /* the client joins the practice's network, then its owner gives the seat */
      const g = await give(P, M3, { preset: 'adviser', posting: 'owner_approves' });
      expect(g.status === 201, 'owner grant ' + g.status);
      expect((await call(A, 'GET', '/api/books/trial-balance?asOf=' + day + '', { member: M3.id, role: 'adviser' })).status === 200, 'after the owner grant the seat cannot read M3');
    });

    await kase('MNY-FIRM-15', 'revoking the grant ends access at the next call (24: the client leaves): before 200 with figures, after refused with no figure, books untouched; the old seat cannot post either', async () => {
      const before = await call(A, 'GET', '/api/books/trial-balance?asOf=' + day + '', { member: M2.id, role: 'adviser' });
      expect(before.status === 200 && Array.isArray(before.body.rows), 'before revoke ' + before.status);
      const rv = await call(ownerOf(M2), 'POST', '/api/books-grants/' + gAppr.body.grant_id + '/revoke', { body: {} });
      expect(rv.status === 200, 'revoke ' + rv.status + ' ' + JSON.stringify(rv.body).slice(0, 200));
      const after = await call(A, 'GET', '/api/books/trial-balance?asOf=' + day + '', { member: M2.id, role: 'adviser' });
      expect(after.status >= 400 && !(after.body && after.body.rows), 'after revoke the seat still reads: ' + after.status + ' ' + JSON.stringify(after.body).slice(0, 160));
      const w = await adv(A, M2, 'POST', '/events', body());
      expect(w.status >= 400, 'after revoke the seat still posts: ' + w.status);
      expect(same(await tb(ownerOf(M2), M2), { 1500: -1500, 6090: 1500 }), 'revoke or the refused post changed the owner books');
    });

    await kase('MNY-FIRM-12', 'a locked month refuses a late document (owner: 409 naming the lock, nothing posted; the adviser seat: 403 before it gets that far); the reopen answers open and the owner posting works again', async () => {
      const periods = (await call(ownerOf(M4), 'GET', '/api/books/periods')).body;
      const rows = Array.isArray(periods.periods || periods.rows || periods) ? (periods.periods || periods.rows || periods) : [];
      const row = rows.find((r) => String(r.start_date).slice(0, 10) <= day && String(r.end_date).slice(0, 10) >= day);
      expect(row, 'no period row covers ' + day + ': ' + JSON.stringify(periods).slice(0, 200));
      const fy = row.fiscal_year || periods.fiscal_year, pno = Number(row.period);
      const lk = await call(ownerOf(M4), 'POST', '/api/books/periods/' + fy + '/' + pno + '/lock', { body: {} });
      expect(lk.status === 200, 'lock ' + lk.status);
      const late = await call(ownerOf(M4), 'POST', '/api/books/events', { body: body({ class: 'professional', amount_minor: 10000, input_tax_minor: 1000, tax_invoice: 'held' }) });
      expect((await adv(A, M4, 'POST', '/events', body())).status === 403, 'the adviser seat was not refused');
      expect(late.status === 409 && /lock/i.test(JSON.stringify(late.body)), 'late document expected 409 naming the lock, got ' + late.status + ' ' + JSON.stringify(late.body).slice(0, 200));
      expect(same(await tb(ownerOf(M4), M4), {}), 'a refused late document wrote to the books');
      const un = await call(ownerOf(M4), 'POST', '/api/books/periods/' + fy + '/' + pno + '/unlock', { body: { reason: 'late bill arrived' } });
      expect(un.status === 200 && un.body.period && un.body.period.status === 'open', 'reopen ' + un.status + ' ' + JSON.stringify(un.body).slice(0, 200));
      const again = await call(ownerOf(M4), 'POST', '/api/books/events', { body: body({ class: 'professional', amount_minor: 10000, input_tax_minor: 1000, tax_invoice: 'held' }) });
      expect(again.status === 200, 'after the reopen the bill is refused: ' + again.status + ' ' + JSON.stringify(again.body).slice(0, 200));
      expect(same(await tb(ownerOf(M4), M4), { 1500: -11000, 2210: 1000, 6120: 10000 }), 'books after reopen ' + JSON.stringify(await tb(ownerOf(M4), M4)) + ', hand {1500:-11000, 2210:1000, 6120:10000}');
    });
  } finally { server.close(); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
