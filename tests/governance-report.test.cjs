/**
 * tests/governance-report.test.cjs — E04: the nightly governance report is red for exactly the reasons it says.
 * ⭐ Invariant: it NEVER passes while main is unprotected (or protection unknown), or while /health does not say production.
 * Offline: planted facts through scripts/governance-report.cjs, and its JUnit read back by the board's own reader.
 * Run: node tests/governance-report.test.cjs
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const G = require('../scripts/governance-report.cjs');
const J = require('../lib/junitresults');

let n = 0;
const it = (what, fn) => { try { fn(); n++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };
const GREEN = { protect_api: 'protected', protect_web: 'protected', enforce_api: 'true', enforce_web: 'true',
  alerts: '0', ci_main: 'success', health_env: 'production' };
const plant = (o) => Object.assign({}, GREEN, o);
const red = (f) => G.evaluate(f).red.map((l) => l.text).join(' | ');

it('everything true -> green', () => assert.strictEqual(G.evaluate(GREEN).red.length, 0));
it('main unprotected on the API -> red, says which repo', () => {
  const r = red(plant({ protect_api: 'unprotected' })); assert.ok(/NOT protected on chitbridge-api/.test(r), r); });
it('main unprotected on web -> red', () => assert.ok(/NOT protected on chitbridge-web/.test(red(plant({ protect_web: 'unprotected' })))));
it('protection unknown is RED, never a pass', () => {
  const r = red(plant({ protect_api: 'unknown' })); assert.ok(/protection: unknown on chitbridge-api/.test(r), r); });
it('a missing protection fact is red too', () => { const f = plant({}); delete f.protect_web; assert.ok(/protection: unknown/.test(red(f))); });
it('admins can skip the rules -> red', () => assert.ok(/admins can skip/.test(red(plant({ enforce_web: 'false' })))));
it('/health "development" -> red', () => assert.ok(/not "production"/.test(red(plant({ health_env: 'development' })))));
it('/health " development" (leading space, H1) -> red, and the space is shown', () => {
  const r = red(plant({ health_env: ' development' })); assert.ok(r.indexOf('" development"') >= 0, r); });
it('/health " production" (stray space) is not a pass', () => assert.ok(red(plant({ health_env: ' production' }))));
it('/health unreachable -> red', () => assert.ok(/could not be reached/.test(red(plant({ health_env: 'unreachable' })))));
it('open alerts -> red with the count; unknown alerts -> red', () => {
  assert.ok(/3 open Dependabot or audit alerts/.test(red(plant({ alerts: '3' }))));
  assert.ok(/open alerts: unknown/.test(red(plant({ alerts: 'unknown' })))); });
it('CI red or unknown on main -> red', () => {
  assert.ok(/did not pass \(failure\)/.test(red(plant({ ci_main: 'failure' }))));
  assert.ok(/CI status of main: unknown/.test(red(plant({ ci_main: '' })))); });
it('INVARIANT: no combination with main unprotected or non-production health is green', () => {
  ['protected', 'unprotected', 'unknown', undefined].forEach((p) => ['production', ' development', 'development', 'staging', undefined].forEach((h) => {
    const f = plant({ protect_api: p, health_env: h });
    if (p !== 'protected' || h !== 'production') assert.ok(G.evaluate(f).red.length > 0, p + ' / ' + h);
  })); });
it('JUnit: one testcase named governance.nightly; red carries every failing line; green passes', () => {
  const bad = J.read(G.junit(G.evaluate(plant({ protect_api: 'unprotected', health_env: ' development' }))), { keyFrom: 'name' });
  const rows = bad.results || bad;
  assert.strictEqual(rows.length, 1); assert.strictEqual(rows[0].case_key, 'governance.nightly');
  assert.strictEqual(rows[0].status, 'fail');
  assert.ok(/NOT protected/.test(rows[0].note) && /development/.test(rows[0].note), rows[0].note);
  const ok = J.read(G.junit(G.evaluate(GREEN)), { keyFrom: 'name' });
  const okRows = ok.results || ok;
  assert.strictEqual(okRows.length, 1); assert.strictEqual(okRows[0].status, 'pass'); });
it('the board lists the case governance.nightly (data/test-cases.json)', () => {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'test-cases.json'), 'utf8'));
  assert.ok(d.cases.some((c) => c.case_key === 'governance.nightly')); });

console.log('\n' + n + ' checks');
