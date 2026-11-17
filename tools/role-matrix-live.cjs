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
const arg = (name) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : null; };
const BASE = arg('--base');
const ONLY = (arg('--only') || 'books,books-actions,books-grants,flags').split(',');
const AREAS = { books: '/api/books', 'books-actions': '/api/books-actions', 'books-grants': '/api/books-grants', flags: '/api/flags' };
/** the areas behind the books grant front: the firm's seats are asked with the X-Books-For header (a live grant); elsewhere the firm person is asked as itself */
const GRANT_FRONT = new Set(['books', 'books-actions']);
const EVIDENCE_FILE = path.join(API, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const RUN = 'rm' + (Date.now() % 1e9).toString(36);
const ZERO = '00000000-0000-4000-8000-000000000001';
const PARAMS = { id: ZERO, account: '1000', fy: '2026', p: '1', act: 'lock', ref: 'x1' };

if (!BASE || !process.env.DATABASE_URL || !process.env.JWT_SECRET) { console.error('needs --base, DATABASE_URL (cb_app on a throwaway database) and JWT_SECRET (the running server\'s)'); process.exit(3); }
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(process.env.DATABASE_URL);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: DATABASE_URL must be cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
process.env.NODE_ENV = 'test';
const net = require(path.join(API, 'src', 'services', 'network'));
const { query, withEntity } = require(path.join(API, 'db'));

const made = [];
const tokenFor = (claims) => jsonWebToken.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

async function business(tag) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [identity] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'IN', 'INR', $3) RETURNING identity_id, display_name`, [bridgeId, 'RoleMatrix ' + tag + ' ' + RUN, bridgeId.toLowerCase()]);
  made.push(identity.identity_id);
  return { id: identity.identity_id, bridgeId, name: identity.display_name, node: await net.nodeOf(identity.identity_id, { ensure: true }) };
}
async function person(biz, tag, level, whole, costs) {
  const { rows: [row] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, parent_entity_id, country, currency_code, user_id, access_level, whole_entity, can_see_costs, hat) VALUES ($1, $2, 'actor', $3, 'IN', 'INR', $4, $5, $6, $7, 'act') RETURNING identity_id, display_name`, [biz.bridgeId + tag, 'Person ' + tag + ' ' + RUN, biz.id, (biz.bridgeId + tag).toLowerCase(), level, whole, costs]);
  made.push(row.identity_id);
  return tokenFor({ identity_id: row.identity_id, identity_type: 'actor', bridge_id: biz.bridgeId, display_name: row.display_name, parent_entity_id: biz.id });
}
const ownerToken = (biz) => tokenFor({ identity_id: biz.id, identity_type: 'entity', bridge_id: biz.bridgeId, display_name: biz.name });

async function call(token, method, route, options) {
  const o = options || {};
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  if (o.member) { headers['x-books-for'] = o.member; if (o.role) headers['x-books-role'] = o.role; }
  const res = await fetch(BASE + route, { method, headers, body: ['POST', 'PUT', 'PATCH'].includes(method) ? JSON.stringify(o.body || {}) : undefined });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body };
}

/** the world: the shop M (owner, a viewer, an editor), the firm P (network parent of M; an adviser person and an auditor person), the ledger on, one live grant per preset */
async function seed() {
  const P = await business('p');
  const M = await business('m');
  const asked = await net.requestConnect({ parentId: P.node.id, childId: M.node.id }, P.node);
  await net.approve({ edgeId: asked.id }, M.node);
  await withEntity(M.id, (h) => require(path.join(API, 'lib', 'country-setup.js')).save(h, M.id, { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: '33AAAAA0000A1Z9', scheme: 'regular' }, source: { tax: 'typed' } }, M.id));
  const tokens = {
    owner: ownerToken(M),
    viewer: await person(M, 'v', 'viewer', false, false),
    editor: await person(M, 'e', 'editor', false, false),
    adviser: await person(P, 'a', 'editor', true, true),
    auditor: await person(P, 'u', 'commenter', true, true)
  };
  const enabled = await call(tokens.owner, 'POST', '/api/books/enable', { body: {} });
  const adviserGrant = await call(tokens.owner, 'POST', '/api/books-grants', { body: { grantee: P.id, preset: 'adviser', posting: 'adviser_posts', purpose: 'role matrix run ' + RUN, consent: true } });
  const auditorGrant = await call(tokens.owner, 'POST', '/api/books-grants', { body: { grantee: P.id, preset: 'auditor', can_see_costs: true, purpose: 'role matrix run ' + RUN, consent: true } });
  if (enabled.status !== 200 || adviserGrant.status !== 201 || auditorGrant.status !== 201) throw new Error('the world did not come up: enable ' + enabled.status + ', adviser grant ' + adviserGrant.status + ' ' + JSON.stringify(adviserGrant.body).slice(0, 200) + ', auditor grant ' + auditorGrant.status + ' ' + JSON.stringify(auditorGrant.body).slice(0, 200));
  return { M, P, tokens };
}

const filled = (route) => route.replace(/:(\w+)/g, (all, name) => PARAMS[name] || ZERO);
/** a body that is the bank page's own, for the four doors an adviser may write only with that body (middleware/books-grant bankWriteBody) */
function bodyFor(method, route, world) {
  if (method !== 'POST') return {};
  if (route === '/events') return { kind: bankKind(), client_ref: 'bank:' + RUN };
  if (route === '/payments') return { party_id: ZERO, client_ref: 'bank:' + RUN };
  return {};
}
const bankKind = () => (/BANK_EVENT_KINDS\s*=\s*\[\s*'([^']+)'/.exec(fs.readFileSync(path.join(API, 'middleware', 'books-grant.js'), 'utf8')) || [])[1] || 'bank_charge';

/** who asks, as { token, member?, role? } per seat (staff has two: a viewer and an editor of the shop) */
function askers(area, world) {
  const front = GRANT_FRONT.has(area);
  return {
    anon: [{ token: null, who: 'anon' }],
    owner: [{ token: world.tokens.owner, who: 'owner' }],
    staff: [{ token: world.tokens.viewer, who: 'staff:viewer', level: 'viewer' }, { token: world.tokens.editor, who: 'staff:editor', level: 'editor' }],
    adviser: [{ token: world.tokens.adviser, who: 'adviser', member: front ? world.M.id : null, role: 'adviser' }],
    auditor: [{ token: world.tokens.auditor, who: 'auditor', member: front ? world.M.id : null, role: 'auditor' }]
  };
}

/** the verdict of one answer: null when it is what the declaration says, else the sentence that says how it differs */
function verdict(answer, allowed, seat) {
  const problemShape = answer.body && typeof answer.body.status === 'number' && typeof answer.body.code === 'string';
  if (allowed) {
    if ([401, 403].includes(answer.status)) return 'allowed seat was refused ' + answer.status + ' ' + ((answer.body && answer.body.code) || '');
    if (answer.status >= 500 && answer.status !== 503) return 'allowed seat reached a handler fault ' + answer.status;
    return null;
  }
  const wanted = seat === 'anon' ? 401 : 403;
  if (answer.status !== wanted) return 'refused seat was answered ' + answer.status + ' ' + ((answer.body && (answer.body.code || answer.body.error)) || '') + ' (wanted ' + wanted + ')';
  return problemShape ? null : 'refusal is not the Problem shape: ' + JSON.stringify(answer.body).slice(0, 120);
}

async function run() {
  const world = await seed();
  const results = [];
  for (const area of ONLY) {
    const contract = require('../lib/' + area + '-contract');
    for (const key of Object.keys(contract.ROUTES)) {
      const [method, route] = key.split(' ');
      const declared = contract.ROUTES[key].seats;
      const full = AREAS[area] + (route === '/' ? '' : route);
      const people = askers(area, world);
      const row = { key: method + ' ' + AREAS[area] + route, area, checks: [] };
      for (const seat of matrix.SEAT_NAMES) {
        for (const who of people[seat]) {
          const allowed = matrix.allowedFor(declared, seat, who.level);
          const answer = await call(who.token, method, filled(full), { member: who.member, role: who.role, body: bodyFor(method, route, world) });
          row.checks.push({ seat, who: who.who, allowed, status: answer.status, code: (answer.body && answer.body.code) || null, problem: verdict(answer, allowed, seat) });
        }
      }
      results.push(row);
    }
  }
  return results;
}

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

(async () => {
  let results = [];
  try {
    results = await run();
  } catch (failure) {
    console.error('RUN FAILED: ' + (failure && failure.stack));
    process.exitCode = 1;
  } finally {
    await cleanup().catch((failure) => console.log('note: the throwaway rows stay (' + (failure && failure.code) + ')'));
  }
  if (!results.length) process.exit(1);
  const closed = results.filter((row) => row.checks.every((check) => !check.problem));
  console.log('role_matrix: ' + closed.length + ' of ' + results.length + ' routes answer as declared for every seat');
  results.filter((row) => !closed.includes(row)).forEach((row) => row.checks.filter((check) => check.problem).forEach((check) => console.log('  MISMATCH  ' + check.who.padEnd(13) + row.key.padEnd(52) + check.problem)));
  if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify(results, null, 1));
  if (process.argv.includes('--write')) writeEvidence(results);
  process.exit(0);
})();
