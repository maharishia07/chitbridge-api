'use strict';
/**
 * tests/engines-pinned.test.js — every engine a platform ADOPTS is exactly the chitbridge-engines release it pins.
 *
 * Athi, 2026-09-27: "we need to have one code base only, so no drifting possible ever for the engine." The copies in
 * this repo and in chitbridge-web are written only by chitbridge-engines/tools/adopt.cjs, from a git TAG; its --check
 * fails on a hand edit, an untagged source, or a file whose version disagrees with engines.lock.json. [[SPEC-one-engine]]
 *
 * ⚠️ The engines repo must sit beside this one (C:\\dev\\chitbridge-engines). If it is missing this FAILS — a check that
 * quietly skips is how drift would come back. [[feedback-silence-is-the-bug]]
 */
const path = require('path'), fs = require('fs'), { spawnSync } = require('child_process');
const DEV = path.join(__dirname, '..', '..');
const ADOPT = path.join(DEV, 'chitbridge-engines', 'tools', 'adopt.cjs');
let bad = 0, pass = 0;
if (!fs.existsSync(ADOPT)) { console.log('  FAIL chitbridge-engines is not checked out beside this repo — clone maharishia07/chitbridge-engines into ' + path.dirname(path.dirname(ADOPT))); process.exit(1); }
for (const repo of ['chitbridge-api', 'chitbridge-web']) {
  const r = spawnSync(process.execPath, [ADOPT, path.join(DEV, repo), '--check'], { encoding: 'utf8' });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  if (r.status === 0) pass++, console.log('  ok  ' + repo + ': ' + out);
  else { bad++; console.log('  FAIL ' + repo + ':\n' + out); }
}
/* ⭐ and nothing else may still WRITE an adopted file — the old wrapper writing money.js was the second master */
const vt = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'vendor-till.cjs'), 'utf8');
if (/wrapForBrowser\('money\.js'/.test(vt)) { bad++; console.log('  FAIL scripts/vendor-till.cjs still writes money.js — a second writer of an adopted engine'); }
else pass++, console.log('  ok  no script but adopt.cjs writes money.js');
/* tax (2026-09-28): vendor-tax.cjs and mirror-pure-libs.cjs were its writers; they must stay gone, and vendor-till must not copy it */
const back = ['vendor-tax.cjs', 'mirror-pure-libs.cjs'].filter((f) => fs.existsSync(path.join(__dirname, '..', 'scripts', f)));
if (back.length || /tax-engine\.js'\)|'engine', 'tax\.js'\)/.test(vt)) { bad++; console.log('  FAIL a second writer of tax is back: ' + (back.join(', ') || 'vendor-till.cjs')); }
else pass++, console.log('  ok  no script but adopt.cjs writes tax or tax-slab');
/* pricing (v1.3.0): vendor-till copied app/pricing.js to engine/ and wrote lib/pricing.browser.js — both writers must stay gone */
if (/'app', 'pricing\.js'/.test(vt) || fs.existsSync(path.join(__dirname, '..', 'lib', 'pricing.browser.js'))) { bad++; console.log('  FAIL a second writer of pricing is back (vendor-till.cjs or lib/pricing.browser.js)'); }
else pass++, console.log('  ok  no script but adopt.cjs writes pricing');
console.log(pass + ' checks');
process.exit(bad ? 1 : 0);
