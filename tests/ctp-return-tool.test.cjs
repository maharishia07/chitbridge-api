/**
 * tests/ctp-return-tool.test.cjs — tools/ctp-return.cjs (the CTP return path's resend, run by cron): with no database and nothing queued it prints ONE JSON line (when, ok, tried, accepted, still, failed) and exits 0; the exit code is 0 exactly when nothing failed for good; it prints no
 * connection string. The drain itself is tested in tests/ctp-return-path.test.cjs. Run: node tests/ctp-return-tool.test.cjs
 */
'use strict';
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const ran = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'ctp-return.cjs')], { env: Object.assign({}, process.env, { DATABASE_URL: '' }), encoding: 'utf8', timeout: 60000 });
const lines = ran.stdout.trim().split('\n');
const last = JSON.parse(lines[lines.length - 1]);
assert.strictEqual(last.ok, true);
assert.strictEqual(ran.status, last.failed === 0 ? 0 : 1, 'the exit code is 0 exactly when nothing failed for good, so cron notices');
assert.deepStrictEqual([last.tried, last.accepted, last.still, last.failed], [0, 0, 0, 0], 'nothing queued, nothing sent');
assert.ok(typeof last.at === 'string', 'one JSON line with when');
assert.ok(!/postgres:\/\//.test(ran.stdout + ran.stderr), 'no connection string is printed');
console.log('   ok   the resend tool answers one clean JSON line and exits 0 with nothing queued\n\n  1 passed, 0 failed');
