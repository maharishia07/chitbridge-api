/**
 * tests/filesize-ratchet.test.cjs — THE FILE-SIZE RATCHET ON THE API (MNT-58, 2026-11-14).
 *
 * OWNS      the api's run of the ONE file-size tool (chitbridge-web tools/readability/filesize.cjs; no second scanner, no copy): no file grows
 *           past filesize.baseline.json, a new file is at most 500 lines. The 1,000-line ceiling is the customer-facing list (--ceiling), reached by MNT-59.
 * CALLED BY scripts/guards.cjs (the offline gate, CI guards job — the web twin is checked out beside; locally C:/dev/chitbridge-web).
 * FLOW      find ../chitbridge-web/tools/readability/filesize.cjs ──▶ spawn it with --root <api> ──▶ print its report ──▶ FAIL on exit 1
 *           · skip with a warning when the web tool is not beside (the web PR lands first)
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

if (!fs.existsSync(WEB_TOOL)) {
  console.log('  skip  the web tool is not beside this checkout (' + path.relative(API, WEB_TOOL) + ') — the twin chitbridge-web branch or main must carry MNT-58');
  console.log('::warning::file-size ratchet skipped — ../chitbridge-web/tools/readability/filesize.cjs not found (the web PR lands first)');
} else {
  const run = spawnSync(process.execPath, [WEB_TOOL, '--root', API], { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 120000 });
  const out = (run.stdout || '') + (run.stderr || '');
  console.log(out.split('\n').map((line) => '        ' + line).join('\n'));
  t('no file grew and no new file is over 500 lines (exit ' + run.status + ')', run.status === 0, 'see the FAIL lines above: split the file, or shrink it back to its baseline');
  t('a judgement was printed (not an empty run)', /filesize ratchet:/.test(out));
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
console.log('  ' + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
