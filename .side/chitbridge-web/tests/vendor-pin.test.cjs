/**
 * vendor-pin.test.cjs — the pin tool refuses what it must and reports drift (tools/vendor-pin.cjs, 11 Nov 2026).
 * Run: node tests/vendor-pin.test.cjs  · temp git repos only, no network.
 */
'use strict';
const assert = require('assert'),
  fs = require('fs'),
  os = require('os'),
  path = require('path'),
  { execFileSync } = require('child_process');
const pinTool = require('../tools/vendor-pin.cjs');

const gitIn = (dir, args) => execFileSync('git', ['-C', dir].concat(args), { encoding: 'utf8' });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-pin-'));
gitIn(tmp, ['init', '-q', '-b', 'main']);
gitIn(tmp, ['config', 'user.email', 't@example.invalid']);
gitIn(tmp, ['config', 'user.name', 'test']);
fs.mkdirSync(path.join(tmp, 'tools', 'tally-connector'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'tools', 'tally-connector', 'till.html'), 'one\n');
gitIn(tmp, ['add', '-A']);
gitIn(tmp, ['commit', '-q', '-m', 'one']);

let passed = 0;
const check = (what, run) => {
  try { run(); passed++; console.log('  ok  ' + what); } catch (err) { console.log('  FAIL ' + what + '\n      ' + err.message); process.exitCode = 1; }
};

check('bump refuses a commit that is not on origin/main (a branch head can vanish)', () => {
  assert.throws(() => pinTool.bump(tmp), /not on api origin\/main|origin\/main/);
});
check('bump refuses an unclean checkout', () => {
  fs.writeFileSync(path.join(tmp, 'dirty.txt'), 'x');
  assert.throws(() => pinTool.bump(tmp), /uncommitted/);
  fs.unlinkSync(path.join(tmp, 'dirty.txt'));
});
check('drift only warns: it names a changed master and never throws', () => {
  const lockFile = path.join(__dirname, '..', 'vendor.lock.json');
  const had = fs.readFileSync(lockFile, 'utf8');
  const first = gitIn(tmp, ['rev-parse', 'HEAD']).trim();
  fs.writeFileSync(lockFile, JSON.stringify({ api: { repo: 'x', sha: first, pinnedAt: '2026-01-01' } }));
  fs.writeFileSync(path.join(tmp, 'tools', 'tally-connector', 'till.html'), 'two\n');
  gitIn(tmp, ['commit', '-q', '-am', 'two']);
  const logged = [];
  const realLog = console.log;
  console.log = (line) => logged.push(line);
  try { pinTool.drift(tmp); } finally { console.log = realLog; fs.writeFileSync(lockFile, had); }
  assert.ok(logged.some((line) => /::warning::/.test(line) && /till\.html/.test(line) && /STALE/.test(line)), logged.join('|'));
});
console.log(passed + ' checks');
