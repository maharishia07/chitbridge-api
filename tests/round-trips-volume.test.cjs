'use strict';
/**
 * tests/round-trips-volume.test.cjs — SPD-17 · the verdict of tools/round-trips-volume.cjs, on made-up numbers (no database, no Docker).
 * ALSO (SPD-17, offline): a fresh run of tools/round-trips-volume.cjs --stub --check (the round-trips stub answering 0 / 10 / 100 rows per read) against round-trips.volume.json.
 * OWNS: the three promises (a new N+1 fails · trips and p95 never pass their baseline · a listed grower may not grow more) and the baseline shape.
 * CALLED BY: scripts/guards.cjs. CARD 28-platform-and-operations/round-trip-volume
 */
const { URL_OK } = require('./support/seed-volume.cjs');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { assemble, toBaseline, judge, tripGrowth, p95Ceiling, raises, judgeKnown, notExercised, unnamedGrowers } = require('../tools/round-trips-volume.cjs');
const API = path.join(__dirname, '..');

let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ok   ' + name); } else { failed++; console.log('  FAIL ' + name + (extra ? '   ' + extra : '')); } };

const LEVELS = [0, 1000, 10000];
const level = (trips, p95) => ({ trips, p50: p95 / 2, p95, status: 200 });
const flat = { 0: level(3, 10), 1000: level(3, 40), 10000: level(3, 200) };
const grower = { 0: level(5, 10), 1000: level(10, 40), 10000: level(60, 200) };

const routes = { 'GET /flat': flat, 'GET /grower': grower };
const baseline = { routes: toBaseline(routes, LEVELS), unmeasured: [] };

check('trips added with rows are measured between the last two levels', tripGrowth(flat, LEVELS) === 0 && tripGrowth(grower, LEVELS) === 50);
check('the baseline marks only the grower', baseline.routes['GET /flat'].grows === false && baseline.routes['GET /grower'].grows === true);
check('p95 ceiling is 1.5x, but at least +50 ms for a tiny route', p95Ceiling(200) === 300 && p95Ceiling(10) === 60);
check('the run that made the baseline passes it', judge(routes, baseline, LEVELS).length === 0);

const newN1 = Object.assign({}, routes, { 'GET /flat': { 0: level(3, 10), 1000: level(3, 40), 10000: level(30, 200) } });
check('a flat route that starts growing is named as an N+1', judge(newN1, baseline, LEVELS).some((s) => /N\+1\? GET \/flat/.test(s)));

const moreTrips = Object.assign({}, routes, { 'GET /grower': { 0: level(5, 10), 1000: level(10, 40), 10000: level(61, 200) } });
check('a listed grower may not go above its own baseline trips', judge(moreTrips, baseline, LEVELS).some((s) => /GET \/grower trips 61 > baseline 60/.test(s)));

const slower = Object.assign({}, routes, { 'GET /flat': { 0: level(3, 10), 1000: level(3, 40), 10000: level(3, 301) } });
check('p95 over its ceiling fails', judge(slower, baseline, LEVELS).some((s) => /GET \/flat p95 301 ms > ceiling 300 ms at 10000/.test(s)));

check('a route with no baseline row fails with the way out', judge({ 'GET /new': flat }, baseline, LEVELS).some((s) => /no volume baseline for GET \/new/.test(s)));
check('a route the baseline lists as unmeasured is not judged', judge({ 'GET /new': flat }, { routes: {}, unmeasured: ['GET /new'] }, LEVELS).length === 0);

const merged = assemble({ 0: { 'GET /a': level(1, 5), 'GET /b': { error: 'answered 500' } }, 1000: { 'GET /a': level(1, 6), 'GET /b': level(1, 6) } }, [0, 1000]);
check('a route that errored at any level is left out and listed', Object.keys(merged.routes).join() === 'GET /a' && merged.unmeasured.join() === 'GET /b');

check('the volume seed refuses any database that is not the local scratch one', URL_OK.test('postgres://u:p@127.0.0.1:55432/cb_volume') && !URL_OK.test('postgres://u:p@db.example.com:5432/cb_volume') && !URL_OK.test('postgres://u:p@127.0.0.1:55432/cb_local'));

/* ── SPD-17 offline: the committed trips baseline, and a fresh run of the rows stub against it (no database, no network) ── */
const base = JSON.parse(fs.readFileSync(path.join(API, 'round-trips.volume.json'), 'utf8'));
const budget = JSON.parse(fs.readFileSync(path.join(API, 'round-trips.budget.json'), 'utf8')).routes;
check('every baseline route has a budget line (a renamed route is re-measured, not left behind)', Object.keys(base.routes).every((r) => budget[r]), Object.keys(base.routes).filter((r) => !budget[r]).join(', '));
check('the two NET-98 routes are known growers with their backlog line', ['GET /api/catalogue/network/:bridge_id', 'POST /api/catalogue/network-store/:networkId/order'].every((r) => base.known_growers && base.known_growers[r] && base.known_growers[r].backlog === 'NET-98'));
check('known growers sit within their ceilings today', judgeKnown(base.known_growers, budget).length === 0, judgeKnown(base.known_growers, budget).join('; '));
check('a known grower whose budget line rises above its ceiling fails', judgeKnown({ 'GET /x': { backlog: 'NET-98', trips: 10 } }, { 'GET /x': { trips: 11 } }).length === 1);
const raised = (trips) => raises({ 'GET /grower': { 0: level(5, 10), 1000: level(10, 40), 10000: level(trips, 200) } }, baseline.routes, LEVELS).length;
check('a rewrite that would RAISE a baseline number is refused; a fall is fine', raised(60) === 0 && raised(61) === 1 && raised(50) === 0);

/* ── silence is the bug: a new grower must be named; a route that stops being exercised must not read as flat ── */
check('--write refuses a NEW grower that no backlog line names', unnamedGrowers({ 'GET /brand/new': grower }, LEVELS).join() === 'GET /brand/new');
check('--write accepts a grower named in KNOWN_GROWERS with its backlog id, and a flat route', unnamedGrowers({ 'GET /api/tax/gstr': grower, 'GET /flat': flat }, LEVELS).length === 0);
check('every grower in the committed baseline is named (known with a backlog id, or a stub artefact with its reason)', Object.keys(base.routes).filter((r) => base.routes[r].grows).every((r) => (base.known_growers[r] && base.known_growers[r].backlog) || (base.stub_artefacts && base.stub_artefacts[r])));
check('the real growers carry their backlog line', base.known_growers['GET /api/tax/gstr'].backlog === 'SPD-48' && base.known_growers['GET /api/relationships/suppliers'].backlog === 'SPD-49' && base.known_growers['GET /api/till/snapshot'].backlog === 'SPD-50' && base.known_growers['GET /api/catalogue/network-store/:networkId'].backlog === 'NET-98');
const answer4xx = { 0: Object.assign(level(1, 1), { status: 404 }), 1000: Object.assign(level(1, 1), { status: 404 }), 10000: Object.assign(level(1, 1), { status: 404 }) };
check('a route that answers 4xx is listed as not exercised, a 2xx one is not', notExercised({ 'GET /a': answer4xx, 'GET /b': flat }, LEVELS).join() === 'GET /a');
check('the baseline marks exercised per route', baseline.routes['GET /flat'].exercised === true && toBaseline({ 'GET /a': answer4xx }, LEVELS)['GET /a'].exercised === false);
const nowGone = judge({ 'GET /flat': answer4xx }, baseline, LEVELS, []);
check('a route that moves from 2xx to 4xx FAILS the check (its flat line no longer proves anything)', nowGone.some((sentence) => /GET \/flat used to answer 2xx/.test(sentence)));
check('a route that newly answers 5xx FAILS the check, a known unmeasured one does not', judge({}, baseline, LEVELS, ['GET /flat']).some((sentence) => /GET \/flat answered 5xx/.test(sentence)) && judge({}, { routes: {}, unmeasured: ['GET /x'] }, LEVELS, ['GET /x']).length === 0);

const fresh = spawnSync(process.execPath, [path.join(API, 'tools', 'round-trips-volume.cjs'), '--stub', '--check'], { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 4 * 60 * 1000 });
const failures = (fresh.stdout || '').split('\n').filter((line) => /FAIL /.test(line));
check('the rows stub at 0 / 10 / 100 rows matches the baseline: no new N+1, no route dearer', fresh.status === 0, failures.join(' | ') || (fresh.stderr || '').slice(-200));

console.log('\n  ' + passed + ' checks · ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
