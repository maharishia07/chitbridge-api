'use strict';
/**
 * regression-harness.test.cjs — scripts/regression.js: the live criss-cross harness must never claim a pass it did not see. (MNT)
 *
 * The harness drives a LIVE api, so offline we prove only what needs no server:
 *   · pointed at an address nobody listens on it reports HARNESS ERROR and PASS 0 — never a count of passed checks
 *   · its non-party isolation checks accept a refusal (403 or 404) and nothing else, so a 200 for Gamma cannot read as a pass
 * Run: node tests/regression-harness.test.cjs · MIN unit-test
 */
const assert = require('assert'), fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'regression.js');

let pass = 0;
const it = (what, run) => { try { run(); pass++; console.log('  ok  ' + what); } catch (e) { process.exitCode = 1; console.log('  FAIL ' + what + '\n      ' + e.message); } };

it('no api reachable: HARNESS ERROR is said and no check counts as passed', () => {
  const run = spawnSync(process.execPath, [SCRIPT], { env: { PATH: process.env.PATH, CB_API: 'http://127.0.0.1:9' }, encoding: 'utf8', timeout: 30000 });
  const said = run.stdout + run.stderr;
  assert.ok(/HARNESS ERROR/.test(said), said.slice(0, 300));
  assert.ok(/PASS 0 /.test(said), said.slice(-200));
});
it('the Gamma (non-party) checks accept 403 or 404 only', () => {
  const lines = fs.readFileSync(SCRIPT, 'utf8').split('\n').filter((line) => /check\('Gamma[^']*CANNOT (open|set|post)/.test(line));
  assert.ok(lines.length >= 3, 'found ' + lines.length + ' Gamma refusal checks');
  for (const line of lines) assert.ok(/403/.test(line) && /404/.test(line) && !/200/.test(line), line.trim());
});
console.log('\n  ' + pass + ' passed · ' + pass + ' checks');
