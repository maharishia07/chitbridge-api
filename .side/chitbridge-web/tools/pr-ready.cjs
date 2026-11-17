#!/usr/bin/env node
/* tools/pr-ready.cjs — ONE command before `git push`: will CI go red for a reason we already know? (LEVER 6, Athi 12 Nov, DECISIONS 44058aeb)
 *
 * OWNS      the pre-push check of a branch in web, api or engines: current with origin/main · nothing uncommitted · no control characters in changed files ·
 *           every new test file enrolled · each generated file equals its regeneration (the repo's own --check tools) · the PR body carries the §6 block, filled,
 *           with the numbers readability --md gives now. One line per failure with the command that fixes it. It never writes a file.
 * CALLED BY every builder, by hand, before the push: `node tools/pr-ready.cjs --body-file body.md` (web) · `node tools/pr-ready.cjs ...` (api, a 20-line
 *           wrapper that runs THIS file with --repo api: one reader, never a copy) · toolset/batch-build.sh (the batch PR) · tests/pr-ready.test.cjs.
 * FLOW      args ──▶ git facts (base, changed files) ──▶ run each check ──▶ list of { check, message, fix } ──▶ print one line each ──▶ exit 1 on any
 * CARD      qa/readability-guard
 *
 * Reuses, never copies: tools/pr-checklist.cjs (the five §6 lines), tools/readability.cjs --md (the numbers), tools/seams.cjs --check, the api's
 * generated-guard / api-register / api-ratchet --check, web's gen-modules-doc / screen-list / gen-process-docs --check.
 *
 *   node tools/pr-ready.cjs [--repo web|api|engines] [--root DIR] [--base origin/main] [--body-file F | --pr N] [--fast] [--no-fetch] [--json]
 *   --fast   skip the slow checks (the readability numbers and every regeneration check); --no-fetch   do not fetch origin main first.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const checklist = require('./pr-checklist.cjs');

const TOOLS = __dirname;
const TEXT_EXT = /\.(js|cjs|mjs|json|md|html|css|sh|ya?ml|sql|txt)$/i;
const TAB_BYTE = 9;
const LINE_FEED = 10;
const CARRIAGE_RETURN = 13;
const DELETE_CHAR = 127;
const ENROLMENT_HOMES = {
  api: ['scripts/guards.cjs', '.github/workflows/ci.yml', 'deploy/proof.sh'],
  web: ['package.json', '.github/workflows/ci.yml']
};
const NEW_TEST = {
  api: /^tests\/[^/]+\.test\.c?js$/,
  web: /^(tests|scripts)\/[^/]+\.test\.(c?js|mjs)$/
};
const MAX_TIME_MS = 600000;

/** run a command in root; { ok, out } where out is stdout+stderr */
function runCommand(root, command, args, env) {
  const done = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: MAX_TIME_MS, env: Object.assign({}, process.env, env || {}) });
  return { ok: done.status === 0, out: String(done.stdout || '') + String(done.stderr || '') };
}

/** `git <args>` in root, trimmed stdout, or null on failure */
function gitText(root, args) {
  const done = spawnSync('git', ['-C', root].concat(args), { encoding: 'utf8' });
  return done.status === 0 ? done.stdout.trim() : null;
}

/** the first line of a tool's output that says why it failed (the last non-empty line when none looks like a reason) */
function reasonOf(out) {
  const lines = out.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => /✗|fail|differs|drift|missing|stale/i.test(line)) || lines[lines.length - 1] || 'no output';
}

/** is origin/main an ancestor of HEAD? (a stale checkout is the commonest avoidable red) */
function checkFresh(ctx) {
  if (!ctx.noFetch) gitText(ctx.root, ['fetch', '-q', 'origin', 'main']);
  const base = gitText(ctx.root, ['rev-parse', '--verify', ctx.base]);
  if (!base) return [{ check: 'base', message: 'cannot read ' + ctx.base + ' (fetch failed?)', fix: 'git fetch origin main' }];
  const ancestor = spawnSync('git', ['-C', ctx.root, 'merge-base', '--is-ancestor', base, 'HEAD']);
  if (ancestor.status === 0) return [];
  const behind = gitText(ctx.root, ['rev-list', '--count', 'HEAD..' + ctx.base]);
  return [{ check: 'base', message: 'the branch is ' + behind + ' commit(s) behind ' + ctx.base + ' (a stale checkout)', fix: 'git merge ' + ctx.base + ' (then run the checks again)' }];
}

/** tracked files with uncommitted changes: they are not in the push */
function checkClean(ctx) {
  const dirty = (gitText(ctx.root, ['status', '--porcelain', '--untracked-files=no']) || '').split('\n').filter(Boolean);
  if (!dirty.length) return [];
  return [{ check: 'clean', message: dirty.length + ' tracked file(s) changed but not committed, e.g. ' + dirty[0].trim(), fix: 'git add <files> && git commit  (the push carries commits only)' }];
}

/** 1-based line numbers holding a control character other than tab, newline, carriage return (a heredoc that ate a backslash leaves these) */
function controlLines(buffer) {
  const lines = [];
  let line = 1;
  for (const byte of buffer) {
    if (byte === LINE_FEED) line += 1;
    else if ((byte < 32 && byte !== TAB_BYTE && byte !== CARRIAGE_RETURN) || byte === DELETE_CHAR) lines.push(line);
  }
  return [...new Set(lines)];
}

/** changed text files that hold control characters */
function checkControlChars(ctx) {
  const found = [];
  for (const file of ctx.files.filter((name) => TEXT_EXT.test(name))) {
    const full = path.join(ctx.root, file);
    if (!fs.existsSync(full)) continue;
    const lines = controlLines(fs.readFileSync(full));
    if (lines.length) found.push(file + ' line ' + lines.slice(0, 3).join(','));
  }
  if (!found.length) return [];
  return [{ check: 'control-chars', message: 'control characters in ' + found.join('; '), fix: 'rewrite the line with the Edit/Write tool (a shell heredoc or node -e ate a backslash: \\b \\f \\v become control bytes)' }];
}

/** the files added by this branch that match the repo's test-file shape */
function newTestFiles(ctx) {
  const shape = NEW_TEST[ctx.repo];
  if (!shape) return [];
  const added = (gitText(ctx.root, ['diff', '--name-only', '--diff-filter=A', ctx.base + '...HEAD']) || '').split('\n').filter(Boolean);
  return added.filter((name) => shape.test(name));
}

/** every new test file is named in a home that CI reads (the api GUARDS list, ci.yml, proof.sh · web package.json, ci.yml) */
function checkEnrolled(ctx) {
  const homes = (ENROLMENT_HOMES[ctx.repo] || []).filter((name) => fs.existsSync(path.join(ctx.root, name)));
  const text = homes.map((name) => fs.readFileSync(path.join(ctx.root, name), 'utf8')).join('\n');
  const missing = newTestFiles(ctx).filter((name) => !text.includes(path.basename(name)));
  return missing.map((name) => ({
    check: 'enrol',
    message: name + ' is not named in ' + (ENROLMENT_HOMES[ctx.repo] || []).join(' / ') + ' (CI never runs it)',
    fix: ctx.repo === 'api' ? "add '" + path.basename(name) + "' to GUARDS in scripts/guards.cjs" : 'add it to the `check` script in package.json'
  }));
}

/** the generated-file checks of one repo: [{ name, cmd, args, fix, env? }] */
function generatedChecks(ctx) {
  const seams = { name: 'seams', cmd: 'node', args: [path.join(TOOLS, 'seams.cjs'), '--check', '--repo', ctx.repo], fix: 'patch the lines the check names in docs/SEAMS.md (never the all-checkout seams --write)' };
  if (ctx.repo === 'api') {
    const strict = ctx.branch === 'main' || ctx.branch.startsWith('batch/');
    const mode = { CB_GENERATED: strict ? 'strict' : 'regen' };
    const list = [{ name: 'api-register', cmd: 'node', args: ['tools/api-register.cjs', '--check'], env: mode, fix: 'node tools/api-register.cjs (regenerates docs/api-register.json, API-REGISTER.md, error-codes) in a worktree of origin/main + the branch' }];
    list.push(strict
      ? { name: 'api-ratchet', cmd: 'node', args: ['tools/api-ratchet.cjs', '--base', ctx.base], fix: 'node tools/api-ratchet.cjs --write' }
      : { name: 'generated-guard', cmd: 'node', args: ['tools/generated-guard.cjs', '--base', ctx.base], env: mode, fix: 'git checkout $(git merge-base origin/main HEAD) -- <the derived files it names> (CI regenerates them on a feature branch)' });
    return list.concat(seams);
  }
  if (ctx.repo === 'web') {
    const docCheck = (name, file, remedy) => ({ name, cmd: 'node', args: [path.join(TOOLS, file), '--check'], fix: remedy });
    return [docCheck('modules-doc', 'gen-modules-doc.cjs', 'node tools/gen-modules-doc.cjs (from an LF checkout)'), docCheck('screen-list', 'screen-list.cjs', 'node tools/screen-list.cjs --write'), docCheck('process-docs', 'gen-process-docs.cjs', 'node tools/gen-process-docs.cjs'), seams];
  }
  return [];
}

/** each generated file equals what its generator says */
function checkGenerated(ctx) {
  const failures = [];
  for (const item of generatedChecks(ctx)) {
    const result = runCommand(ctx.root, item.cmd, item.args, item.env);
    if (!result.ok) failures.push({ check: 'generated:' + item.name, message: reasonOf(result.out), fix: item.fix });
  }
  return failures;
}

/** the body text: --body-file, else the open PR of this branch (gh pr view), else null */
function readBody(ctx) {
  if (ctx.bodyFile) return fs.readFileSync(ctx.bodyFile, 'utf8');
  const target = ctx.pr ? [String(ctx.pr)] : [ctx.branch];
  const done = spawnSync('gh', ['pr', 'view'].concat(target, ['--json', 'body', '-q', '.body']), { cwd: ctx.root, encoding: 'utf8' });
  return done.status === 0 ? done.stdout : null;
}

/** the "lines N → N" and "complexity N → N" pairs of a §6 text, in order */
function numbersOf(text) {
  const pick = (word) => [...String(text).matchAll(new RegExp(word + '\\s*`?(\\d+)\\s*(?:→|->)\\s*(\\d+)', 'gi'))].map((found) => found[1] + '→' + found[2]);
  return { lines: pick('lines'), complexity: pick('complexity') };
}

/** the §6 numbers the body carries differ from `readability --changed --md` run now (complexity drifts: re-run before the push) */
function numbersDrift(body, fresh) {
  const have = numbersOf(checklist.checklistBlock(body));
  const now = numbersOf(fresh);
  const drift = [];
  for (const key of ['lines', 'complexity']) {
    if (now[key].length && have[key].join() !== now[key].join()) drift.push(key + ' ' + have[key].join(',') + ' in the body, ' + now[key].join(',') + ' now');
  }
  return drift;
}

/** the readability --md command for this repo */
function readabilityArgs(ctx) {
  return [path.join(TOOLS, 'readability.cjs'), '--changed', '--repo', ctx.repo, '--root', ctx.root, '--base', ctx.base, '--ratchet', '--md'];
}

/** the body has the §6 heading, the five lines filled, no placeholder, and (unless --fast) the numbers readability gives now */
function checkBody(ctx) {
  const fill = 'node ' + (ctx.repo === 'web' ? 'tools/readability.cjs' : '../chitbridge-web/tools/readability.cjs') + ' --changed --repo ' + ctx.repo + ' --root . --ratchet --md   (paste it under a ## §6 heading, fill Pass 0 and the doc names)';
  if (checklist.skipReason('', ctx.files)) return [];
  const body = readBody(ctx);
  if (body === null) return [{ check: 'body', message: 'no PR body to read (no --body-file, no open PR for ' + ctx.branch + ')', fix: 'write the body to a file and pass --body-file <file>' }];
  const failures = [];
  if (!/^#{1,6}[ \t]*§\s*6/m.test(body)) failures.push({ check: 'body', message: 'no "## §6" heading in the PR body', fix: fill });
  for (const problem of checklist.problems(body)) failures.push({ check: 'body', message: problem, fix: fill });
  if (failures.length || ctx.fast) return failures;
  const fresh = runCommand(ctx.root, 'node', readabilityArgs(ctx));
  const drift = numbersDrift(body, fresh.out);
  return drift.map((text) => ({ check: 'body-numbers', message: '§6 ' + text, fix: fill }));
}

/** the arguments of the command line */
function parseArgs(argv) {
  const out = { repo: 'web', root: process.cwd(), base: 'origin/main', fast: false, noFetch: false, json: false };
  for (let at = 0; at < argv.length; at += 1) {
    const key = argv[at];
    if (key === '--fast') out.fast = true;
    else if (key === '--no-fetch') out.noFetch = true;
    else if (key === '--json') out.json = true;
    else if (key === '--repo') out.repo = argv[++at];
    else if (key === '--root') out.root = path.resolve(argv[++at]);
    else if (key === '--base') out.base = argv[++at];
    else if (key === '--body-file') out.bodyFile = argv[++at];
    else if (key === '--pr') out.pr = argv[++at];
  }
  return out;
}

/** the facts every check reads: branch, changed files */
function contextOf(args) {
  const branch = gitText(args.root, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'HEAD';
  const changed = gitText(args.root, ['diff', '--name-only', '--diff-filter=AM', args.base + '...HEAD']) || '';
  return Object.assign({}, args, { branch, files: changed.split('\n').filter(Boolean) });
}

/** every failure of the branch in ctx.root: [{ check, message, fix }] */
function problemsOf(ctx) {
  const list = [].concat(checkFresh(ctx), checkClean(ctx), checkControlChars(ctx), checkEnrolled(ctx));
  if (!ctx.fast) list.push(...checkGenerated(ctx));
  return list.concat(checkBody(ctx));
}

function main() {
  const ctx = contextOf(parseArgs(process.argv.slice(2)));
  const found = problemsOf(ctx);
  if (ctx.json) console.log(JSON.stringify(found, null, 2));
  else found.forEach((item) => console.log('  ✗ ' + item.check + ': ' + item.message + '\n      fix: ' + item.fix));
  const verdict = found.length ? found.length + ' failure(s)' : 'ok';
  console.log('pr-ready · ' + ctx.repo + ' · ' + ctx.branch + ' · ' + ctx.files.length + ' changed file(s)' + (ctx.fast ? ' · --fast' : '') + ' · ' + verdict);
  return found.length ? 1 : 0;
}

if (require.main === module) process.exit(main());
module.exports = { controlLines, numbersOf, numbersDrift, newTestFiles, checkEnrolled, checkControlChars, generatedChecks, parseArgs, reasonOf };
