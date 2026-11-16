'use strict';
/**
 * tests/l16-staff-areas2.realstack.cjs — W15-66 slice 2 on a REAL Postgres through the REAL sign-in (cb_app, RLS on): the money answers outside /api/books are a person's only when the owner opened the area.
 * It is also the LEAK PROBE: PROBE_OUT=<file> writes one line per persona x route (status and a hash of the answer with ids and times blanked), so the same file run on the base head and on this head
 * gives the before/after table and the byte-compare of the owner and of a person granted the area. The persona who is granted an area gets it by a direct write of identities.area_grants (the owner's PATCH is
 * proven in tests/l16-staff-areas.realstack.cjs), so the SAME probe runs on a head that has no PATCH for that area.
 * Run: DATABASE_URL=postgres://cb_app:...@<host>:5432/<throwaway db> [PROBE_OUT=/tmp/probe.tsv] node tests/l16-staff-areas2.realstack.cjs
 * OWNS the real-database half of lib/books-areas.DOORS and CARD_AREA, middleware/books-area-gate.areaDoor and routes/crm.js's party money mask.   CARD  18-identity-sign-in-and-access/access-levels
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|l16sa-db|l16sa2-db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'l16_areas2_realstack_secret_at_least_32_chars_padding';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const jsonWebToken = require('jsonwebtoken');
const API = path.join(__dirname, '..');
const net = require(path.join(API, 'src', 'services', 'network'));
const { query, withEntity } = require(path.join(API, 'db'));

let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 500) : '')); } };
const RUN = 'l16b' + (Date.now() % 1e10).toString(36);
const madeIdentities = [];
const OPEN_CARDS = ['till', 'counters', 'account', 'orders', 'operations', 'disputes', 'crm', 'assist'];
const MONEY_CARDS = { accounts: 'accounts', compare: 'accounts', reports: 'reports', finance: 'finance' };
const DOOR_ROUTES = { reports: ['/api/chits/rollup', '/api/folders/groupsum?scope=task', '/api/folders/reconcile', '/api/folders/mis'], accounts: ['/api/till/invoice-lease/report'] };
const OPEN_ROUTES = ['/api/chits/inbox', '/api/chits/sent', '/api/crm/parties'];

async function business(tag) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [identity] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'IN', 'INR', $3) RETURNING identity_id, display_name`, [bridgeId, 'L16B ' + tag + ' ' + RUN, bridgeId.toLowerCase()]);
  madeIdentities.push(identity.identity_id);
  return { tag, bridgeId, id: identity.identity_id, name: identity.display_name, node: await net.nodeOf(identity.identity_id, { ensure: true }) };
}
const tokenFor = (claims) => jsonWebToken.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
const ownerToken = (biz) => tokenFor({ identity_id: biz.id, identity_type: 'entity', bridge_id: biz.bridgeId, display_name: biz.name });
async function person(biz, tag, level, whole, costs, grants) {
  const hasGrants = (await query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'identities' AND column_name = 'area_grants'`)).rows.length > 0;
  const { rows: [row] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, parent_entity_id, country, currency_code, user_id, access_level, whole_entity, can_see_costs, hat) VALUES ($1, $2, 'actor', $3, 'IN', 'INR', $4, $5, $6, $7, 'act') RETURNING identity_id, display_name`,
    [biz.bridgeId + tag, 'Person ' + tag + ' ' + RUN, biz.id, (biz.bridgeId + tag).toLowerCase(), level, whole, costs]);
  madeIdentities.push(row.identity_id);
  if (grants && hasGrants) await query(`UPDATE identities SET area_grants = $2::jsonb WHERE identity_id = $1`, [row.identity_id, JSON.stringify(grants)]);
  return { id: row.identity_id, name: row.display_name, token: tokenFor({ identity_id: row.identity_id, identity_type: 'actor', bridge_id: biz.bridgeId, display_name: row.display_name, parent_entity_id: biz.id }) };
}
const grant = (area) => ({ [area]: { level: 'see', until: null, by: null, at: '2026-11-16T00:00:00.000Z' } });
let base = '';
async function call(token, method, route, body) {
  const h = { 'content-type': 'application/json' };
  if (token) h.authorization = 'Bearer ' + token;
  const res = await fetch(base + route, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (_) { parsed = null; }
  return { status: res.status, body: parsed, text };
}
/** the answer with ids, times and this run's names blanked, so two heads can be compared byte for byte */
const stable = (text) => String(text).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>').replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<time>').split(RUN).join('<run>').replace(/CBL16B\w*/gi, '<bridge>');
const hash = (text) => crypto.createHash('sha1').update(stable(text)).digest('hex').slice(0, 10);
const closedWords = (r) => r.status === 403 && r.body && r.body.code === 'BOOKS_AREA_CLOSED' && /Your access does not include/.test(r.body.detail || '');
const closedCard = (r) => r.status === 200 && r.body && r.body.closed === true && Array.isArray(r.body.lines) && r.body.lines.length === 0 && r.body.state === 'not_started' && /Ask the owner/.test(r.body.why || '');

async function main() {
  const S = await business('s');
  const personas = {
    owner: { token: ownerToken(S) },
    counter: await person(S, 'c', 'editor', false, false),
    viewonly: await person(S, 'v', 'viewer', false, false),
    gReports: await person(S, 'gr', 'editor', false, false, grant('reports')),
    gFinance: await person(S, 'gf', 'editor', false, false, grant('finance')),
    gAccounts: await person(S, 'ga', 'editor', false, false, grant('accounts')),
    auditor: await person(S, 'a', 'commenter', true, true),
    reportsMis: await person(S, 'm', 'commenter', true, false),
    regional: await person(S, 'r', 'editor', true, true)
  };
  const app = express();
  app.use(express.json());
  app.use('/api/books', require(path.join(API, 'routes', 'books.js')));
  app.use('/api/books', require(path.join(API, 'routes', 'books-money.js')));
  app.use('/api/facts', require(path.join(API, 'routes', 'facts.js')));
  app.use('/api/till', require(path.join(API, 'routes', 'till.js')));
  app.use('/api/chits', require(path.join(API, 'routes', 'chits.js')));
  app.use('/api/folders', require(path.join(API, 'routes', 'folders.js')));
  app.use('/api/crm', require(path.join(API, 'routes', 'crm.js')));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
  const out = [];
  try {
    await withEntity(S.id, (h) => require(path.join(API, 'lib', 'country-setup.js')).save(h, S.id, { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: '33AAAAA0000A1Z9', scheme: 'regular' }, source: { tax: 'typed' } }, S.id));
    await call(personas.owner.token, 'POST', '/api/books/enable', {});
    const routes = [].concat(Object.keys(MONEY_CARDS).concat(OPEN_CARDS).map((card) => '/api/facts/' + card), DOOR_ROUTES.reports, DOOR_ROUTES.accounts, OPEN_ROUTES);
    const got = {};
    for (const [name, who] of Object.entries(personas)) {
      got[name] = {};
      for (const route of routes) {
        const r = await call(who.token, 'GET', route);
        got[name][route] = r;
        out.push([name, route, r.status, hash(r.text)].join('\t'));
      }
    }
    if (process.env.PROBE_OUT) fs.writeFileSync(process.env.PROBE_OUT, out.join('\n') + '\n');
    const area = (route) => (route.startsWith('/api/facts/') ? MONEY_CARDS[route.slice(11)] || null : DOOR_ROUTES.reports.includes(route) ? 'reports' : DOOR_ROUTES.accounts.includes(route) ? 'accounts' : null);
    const owner = got.owner;
    ok('0 the owner reaches every route (no 401/403)', routes.every((route) => owner[route].status !== 401 && owner[route].status !== 403), JSON.stringify(routes.map((route) => owner[route].status)));
    for (const who of ['counter', 'viewonly']) {
      for (const route of routes) {
        const r = got[who][route];
        const needs = area(route);
        if (needs && route.startsWith('/api/facts/')) ok('1 ' + who + ' ' + route + ': a closed card (lines none, not_started, closed, why), 200 not 403', closedCard(r), JSON.stringify(r.body));
        else if (needs) ok('1 ' + who + ' ' + route + ': 403 in words', closedWords(r), r.status + ' ' + r.text.slice(0, 200));
        else ok('1 ' + who + ' ' + route + ' stays open exactly as the owner reads it (status ' + owner[route].status + ')', r.status === owner[route].status, r.status + ' vs ' + owner[route].status);
      }
    }
    for (const [who, granted] of [['gReports', 'reports'], ['gFinance', 'finance'], ['gAccounts', 'accounts']]) {
      for (const route of routes) {
        const needs = area(route);
        const r = got[who][route];
        if (needs === granted || !needs) ok('2 ' + who + ' ' + route + ': the same status and the same answer as the owner', r.status === owner[route].status && hash(r.text) === hash(owner[route].text), r.status + ' vs ' + owner[route].status);
        else ok('2 ' + who + ' ' + route + ': an area not granted stays closed', route.startsWith('/api/facts/') ? closedCard(r) : closedWords(r), r.status);
      }
    }
    for (const who of ['auditor', 'reportsMis', 'regional']) {
      ok('3 ' + who + ' reads every route as the owner does (same statuses and answers)', routes.every((route) => got[who][route].status === owner[route].status && hash(got[who][route].text) === hash(owner[route].text)), routes.filter((route) => got[who][route].status !== owner[route].status).join(' '));
    }
    const sam = got.counter['/api/crm/parties'];
    ok('4 the party list stays for Counter staff and carries no dues_overdue and no party dues', sam.status === 200 && Array.isArray(sam.body.parties) && !('dues_overdue' in (sam.body.alerts || {})) && sam.body.parties.every((party) => !('dues' in party) && !('unbilled' in party)), sam.text.slice(0, 300));
    ok('4b the owner still sees alerts.dues_overdue', owner['/api/crm/parties'].status === 200 && 'dues_overdue' in (owner['/api/crm/parties'].body.alerts || {}), owner['/api/crm/parties'].text.slice(0, 300));
    const nobody = await call(null, 'GET', '/api/facts/accounts');
    ok('5 no token: 401 from the real sign-in, never the card', nobody.status === 401, nobody.status);
    const unknown = await call(personas.counter.token, 'GET', '/api/facts/not-a-card');
    ok('6 an unknown card is still 404 (the closed card does not hide it)', unknown.status === 404, unknown.status);
  } finally {
    server.close();
  }
}

async function cleanup() {
  const nodes = (await query(`SELECT e.id FROM cb_entity e JOIN identities i ON upper(i.bridge_id) = upper(e.bridge_id) WHERE i.identity_id = ANY($1::uuid[])`, [madeIdentities])).rows.map((row) => row.id);
  await query(`DELETE FROM cb_edge WHERE parent_id = ANY($1::uuid[]) OR child_id = ANY($1::uuid[])`, [nodes]);
  await query(`DELETE FROM cb_entity WHERE id = ANY($1::uuid[])`, [nodes]);
  await query(`DELETE FROM identities WHERE identity_id = ANY($1::uuid[])`, [madeIdentities]);
}
(async () => {
  console.log('\n── W15-66 slice 2: money answers outside the books through the REAL sign-in (cb_app, RLS on) · run ' + RUN + ' ──');
  try { await main(); } catch (failure) { ok('the run reached its end', false, failure && failure.stack); } finally { await cleanup().catch((failure) => console.log('  note  the throwaway businesses stay: ' + (failure && failure.message))); }
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
