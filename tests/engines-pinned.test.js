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
console.log(pass + ' checks');
process.exit(bad ? 1 : 0);
