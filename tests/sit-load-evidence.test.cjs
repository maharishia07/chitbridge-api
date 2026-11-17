'use strict';
/**
 * tests/sit-load-evidence.test.cjs - THE RECORDED SIT LOAD RUNS AGREE WITH THEMSELVES AND ARE NOT STALE.
 *
 * ⚠️ WHAT THIS PROVES, SAID PLAINLY: a RECORD of a run, not a live one. It reads docs/perf/sit-runs-2026-11.json (numbers copied from the junit
 * the SIT knee / stress / load runs of 2026-11-06 wrote; the run notes are in C:/dev/PM, which CI cannot read) and checks the record's own
 * invariants. It drives no server. It fails when the record is older than its own max_age_days, so the claim "we measured the knee" cannot
 * outlive the measurement: re-run toolset/sitload/ramp.cjs on SIT and update the file.
 *   1  the knee is present, is one of the steps, and is the FIRST step whose p95 passes baseline_factor x the lowest step's p95
 *   2  p50 <= p95 <= p99 in every segment; p95 never falls by more than 3 ms from one step to the next (rises with load)
 *   3  0 x 5xx and 0 timeouts in every step, hold, soak and spike; below the knee also 0 x 429 (a 429 there would be the limiter, not capacity)
 *   4  every step sent exactly rate x seconds (nothing silently dropped from the count); the hold sat at 80% of the knee
 *   5  spikes recover: each "recover" p95 within 1.5x of its "base-before" p95
 *   6  the 184-route pass adds up (200 + 403 + 400 + 401 = 184, 0 x 5xx); the round-trip totals are what the over-budget gap says; the budget file exists
 *   7  the record says it is a record (recorded_not_live) and names its sources
 *   8  not stale: run_date within max_age_days of today
 * CARD      28-platform-and-operations/load-simulation
 * CARD      28-platform-and-operations/performance-and-round-trips
 * Run: node tests/sit-load-evidence.test.cjs
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
const R = JSON.parse(fs.readFileSync(path.join(API, 'docs', 'perf', 'sit-runs-2026-11.json'), 'utf8'));

let n = 0, failed = 0;
const it = (name, fn) => { n++; try { fn(); console.log('  ok  ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } };
const segments = () => [].concat(R.steps, [R.hold_below_knee, R.soak], R.spikes);

it('the record says it is a record, with its sources named', () => {
  assert.strictEqual(R.recorded_not_live, true);
  assert.ok(R.source_docs.length >= 3 && R.source_junit.length >= 5, 'sources named');
  assert.ok(/^[0-9a-f]{8}$/.test(R.target.api_commit), 'the api commit the run measured');
});

it('the knee is present, is one of the steps, and is the first step past baseline_factor x the lowest p95', () => {
  const rates = R.steps.map((s) => s.rate_per_s);
  assert.ok(rates.every((r, i) => i === 0 || r > rates[i - 1]), 'steps ascend');
  assert.ok(R.knee && rates.includes(R.knee.rate_per_s), 'the knee is a measured step');
  const limit = R.knee.baseline_factor * R.steps[0].p95_ms;
  const first = R.steps.find((s) => s.p95_ms >= limit);
  assert.ok(first, 'no step passes ' + limit + ' ms: no knee in the data');
  assert.strictEqual(first.rate_per_s, R.knee.rate_per_s, 'recomputed knee ' + first.rate_per_s + ' differs from the recorded ' + R.knee.rate_per_s);
  assert.ok(R.knee.rate_per_s > rates[0] && R.knee.rate_per_s < rates[rates.length - 1], 'the knee is inside the range, with a step beyond it');
});

it('p50 <= p95 <= p99 in every segment; p95 rises with load (never falls more than 3 ms step to step)', () => {
  segments().forEach((s) => assert.ok(s.p50_ms <= s.p95_ms && s.p95_ms <= s.p99_ms, JSON.stringify(s)));
  R.steps.forEach((s, i) => { if (i) assert.ok(s.p95_ms >= R.steps[i - 1].p95_ms - 3, 'p95 fell from ' + R.steps[i - 1].rate_per_s + '/s to ' + s.rate_per_s + '/s'); });
  const last = R.steps[R.steps.length - 1], at = R.steps.find((s) => s.rate_per_s === R.knee.rate_per_s);
  assert.ok(last.p95_ms > at.p95_ms, 'the step past the knee is slower than the knee');
});

it('0 x 5xx and 0 timeouts in every segment; no 429 below the knee', () => {
  segments().forEach((s) => assert.ok(s.x5xx === 0 && s.timeouts === 0, 'errors in ' + JSON.stringify(s)));
  R.steps.filter((s) => s.rate_per_s < R.knee.rate_per_s).forEach((s) => assert.strictEqual(s.x429, 0, 'a 429 below the knee at ' + s.rate_per_s + '/s'));
});

it('every step sent exactly rate x seconds; the hold ran at 80% of the knee', () => {
  R.steps.forEach((s) => assert.strictEqual(s.sent, s.rate_per_s * s.seconds, s.rate_per_s + '/s sent ' + s.sent));
  assert.strictEqual(R.hold_below_knee.rate_per_s, R.knee.rate_per_s * 0.8);
  assert.strictEqual(R.hold_below_knee.sent, R.hold_below_knee.rate_per_s * R.hold_below_knee.seconds);
  assert.strictEqual(R.soak.sent, R.soak.rate_per_s * R.soak.seconds);
});

it('the generator was never the limit: driver CPU stayed under 30% in every step', () => {
  R.steps.forEach((s) => assert.ok(s.driver_cpu_pct < 30, s.rate_per_s + '/s driver at ' + s.driver_cpu_pct + '%'));
});

it('every spike recovers: the p95 after is within 1.5x of the p95 before', () => {
  [30, 80].forEach((to) => {
    const before = R.spikes.find((s) => s.spike_to_per_s === to && s.phase === 'base-before'), after = R.spikes.find((s) => s.spike_to_per_s === to && s.phase === 'recover');
    assert.ok(before && after, 'spike ' + to + ' has before and after');
    assert.ok(after.p95_ms <= before.p95_ms * 1.5, 'spike ' + to + ' did not recover: ' + before.p95_ms + ' -> ' + after.p95_ms);
  });
});

it('the 184-route pass adds up, with 0 x 5xx, and the round-trip totals show the gap they name', () => {
  const L = R.load_routes, T = R.round_trips;
  assert.strictEqual(L.answered_200 + L.answered_403 + L.answered_400 + L.answered_401, L.routes_read);
  assert.ok(L.x5xx === 0 && L.timeouts === 0);
  assert.ok(T.live_total > T.budgeted_total && T.over_budget_routes > 0, 'live cost over the budget is the recorded finding');
  assert.ok(T.routes_with_header <= L.routes_read);
  assert.ok(fs.existsSync(path.join(API, T.budget_file)), T.budget_file + ' is in the repo');
});

it('not stale: the run is no older than max_age_days (re-run the SIT ramp and update docs/perf/sit-runs-2026-11.json)', () => {
  const today = new Date(process.env.CB_TODAY || Date.now());
  const age = Math.floor((today - new Date(R.run_date + 'T00:00:00Z')) / 86400000);
  assert.ok(age >= -1, 'the run is dated in the future: ' + R.run_date);
  assert.ok(age <= R.max_age_days, 'the SIT load record is ' + age + ' days old (limit ' + R.max_age_days + '): re-run toolset/sitload/ramp.cjs on SIT and refresh the record');
});

console.log('\n  ' + (n - failed) + ' passed, ' + failed + ' failed · ' + n + ' checks');
process.exit(failed ? 1 : 0);
