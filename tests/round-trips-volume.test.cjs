'use strict';
/**
 * tests/round-trips-volume.test.cjs — SPD-17 · the verdict of tools/round-trips-volume.cjs, on made-up numbers (no database, no Docker).
 * OWNS: the three promises (a new N+1 fails · trips and p95 never pass their baseline · a listed grower may not grow more) and the baseline shape.
 * CALLED BY: scripts/guards.cjs. CARD 28-platform-and-operations/round-trip-volume
 */
const { URL_OK } = require('./support/seed-volume.cjs');
const { assemble, toBaseline, judge, tripGrowth, p95Ceiling } = require('../tools/round-trips-volume.cjs');

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

console.log('\n  ' + passed + ' checks · ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
