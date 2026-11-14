/**
 * tests/filesize-ratchet.test.cjs — THE FILE-SIZE RATCHET ON THE API (MNT-58, 2026-11-14).
 *
 * OWNS      the api's run of the ONE file-size tool (chitbridge-web tools/readability/filesize.cjs; no second scanner, no copy): no file grows
 *           past filesize.baseline.json, a new file is at most 500 lines. The 1,000-line ceiling is the customer-facing list (--ceiling), reached by MNT-59.
 * CALLED BY scripts/guards.cjs (the offline gate, CI guards job — the web twin is checked out beside; locally C:/dev/chitbridge-web).
 * FLOW      find ../chitbridge-web/tools/readability/filesize.cjs ──▶ spawn it with --root <api> ──▶ print its report ──▶ FAIL on exit 1
 *           · a missing web tool FAILS when env CI is set; it only skips (locally) with a note
 * CARD      qa/readability-guard
 *
 * Judged where made: lib/ files whose line 1 is the ADOPTED header are engines copies (master chitbridge-engines); the baseline is reset only at a batch stamp:
 *   node ../chitbridge-web/tools/readability/filesize.cjs --root . --rebaseline
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const API = path.join(__dirname, '..');
const WEB_TOOL = path.join(process.env.CB_WEB_DIR || path.join(API, '..', 'chitbridge-web'), 'tools', 'readability', 'filesize.cjs');

let pass = 0, fail = 0;
const t = (name, ok, why) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  XX  ' + name + (why ? '\n        ' + why : '')); } };

console.log('\nfile-size ratchet · no file grows, a new file is at most 500 lines (MNT-58)');

const gate = fs.readFileSync(path.join(API, 'scripts/guards.cjs'), 'utf8');
t('scripts/guards.cjs lists filesize-ratchet.test.cjs', /'filesize-ratchet\.test\.cjs'/.test(gate));
t('filesize.baseline.json is committed', fs.existsSync(path.join(API, 'filesize.baseline.json')));

if (!fs.existsSync(WEB_TOOL) && process.env.CI) {
  t('the web tool is beside this checkout (CI: a missing tool is a FAIL, never a skip)', false, path.relative(API, WEB_TOOL) + ' not found: the twin chitbridge-web checkout must carry MNT-58');
} else if (!fs.existsSync(WEB_TOOL)) {
  console.log('  skip  the web tool is not beside this checkout (' + path.relative(API, WEB_TOOL) + ') — locally only; CI fails on this');
} else {
  const run = spawnSync(process.execPath, [WEB_TOOL, '--root', API, '--against', process.env.CB_READABILITY_BASE || 'origin/main'], { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 120000 });
  const out = (run.stdout || '') + (run.stderr || '');
  console.log(out.split('\n').map((line) => '        ' + line).join('\n'));
  t('no file grew and no new file is over 500 lines (exit ' + run.status + ')', run.status === 0, 'see the FAIL lines above: split the file, or shrink it back to its baseline');
  t('a judgement was printed (not an empty run)', /filesize ratchet:/.test(out));
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
console.log('  ' + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
