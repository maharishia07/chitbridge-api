'use strict';
/**
 * tools/round-trips-volume.cjs — SPD-17 · what a route costs WITH DATA: trips and p50/p95 ms at 0 / 1,000 / 10,000 extra rows per main table.
 *
 *   node tools/round-trips-volume.cjs --prepare          make the base database cb_volume_base (a copy of cb_local) once
 *   node tools/round-trips-volume.cjs --write            measure and write the baseline round-trips.volume.json (commit it)
 *   node tools/round-trips-volume.cjs [--check]          measure and compare with the baseline; exit 1 on a growth or a ceiling (nightly)
 *   options: --levels 0,1000,10000 · --runs 8 (timed calls per route) · --out file (also keep this run's numbers)
 *
 * OWNS: the volume levels, the baseline file, the verdict. REUSES (never a second harness): tests/round-trips-all.test.cjs --volume (the same
 * called-route list, mounts and X-DB-Trips header, run against a real database) and tests/support/seed-volume.cjs (the rows).
 * CALLED BY: `npm run check:trips:volume` (nightly, by hand or by a workflow Athi adds). FLOW: SPD-17 · speed scorecard row 12.
 * CARD 28-platform-and-operations/round-trip-volume
 *
 * ⭐ WHAT FAILS (the same promise as round-trips.budget.json: ceilings only fall)
 *    1. TRIPS GROW WITH ROWS: trips at 10,000 above trips at 1,000 on a route the baseline does not already list as `grows` — an N+1 hidden by an
 *       empty stub. A listed grower may not go above its own baseline (each listed grower has an SPD-n line in docs/speed/SPEED-BACKLOG.md).
 *    2. TRIPS ABOVE THE BASELINE at any level.
 *    3. P95 ABOVE ITS CEILING at any level: ceiling = baseline p95 × 1.5 (but at least +50 ms). Why 1.5: the same route measured twice on this
 *       laptop (Docker Postgres, one process, 8 timed calls) differs by up to about a third, so 1.5 catches a real change and not the noise;
 *       the +50 ms floor stops a 5 ms route from failing at 8 ms. A 10× row growth that costs 10× the time shows at once.
 *    Lower a number: run --write and commit. Never raise one without the reason in the commit.
 * ⭐ LOCAL ONLY: Docker container cb-local-pg (toolset/local-stack.sh up), databases cb_volume_base / cb_volume, 127.0.0.1. Never production,
 *    Railway or Supabase. Each level starts from a fresh copy of the base: nothing is deleted, no trigger is switched off.
 *    Writes (POST/PUT/DELETE) are not fired: they would change the data being measured; the trip budget still covers them on the empty stub.
 * ⚠️ Free RAM must be ≥ 2 GB (the run refuses below it). The 10,000 level takes minutes, not seconds. Do not run guards beside it: timing is noisy.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { DEMO_SHOP } = require('../tests/support/seed-volume.cjs');

const API = path.join(__dirname, '..');
const BASELINE = path.join(API, 'round-trips.volume.json');
const CONTAINER = process.env.CB_LOCAL_PGC || 'cb-local-pg';
const PORT = process.env.CB_LOCAL_PGPORT || '55432';
const VOLUME_URL = 'postgres://postgres:cblocal@127.0.0.1:' + PORT + '/cb_volume';
const MIN_FREE_GB = 2;
const P95_FACTOR = 1.5;
const P95_FLOOR_MS = 50;
const DEFAULT_LEVELS = [0, 1000, 10000];
const flagValue = (flag, fallback) => { const at = process.argv.indexOf(flag); return at > 0 ? process.argv[at + 1] : fallback; };
const hasFlag = (flag) => process.argv.includes(flag);
const childEnv = Object.assign({}, process.env, { CB_VOLUME_URL: VOLUME_URL, CB_VOLUME_ENTITY: DEMO_SHOP });

function runCommand(command, args, options) { return spawnSync(command, args, Object.assign({ encoding: 'utf8', env: childEnv, maxBuffer: 64 << 20 }, options)); }
const psql = (database, sql) => runCommand('docker', ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', database, '-Atc', sql]);

/** Make the base database once: a plain copy of cb_local (schema + the demo shop), so cb_local itself is never written. */
function prepareBase() {
  const probe = psql('postgres', "SELECT 1 FROM pg_database WHERE datname='cb_volume_base'");
  if (probe.status !== 0) throw new Error('Docker container ' + CONTAINER + ' is not running (sh C:/dev/toolset/local-stack.sh up): ' + (probe.stderr || '').slice(0, 120));
  if (probe.stdout.trim() === '1') return;
  psql('postgres', 'CREATE DATABASE cb_volume_base');
  const copy = runCommand('docker', ['exec', CONTAINER, 'sh', '-c', 'pg_dump -U postgres cb_local | psql -q -U postgres -d cb_volume_base']);
  if (copy.status !== 0) throw new Error('copy of cb_local failed: ' + (copy.stderr || '').slice(0, 200));
  console.log('  cb_volume_base made from cb_local');
}

/** A level starts from a fresh copy of the base, so nothing is ever deleted or switched off to reset it. */
function freshScratch() {
  psql('postgres', 'DROP DATABASE IF EXISTS cb_volume WITH (FORCE)');
  const made = psql('postgres', 'CREATE DATABASE cb_volume TEMPLATE cb_volume_base');
  if (made.status !== 0) throw new Error('could not copy cb_volume_base: ' + (made.stderr || '').slice(0, 200));
}

/** One level: fresh copy, seed N extra rows, then time every GET route the web calls. Returns {route: {status, trips, p50, p95} | {error}}. */
function measureLevel(rows, timedRuns) {
  freshScratch();
  const seed = runCommand('node', [path.join(API, 'tests', 'support', 'seed-volume.cjs'), '--rows', String(rows)]);
  if (seed.status !== 0) throw new Error('seed at ' + rows + ' failed: ' + (seed.stderr || seed.stdout).slice(0, 300));
  console.log(seed.stdout.trim());
  const outFile = path.join(os.tmpdir(), 'round-trips-volume-' + rows + '.json');
  const timed = runCommand('node', [path.join(API, 'tests', 'round-trips-all.test.cjs'), '--volume', '--out', outFile, '--runs', String(timedRuns)], { timeout: 55 * 60 * 1000 });
  if (timed.status !== 0) throw new Error('timed run at ' + rows + ' failed: ' + (timed.stderr || timed.stdout).slice(-300));
  return JSON.parse(fs.readFileSync(outFile, 'utf8')).routes;
}

/** {route: {rows: {trips,p50,p95}}} from the per-level answers; a route that errored at any level is left out and listed. */
function assemble(perLevel, levels) {
  const routes = {}; const unmeasured = new Set();
  for (const level of Object.keys(perLevel)) {
    for (const [route, answer] of Object.entries(perLevel[level])) {
      if (answer.error) { unmeasured.add(route); continue; }
      (routes[route] = routes[route] || {})[level] = { trips: answer.trips, p50: answer.p50, p95: answer.p95, status: answer.status };
    }
  }
  for (const route of Object.keys(routes)) if (unmeasured.has(route) || Object.keys(routes[route]).length !== levels.length) delete routes[route];
  return { routes, unmeasured: [...unmeasured].sort() };
}

const topLevel = (levels) => String(Math.max(...levels));
const belowTop = (levels) => String(levels[Math.max(0, levels.length - 2)]);
/** Trips added by the last stretch of rows: 0 on a route that reads with a fixed number of statements. */
const tripGrowth = (byLevel, levels) => byLevel[topLevel(levels)].trips - byLevel[belowTop(levels)].trips;
const p95Ceiling = (p95Ms) => Math.round(Math.max(p95Ms * P95_FACTOR, p95Ms + P95_FLOOR_MS) * 10) / 10;

/** The committed shape: per route and level the baseline trips + p50/p95 and the p95 ceiling; `grows` marks a known grower. */
function toBaseline(routes, levels) {
  const out = {};
  for (const route of Object.keys(routes).sort()) {
    out[route] = { grows: tripGrowth(routes[route], levels) > 0 };
    for (const level of levels) {
      const measured = routes[route][level];
      out[route][level] = { trips: measured.trips, p50: measured.p50, p95: measured.p95, p95_ceiling: p95Ceiling(measured.p95) };
    }
  }
  return out;
}

/** The sentences one route earns against its baseline row: growth that is new, trips above the baseline, p95 above its ceiling. */
function judgeRoute(route, byLevel, baseRow, levels) {
  const problems = [];
  if (tripGrowth(byLevel, levels) > 0 && !(baseRow && baseRow.grows)) {
    problems.push('N+1? ' + route + ' trips grow with rows: ' + byLevel[belowTop(levels)].trips + ' at ' + belowTop(levels) + ' -> ' + byLevel[topLevel(levels)].trips + ' at ' + topLevel(levels));
  }
  if (!baseRow) return problems.concat('no volume baseline for ' + route + ' (run --write, say why)');
  for (const level of levels) {
    const base = baseRow[level]; const now = byLevel[level];
    if (!base) continue;
    if (now.trips > base.trips) problems.push(route + ' trips ' + now.trips + ' > baseline ' + base.trips + ' at ' + level + ' rows');
    if (now.p95 > base.p95_ceiling) problems.push(route + ' p95 ' + now.p95 + ' ms > ceiling ' + base.p95_ceiling + ' ms at ' + level + ' rows');
  }
  return problems;
}

/** The verdict against the committed baseline: a list of sentences, empty = pass. A route the baseline lists as unmeasured is not judged. */
function judge(routes, baseline, levels) {
  const skip = new Set(baseline.unmeasured || []);
  return Object.keys(routes).filter((route) => !skip.has(route)).flatMap((route) => judgeRoute(route, routes[route], baseline.routes[route], levels));
}

/** Top-10 tables for the report / the backlog: by trips added with rows, and by p95 at the top level. */
function topTen(routes, levels) {
  const all = Object.keys(routes).map((route) => ({ route, byLevel: routes[route] }));
  const top = topLevel(levels);
  const byGrowth = all.filter((row) => tripGrowth(row.byLevel, levels) > 0).sort((left, right) => tripGrowth(right.byLevel, levels) - tripGrowth(left.byLevel, levels)).slice(0, 10);
  const byP95 = all.slice().sort((left, right) => right.byLevel[top].p95 - left.byLevel[top].p95).slice(0, 10);
  console.log('\n  TOP 10 BY TRIPS GROWTH (' + belowTop(levels) + ' -> ' + top + ' rows):');
  byGrowth.forEach((row) => console.log('    +' + tripGrowth(row.byLevel, levels) + ' trips  (' + levels.map((level) => row.byLevel[level].trips).join(' / ') + ')  ' + row.route));
  if (!byGrowth.length) console.log('    none: no route adds trips as rows grow');
  console.log('\n  TOP 10 BY p95 AT ' + top + ' ROWS (p95 / p50 ms, trips):');
  byP95.forEach((row) => console.log('    ' + String(row.byLevel[top].p95).padStart(7) + ' / ' + String(row.byLevel[top].p50).padStart(7) + ' ms · ' + row.byLevel[top].trips + ' trips  ' + row.route));
}

/** Write the committed baseline file from this run's numbers. */
function writeBaseline(routes, unmeasured, levels) {
  const doc = { _doc: 'SPD-17: round-trip cost WITH DATA. Per GET route the web calls: trips and p50/p95 ms at 0 / 1,000 / 10,000 extra rows per main table (tests/support/seed-volume.cjs, local scratch DB). p95_ceiling = p95 x ' + P95_FACTOR + ' (at least +' + P95_FLOOR_MS + ' ms). grows:true = trips rise with rows (an SPD-n backlog line each). Lower with node tools/round-trips-volume.cjs --write; never raise without the reason in the commit.',
    levels, measured_on: new Date().toISOString().slice(0, 10), unmeasured, routes: toBaseline(routes, levels) };
  fs.writeFileSync(BASELINE, JSON.stringify(doc, null, 1) + '\n');
  console.log('\n  wrote ' + BASELINE);
}

/** Measure every level, print the top tens, then either write the baseline (--write) or judge against it (default). */
function main() {
  if (hasFlag('--prepare')) { prepareBase(); return; }
  const freeGb = os.freemem() / 2 ** 30;
  if (freeGb < MIN_FREE_GB) throw new Error('REFUSED: ' + freeGb.toFixed(1) + ' GB of RAM free, need ' + MIN_FREE_GB + ' GB');
  const levels = String(flagValue('--levels', DEFAULT_LEVELS.join(','))).split(',').map(Number);
  prepareBase();
  const perLevel = {};
  for (const rows of levels) { console.log('\n  level ' + rows + ' extra rows per table'); perLevel[rows] = measureLevel(rows, Number(flagValue('--runs', 8))); }
  const { routes, unmeasured } = assemble(perLevel, levels);
  if (flagValue('--out')) fs.writeFileSync(flagValue('--out'), JSON.stringify({ routes, unmeasured }, null, 1));
  console.log('\n  ' + Object.keys(routes).length + ' GET routes measured at ' + levels.join(' / ') + ' rows · ' + unmeasured.length + ' answered 5xx or did not load (listed in the baseline)');
  topTen(routes, levels);
  if (hasFlag('--write')) { writeBaseline(routes, unmeasured, levels); return; }
  const problems = judge(routes, JSON.parse(fs.readFileSync(BASELINE, 'utf8')), levels);
  problems.forEach((sentence) => console.log('  FAIL ' + sentence));
  console.log('\n  ' + (problems.length ? problems.length + ' failed' : 'all within the volume baseline') + '\n');
  process.exit(problems.length ? 1 : 0);
}

if (require.main === module) { try { main(); } catch (err) { console.error(err.message); process.exit(1); } }
module.exports = { assemble, toBaseline, judge, tripGrowth, p95Ceiling };
