#!/usr/bin/env node
/**
 * e2e/filesize-ratchet.cjs — THE FILE-SIZE RATCHET, BROKEN ONCE ON A FIXTURE (MNT-58, 2026-11-14). Offline: no browser, no server, no install.
 *
 * OWNS      the proof that tools/readability/filesize.cjs bites: a throw-away git repo (branch main, a 600-line baseline file in lib/), then
 *           · the untouched repo is green · a baseline file that GREW is red · a NEW file of 501 lines is red · a NEW file of 500 is green
 *           · a shrunk file is green and --write lowers its row · --write refuses to raise a row and to add a new 900-line file
 *           · a hand-added baseline row for that 900-line file is red against main (a PR cannot hide growth) · a hand-raised row is red
 *           · --rebaseline on a feature branch is refused, with the batch tool stamp it resets the rows · --ceiling lists a computed customer file
 *           · a batch/* branch with only a CB_BUILD comment line is red · CB_FILESIZE_STAMP in a PR that edits a workflow is refused and red
 *           · a real batch (CB_BUILD assignment bumped, a merge commit touching the file) is green and prints the raised row
 *           · api/engines (no CB_BUILD): a filesize.stamp line "<batch branch> <date>" is green; none, another branch, a feature branch, two lines, no date are red
 *           · tests count; a copy, a fixtures/ file and the generated and vendored web paths do not
 * CALLED BY .github/workflows/ci.yml (web check job).
 * FLOW      build the fixture repo on main ──▶ branch ──▶ edit ──▶ run tools/readability/filesize.cjs --against main ──▶ assert exit code and words
 * CARD      qa/readability-guard
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const TOOL = path.join(__dirname, '..', 'tools', 'readability', 'filesize.cjs');
const { isExcluded } = require(TOOL);
const QUIET_ENV = ['CI', 'GITHUB_HEAD_REF', 'GITHUB_BASE_REF', 'FILESIZE_BASE', 'CB_FILESIZE_STAMP', 'GITHUB_STEP_SUMMARY'];
const STAMP_V1 = "<script>\nconst CB_BUILD =\n  '2026-11-13a'; /* stamp */\n</script>\n";
const STAMP_V2 = "<script>\nconst CB_BUILD =\n  '2026-11-14a'; /* stamp */\n</script>\n";
const STAMP_COMMENT = "<script>\n// const CB_BUILD = '2026-11-14z';\nconst CB_BUILD =\n  '2026-11-13a'; /* stamp */\n</script>\n";
let bad = 0;

function check(cond, what) {
  if (!cond) bad++;
  console.log((cond ? '  ok  ' : '  XX  ') + what);
}

function run(root, flags, extraEnv) {
  const env = Object.assign({}, process.env);
  QUIET_ENV.forEach((key) => delete env[key]);
  const out = spawnSync(process.execPath, [TOOL, '--root', root, '--against', 'main'].concat(flags || []), { encoding: 'utf8', env: Object.assign(env, extraEnv) });
  return { code: out.status, text: out.stdout + out.stderr };
}

function lines(count, first) {
  const body = [];
  for (let at = 0; at < count; at++) body.push(at === 0 && first ? first : '// line ' + at);
  return body.join('\n') + '\n';
}

function put(root, rel, text) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

function git(root, gitArgs) {
  return spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t'].concat(gitArgs), { encoding: 'utf8' });
}

function baselineText(root) {
  return fs.readFileSync(path.join(root, 'filesize.baseline.json'), 'utf8');
}

function commitAll(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
}

function buildFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filesize-'));
  git(root, ['init', '-q', '-b', 'main']);
  put(root, 'lib/big.js', lines(600));
  put(root, 'lib/small.js', lines(100));
  put(root, 'tests/fixtures/data.js', lines(900));
  put(root, 'lib/adopted.js', lines(900, '/* ADOPTED from chitbridge-engines v1.0.0 · lib/adopted.js · sha256 abc */'));
  put(root, 'tests/big.test.cjs', lines(550));
  put(root, 'public/app.html', STAMP_V1);
  put(root, 'public/big.html', '<!-- <script src="/app/ghost.js"></script> -->\n<script src="/app/cust.js"></script>\n');
  put(root, 'public/app/cust.js', lines(300));
  put(root, 'e2e/proof/pages.json', JSON.stringify({ pages: [['big', '/big.html']] }));
  put(root, '.github/workflows/ci.yml', 'name: ci\n');
  put(root, 'filesize.baseline.json', '{\n  "files": {\n    "lib/big.js": 600,\n    "tests/big.test.cjs": 550\n  }\n}\n');
  commitAll(root, 'base');
  git(root, ['checkout', '-q', '-b', 'feature/x']);
  return root;
}

function showGrowth(root) {
  check(run(root).code === 0, 'the untouched repo is green (copy, fixtures/ not counted)');
  put(root, 'lib/big.js', lines(601));
  const grown = run(root);
  check(grown.code === 1 && /grew: lib\/big\.js 600 -> 601/.test(grown.text), 'a baseline file that grew by one line is RED');
  put(root, 'tests/big.test.cjs', lines(551));
  check(/grew: tests\/big\.test\.cjs 550 -> 551/.test(run(root).text), 'a test file that grew is RED too (tests are in scope)');
  put(root, 'tests/big.test.cjs', lines(550));
  put(root, 'lib/big.js', lines(590));
  check(run(root).code === 0, 'a baseline file that shrank is green');
  check(run(root, ['--write']).code === 0 && /"lib\/big\.js": 590/.test(baselineText(root)), '--write lowers the row to 590');
  put(root, 'lib/big.js', lines(595));
  const refused = run(root, ['--write']);
  check(refused.code === 1 && /REFUSED/.test(refused.text), '--write refuses to raise a row (590 -> 595)');
  put(root, 'lib/big.js', lines(590));
}

function showNewFile(root) {
  put(root, 'lib/fresh.js', lines(500));
  check(run(root).code === 0, 'a NEW file of exactly 500 lines is green');
  put(root, 'lib/fresh.js', lines(501));
  const tooBig = run(root);
  check(tooBig.code === 1 && /new file over 500: lib\/fresh\.js \(501/.test(tooBig.text), 'a NEW file of 501 lines is RED');
  fs.rmSync(path.join(root, 'lib/fresh.js'));
}

function showHiddenGrowth(root) {
  put(root, 'lib/new900.js', lines(900));
  const refused = run(root, ['--write']);
  check(refused.code === 1 && /REFUSED[^\n]*lib\/new900\.js/.test(refused.text), '--write refuses to ADD a row for a new 900-line file');
  const rows = JSON.parse(baselineText(root)).files;
  rows['lib/new900.js'] = 900;
  fs.writeFileSync(path.join(root, 'filesize.baseline.json'), JSON.stringify({ files: rows }, null, 2));
  const hidden = run(root);
  check(hidden.code === 1 && /baseline row added or raised: lib\/new900\.js/.test(hidden.text), 'the same row added by hand is RED against main (a PR cannot hide growth)');
  fs.rmSync(path.join(root, 'lib/new900.js'));
}

/** a raised row: lib/big.js 600 -> 700, in the file and in the baseline */
function raiseRow(root) {
  put(root, 'lib/big.js', lines(700));
  fs.writeFileSync(path.join(root, 'filesize.baseline.json'), JSON.stringify({ files: { 'lib/big.js': 700, 'tests/big.test.cjs': 550 } }, null, 2));
}

function branchFromMain(root, name) {
  git(root, ['checkout', '-q', '-f', 'main']);
  git(root, ['clean', '-fdq']);
  git(root, ['checkout', '-q', '-b', name]);
}

function showRebaseline(root) {
  put(root, 'public/app/cust.js', lines(1200));
  const refused = run(root, ['--rebaseline']);
  check(refused.code === 1 && /REFUSED: --rebaseline runs only at a batch stamp/.test(refused.text), '--rebaseline on a feature branch is REFUSED');
  const stamped = run(root, ['--rebaseline'], { CB_FILESIZE_STAMP: '1' });
  check(stamped.code === 0 && /"public\/app\/cust\.js": 1200/.test(baselineText(root)), '--rebaseline with the batch tool stamp resets the rows');
  const ceiling = run(root, ['--ceiling']);
  check(ceiling.code === 1 && /public\/app\/cust\.js \(1200\)/.test(ceiling.text), '--ceiling lists the computed customer file over 1,000 and exits 1');
  check(!/ghost/.test(ceiling.text) && /computed: 2 /.test(ceiling.text), 'the customer list is the page and its one live script (a commented-out tag is not loaded)');
}

function showForgeries(root) {
  branchFromMain(root, 'batch/fake');
  put(root, 'public/app.html', STAMP_COMMENT);
  raiseRow(root);
  commitAll(root, 'forged');
  const comment = run(root);
  check(comment.code === 1 && /baseline row added or raised: lib\/big\.js/.test(comment.text), 'a batch/* branch with only a CB_BUILD comment line is RED (stamp forged)');
  branchFromMain(root, 'feature/env');
  put(root, '.github/workflows/ci.yml', 'name: ci\nenv: { CB_FILESIZE_STAMP: 1 }\n');
  raiseRow(root);
  commitAll(root, 'env forged');
  const forged = run(root, [], { CB_FILESIZE_STAMP: '1' });
  check(forged.code === 1 && /REFUSED CB_FILESIZE_STAMP: this change edits a workflow file/.test(forged.text), 'CB_FILESIZE_STAMP set while the PR edits a workflow is REFUSED, the row RED');
}

function showRealBatch(root) {
  branchFromMain(root, 'feat/y');
  raiseRow(root);
  commitAll(root, 'feature grew a file');
  branchFromMain(root, 'batch/real');
  put(root, 'public/app.html', STAMP_V2);
  commitAll(root, 'stamp');
  git(root, ['merge', '-q', '--no-ff', '-m', 'merge feat/y', 'feat/y']);
  const batch = run(root);
  check(batch.code === 0 && /STAMP \(batch\) row lib\/big\.js 600 -> 700/.test(batch.text), 'a real batch (CB_BUILD assignment bumped + a merge commit touching the file) is GREEN and prints the raised row');
}

/** the api/engines stamp: a committed filesize.stamp line "<branch> <date>" on a batch/* branch; every other shape is red */
function stampRun(root, branch, stampText) {
  branchFromMain(root, 'feat/z-' + branch.replace(/\W/g, ''));
  raiseRow(root);
  commitAll(root, 'feature grew a file');
  const feature = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
  branchFromMain(root, branch);
  if (stampText) put(root, 'filesize.stamp', stampText);
  commitAll(root, 'stamp');
  git(root, ['merge', '-q', '--no-ff', '-m', 'merge ' + feature, feature]);
  return run(root);
}

function showFileStamp(root) {
  const ok = stampRun(root, 'batch/api-ok', 'batch/api-ok 2026-11-15\n');
  check(ok.code === 0 && /STAMP \(batch\) row lib\/big\.js 600 -> 700/.test(ok.text), 'api/engines: filesize.stamp "<this batch branch> <date>" + a merge commit is GREEN and prints the raised row');
  check(stampRun(root, 'batch/api-none', '').code === 1, 'api/engines: a batch/* branch with NO filesize.stamp change is RED');
  check(stampRun(root, 'batch/api-other', 'batch/api-old 2026-11-14\n').code === 1, 'api/engines: a stamp naming ANOTHER branch (carried over) is RED');
  check(stampRun(root, 'feature/api-stamp', 'feature/api-stamp 2026-11-15\n').code === 1, 'api/engines: the right stamp line on a NON-batch branch is RED');
  check(stampRun(root, 'batch/api-two', 'batch/api-two 2026-11-15\nbatch/api-x 2026-11-15\n').code === 1, 'api/engines: a stamp file with two added lines is RED');
  check(stampRun(root, 'batch/api-nodate', 'batch/api-nodate soon\n').code === 1, 'api/engines: a stamp line without a YYYY-MM-DD date is RED');
  branchFromMain(root, 'batch/api-rb');
  put(root, 'filesize.stamp', 'batch/api-rb 2026-11-15\n');
  commitAll(root, 'stamp');
  check(run(root, ['--rebaseline']).code === 0, 'api/engines: --rebaseline is allowed on that stamp');
}

function showExclusions() {
  const skipped = ['public/app/screens.js', 'public/app/strings-hi.js', 'public/engine/tax.js', 'public/till.html', 'vendor/x.js', 'a/node_modules/b.js', 'public/x.min.js', 'tests/fixtures/y.js'];
  check(skipped.every(isExcluded) && !isExcluded('tests/x.test.cjs') && !isExcluded('public/app/cart.js'), 'generated, copied, vendored, minified and fixture paths are not counted; tests and app files are');
}

console.log('\nfile-size ratchet · every rule broken once on a fixture (MNT-58)');
const fixture = buildFixture();
showGrowth(fixture);
showNewFile(fixture);
showHiddenGrowth(fixture);
showRebaseline(fixture);
showForgeries(fixture);
showRealBatch(fixture);
showFileStamp(fixture);
showExclusions();
fs.rmSync(fixture, { recursive: true, force: true });
console.log(bad ? '\n' + bad + ' FAILED' : '\nall ok');
process.exit(bad ? 1 : 0);
