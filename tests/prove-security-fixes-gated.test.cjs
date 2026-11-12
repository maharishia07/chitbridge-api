/**
 * tests/prove-security-fixes-gated.test.cjs — SEC-132 (C12): scripts/prove-security-fixes.js is a LIVE proof (it signs up shops on a running api), so it cannot run here.
 * What can be held offline: it still parses, and its S1 step has the sealed-box branch (the simulator answers the unknown-path 404 when gated, and the step then
 * passes without trying a lead token), AND the real gate it relies on answers exactly that (tests/sec-132-simulator-gate.test.cjs holds the route half).
 * Run: node tests/prove-security-fixes-gated.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const file = path.join(__dirname, '..', 'scripts', 'prove-security-fixes.js');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };
const parsed = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
t('the live proof script still parses', parsed.status === 0, parsed.stderr);
const src = fs.readFileSync(file, 'utf8');
t('S1 has the sealed-box branch: a 404 from /api/simulator/lead is "gated off" and passes', /const gated = lead\.status === 404;/.test(src) && /gated off here \(SEC-132\)/.test(src));
t('…and then does not try a lead token that no longer exists (the two bypass calls are skipped when gated)', (src.match(/gated \? \{ status: 401 \}/g) || []).length === 2);
console.log(`\n${pass + fail} checks · ${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
