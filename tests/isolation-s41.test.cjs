#!/usr/bin/env node
/*
 * OWNS      S41 · the cross-shop rule (S35) proved against a REAL database with REAL row-level security: signed in as shop B, every id of shop A answers
 *           exactly what an unknown id answers (same status, same body once the id is masked), for read and write, and no word of shop A is in the body.
 * CALLED BY .github/workflows/ci.yml job `integration` (every PR and main) · by hand against the local stack (see RUN below)
 * FLOW      tokens (A = the seeded shop, B = a bare shop) → A's ids and words read with the owner connection → every authenticated route that
 *           takes a path id: GET first, then writes → B asks with A's id and with an unknown id of the same shape → compare → A's rows hashed
 *           before and after the writes (a write that landed shows there) → known gaps (tests/isolation-s41.expected.json) may fail, nothing else
 * CARD      28-platform-and-operations/api-standard (S41)
 *
 * RUN  S41_API_BASE=http://127.0.0.1:3201 S41_OWNER_DB_URL=postgres://postgres:…@127.0.0.1:5432/db node tests/isolation-s41.test.cjs [--verbose] [--write-expected]
 *      The api must run as the NON-owner role cb_app (that is what makes the policies bite) with the dev codes armed, the shop A seeded by
 *      scripts/seed-local.cjs --demo-month. No S41_API_BASE → skipped with a warning (the offline guards job has no database).
 * A finding is one of: LEAK (B's answer for A's id differs and is not an error: shop A's data or a write reached B) · ORACLE (both are errors but they
 * differ, so B can tell an id of shop A from nothing) · WORDS (A's own words are in B's body).
 */
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const API_BASE = process.env.S41_API_BASE;
if (!API_BASE) {
  console.log('  - isolation-s41: S41_API_BASE not set - skipped (the integration CI job sets it)\n\n  0 checks');
  process.exit(0);
}
const OWNER_DB = process.env.S41_OWNER_DB_URL;
const EXPECTED_FILE = path.join(__dirname, 'isolation-s41.expected.json');
const WRITES = ['POST', 'PUT', 'PATCH', 'DELETE'];
const ENTITY_OTP = '123456';
const SHOP_A = { email: 'mayur@local.test', name: 'Mayur Restaurant' };
const SHOP_B = { email: 'bravo-s41@example.com', name: 'Bravo Probe Shop' };
const ID_COLUMN = /(^id$|_id$|^key$|_key$|_no$|number$)/;
const WORD_COLUMN = /(^name$|_name$|^email$|^title$|^label$)/;
const POOL_CAP = 60;
const MIN_ID = 4; /* a shorter value (C2, IN, 1) cannot be masked out of a message without eating other words, and guesses itself */
const MIN_WORD = 6;
const DANGEROUS = /\/(logout|signout|sign-out)$/;
const argv = process.argv.slice(2);
const verbose = argv.includes('--verbose');

/** one HTTP call: { status, text, json } (status 0 = no answer in 8 s) */
function call(method, urlPath, token, body) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = 'Bearer ' + token;
    if (data) headers['content-length'] = Buffer.byteLength(data);
    const request = http.request(API_BASE + urlPath, { method, headers }, (response) => {
      let text = '';
      response.on('data', (part) => (text += part));
      response.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch (parseFailure) { json = null; }
        resolve({ status: response.statusCode, text, json });
      });
    });
    request.setTimeout(8000, () => { request.destroy(); resolve({ status: 0, text: '', json: null }); });
    request.on('error', () => resolve({ status: 0, text: '', json: null }));
    if (data) request.write(data);
    request.end();
  });
}

/** register is also sign-in on the dev codes: the token and the identity of a shop */
async function signIn(shop) {
  await call('POST', '/api/entities/register', null, { email: shop.email, display_name: shop.name });
  const verified = await call('POST', '/api/entities/verify', null, { email: shop.email, otp: ENTITY_OTP });
  if (!verified.json || !verified.json.token) throw new Error('sign-in failed for ' + shop.email + ' (http ' + verified.status + ')');
  return { token: verified.json.token, entity: verified.json.entity || {} };
}

/** a random id of the same shape as `sample`: uuid, number, or text of the same length and letters */
function unknownLike(sample) {
  const text = String(sample);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return crypto.randomUUID();
  if (/^\d+$/.test(text)) return String(900000000 + Math.floor(Math.random() * 99999999));
  const letters = crypto.randomBytes(text.length).toString('hex');
  return letters.slice(0, text.length).replace(/[0-9]/g, (digit) => 'xyzabcdefg'[Number(digit)]);
}
const shapeOf = (sample) => (/^[0-9a-f-]{36}$/i.test(String(sample)) ? 'uuid' : /^\d+$/.test(String(sample)) ? 'number' : 'text:' + String(sample).length);

/** the id and word pools of shop A, read with the owner connection: round-robin across its tables so one big table cannot fill the pool */
async function harvest(pg, entityId) {
  const tables = (await pg.query(`SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='entity_id' ORDER BY 1`)).rows;
  const ids = new Map(), words = new Set();
  const perTable = [];
  for (const { table_name: table } of tables) {
    const rows = (await pg.query(`SELECT to_jsonb(t) AS j FROM "${table}" t WHERE entity_id::text = $1 LIMIT 3`, [String(entityId)])).rows;
    perTable.push({ table, rows: rows.map((row) => row.j) });
  }
  for (let depth = 0; depth < 3; depth++)
    for (const { table, rows } of perTable) if (rows[depth]) collect(rows[depth], table, ids, words);
  return { ids: [...ids.entries()].slice(0, POOL_CAP).map(([value, table]) => ({ value, table })), words: [...words], tables: perTable.filter((t) => t.rows.length).length };
}

/** the probe-worthy values of one row: ids (not the shop's own entity_id column) and words */
function collect(row, table, ids, words) {
  for (const [column, value] of Object.entries(row)) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const text = String(value);
    if (ID_COLUMN.test(column) && text.length >= MIN_ID && text.length <= 64 && /^[A-Za-z0-9_.:@-]+$/.test(text) && !ids.has(text)) ids.set(text, table + '.' + column);
    if (WORD_COLUMN.test(column) && text.length >= MIN_WORD && text.length <= 80) words.add(text);
  }
}

/** a hash of every row shop A owns, per table: a write that landed changes it */
async function snapshot(pg, entityId) {
  const tables = (await pg.query(`SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='entity_id' ORDER BY 1`)).rows;
  const hashes = {};
  for (const { table_name: table } of tables) {
    const row = (await pg.query(`SELECT count(*)::int AS n, md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM "${table}" t WHERE entity_id::text = $1`, [String(entityId)])).rows[0];
    hashes[table] = row.n + ':' + row.h;
  }
  return hashes;
}

/** the routes B can reach with a path id: authenticated, at least one :param, not a sign-out */
function probeRoutes() {
  const loader = require('../tools/load-app.cjs');
  process.env.NODE_ENV = 'test';
  loader.stubDatabase();
  const app = loader.loadApp();
  const auth = require('../middleware/auth');
  const routes = loader.leavesOf(app).filter((leaf) => /:[A-Za-z_]+/.test(leaf.path) && !DANGEROUS.test(leaf.path));
  return routes.filter((leaf) => leaf.fns.includes(auth) || leaf.chain.some((item) => item === auth || item.fn === auth));
}

/** the id as a whole token, any letter case (a message may upper-case it), so a short code like C2 does not eat the middle of a word */
const idPattern = (id) => new RegExp('(?<![A-Za-z0-9])' + String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9])', 'gi');

/** the same body with the probed id masked and the per-call fields dropped, so two answers can be compared */
function masked(response, id) {
  const volatile = /^(request_id|at|ts|timestamp|now|server_time|generated_at|trace_id)$/;
  const strip = (value) => {
    if (Array.isArray(value)) return value.map(strip);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !volatile.test(key)).map(([key, inner]) => [key, strip(inner)]));
    return value;
  };
  const body = response.json === null ? response.text : JSON.stringify(strip(response.json));
  return response.status + ' ' + String(body).replace(idPattern(id), '<ID>');
}

const fillPath = (routePath, id) => routePath.replace(/:[A-Za-z_]+\??/g, encodeURIComponent(id));
const bodyFor = (method) => (WRITES.includes(method) && method !== 'DELETE' ? {} : undefined);

/** one route, one A id: what B gets for it and for an unknown id of the same shape, and the verdict */
async function probeOne(route, id, token, words, baselines) {
  const mine = await call(route.method, fillPath(route.path, id.value), token, bodyFor(route.method));
  const key = route.method + ' ' + route.path + ' ' + shapeOf(id.value);
  if (!baselines.has(key)) {
    const unknown = unknownLike(id.value);
    const baseline = await call(route.method, fillPath(route.path, unknown), token, bodyFor(route.method));
    baselines.set(key, { status: baseline.status, text: masked(baseline, unknown) });
  }
  const base = baselines.get(key);
  if (mine.status === 429 || base.status === 429) return { limited: true };
  const finding = verdict(mine, masked(mine, id.value), base, words);
  return { status: mine.status, base: base.status, finding, mineText: masked(mine, id.value), baseText: base.text };
}

/** LEAK · ORACLE · WORDS · null (identical answer, no word of A) */
function verdict(mine, maskedMine, base, words) {
  const leakedWord = words.find((word) => mine.text.includes(word));
  if (leakedWord) return 'WORDS';
  if (maskedMine === base.text) return null;
  return mine.status >= 200 && mine.status < 300 ? 'LEAK' : 'ORACLE';
}

/** every route x every id, reads first and writes after; `kind` is GET or write */
async function sweep(routes, ids, token, words, kind) {
  const baselines = new Map(), findings = [], stats = { limited: 0, requests: 0, reached: 0, routes: new Set(), reachedRoutes: new Set() };
  const wanted = routes.filter((route) => (kind === 'read' ? route.method === 'GET' : WRITES.includes(route.method)));
  for (const route of wanted) {
    const pool = route.path.match(/:/g) ? ids : [];
    for (const id of pool) {
      const result = await probeOne(route, id, token, words, baselines);
      if (result.limited) { stats.limited++; continue; }
      stats.requests += 2;
      stats.routes.add(route.method + ' ' + route.path);
      if (result.base === 404) { stats.reached++; stats.reachedRoutes.add(route.method + ' ' + route.path); }
      if (result.finding) findings.push({ route: route.method + ' ' + route.path, id: id.value, from: id.table, kind: result.finding, status: result.status, unknown: result.base });
      if (verbose && result.finding) console.log('    ' + result.finding + ' ' + route.method + ' ' + route.path + ' id=' + id.value + ' got ' + result.status + ' (unknown id: ' + result.base + ')');
      if (verbose && result.finding) console.log('        mine: ' + result.mineText.slice(0, 300) + '\n        base: ' + result.baseText.slice(0, 300));
    }
  }
  return { findings, stats };
}

/** findings grouped to one line per route+kind, the form the expected-gaps file uses */
const keysOf = (findings) => [...new Set(findings.map((finding) => finding.kind + ' ' + finding.route))].sort();

async function main() {
  const started = Date.now();
  const owner = OWNER_DB ? new (require('pg').Pool)({ connectionString: OWNER_DB, max: 2 }) : null;
  if (!owner) throw new Error('S41_OWNER_DB_URL is needed (the owner connection that reads shop A\'s ids and hashes its rows)');
  const shopA = await signIn(SHOP_A), shopB = await signIn(SHOP_B);
  const entityA = shopA.entity.identity_id;
  const pool = await harvest(owner, entityA);
  pool.words.push(SHOP_A.email, SHOP_A.name);
  const routes = probeRoutes();
  console.log('  shop A: ' + pool.ids.length + ' ids and ' + pool.words.length + ' words from ' + pool.tables + ' tables · ' + routes.length + ' authenticated routes with a path id');
  const before = await snapshot(owner, entityA);
  const reads = await sweep(routes, pool.ids, shopB.token, pool.words, 'read');
  const writes = await sweep(routes, pool.ids, shopB.token, pool.words, 'write');
  const after = await snapshot(owner, entityA);
  const changed = Object.keys(before).filter((table) => before[table] !== after[table]);
  await owner.end();
  return { reads, writes, changed, routes: routes.length, ids: pool.ids.length, seconds: Math.round((Date.now() - started) / 1000), shopA, shopB };
}

/** the control that keeps the run honest: shop A itself still sees its own shop (the ids are real, the token works) */
async function control(result) {
  const me = await call('GET', '/api/entities/me', result.shopA.token);
  return me.status === 200;
}

function report(result, controlOk) {
  const all = result.reads.findings.concat(result.writes.findings);
  const expected = fs.existsSync(EXPECTED_FILE) ? JSON.parse(fs.readFileSync(EXPECTED_FILE, 'utf8')).gaps : {};
  const found = keysOf(all);
  const unexpected = found.filter((key) => !(key in expected));
  const healed = Object.keys(expected).filter((key) => !found.includes(key));
  const reached = new Set([...result.reads.stats.reachedRoutes, ...result.writes.stats.reachedRoutes]);
  const requests = result.reads.stats.requests + result.writes.stats.requests;
  console.log('  ' + (controlOk ? '✓' : '✗') + ' control: shop A signs in and reads its own shop');
  console.log('  routes probed ' + new Set([...result.reads.stats.routes, ...result.writes.stats.routes]).size + ' · reached the lookup (unknown id = 404) ' + reached.size + ' · requests ' + requests + ' (' + (result.reads.stats.limited + result.writes.stats.limited) + ' skipped: own 429 limit)' + ' · ' + result.seconds + ' s');
  console.log('  ' + (result.changed.length === 0 ? '✓' : '✗') + ' shop A rows unchanged after B\'s writes' + (result.changed.length ? ': ' + result.changed.join(', ') : ''));
  console.log('  findings ' + found.length + ' (' + unexpected.length + ' not in the expected-gaps file) · expected gaps now clean ' + healed.length);
  unexpected.forEach((key) => console.log('  ✗ NEW ' + key));
  healed.forEach((key) => console.log('  ✗ HEALED, remove from isolation-s41.expected.json: ' + key));
  if (argv.includes('--write-expected')) writeExpected(all);
  return controlOk && result.changed.length === 0 && unexpected.length === 0 && healed.length === 0;
}

/** the honest list of known, filed gaps: each key is `KIND METHOD /path`; the value says where it is filed */
function writeExpected(findings) {
  const gaps = {};
  keysOf(findings).forEach((key) => (gaps[key] = 'UNFILED - written by --write-expected: file it as a P1 before this job may stay green'));
  fs.writeFileSync(EXPECTED_FILE, JSON.stringify({ about: 'S41 known cross-shop gaps. Green only for these, each filed. A healed gap must leave the list.', gaps }, null, 2) + '\n');
  console.log('  wrote ' + EXPECTED_FILE);
}

main()
  .then(async (result) => {
    const ok = report(result, await control(result));
    console.log('\n  ' + (ok ? 'PASS' : 'FAIL') + ' isolation-s41');
    process.exit(ok ? 0 : 1);
  })
  .catch((failure) => {
    console.log('  ✗ isolation-s41 could not run: ' + failure.message);
    process.exit(1);
  });
