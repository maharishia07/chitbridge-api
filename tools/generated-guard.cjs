#!/usr/bin/env node
'use strict';
/*
 * OWNS      "a feature PR does not carry what a tool derives from the code" (Athi, 11 Nov: stop the generated-file clashes between api PRs). On a feature branch
 *           (CB_GENERATED=regen) the change may not touch the derived register files, the derived contract result files, or any derived key of docs/api-ratchet.json.
 *           CI regenerates them in the runner and the batch build (batch/*) regenerates them once; the strict checks on batch/* and main compare them to the code.
 * CALLED BY CI job api-standard (regen mode only) · by hand before pushing: node tools/generated-guard.cjs --base origin/main
 * FLOW      git diff --name-only <base>...HEAD (the merge-base, so a merge of main adds nothing) ──▶ any DERIVED file touched? ──▶ docs/api-ratchet.json: base vs head,
 *           only the hand keys (HAND_RATCHET_KEYS) may differ ──▶ exit 1 with the one command that puts it right
 * CARD      28-platform-and-operations/api-standard
 *
 * Allow-list, not deny-list: in docs/api-ratchet.json only `debt`, `stage` and `version` are hand facts (api-ratchet.cjs reads them from HEAD); every other key, `updated`
 * included, is written by `api-ratchet.cjs --write`, so a key added later is derived by default. NOT here: docs/api-signoffs.json (a reviewed hand record, laid out one entry
 * per line by tools/hand-file-fix.cjs) and readability.ratchet.json (a PR that adds a file scoring above 0 legitimately adds its row; the web tool only ever lowers a row).
 */
const { spawnSync } = require('child_process');

/** files a tool writes from the code: a feature PR leaves them as they are on its merge-base */
const DERIVED_FILES = [
  'docs/api-register.json',
  'docs/API-REGISTER.md',
  'docs/contracts/api-contract-results.json',
  'docs/contracts/api-hardening-results.json',
  'docs/contracts/api-hardening-evidence.json',
];
/** the keys of docs/api-ratchet.json a person writes; everything else is derived */
const HAND_RATCHET_KEYS = ['debt', 'stage', 'version'];

/** the derived keys whose value differs between two ratchet objects (a key in only one of them counts) */
function derivedRatchetChanges(base, head) {
  const keys = new Set([...Object.keys(base || {}), ...Object.keys(head || {})]);
  return [...keys].filter((key) => !HAND_RATCHET_KEYS.includes(key) && JSON.stringify((base || {})[key]) !== JSON.stringify((head || {})[key])).sort();
}

/** every problem in one change: { files: names touched, base, head: the two ratchet objects (or null) } -> [text] */
function problemsOf({ files, base, head }) {
  const problems = [];
  const touched = DERIVED_FILES.filter((name) => files.includes(name));
  if (touched.length) problems.push('derived files in this PR: ' + touched.join(', ') + '. CI regenerates them and the batch build commits them once. Put them back: git checkout $(git merge-base origin/main HEAD) -- ' + touched.join(' '));
  if (files.includes('docs/api-ratchet.json')) {
    const keys = derivedRatchetChanges(base, head);
    if (keys.length) problems.push('docs/api-ratchet.json: derived key(s) changed in this PR: ' + keys.join(', ') + ' (only ' + HAND_RATCHET_KEYS.join(', ') + ' are hand facts; the counts are written in the batch). Put the file back, then re-apply only your debt/stage edit.');
  }
  return problems;
}

/** run git, return stdout, or null when it fails */
const runGit = (args) => { const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 << 20 }); return result.status === 0 ? result.stdout : null; };
/** a json file as of a git ref, or null */
const jsonAt = (ref, file) => { const text = runGit(['show', ref + ':' + file]); return text ? JSON.parse(text) : null; };

/** the command line: --base <ref>; exit code 0 = no derived file carried */
function main(argv) {
  const baseRef = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : 'origin/main';
  if (process.env.CB_GENERATED && process.env.CB_GENERATED !== 'regen') { console.log('generated-guard: CB_GENERATED=' + process.env.CB_GENERATED + ' (batch/* or main): the strict checks compare the derived files to the code; nothing to guard here'); return 0; }
  const names = runGit(['diff', '--name-only', baseRef + '...HEAD']);
  if (names === null) { console.log('generated-guard: cannot diff ' + baseRef + '...HEAD (fetch the base with full history)'); return 1; }
  const files = names.split('\n').filter(Boolean);
  const mergeBase = (runGit(['merge-base', baseRef, 'HEAD']) || '').trim();
  const problems = problemsOf({ files, base: mergeBase ? jsonAt(mergeBase, 'docs/api-ratchet.json') : null, head: jsonAt('HEAD', 'docs/api-ratchet.json') });
  if (problems.length) { console.log('generated-guard: FAIL\n  ' + problems.join('\n  ')); return 1; }
  console.log('generated-guard: ok, ' + files.length + ' changed file(s), none of them derived');
  return 0;
}

module.exports = { DERIVED_FILES, HAND_RATCHET_KEYS, derivedRatchetChanges, problemsOf };
if (require.main === module) process.exit(main(process.argv.slice(2)));
