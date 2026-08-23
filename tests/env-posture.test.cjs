'use strict';
/**
 * env-posture.test.cjs — NOBODY COMPARES NODE_ENV BY HAND.
 *
 * ⚠️⚠️ THE LIVE API REPORTS `"environment":" development"` — WITH A LEADING SPACE. That is not a typo in a log
 * line; it is the value the process is actually running with, and it silently defeats every
 * `NODE_ENV === 'production'` comparison in the codebase. `lib/dev-otp.js` discovered this, wrote it down in
 * its own header, and fixed itself by trimming. **The fix never reached the other two places**, which is the
 * whole reason this file exists: a lesson learned in one file is not learned by the codebase.
 *
 * What it was still costing on 2026-08-23:
 *   · `server.js` aborted boot on a weak JWT_SECRET only when NODE_ENV was EXACTLY 'production' — so the guard
 *     protecting the secret that auth integrity depends on would have gone quiet under " production".
 *   · `routes/catalogue.js` gated an UNAUTHENTICATED order-creating route on an untrimmed comparison, with
 *     `DEV_OTP` accepted as sufficient on its own — a login convenience acting as a key to a different door.
 *
 * ⭐ So there is ONE definition of a sealed environment (`lib/dev-otp.js: isSealed()`), it trims and lowercases,
 * and everything asks it. This test fails if any file re-implements the comparison instead.
 *
 * ⚠️ It deliberately does NOT assert what NODE_ENV should be — that is a deployment setting, not a code fact,
 * and a test that fails on a developer's laptop for having a laptop's environment gets deleted.
 */
const fs = require('fs');
const path = require('path');

const API = path.join(__dirname, '..');
const DIRS = ['', 'routes', 'lib', 'middleware', 'db'];
/** dev-otp.js IS the definition; tests may set NODE_ENV to exercise it. */
const ALLOWED = new Set(['lib/dev-otp.js']);

let pass = 0;
const fails = [];
const files = [];
for (const d of DIRS) {
  const abs = path.join(API, d);
  if (!fs.existsSync(abs)) continue;
  for (const f of fs.readdirSync(abs)) {
    if (!f.endsWith('.js')) continue;
    const rel = d ? d + '/' + f : f;
    if (fs.statSync(path.join(abs, f)).isFile()) files.push(rel);
  }
}

console.log('\n── one definition of a sealed environment ──');

for (const rel of files) {
  if (ALLOWED.has(rel)) continue;
  const src = fs.readFileSync(path.join(API, rel), 'utf8');
  const lines = src.split(/\r?\n/);
  lines.forEach((ln0, i) => {
    let ln = ln0;
    /* ⚠️ Strip a TRAILING comment too, not just a leading one. `routes/actors.js:5` is the line
       `const devOtp = require('../lib/dev-otp');   // NEVER gate OTP exposure on process.env.DEV_OTP directly`
       — a warning against the very thing this test looks for, reported as an instance of it. A guard that
       flags its own documentation teaches people to ignore the guard. */
    ln = ln.replace(/\/\/.*$/, '');
    if (/^\s*(\/\/|\*)/.test(ln) || !ln.trim()) return;                       // a comment about the bug is not the bug
    /* A comparison of NODE_ENV against a literal, without .trim() on the same line. */
    if (/process\.env\.NODE_ENV\s*(===?|!==?)\s*['"]/.test(ln) && !/\.trim\(\)/.test(ln)) {
      fails.push(`${rel}:${i + 1} compares NODE_ENV to a literal without trimming — use require('./lib/dev-otp').isSealed()`);
    }
  });
  pass++;
}

/**
 * ⚠️ And the second half of the catalogue defect: DEV_OTP is an OTP flag. It may decide whether a fixed CODE is
 * issued, and nothing else. Any other route gating itself on DEV_OTP is treating a test convenience as an
 * environment switch.
 */
for (const rel of files) {
  if (ALLOWED.has(rel) || !rel.startsWith('routes/')) continue;
  const src = fs.readFileSync(path.join(API, rel), 'utf8');
  src.split(/\r?\n/).forEach((ln, i) => {
    /* ⚠️ Strip a TRAILING comment too, not just a leading one. `routes/actors.js:5` is the line
       `const devOtp = require('../lib/dev-otp');   // NEVER gate OTP exposure on process.env.DEV_OTP directly`
       — a warning against the very thing this test looks for, reported as an instance of it. A guard that
       flags its own documentation teaches people to ignore the guard. */
    ln = ln.replace(/\/\/.*$/, '');
    if (/^\s*(\/\/|\*)/.test(ln) || !ln.trim()) return;
    if (/process\.env\.DEV_OTP/.test(ln)) {
      fails.push(`${rel}:${i + 1} a ROUTE reads DEV_OTP — that flag governs OTP codes, never access`);
    }
  });
}

console.log(`  scanned ${pass} file(s) across ${DIRS.filter(Boolean).join(', ')} and the root`);
fails.forEach((f) => console.error('  x ' + f));
if (!fails.length) console.log('  OK — every environment decision goes through isSealed()\n');
else console.error(`\n  ${fails.length} problem(s). The live API runs with NODE_ENV=" development" (leading space),\n  so an untrimmed comparison is not hypothetical here.\n`);

process.exit(fails.length ? 1 : 0);
