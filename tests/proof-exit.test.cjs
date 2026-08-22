'use strict';
/**
 * proof-exit.test.cjs — A PROOF THAT REPORTS ITS OWN FAILURE MUST NOT TELL THE SHELL IT PASSED.
 *
 * Found 2026-08-22 while building the requirements traceability tool, by reading what the proofs actually
 * assert rather than trusting their names.
 *
 * ⚠️⚠️ NINETEEN OF THEM COUNTED FAILURES, PRINTED `FAIL n`, AND THEN CALLED `process.exit(0)` ANYWAY — and
 * several did it in the `.catch` too, so a proof that crashed before testing anything also reported success.
 * The output was honest and the EXIT CODE lied, which is the worse half: a human reads the output, but every
 * other thing that will ever run these — a shell `&&`, a CI step, a batch runner, a future regression sweep —
 * reads only the code. It is the difference between "this was never checked" and "this was checked and passed",
 * and the second is a claim nobody made on purpose.
 *
 * ⭐ Why this is a guard and not a note: the shape is copied. Every new proof starts as a copy of the last one,
 * so a defect in the template is a defect in everything written after it. That is exactly the case where a
 * 40-millisecond grep earns its keep for years.
 */
const fs = require('fs');
const path = require('path');

const S = path.join(__dirname, '..', 'scripts');
let pass = 0;
const fails = [];

const files = fs.readdirSync(S).filter((f) => /^(prove-|dispute-|penetration)/.test(f) && f.endsWith('.js'));

for (const f of files) {
  const src = fs.readFileSync(path.join(S, f), 'utf8');

  /* Only files that actually keep score can lie about it. A pure demo has nothing to contradict. */
  const counts = /\b(FAIL|F)\s*(\+\+|\+=)/.test(src) || /\bFAIL\b.*\+/.test(src);
  if (!counts) continue;

  const exitsZero = /process\.exit\(\s*0\s*\)/.test(src);
  const exitsOnFailure = /process\.exit\(\s*(F|FAIL|fail|failed)\s*(\?|>)/.test(src) || /process\.exitCode/.test(src);

  if (exitsZero && !exitsOnFailure) {
    fails.push(`${f} counts failures and calls process.exit(0) — the shell will read success`);
  } else {
    pass++;
  }
}

/**
 * ⚠️ AND THE CATCH IS THE HALF THAT WAS MISSED FIRST. `.catch(e => { console.error(...); process.exit(0) })`
 * turns a harness crash into a green run — the state in which the LEAST was verified reports the same as the
 * state in which everything was.
 */
for (const f of files) {
  const src = fs.readFileSync(path.join(S, f), 'utf8');
  if (/\.catch\([^)]*=>\s*\{[^}]*process\.exit\(\s*0\s*\)/.test(src)) {
    fails.push(`${f} exits 0 from its .catch — a crashed proof would report success`);
  }
}

console.log('\n── a proof cannot report success while counting failures ──');
console.log(`  scanned ${files.length} script(s); ${pass} keep score and exit on it`);
fails.forEach((m) => console.error('  x ' + m));
if (!fails.length) console.log('  OK — no proof contradicts its own exit code\n');
else console.error(`\n  ${fails.length} problem(s). Use process.exit(F ? 1 : 0), and exit(1) from the catch.\n`);

process.exit(fails.length ? 1 : 0);
