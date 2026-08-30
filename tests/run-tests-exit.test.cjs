/**
 * tests/run-tests-exit.test.cjs — the harness must not call an empty run a pass.
 *
 * ⚠️⚠️ WHAT THIS EXISTS FOR. `npm test` printed "OK ALL TESTS PASSED - MVP CONCEPT PROVEN"
 * after running ZERO assertions, and exited 0. With no server on :3000 the first fetch throws
 * before testHealth() can even call fail(), so nothing lands in state.results; main() caught the
 * error, printed one line, and fell through to a summary whose only condition was `failed === 0`.
 *
 * ⚠️ THE EXIT CODE WAS THE WORSE HALF. main() set none, so the shell saw 0 regardless. A CI job
 * wired to this would have gone green through a total outage of the API — and nobody reads a
 * passing build.
 *
 * ⭐ Four states, one rule: a run is a pass only when assertions RAN, none FAILED, and nothing
 * ABORTED. Red-proofed — drop any of the three conditions from `ok` and a case below fails.
 */
const path = require('path');
const H = require(path.join(__dirname, 'run-tests.js'));   // must NOT start the suite

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.error('  ✗ ' + name + (extra ? '   ' + extra : '')); }
};

/* printResults writes to stdout; quiet it so the four verdicts read cleanly. */
function verdict(results, aborted) {
  H.state.results = results;
  const real = console.log;
  console.log = () => {};
  try { return H.printResults(aborted); } finally { console.log = real; }
}
const P = (n) => Array.from({ length: n }, (_, i) => ({ test: 't' + i, passed: true }));
const F = (n) => Array.from({ length: n }, (_, i) => ({ test: 'f' + i, passed: false }));

console.log('\n-- requiring the harness must not run it --');
t('module loads without starting the suite', typeof H.printResults === 'function');
t('and exposes the state it counts', !!H.state && Array.isArray(H.state.results));

console.log('\n-- ⭐⭐ the empty run, which is the bug --');
t('zero assertions is NOT a pass', verdict([], null) === false);
t('zero assertions with an abort is NOT a pass', verdict([], 'fetch failed') === false);

console.log('\n-- the other three states --');
t('some passed, none failed, no abort -> pass', verdict(P(12), null) === true);
t('one failure among many -> not a pass', verdict(P(11).concat(F(1)), null) === false);
/* ⚠️ A PARTIAL RUN IS NOT A PASS. Nine green assertions then a crash is not nine-tenths of a
   proof — everything after the crash was never checked, and that is most of the suite. */
t('assertions passed but the run aborted -> not a pass', verdict(P(9), 'ECONNREFUSED') === false);

console.log('\n-- the runner sets an exit code at all --');
const src = require('fs').readFileSync(path.join(__dirname, 'run-tests.js'), 'utf8');
/* ⚠️⚠️ STRIP THE COMMENTS FIRST. The no-process.exit() check matched the sentence in the
   runner EXPLAINING why process.exit() is not used — a source-text assertion that reads prose as
   code. Same trap pack-parity.test.cjs already records: a verification that shares an assumption
   with the thing it verifies is not a verification. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
t('process.exitCode is set from the verdict', /process\.exitCode = printResults\(aborted\) \? 0 : 1;/.test(code));
/* ⚠️ process.exit() would truncate unflushed stdout on a failing run — the output someone needs. */
t('and it does NOT use process.exit()', !/process\.exit\(/.test(code));
t('main() only runs when executed directly', /require\.main === module/.test(src));

console.log('\n  == ' + pass + ' passed - ' + fail + ' failed ==\n');
process.exitCode = fail ? 1 : 0;
