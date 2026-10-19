/**
 * tests/readability-guard.test.cjs — THE §6 CODE-QUALITY GUARD ON THE API'S OWN CHANGE (READ-GUARD, 2026-10-15).
 *
 * OWNS      the api's run of the ONE readability tool (chitbridge-web tools/readability.cjs, acorn vendored there — no dependency here):
 *           only the functions and files this change touched are judged — a hard limit crossed, a NEW cryptic name, a new empty catch,
 *           a touched module with no header / no CARD line / no test row in trace.json, a file scoring worse than readability.ratchet.json.
 * CALLED BY scripts/guards.cjs (the offline gate, CI guards job — the web twin is checked out beside; locally C:/dev/chitbridge-web).
 * FLOW      find ../chitbridge-web/tools/readability.cjs ──▶ spawn `--changed --repo api --root <api> --base origin/main --ratchet --md`
 *           ──▶ print its report ──▶ FAIL on exit 1 · skip with a warning when the web tool is not beside (the web PR lands first)
 * CARD      qa/readability-guard
 *
 * The ratchet (readability.ratchet.json, per file, lower only): tighten it with
 *   node ../chitbridge-web/tools/readability.cjs --repo api --root . --write
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const API = path.join(__dirname, '..');
const WEB_TOOL = path.join(API, '..', 'chitbridge-web', 'tools', 'readability.cjs');
const BASE = process.env.CB_READABILITY_BASE || 'origin/main';
const TIMEOUT_MS = 180000;

let pass = 0, fail = 0;
const t = (name, ok, why) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  XX  ' + name + (why ? '\n        ' + why : '')); } };

console.log('\nreadability guard · only the api code THIS change touched (DISCIPLINES §6)');

/* the gate lists this file — a guard outside scripts/guards.cjs is a guard nobody runs */
const gate = fs.readFileSync(path.join(API, 'scripts/guards.cjs'), 'utf8');
t('scripts/guards.cjs lists readability-guard.test.cjs', /'readability-guard\.test\.cjs'/.test(gate));

/**
 * ONE-TIME WAIVER (Athi, 19 Oct 2026): the iteration-1 mechanical pass reformats every file, so every legacy function "got worse" and the OWNS / CARD
 * headers are owed (iteration 2). The judgement is skipped ONLY when the PR head branch is exactly iter1/mechanical AND the commit
 * "chore(iter1): mechanical pass (MNT-4)" is on it. It expires on landing (the branch is gone; later PRs are judged against the re-baselined
 * readability.ratchet.json). No limit or rule changes for any other branch.
 */
const PASS_SUBJECT = 'chore(iter1): mechanical pass (MNT-4)';
const subjects = spawnSync('git', ['-C', API, 'log', BASE + '..HEAD', '--format=%s'], { encoding: 'utf8' }).stdout || '';
const waived = process.env.GITHUB_HEAD_REF === 'iter1/mechanical' && subjects.split(/\r?\n/).includes(PASS_SUBJECT);

if (waived) {
  console.log('  waived  the iter1 mechanical pass (head branch iter1/mechanical + "' + PASS_SUBJECT + '"): one-time, expires on landing — see the PR section 6');
} else if (!fs.existsSync(WEB_TOOL)) {
  console.log('  skip  the web tool is not beside this checkout (' + path.relative(API, WEB_TOOL) + ') — the twin chitbridge-web branch or main must carry READ-GUARD');
  console.log('::warning::readability guard skipped — ../chitbridge-web/tools/readability.cjs not found (the web PR lands first)');
} else {
  const run = spawnSync(process.execPath, [WEB_TOOL, '--changed', '--repo', 'api', '--root', API, '--base', BASE, '--ratchet', '--md'], { encoding: 'utf8', maxBuffer: 64 << 20, timeout: TIMEOUT_MS });
  const out = (run.stdout || '') + (run.stderr || '');
  console.log(out.split('\n').map((line) => '        ' + line).join('\n'));
  t('the change judged (exit ' + run.status + ')', run.status === 0, run.status === 2 ? 'the tool could not run — is origin/main fetched? (CI: fetch-depth 0)' : 'see the lines above: fix the named function/file, or tighten only what you touched');
  t('a judgement was printed (not an empty run)', /readability --changed · api/.test(out));
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
console.log('  ' + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
