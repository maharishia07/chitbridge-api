/**
 * tests/mnt16-tooling.test.cjs — the two api tooling false reds MNT-16 removed stay removed.
 *
 * OWNS      (1) the readability guard finds the web tool through CB_WEB_DIR (a worktree has no sibling chitbridge-web);
 *           (2) the sweep kit replays a frozen 5xx body like a frozen 4xx, so no sweep re-adds that check by hand.
 * CALLED BY scripts/guards.cjs (the offline gate).
 * FLOW      (1) a stub web tool + CB_WEB_DIR ──▶ spawn the guard ──▶ the stub's report is in its output
 *           (2) kit.checkServerError over a matching and a drifted 5xx answer ──▶ one passes, one fails
 * CARD      qa/readability-guard
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const kit = require('./problem-sweep-kit.cjs');

let passed = 0;
let failed = 0;
const expect = (name, ok) => {
  if (ok) passed++;
  else failed++;
  console.log('  ' + (ok ? 'ok  ' : 'XX  ') + name);
};

console.log('\nMNT-16 · tooling false reds');

const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mnt16-web-'));
fs.mkdirSync(path.join(stubDir, 'tools'));
fs.writeFileSync(path.join(stubDir, 'tools', 'readability.cjs'), "console.log('readability --changed · api · STUB-FROM-CB-WEB-DIR');\n");
const env = Object.assign({}, process.env, { CB_WEB_DIR: stubDir });
delete env.GITHUB_HEAD_REF;
delete env.GITHUB_REF_NAME;
const guard = spawnSync(process.execPath, [path.join(__dirname, 'readability-guard.test.cjs')], { env, encoding: 'utf8' });
expect('the readability guard runs the web tool CB_WEB_DIR names', /STUB-FROM-CB-WEB-DIR/.test(guard.stdout || ''));
fs.rmSync(stubDir, { recursive: true, force: true });

const frozen = { status: 500, fixture: { error: 'Failed', message: 'Something went wrong' } };
const sameAnswer = { status: 500, text: '{"error":"Failed"}', json: { error: 'Failed', message: 'Something went wrong', code: 'x' } };
const driftedAnswer = { status: 500, text: '{"error":"Oops"}', json: { error: 'Oops', message: 'Something went wrong' } };
const leaky = { status: 500, text: 'relation "x" does not exist', json: { error: 'Failed', message: 'Something went wrong' } };
const run = (answer, frozenAnswer) => {
  const tally = { bad: 0 };
  kit.checkServerError((label, ok) => ok || tally.bad++, 'x', answer, frozenAnswer, /relation/);
  return tally.bad;
};
expect('a 5xx equal to its frozen body passes', run(sameAnswer, frozen) === 0);
expect('a 5xx whose frozen key drifted fails', run(driftedAnswer, frozen) > 0);
expect('a 5xx that leaks its cause fails', run(leaky, frozen) > 0);
expect('a 5xx with no frozen entry is only leak-checked', run(sameAnswer, undefined) === 0);

console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
