// tests/health-line.test.cjs — PM-120/HLT-1: deploy/health-line.cjs prints the line offline and fails loudly on a bad fixture.
'use strict';
const assert = require('assert'); const { spawnSync } = require('child_process'); const path = require('path');
const script = path.join(__dirname, '..', 'deploy', 'health-line.cjs'), fx = (n) => path.join(__dirname, '..', 'deploy', 'fixtures', n);
const ok = spawnSync('node', [script, '--fixture', fx('health-line.ok.json')], { encoding: 'utf8' });
assert.strictEqual(ok.status, 0, ok.stderr);
assert.strictEqual(ok.stdout.trim(), '2026-10-19 · api prod ok db 456ms commit=main · web ok · CI 3/3 green · audit_lost 0 · money_mismatch 0 · stock drift 0 · no-movement 0');
const bad = spawnSync('node', [script, '--fixture', fx('health-line.bad.json')], { encoding: 'utf8' });
assert.strictEqual(bad.status, 2); assert.ok(/bad health input/.test(bad.stderr), bad.stderr); assert.strictEqual(bad.stdout, '');
const { formatLine } = require(script);
const red = formatLine({ health: { db: 'ok', environment: 'production', commit: 'deadbee1', audit_lost: 2 }, mainSha: { api: '76d350b1', web: 'x' }, ci: { web: 'success', api: 'failure', engines: 'success' } }, 'D');
assert.ok(red.red.includes('api commit behind main') && red.red.includes('CI not green') && /stock n\/a/.test(red.line));
/* HLT-6: money_mismatch above 0 is red; absent stays n/a (never 0, never a throw) */
const mm = spawnSync('node', [script, '--fixture', fx('health-line.red.json')], { encoding: 'utf8' });
assert.strictEqual(mm.status, 1); assert.ok(/money_mismatch 2/.test(mm.stdout) && /RED: money_mismatch 2/.test(mm.stderr), mm.stdout + mm.stderr);
assert.ok(/money_mismatch n\/a/.test(red.line) && !red.red.some((x) => /money_mismatch/.test(x)));
console.log('health-line: ok · 9 checks');
