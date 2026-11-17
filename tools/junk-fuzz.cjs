#!/usr/bin/env node
'use strict';
/*
 * OWNS      the LIVE half of register column 17 (junk_fuzz, OWASP API4/API8): sends every route of the register the fixed, seeded junk set of lib/junk-fuzz.js (built from the route's own input schema) as owner, staff and no sign-in
 *           through the REAL server and a REAL Postgres, and judges each answer (no 5xx · a Problem-shaped 4xx with a registered code · no stack text · nothing written on a refused call · answered in time).
 *           With --write it is the ONLY writer of `junk_fuzz: true` per route in docs/contracts/api-hardening-evidence-areas.json and of the run summary under its top-level `junk_fuzz`.
 * CALLED BY by hand on a SIT box against a throwaway database built by tools/migrate.cjs (never production, never a shared database): two steps, the plan (offline, the real app with a stand-in database) then the run.
 * FLOW      --make-plan FILE (server.js offline ──▶ per register route: params, query names, body schema, tables written) ──▶ run: seed a world per area (owner, staff) ──▶ per route, per seat, per case: one request ──▶ verdictOf + table counts ──▶ report (+ evidence)
 * CARD      28-platform-and-operations/api-standard
 *
 * Writes on refusal: for a refused (4xx) call the row counts of the tables the register names under `writes` are read before and after with an ADMIN connection (ADMIN_DATABASE_URL, a superuser of the throwaway database, so RLS hides nothing).
 * A difference counts only when the same request, sent again, writes again (a background worker moving a table is not the route).
 * The limiter: every request carries a new X-Forwarded-For (the api trusts one proxy), and the global and auth limits are raised by the api's own env on the throwaway server; a 429 is VOID, never a pass.
 *
 *   node tools/junk-fuzz.cjs --make-plan plan.json
 *   DATABASE_URL=postgres://cb_app:...@db:5432/x ADMIN_DATABASE_URL=postgres://postgres:...@db:5432/x JWT_SECRET=... node tools/junk-fuzz.cjs --base http://127.0.0.1:3000 --plan plan.json [--only /api/books] [--seed 17] [--write] [--json FILE]
 */
const path = require('path');
const fs = require('fs');

const API = path.join(__dirname, '..');
const arg = (name) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : null;
};
const EVIDENCE_FILE = path.join(API, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const SEED = Number(arg('--seed') || 17);
const TIMEOUT_MS = Number(arg('--timeout') || 15000);

/* ── step 1: the plan, from the real app with a stand-in database (no network, no data) ───────────────────────────────── */
function makePlan(file) {
  ['RATE_LIMIT_MAX', 'AUTH_RATE_LIMIT_MAX', 'CHECK_LOGIN_RATE_LIMIT_MAX', 'CATALOGUE_RATE_LIMIT_MAX', 'ASSIST_RATE_LIMIT_MAX'].forEach((name) => (process.env[name] = '100000'));
  const loader = require('./load-app.cjs');
  loader.stubDatabase(API);
  const app = loader.loadApp(API);
  const { bodySchemaOf, urlSchemaOf } = require('../middleware/validate');
  const leaves = {};
  loader.leavesOf(app, true).forEach((leaf) => (leaves[leaf.method + ' ' + leaf.path] = leaf));
  const register = require('../docs/api-register.json');
  const plan = register.routes.map((row) => {
    const leaf = leaves[row.key];
    const check = leaf && leaf.fns.find((fn) => fn && fn.schemaOperation);
    const operation = check && check.schemaOperation;
    const url = operation && urlSchemaOf(operation);
    const params = [...row.path.matchAll(/:(\w+)/g)].map((match) => match[1]);
    const body = operation && bodySchemaOf(operation);
    return {
      key: row.key,
      method: row.method,
      path: row.path,
      area: row.owner_area,
      params,
      query: Object.keys((url && url.properties) || {}).filter((name) => !params.includes(name)),
      body: body ? { properties: Object.fromEntries(Object.entries(body.properties || {}).map(([name, schema]) => [name, { type: (schema || {}).type }])), required: body.required || [] } : null,
      writes: row.writes || [],
      schema: !!operation
    };
  });
  fs.writeFileSync(file, JSON.stringify(plan, null, 1));
  console.log('plan: ' + plan.length + ' routes, ' + plan.filter((route) => route.schema).length + ' with a schema, written to ' + file);
  process.exit(0);
}
if (arg('--make-plan')) makePlan(arg('--make-plan'));

/* ── step 2: the run ────────────────────────────────────────────────────────────────────────────────────────────────── */
const BASE = arg('--base');
const PLAN_FILE = arg('--plan');
if (!BASE || !PLAN_FILE || !process.env.DATABASE_URL || !process.env.JWT_SECRET) {
  console.error("needs --base, --plan (from --make-plan), DATABASE_URL (cb_app on a throwaway database), ADMIN_DATABASE_URL (a superuser of it, for row counts) and JWT_SECRET (the running server's)");
  process.exit(3);
}
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|[a-z0-9-]*junkdb[a-z0-9-]*|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(process.env.DATABASE_URL);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) {
  console.error('REFUSED: DATABASE_URL must be cb_app on localhost, the compose db or a SIT host');
  process.exit(3);
}
process.env.NODE_ENV = 'test';
const jsonWebToken = require('jsonwebtoken');
const { Pool } = require('pg');
const junk = require('../lib/junk-fuzz');
const networkService = require(path.join(API, 'src', 'services', 'network'));
const { query, withEntity } = require(path.join(API, 'db'));
const CODES = new Set(require('../docs/error-codes.json').codes.map((row) => row.code));
const admin = new Pool({ connectionString: process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL, max: 2 });
const RUN_TAG = 'jf' + (Date.now() % 1e9).toString(36);

const tokenFor = (claims) => jsonWebToken.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '3h' });
let sent = 0;
/** a new client address per request: the api trusts one proxy, so the per-IP limiters never see a repeat */
const addressOf = () => '10.' + ((sent >> 16) & 255) + '.' + ((sent >> 8) & 255) + '.' + (sent & 255);

/** one request to the running server: the answer as the verdict reads it */
async function call(token, method, url, options) {
  const asked = options || {};
  const headers = { 'x-forwarded-for': addressOf() };
  sent++;
  if (token) headers.authorization = 'Bearer ' + token;
  let payload;
  if (asked.raw !== undefined) payload = asked.raw;
  else if (asked.body !== undefined) payload = JSON.stringify(asked.body);
  const withBody = junk.BODY_METHODS.includes(method) && payload !== undefined;
  if (withBody) headers['content-type'] = 'application/json';
  try {
    const res = await fetch(BASE + url, { method, headers, body: withBody ? payload : undefined, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'manual' });
    const text = await res.text().catch(() => '');
    let body = null;
    try {
      body = JSON.parse(text);
    } catch (notJson) {
      body = null;
    }
    return { status: res.status, text, body, contentType: res.headers.get('content-type') || '' };
  } catch (failure) {
    const timedOut = failure && (failure.name === 'TimeoutError' || failure.name === 'AbortError');
    return { status: 0, text: '', body: null, timedOut, failure: String(failure && failure.message).slice(0, 80) };
  }
}

/** a throwaway business entity with its network node */
const made = [];
async function business(tag) {
  const bridgeId = 'CB' + RUN_TAG + tag;
  const {
    rows: [identity]
  } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'IN', 'INR', $3) RETURNING identity_id, display_name`, [bridgeId, 'JunkFuzz ' + tag + ' ' + RUN_TAG, bridgeId.toLowerCase()]);
  made.push(identity.identity_id);
  return { id: identity.identity_id, bridgeId, name: identity.display_name, node: await networkService.nodeOf(identity.identity_id, { ensure: true }) };
}
/** a throwaway actor of a business at an access level; returns its token */
async function person(shop, tag, level) {
  const {
    rows: [row]
  } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, parent_entity_id, country, currency_code, user_id, access_level, whole_entity, can_see_costs, hat) VALUES ($1, $2, 'actor', $3, 'IN', 'INR', $4, $5, false, false, 'act') RETURNING identity_id, display_name`, [shop.bridgeId + tag, 'Person ' + tag + ' ' + RUN_TAG, shop.id, (shop.bridgeId + tag).toLowerCase(), level]);
  made.push(row.identity_id);
  return tokenFor({ identity_id: row.identity_id, identity_type: 'actor', bridge_id: shop.bridgeId, display_name: row.display_name, parent_entity_id: shop.id });
}
let worlds = 0;
/** the world: one shop (country set, ledger on), its owner, its staff (an editor) */
async function seed() {
  const shop = await business('s' + worlds++);
  await withEntity(shop.id, (handle) => require(path.join(API, 'lib', 'country-setup.js')).save(handle, shop.id, { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: '33AAAAA0000A1Z9', scheme: 'regular' }, source: { tax: 'typed' } }, shop.id));
  const owner = tokenFor({ identity_id: shop.id, identity_type: 'entity', bridge_id: shop.bridgeId, display_name: shop.name });
  await call(owner, 'POST', '/api/books/enable', { body: {} });
  return { shop, tokens: { owner, staff: await person(shop, 'e', 'editor'), anon: null } };
}
const alive = async (world) => (await query('SELECT 1 FROM identities WHERE identity_id = $1', [world.shop.id])).rowCount === 1;

/* ── row counts of the tables a route writes ── */
let knownTables = null;
async function tablesOf(names) {
  if (!knownTables) knownTables = new Set((await admin.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).rows.map((row) => row.table_name));
  return names.filter((name) => knownTables.has(name) && /^[a-z_][a-z0-9_]*$/.test(name));
}
async function countsOf(tables) {
  if (!tables.length) return {};
  const { rows } = await admin.query('SELECT ' + tables.map((name, at) => `(SELECT count(*) FROM "${name}")::int AS c${at}`).join(', '));
  return Object.fromEntries(tables.map((name, at) => [name, rows[0]['c' + at]]));
}
const changedOf = (before, after) => Object.keys(before).filter((name) => after[name] !== before[name]);

/** the world of a route: one per `/api/<segment>` so a route that signs the owner out cannot spoil the next area */
let current = { segment: null, world: null };
async function worldFor(route) {
  const segment = route.path.split('/').slice(0, 3).join('/');
  if (!current.world || current.segment !== segment || !(await alive(current.world))) current = { segment, world: await seed() };
  return current.world;
}

/** one route, every case, every seat: { route, requests, failures: [{ seat, case, kind, detail, status }], voids } */
async function fuzzRoute(route) {
  const world = await worldFor(route);
  const cases = junk.casesOf(route, SEED);
  const tables = await tablesOf(route.writes);
  const result = { key: route.key, requests: 0, failures: [], voids: 0 };
  for (const seat of ['owner', 'staff', 'anon']) {
    for (const item of cases) {
      const url = item.path + (item.query ? '?' + item.query : '');
      const asked = { body: item.body, raw: item.raw };
      const before = tables.length ? await countsOf(tables) : null;
      let answer = await call(world.tokens[seat], route.method, url, asked);
      result.requests++;
      const verdict = junk.verdictOf(answer, CODES);
      if (verdict && verdict.kind === 'void') result.voids++;
      else if (verdict) result.failures.push({ seat, case: item.id, kind: verdict.kind, detail: verdict.detail, status: answer.status });
      if (!verdict && before && junk.isRefusal(answer.status)) {
        const first = changedOf(before, await countsOf(tables));
        if (first.length) {
          const again = await countsOf(tables);
          await call(world.tokens[seat], route.method, url, asked);
          const second = changedOf(again, await countsOf(tables));
          const both = first.filter((name) => second.includes(name));
          if (both.length) result.failures.push({ seat, case: item.id, kind: 'write_on_refusal', detail: both.join(','), status: answer.status });
        }
      }
    }
  }
  return result;
}

/** remove the throwaway rows (best effort: insert-only tables keep some) */
async function cleanup() {
  const nodes = (await query(`SELECT e.id FROM cb_entity e JOIN identities i ON upper(i.bridge_id) = upper(e.bridge_id) WHERE i.identity_id = ANY($1::uuid[])`, [made])).rows.map((x) => x.id);
  await query(`DELETE FROM cb_edge WHERE parent_id = ANY($1::uuid[]) OR child_id = ANY($1::uuid[])`, [nodes]);
  await query(`DELETE FROM cb_entity WHERE id = ANY($1::uuid[])`, [nodes]);
  await query(`DELETE FROM identities WHERE identity_id = ANY($1::uuid[])`, [made]);
}

/** merge the run into the evidence file: junk_fuzz true on each route that passed every case (voids excepted), absent on each that did not; the summary under the top-level junk_fuzz */
function writeEvidence(results, summary) {
  const onDisk = JSON.parse(fs.readFileSync(EVIDENCE_FILE, 'utf8'));
  const routes = onDisk.routes || {};
  results.forEach((row) => {
    const entry = routes[row.key] || {};
    if (!row.failures.length && !row.voids) entry.junk_fuzz = true;
    else delete entry.junk_fuzz;
    if (Object.keys(entry).length) routes[row.key] = entry;
    else delete routes[row.key];
  });
  const sorted = Object.fromEntries(Object.keys(routes).sort().map((route) => [route, routes[route]]));
  fs.writeFileSync(EVIDENCE_FILE, JSON.stringify(Object.assign({}, onDisk, { routes: sorted, junk_fuzz: summary }), null, 1) + '\n');
}

/** the verdict of a run, by kind and by case, for the report */
function summaryOf(results) {
  const failing = results.filter((row) => row.failures.length);
  const kinds = {};
  const cases = {};
  failing.forEach((row) => row.failures.forEach((failure) => {
    kinds[failure.kind] = (kinds[failure.kind] || 0) + 1;
    const name = failure.case.replace(/:.*/, '') + ' ' + failure.kind;
    cases[name] = (cases[name] || new Set()).add(row.key);
  }));
  return {
    about: 'written by node tools/junk-fuzz.cjs --write (register column 17): the fixed seeded junk set of lib/junk-fuzz.js as owner, staff and anon on a throwaway database; a route passes when no case got a 5xx, a timeout, stack text, an unregistered or non-Problem refusal, or a write on a refusal',
    seed: SEED,
    routes: results.length,
    passing: results.filter((row) => !row.failures.length && !row.voids).length,
    failing: failing.length,
    void_429: results.filter((row) => !row.failures.length && row.voids).length,
    requests: results.reduce((sum, row) => sum + row.requests, 0),
    by_kind: kinds,
    by_case: Object.fromEntries(Object.entries(cases).map(([name, set]) => [name, set.size])),
    failing_routes: Object.fromEntries(failing.map((row) => [row.key, row.failures.slice(0, 3).map((failure) => failure.seat + ' ' + failure.case + ' ' + failure.kind + ' ' + failure.status + ' ' + failure.detail)]))
  };
}

async function main() {
  const only = arg('--only');
  const plan = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8')).filter((route) => !only || route.path.startsWith(only));
  const results = [];
  const beat = () => {
    try {
      fs.writeFileSync('/tmp/junk-fuzz.progress', results.length + '/' + plan.length + ' routes, ' + sent + ' requests, ' + results.filter((row) => row.failures.length).length + ' failing\n');
    } catch (ignored) {
      /* progress is a courtesy */
    }
  };
  try {
    for (const route of plan) {
      results.push(await fuzzRoute(route));
      beat();
    }
  } catch (failure) {
    console.error('RUN FAILED at ' + results.length + ': ' + (failure && failure.stack));
    process.exitCode = 1;
  }
  await cleanup().catch((failure) => console.log('note: the throwaway rows stay (' + (failure && failure.code) + ')'));
  const summary = summaryOf(results);
  console.log('junk_fuzz: ' + summary.passing + ' of ' + summary.routes + ' routes pass · ' + summary.failing + ' fail · ' + summary.void_429 + ' void (429) · ' + summary.requests + ' requests');
  console.log('by kind: ' + JSON.stringify(summary.by_kind));
  if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify({ summary, results }, null, 1));
  if (process.argv.includes('--write') && !only) writeEvidence(results, summary);
  process.exit(process.exitCode || 0);
}
main();
