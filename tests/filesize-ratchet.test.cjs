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

/* ⭐ BY-DESIGN WAIVERS (zeroreds 26 Nov, Athi): the baseline resets only at the batch stamp (land script), so branch growth is red until it. Each entry names the file, the
   size it may reach, why, and when it goes: after the stamp the baseline holds the size and the entry is deleted. Growth past max is red again. */
const STAMP_WAIVERS = [
  { file: 'lib/bank-rec-log.js', max: 549, added: '2026-11-26', until: 'batch 1130 stamp', reason: 'rw1fin/w4 bank-rec log growth in the 1130 batch' },
  { file: 'lib/books-cashflow.js', max: 530, added: '2026-11-26', until: 'batch 1130 stamp', reason: 'rw2acc growth in the 1130 batch' },
  { file: 'lib/books-period.js', max: 1871, added: '2026-11-26', until: 'batch 1130 stamp', reason: 'rw2acc growth in the 1130 batch' },
  { file: 'lib/books-store.js', max: 2158, added: '2026-11-26', until: 'batch 1130 stamp', reason: 'rw2acc growth in the 1130 batch' },
  { file: 'tests/api-problem-books.test.cjs', max: 774, added: '2026-11-28', until: 'batch 1138 stamp', reason: 'ACC-418: the four sweep scenes of the recovery door POST /write-off/recover (its error_tests and legacy rows are written by this area test)' },
  { file: 'lib/identity-auth.js', max: 746, added: '2026-11-26', until: 'batch 1130 stamp', reason: 'security growth in the 1130 batch' },
];
let pass = 0, fail = 0;
const t = (name, ok, why) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  XX  ' + name + (why ? '\n        ' + why : '')); } };

console.log('\nfile-size ratchet · no file grows, a new file is at most 500 lines (MNT-58)');

const gate = require('./support/guards-list-text.cjs').guardsListText();
t('scripts/guards-list.cjs lists filesize-ratchet.test.cjs', /'filesize-ratchet\.test\.cjs'/.test(gate));
t('filesize.baseline.json is committed', fs.existsSync(path.join(API, 'filesize.baseline.json')));

if (!fs.existsSync(WEB_TOOL) && process.env.CI) {
  t('the web tool is beside this checkout (CI: a missing tool is a FAIL, never a skip)', false, path.relative(API, WEB_TOOL) + ' not found: the twin chitbridge-web checkout must carry MNT-58');
} else if (!fs.existsSync(WEB_TOOL)) {
  console.log('  skip  the web tool is not beside this checkout (' + path.relative(API, WEB_TOOL) + ') — locally only; CI fails on this');
} else {
  const run = spawnSync(process.execPath, [WEB_TOOL, '--root', API, '--against', process.env.CB_READABILITY_BASE || 'origin/main'], { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 120000 });
  const out = (run.stdout || '') + (run.stderr || '');
  console.log(out.split('\n').map((line) => '        ' + line).join('\n'));
  /* the red lines that are NOT a waived growth; a waiver covers only "FAIL grew: <file> a -> b" with b <= max (growth beyond it is red again) */
  const red = out.split('\n').filter((l) => /^\s*FAIL /.test(l)).filter((l) => {
    const m = /FAIL grew: (\S+) \d+ -> (\d+)/.exec(l);
    const w = m && STAMP_WAIVERS.find((x) => x.file === m[1]);
    if (w && Number(m[2]) <= w.max) { console.log('        WAIVED (' + w.added + ', until ' + w.until + '): ' + m[1] + ' ' + m[2] + ' <= ' + w.max + ' · ' + w.reason); return false; }
    return true;
  });
  t('no file grew and no new file is over 500 lines (exit ' + run.status + (run.status && !red.length ? ', every red waived below' : '') + ')', red.length === 0 && (run.status === 0 || run.status === 1), red.join(' | ') || 'see the FAIL lines above');
  t('a judgement was printed (not an empty run)', /filesize ratchet:/.test(out));
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
console.log('  ' + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
