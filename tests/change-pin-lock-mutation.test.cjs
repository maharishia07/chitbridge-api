#!/usr/bin/env node
// @type: unit
/**
 * change-pin-lock-mutation.test.cjs — PPL-30 mutation check: break change-pin the way it was (a bare pinMatches, no count, no lock) and tests/change-pin-lock.test.cjs MUST go red.
 * A copy of routes/actors.js with the lock/count line swapped is written beside it, the test is run against it, the copy is deleted. Proves the test can fail.
 * RUN       node tests/change-pin-lock-mutation.test.cjs
 * CARD      17-people-employees-hr-and-payroll/pin-otp-first-sign-in
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LOCKED_LINE = "identityAuth.verifyCredential(db, { ...a, identity_id, identity_type: 'actor' }, { pin: req.body.current_pin })";
const BARE_LINE = "{ ok: await identityAuth.pinMatches(req.body.current_pin, a.pin_hash), reason: 'PIN_WRONG' }";
const MUTANT = path.join('routes', '_mutant-actors-ppl30.js');

const source = fs.readFileSync(path.join(ROOT, 'routes', 'actors.js'), 'utf8');
if (!source.includes(LOCKED_LINE)) {
  console.log('FAIL the change-pin count-and-lock line is not where the mutation expects it');
  process.exit(1);
}
fs.writeFileSync(path.join(ROOT, MUTANT), source.replace(LOCKED_LINE, BARE_LINE));
let ran;
try {
  ran = spawnSync(process.execPath, [path.join(__dirname, 'change-pin-lock.test.cjs')], { env: { ...process.env, CHANGE_PIN_ROUTE: MUTANT }, encoding: 'utf8' });
} finally {
  fs.unlinkSync(path.join(ROOT, MUTANT));
}
const red = ran.status === 1 && /FAIL /.test(ran.stdout);
console.log((red ? 'ok   ' : 'FAIL ') + 'with the count-and-lock removed, change-pin-lock.test.cjs goes red (exit ' + ran.status + ')');
process.exit(red ? 0 : 1);
