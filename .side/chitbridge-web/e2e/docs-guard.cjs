/**
 * e2e/docs-guard.cjs — the documents people ACT on must match the code.
 *
 * ⚠️⚠️ NOT ALL DOCUMENTS, AND THAT RESTRAINT IS THE DESIGN. `tools/docs-inventory.cjs` ranks all 240 for a
 * human to triage; this fails a BUILD, so it covers only the few whose wrongness has already cost something:
 * the module map beside the source, and the generated-vs-actual check for it.
 *
 * ⭐ A guard that fails on 240 documents is a guard someone disables. One that fails on the map next to the
 * code, when the code moved, is one they fix.
 */
const { execSync } = require('child_process');
const path = require('path');

let fail = 0;
console.log('');

/* ── the module map must match the directory ────────────────────────────────────────────────────────────── */
try {
  execSync('node ' + JSON.stringify(path.join(__dirname, '..', 'tools', 'gen-modules-doc.cjs')) + ' --check',
    { stdio: 'pipe' });
  console.log('  \u2713 public/app/MODULES.md matches the directory');
} catch (e) {
  fail++;
  console.error('  \u2717 public/app/MODULES.md has drifted from public/app/');
  console.error('    The document beside the code described a `panel-*.js` split that was never built, for');
  console.error('    weeks, saying "in progress". Regenerate: node tools/gen-modules-doc.cjs');
}

/* ── CL3: "Where ChitBridge is for <country>" is generated from the engines' matrix × COUNTRY-COVERAGE §1 — never typed, never stale ── */
try {
  const out = execSync('node ' + JSON.stringify(path.join(__dirname, '..', 'scripts', 'country-ready.cjs')) + ' --check', { stdio: 'pipe' }).toString().trim();
  console.log('  \u2713 public/data/country-ready.json — ' + out.replace(/^country-ready: /, ''));
} catch (e) {
  fail++;
  console.error('  \u2717 public/data/country-ready.json has drifted: ' + String((e.stdout || '') + (e.stderr || '')).trim());
  console.error('    Re-vendor the matrix (engines: node tools/country-matrix.cjs --web <web>), then: node scripts/country-ready.cjs');
}

console.log('\n  \u2550\u2550 ' + (fail ? 'DOCUMENT DRIFT' : 'the load-bearing documents match the code') + ' \u2550\u2550\n');
process.exit(fail ? 1 : 0);
