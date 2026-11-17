#!/usr/bin/env node
'use strict';
/*
 * OWNS      the LIVE half of register column 14 (role_matrix, OWASP API5:2023): asks every route of the books, books-actions, books-grants and flags contracts as each seat (owner, a viewer and an editor of the business, the firm's adviser
 *           under a live grant, the firm's auditor under a live grant, and no sign-in) through the REAL server and a REAL Postgres, and compares each answer with the route's declared `seats` (lib/role-matrix.js).
 *           With --write it is the ONLY writer of `role_matrix: true` in docs/contracts/api-hardening-evidence-areas.json (a route that stops holding loses it).
 * CALLED BY by hand on a SIT box against a throwaway database built by tools/migrate.cjs (never production, never a shared database):.
 * FLOW      seed (two businesses, a network edge, a viewer and an editor of the shop, an adviser and an auditor person of the firm, the ledger on, an adviser grant and an auditor grant) ──▶ per route, per seat: one request ──▶ answer vs declaration ──▶ report (+ evidence)
 * CARD      28-platform-and-operations/api-standard
 *
 * What counts as the answer. An ALLOWED seat must not be refused as a seat: any answer except 401 or 403 (a 422 for the empty body, a 404 for the made-up id, a 409 are all the route's own business answer, so the gate let the seat through).
 * A REFUSED seat must answer 401 (no sign-in) or 403 (every other seat) in the one Problem shape (status and code). A refusal by 404 or an answer by the handler is a MISMATCH: either the declaration is wrong or the route is open to a seat it should refuse (a FINDING).
 * The tokens are signed with the api's own secret (as tests/acc-176b-adviser-realauth.realstack.cjs does); the real middleware/auth re-reads each person's row on every request. The sign-in door (OTP) is not under test here.
 *
 *   DATABASE_URL=postgres://cb_app:...@localhost:PORT/db JWT_SECRET=... node tools/role-matrix-live.cjs --base http://127.0.0.1:3611 [--only books,flags] [--write] [--json FILE]
 */
const path = require('path');
const fs = require('fs');
const jsonWebToken = require('jsonwebtoken');
const matrix = require('../lib/role-matrix');

const API = path.join(__dirname, '..');
/** the value after a command-line flag, or null */
const arg = (name) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : null; };
const BASE = arg('--base');
const ONLY = (arg('--only') || 'books,books-actions,books-grants,flags').split(',');
const AREAS = { books: '/api/books', 'books-actions': '/api/books-actions', 'books-grants': '/api/books-grants', flags: '/api/flags' };
/** the areas behind the books grant front: the firm's seats are asked with the X-Books-For header (a live grant); elsewhere the firm person is asked as itself */
const GRANT_FRONT = new Set(['books', 'books-actions']);
const EVIDENCE_FILE = path.join(API, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const RUN_TAG = 'rm' + (Date.now() % 1e9).toString(36);
const ZERO = '00000000-0000-4000-8000-000000000001';
const PARAMS = { id: ZERO, account: '1000', fy: '2026', p: '1', act: 'lock', ref: 'x1' };

if (!BASE || !process.env.DATABASE_URL || !process.env.JWT_SECRET) { console.error('needs --base, DATABASE_URL (cb_app on a throwaway database) and JWT_SECRET (the running server\'s)'); process.exit(3); }
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(process.env.DATABASE_URL);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: DATABASE_URL must be cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
process.env.NODE_ENV = 'test';
const networkService = require(path.join(API, 'src', 'services', 'network'));
const { query, withEntity } = require(path.join(API, 'db'));

const made = [];
/** a bearer token signed with the running server's own secret (the real middleware/auth re-reads the person's row on every request) */
const tokenFor = (claims) => jsonWebToken.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

/** a throwaway business entity with its network node */
async function business(tag) {
  const bridgeId = 'CB' + RUN_TAG + tag;
  const { rows: [identity] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'IN', 'INR', $3) RETURNING identity_id, display_name`, [bridgeId, 'RoleMatrix ' + tag + ' ' + RUN_TAG, bridgeId.toLowerCase()]);
  made.push(identity.identity_id);
  return { id: identity.identity_id, bridgeId, name: identity.display_name, node: await networkService.nodeOf(identity.identity_id, { ensure: true }) };
}
/** a throwaway actor of a business at an access level; returns its token */
async function person(business_row, tag, level, whole, costs) {
  const { rows: [row] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, parent_entity_id, country, currency_code, user_id, access_level, whole_entity, can_see_costs, hat) VALUES ($1, $2, 'actor', $3, 'IN', 'INR', $4, $5, $6, $7, 'act') RETURNING identity_id, display_name`, [business_row.bridgeId + tag, 'Person ' + tag + ' ' + RUN_TAG, business_row.id, (business_row.bridgeId + tag).toLowerCase(), level, whole, costs]);
  made.push(row.identity_id);
  return tokenFor({ identity_id: row.identity_id, identity_type: 'actor', bridge_id: business_row.bridgeId, display_name: row.display_name, parent_entity_id: business_row.id });
}
/** the owner's token: the business entity itself */
const ownerToken = (business_row) => tokenFor({ identity_id: business_row.id, identity_type: 'entity', bridge_id: business_row.bridgeId, display_name: business_row.name });

/** one request to the running server: { status, body } (body null when the answer is not JSON) */
async function call(token, method, route, options) {
  const asked = options || {};
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  if (asked.member) { headers['x-books-for'] = asked.member; if (asked.role) headers['x-books-role'] = asked.role; }
  const res = await fetch(BASE + route, { method, headers, body: ['POST', 'PUT', 'PATCH'].includes(method) ? JSON.stringify(asked.body || {}) : undefined });
  let body = null;
  try {
    body = await res.json();
  } catch (notJson) {
    console.log('note: ' + method + ' ' + route + ' answered ' + res.status + ' with no JSON body (' + notJson.name + ')');
  }
  return { status: res.status, body };
}

/** the world: the shop M (owner, a viewer, an editor), the firm P (network parent of M; an adviser person and an auditor person), the ledger on, one live grant per preset */
async function seed() {
  const firm = await business('p');
  const shop = await business('m');
  const asked = await networkService.requestConnect({ parentId: firm.node.id, childId: shop.node.id }, firm.node);
  await networkService.approve({ edgeId: asked.id }, shop.node);
  await withEntity(shop.id, (handle) => require(path.join(API, 'lib', 'country-setup.js')).save(handle, shop.id, { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: '33AAAAA0000A1Z9', scheme: 'regular' }, source: { tax: 'typed' } }, shop.id));
  const tokens = {
    owner: ownerToken(shop),
    viewer: await person(shop, 'v', 'viewer', false, false),
    editor: await person(shop, 'e', 'editor', false, false),
    adviser: await person(firm, 'a', 'editor', true, true),
    auditor: await person(firm, 'u', 'commenter', true, true)
  };
  const enabled = await call(tokens.owner, 'POST', '/api/books/enable', { body: {} });
  const adviserGrant = await call(tokens.owner, 'POST', '/api/books-grants', { body: { grantee: firm.id, preset: 'adviser', posting: 'adviser_posts', purpose: 'role matrix run ' + RUN_TAG, consent: true } });
  const auditorGrant = await call(tokens.owner, 'POST', '/api/books-grants', { body: { grantee: firm.id, preset: 'auditor', can_see_costs: true, purpose: 'role matrix run ' + RUN_TAG, consent: true } });
  if (enabled.status !== 200 || adviserGrant.status !== 201 || auditorGrant.status !== 201) throw new Error('the world did not come up: enable ' + enabled.status + ', adviser grant ' + adviserGrant.status + ' ' + JSON.stringify(adviserGrant.body).slice(0, 200) + ', auditor grant ' + auditorGrant.status + ' ' + JSON.stringify(auditorGrant.body).slice(0, 200));
  return { shop, firm, tokens };
}

/** a route with its path arguments made up */
const filled = (route) => route.replace(/:(\w+)/g, (all, name) => PARAMS[name] || ZERO);
/** a body that is the bank page's own, for the four doors an adviser may write only with that body (middleware/books-grant bankWriteBody) */
function bodyFor(method, route, world) {
  if (method !== 'POST') return {};
  if (route === '/events') return { kind: bankKind(), client_ref: 'bank:' + RUN_TAG };
  if (route === '/payments') return { party_id: ZERO, client_ref: 'bank:' + RUN_TAG };
  return {};
}
/** the first event kind the bank page posts, read from the grant front's own list */
const bankKind = () => (/BANK_EVENT_KINDS\s*=\s*\[\s*'([^']+)'/.exec(fs.readFileSync(path.join(API, 'middleware', 'books-grant.js'), 'utf8')) || [])[1] || 'bank_charge';

/** who asks, as { token, member?, role? } per seat (staff has two: a viewer and an editor of the shop) */
function askers(area, world) {
  const front = GRANT_FRONT.has(area);
  return {
    anon: [{ token: null, who: 'anon' }],
    owner: [{ token: world.tokens.owner, who: 'owner' }],
    staff: [{ token: world.tokens.viewer, who: 'staff:viewer', level: 'viewer' }, { token: world.tokens.editor, who: 'staff:editor', level: 'editor' }],
    adviser: [{ token: world.tokens.adviser, who: 'adviser', member: front ? world.shop.id : null, role: 'adviser' }],
    auditor: [{ token: world.tokens.auditor, who: 'auditor', member: front ? world.shop.id : null, role: 'auditor' }]
  };
}

/** one route asked as every seat: { key, area, checks: [{ seat, who, allowed, status, code, problem }] } */
async function askRoute(area, key, world) {
  const [method, route] = key.split(' ');
  const declared = require('../lib/' + area + '-contract').ROUTES[key].seats;
  const people = askers(area, world);
  const row = { key: method + ' ' + AREAS[area] + (route === '/' ? '' : route), area, checks: [] };
  const asks = matrix.SEAT_NAMES.flatMap((seat) => people[seat].map((asker) => ({ seat, asker })));
  for (const { seat, asker } of asks) {
    const allowed = matrix.allowedFor(declared, seat, asker.level);
    const answer = await call(asker.token, method, filled(AREAS[area] + (route === '/' ? '' : route)), { member: asker.member, role: asker.role, body: bodyFor(method, route, world) });
    row.checks.push({ seat, who: asker.who, allowed, status: answer.status, code: (answer.body && answer.body.code) || null, problem: matrix.verdictOf(answer, allowed, seat) });
  }
  return row;
}

/** every route of the chosen areas asked as every seat */
async function runMatrix() {
  const world = await seed();
  const results = [];
  for (const area of ONLY) {
    for (const key of Object.keys(require('../lib/' + area + '-contract').ROUTES)) results.push(await askRoute(area, key, world));
  }
  return results;
}

/** remove the throwaway rows (best effort: insert-only tables keep some) */
async function cleanup() {
  const nodes = (await query(`SELECT e.id FROM cb_entity e JOIN identities i ON upper(i.bridge_id) = upper(e.bridge_id) WHERE i.identity_id = ANY($1::uuid[])`, [made])).rows.map((x) => x.id);
  await query(`DELETE FROM cb_edge WHERE parent_id = ANY($1::uuid[]) OR child_id = ANY($1::uuid[])`, [nodes]);
  await query(`DELETE FROM cb_entity WHERE id = ANY($1::uuid[])`, [nodes]);
  await query(`DELETE FROM identities WHERE identity_id = ANY($1::uuid[])`, [made]);
}

/** merge the run into the evidence file: role_matrix true on each route asked whose every seat answered as declared, absent on each route asked that did not */
function writeEvidence(results) {
  const onDisk = JSON.parse(fs.readFileSync(EVIDENCE_FILE, 'utf8'));
  const routes = onDisk.routes || {};
  results.forEach((row) => {
    const held = row.checks.every((check) => !check.problem);
    const entry = routes[row.key] || {};
    if (held) entry.role_matrix = true;
    else delete entry.role_matrix;
    if (Object.keys(entry).length) routes[row.key] = entry;
    else delete routes[row.key];
  });
  const sorted = Object.fromEntries(Object.keys(routes).sort().map((route) => [route, routes[route]]));
  fs.writeFileSync(EVIDENCE_FILE, JSON.stringify(Object.assign({}, onDisk, { routes: sorted }), null, 1) + '\n');
}

/** print the verdict of a run: how many routes closed, the two kinds of difference, and each mismatch */
function report(results) {
  const closed = results.filter((row) => row.checks.every((check) => !check.problem));
  console.log('role_matrix: ' + closed.length + ' of ' + results.length + ' routes answer as declared for every seat');
  const kinds = (kind) => results.filter((row) => row.checks.some((check) => check.problem && check.problem.startsWith(kind))).length;
  console.log('  routes with a wrong status (SEAT): ' + kinds('SEAT') + ' · routes whose refusal is not the Problem shape (SHAPE): ' + kinds('SHAPE'));
  const mismatches = results.filter((row) => !closed.includes(row)).flatMap((row) => row.checks.filter((check) => check.problem).map((check) => '  MISMATCH  ' + check.who.padEnd(13) + row.key.padEnd(52) + check.problem));
  mismatches.forEach((line) => console.log(line));
}

/** the whole run: the matrix, the cleanup, the report, the optional JSON and evidence */
async function main() {
  let results = [];
  try {
    results = await runMatrix();
  } catch (failure) {
    console.error('RUN FAILED: ' + (failure && failure.stack));
    process.exitCode = 1;
  }
  await cleanup().catch((failure) => console.log('note: the throwaway rows stay (' + (failure && failure.code) + ')'));
  if (!results.length) process.exit(1);
  report(results);
  if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify(results, null, 1));
  if (process.argv.includes('--write')) writeEvidence(results);
  process.exit(0);
}
main();
