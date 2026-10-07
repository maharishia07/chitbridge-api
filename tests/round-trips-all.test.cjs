'use strict';
/**
 * tests/round-trips-all.test.cjs — ⭐⭐ EVERY ROUTE THE WEB CLIENT CALLS HAS A ROUND-TRIP BUDGET (DB10, 2026-10-07).
 *
 * One route had a budget (round-trips-till: GET /till/snapshot). The audit (AUDIT-db-calls-2026-10-06) found the cost is
 * spread over the whole called surface, and a surface with no ceiling only ever drifts up. `round-trips.budget.json` now has
 * a line for every route in `node tools/endpoint-usage.cjs --called`, and this test fires each one with CB_TRIPS=1 and reads
 * the SAME `X-DB-Trips` header a live server would send: the real lib/trips middleware, the real db/index.js counting.
 * Only the wire is replaced: `pg`'s Pool is a stub that answers every statement with no rows (and counts the statements).
 *
 * ⭐ THE FIRST BUDGET IS TODAY'S NUMBER. Nothing is tuned here: the point is that nothing REGRESSES while the fixes land.
 *    When a route gets cheaper, run `node tests/round-trips-all.test.cjs --write` and commit the lower line.
 *    ⚠️ Never raise a line without saying why in the commit — this file is the only thing stopping the drift.
 *
 * ⚠️ AN EMPTY STUB IS A SHALLOW STUB. Most routes meet no rows, so many answer 404/400 early and measure only the trips up to
 *    that answer. They are budgeted and fired, and counted as "answered 4xx": the number is a floor, not the route's full cost.
 *    A route that cannot be fired at all (no mount, 5xx, timeout) is printed as "budgeted, not fired" with the reason — never
 *    skipped in silence. Its budget is a placeholder ceiling (UNFIRED_CEILING) until a fixture lets it run.
 *
 * ⭐ I19: no called route without a budget line. Checked whenever the web client sits next to this repo (the list comes from
 *    tools/endpoint-usage.cjs --json); without it the budget file's own list is what is fired, and that is said.
 *
 * Run: node tests/round-trips-all.test.cjs [--write] · no DB, no network.
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const API = path.join(__dirname, '..');
const BUDGET_FILE = path.join(API, 'round-trips.budget.json');
const WRITE = process.argv.includes('--write');
const UNFIRED_CEILING = 50;

process.env.CB_TRIPS = '1';
process.env.RLS_GUARD = 'off';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://u:p@127.0.0.1:5432/x';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.DB_BOOT_WAIT_MS = '2000';

/* ── the wire: a pool that counts statements and answers with no rows ── */
let wire = 0;
const empty = () => ({ rows: [], rowCount: 0, fields: [], command: 'SELECT' });
function answer(text) {
  wire += 1;
  /* readBatch sends BEGIN; ...; COMMIT; as one simple-protocol text and slices the middle out of an array of results */
  if (/^\s*BEGIN;/.test(String(text))) return Array.from({ length: 200 }, empty);
  return empty();
}
class FakePool {
  on() { return this; }
  async end() {}
  query(text, params, cb) {
    if (typeof params === 'function') cb = params;
    const r = answer(text);
    if (cb) { cb(null, r); return undefined; }
    return Promise.resolve(r);
  }
  connect(cb) {
    const client = { query: (q) => Promise.resolve(answer(q)), release() {} };
    if (typeof cb === 'function') { cb(null, client, () => {}); return undefined; }
    return Promise.resolve(client);
  }
}
require('pg').Pool = FakePool;

/* no network: whatever a route tries to fetch fails fast (this file keeps the real one for its own requests) */
const realFetch = global.fetch;
global.fetch = () => Promise.reject(new Error('offline test'));

const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(
  (req, res, next) => { req.identity = { identity_id: 'e1', identity_type: 'entity', entity_id: 'e1' }; next(); },
  { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id,
    requireScope: () => (req, res, next) => next(), userOf: (req) => req.identity, forgetKey: () => {}, keyAlive: async () => true }) };

/* ── the list: what the client calls, from the one scanner ── */
let budget = { routes: {} };
try { budget = JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8')); } catch (_) { /* first run: --write is about to make it */ }
budget.routes = budget.routes || {};

const webHere = fs.existsSync(path.join(API, '..', 'chitbridge-web', 'public', 'app'));
let called = null, mounts = {};
if (webHere) {
  const r = spawnSync(process.execPath, [path.join(API, 'tools', 'endpoint-usage.cjs'), '--json'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  try { const j = JSON.parse(r.stdout); called = j.called; mounts = j.mounts; } catch (e) { called = null; }
}
if (!called) {
  /* the web client is not beside us: fire the budget's own list, with the mounts server.js declares */
  const src = fs.readFileSync(path.join(API, 'server.js'), 'utf8');
  for (const m of src.matchAll(/app\.use\(\s*['"]([^'"]+)['"][\s\S]{0,120}?require\(['"][^'"]*routes\/([A-Za-z0-9_-]+)['"]\)/g)) if (!mounts[m[2] + '.js']) mounts[m[2] + '.js'] = m[1];
  called = Object.keys(budget.routes).map((k) => ({ route: k, file: budget.routes[k].file }));
}

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '   ' + extra : '')); }
};

/* A route the client calls WITHOUT the registry (the shell's direct get('/api/entities/header'), N19) is invisible to the scanner. Its budget line
   says `extra: true` and it is added to the list HERE, BEFORE the mount loop (or its file is never mounted), so it is still fired / checked and the "no longer called" check does not drop it. */
for (const k of Object.keys(budget.routes)) if (budget.routes[k].extra && !called.some((r) => r.route === k)) called.push({ route: k, file: budget.routes[k].file });

const express = require('express');
const app = express();
app.use(require(path.join(API, 'lib', 'trips')).middleware());
app.use(express.json({ limit: '8mb' }));
const mountedFiles = new Set();
const mountErr = {};
for (const f of [...new Set(called.map((r) => r.file))].sort()) {
  const base = mounts[f];
  if (base === undefined) { mountErr[f] = 'no mount in server.js'; continue; }
  try { app.use(base, require(path.join(API, 'routes', f))); mountedFiles.add(f); }
  catch (e) { mountErr[f] = 'would not load: ' + String(e && e.message).slice(0, 60); }
}

/* A route the client calls WITHOUT the registry (the shell's direct get('/api/entities/header'), N19) is invisible to the scanner. Its budget line
   says `extra: true` and it is added to the list here, so it is still fired / checked and the "no longer called" check does not drop it. */
for (const k of Object.keys(budget.routes)) if (budget.routes[k].extra && !called.some((r) => r.route === k)) called.push({ route: k, file: budget.routes[k].file });

const ID = '00000000-0000-4000-8000-000000000001';
async function fire(port, route) {
  const sp = route.indexOf(' ');
  const method = route.slice(0, sp), url = route.slice(sp + 1).replace(/:[A-Za-z_]+/g, ID);
  wire = 0;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 6000);
  try {
    const opts = { method, signal: ac.signal, headers: { 'content-type': 'application/json' } };
    if (method !== 'GET' && method !== 'DELETE') opts.body = '{}';
    const r = await realFetch('http://127.0.0.1:' + port + url, opts);
    await r.text().catch(() => '');
    const h = r.headers.get('x-db-trips');
    return { status: r.status, trips: h === null ? null : Number(h), wire };
  } catch (e) { return { error: e.name === 'AbortError' ? 'timed out' : String(e.message).slice(0, 50), wire }; }
  finally { clearTimeout(timer); }
}

const srv = app.listen(0, '127.0.0.1', async () => {
  const fired = [], shallow = [], notFired = [];
  const next = { _doc: budget._doc, routes: {} };
  try {
    const sorted = called.slice().sort((a, b) => a.route.localeCompare(b.route));
    for (const r of sorted) {
      let m;
      if (!mountedFiles.has(r.file)) m = { error: mountErr[r.file] || 'no mount' };
      else {
        m = await fire(srv.address().port, r.route);
        if (!m.error && m.trips === null) m = { error: 'no X-DB-Trips header (status ' + m.status + ')' };
        else if (!m.error && m.status >= 500) m = { error: 'answered ' + m.status + ' on the stub' };
      }
      const b = budget.routes[r.route];
      const row = { route: r.route, file: r.file, status: m.status, trips: m.trips, wire: m.wire };
      if (m.error) {
        notFired.push(Object.assign(row, { why: m.error }));
        next.routes[r.route] = { file: r.file, trips: b && b.fired === false ? b.trips : UNFIRED_CEILING, wire: null, fired: false, why: m.error, ...(b && b.extra ? { extra: true } : {}) };
        continue;
      }
      (m.status >= 400 ? shallow : fired).push(row);
      next.routes[r.route] = { file: r.file, trips: m.trips, wire: m.wire, fired: true, status: m.status, ...(b && b.extra ? { extra: true } : {}) };
      if (!WRITE) {
        t(r.route + ' has a budget line (I19)', !!b);
        if (b && b.fired !== false) {
          t(r.route + ' within ' + b.trips + ' trips', m.trips <= b.trips, m.trips + ' used · status ' + m.status);
          if (typeof b.wire === 'number') t(r.route + ' within ' + b.wire + ' statements', m.wire <= b.wire, m.wire + ' sent');
        }
      }
    }
    if (!WRITE) {
      for (const n of notFired) t(n.route + ' has a budget line (I19, budgeted not fired)', !!budget.routes[n.route], n.why);
      if (webHere) {
        const gone = Object.keys(budget.routes).filter((k) => !called.some((r) => r.route === k));
        t('no budget line for a route the client no longer calls', gone.length === 0, gone.slice(0, 3).join(' | '));
      } else console.log('  note: the web client is not beside this repo, so I19 is checked against the budget file\'s own list only');
    }
    if (WRITE) {
      next._doc = 'DB10: round-trip ceiling per route the web client calls. trips = X-DB-Trips, wire = statements sent. Lower it when a route gets cheaper (node tests/round-trips-all.test.cjs --write); never raise without saying why. fired:false = placeholder ceiling, the route could not be fired offline (see why).';
      fs.writeFileSync(BUDGET_FILE, JSON.stringify(next, null, 2) + '\n');
      console.log('  wrote ' + BUDGET_FILE);
    }
    console.log(`\n  ${called.length} routes budgeted · ${fired.length + shallow.length} fired (${shallow.length} answered 4xx on the empty stub) · ${notFired.length} budgeted, not fired`);
    if (notFired.length) { console.log('\n  BUDGETED, NOT FIRED:'); notFired.forEach((n) => console.log('    ' + n.route.padEnd(52) + n.why)); }
    const worst = fired.concat(shallow).sort((a, b) => (b.wire - a.wire) || (b.trips - a.trips)).slice(0, 5);
    console.log('\n  FIVE WORST (statements on the wire, then X-DB-Trips):'); worst.forEach((w) => console.log('    ' + String(w.wire).padStart(3) + ' stmts · ' + w.trips + ' trips  ' + w.route + '  (status ' + w.status + ')'));
  } catch (e) { fail++; console.log('  FAIL the measurement ran   ' + (e && e.stack)); }
  console.log(`\n  ${pass} checks · ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
});
