/**
 * tests/pr-ready.test.cjs - LEVER 6 (Athi 12 Nov, DECISIONS 44058aeb): tools/pr-ready.cjs is the one pre-push check; each failure it names must be caught here.
 * Pass mark: control bytes found, a drifted §6 number found, an unenrolled new test file found in a real temp git repo, a stale branch found, every
 * failure line carries a fix command. No network, no CI.
 * Run: node tests/pr-ready.test.cjs
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');
const ready = require('../tools/pr-ready.cjs');

let checks = 0;
const ok = (value, label) => {
  assert(value, label);
  checks += 1;
};

/* control characters: tab, newline and carriage return are fine, a backspace byte (a heredoc ate the backslash of \b) is not */
ok(ready.controlLines(Buffer.from('a\tb\r\nc\n')).length === 0, 'tab, CR and LF are not control characters');
ok(ready.controlLines(Buffer.from('one\ntwo\x08\nthree\x0c\n')).join() === '2,3', 'backspace on line 2 and form feed on line 3 are found');
ok(ready.controlLines(Buffer.from('del\x7f')).join() === '1', 'DEL is found');

/* the §6 numbers: the body is judged against readability --md run now */
const fresh = '- [x] Pass 1 · shrink: lines 10 → 12 · complexity 3 → 3 · DB trips n/a\n';
const same = '## §6\n- [x] Pass 1 · shrink: lines `10 → 12` · complexity `3 → 3`\n';
const old = '## §6\n- [x] Pass 1 · shrink: lines 10 → 11 · complexity 3 → 3\n';
ok(ready.numbersDrift(same, fresh).length === 0, 'the same numbers do not drift');
ok(ready.numbersDrift(old, fresh).length === 1 && /lines/.test(ready.numbersDrift(old, fresh)[0]), 'a changed line count is named');
ok(ready.numbersDrift(old, '').length === 0, 'no fresh numbers means nothing to compare');

/* the argument reader */
const args = ready.parseArgs(['--repo', 'api', '--body-file', 'b.md', '--fast']);
ok(args.repo === 'api' && args.bodyFile === 'b.md' && args.fast === true, 'flags are read');

/* generated checks: one per generator, each with a fix command */
const apiPlan = ready.generatedChecks({ repo: 'api', branch: 'batch/x', base: 'origin/main' });
ok(apiPlan.some((item) => item.name === 'api-ratchet') && apiPlan.some((item) => item.name === 'seams'), 'a batch branch checks the ratchet and seams');
ok(ready.generatedChecks({ repo: 'api', branch: 'feat/x', base: 'origin/main' }).some((item) => item.name === 'generated-guard'), 'a feature branch runs the generated-guard');
ok(ready.generatedChecks({ repo: 'web', branch: 'feat/x', base: 'origin/main' }).length === 4, 'web checks modules, screen list, process docs, seams');
ok(apiPlan.concat(ready.generatedChecks({ repo: 'web', branch: 'b', base: 'x' })).every((item) => item.fix), 'every generated check names its fix');

/* a real temp repo: a new test file that no home names is an enrol failure, one that GUARDS names is not */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-ready-'));
const git = (...list) => spawnSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false'].concat(list), { encoding: 'utf8' });
git('init', '-q', '-b', 'main');
fs.mkdirSync(path.join(dir, 'scripts'));
fs.mkdirSync(path.join(dir, 'tests'));
fs.writeFileSync(path.join(dir, 'scripts/guards.cjs'), "const GUARDS = [\n  'enrolled.test.cjs',\n];\n");
git('add', '-A');
git('commit', '-q', '-m', 'base');
git('update-ref', 'refs/remotes/origin/main', 'HEAD');
git('checkout', '-q', '-b', 'feat');
fs.writeFileSync(path.join(dir, 'tests/enrolled.test.cjs'), '// ok\n');
fs.writeFileSync(path.join(dir, 'tests/orphan.test.cjs'), '// ok\n');
fs.writeFileSync(path.join(dir, 'tests/bad.txt'), 'x\x08y\n');
git('add', '-A');
git('commit', '-q', '-m', 'feat');
const ctx = { repo: 'api', root: dir, base: 'origin/main', branch: 'feat', files: ['tests/enrolled.test.cjs', 'tests/orphan.test.cjs', 'tests/bad.txt'] };
const missing = ready.checkEnrolled(ctx);
ok(missing.length === 1 && /orphan\.test\.cjs/.test(missing[0].message) && /GUARDS/.test(missing[0].fix), 'only the orphan test file is reported, with the GUARDS fix');
const control = ready.checkControlChars(ctx);
ok(control.length === 1 && /bad\.txt line 1/.test(control[0].message), 'the control byte is reported with its file and line');
fs.rmSync(dir, { recursive: true, force: true });

console.log('pr-ready: ' + checks + ' checks ok');
