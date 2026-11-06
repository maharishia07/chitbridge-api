#!/usr/bin/env node
// @type: unit
/**
 * change-pin-lock-mutation.test.cjs — PPL-30 mutation checks: break the lock two ways and tests/change-pin-lock.test.cjs MUST go red each time.
 *   1. the route: a bare pinMatches (no count, no lock, the way it was)
 *   2. the engine: lib/identity-auth.js countWrongPin back to read-then-write (the parallel-guess race)
 * A broken copy is written beside the real file, the test is run against it, the copy is deleted. Proves the test can fail.
 * RUN       node tests/change-pin-lock-mutation.test.cjs
 * CARD      17-people-employees-hr-and-payroll/pin-otp-first-sign-in
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ROUTE_LINE = "identityAuth.verifyCredential(db, { ...a, identity_id, identity_type: 'actor' }, { pin: req.body.current_pin })";
const ROUTE_BARE = "{ ok: await identityAuth.pinMatches(req.body.current_pin, a.pin_hash), reason: 'PIN_WRONG' }";
const READ_THEN_WRITE = [
  'async function countWrongPin(query, identityId) {',
  "  const seen = await query('SELECT pin_attempts, pin_locked_at FROM identities WHERE identity_id = $1', [identityId]);",
  '  const n = ((seen.rows[0] && seen.rows[0].pin_attempts) || 0) + 1;',
  '  const lock = n >= MAX_PIN_ATTEMPTS;',
  "  await query('UPDATE identities SET pin_attempts = $2' + (lock ? ', pin_locked_at = NOW()' : '') + ' WHERE identity_id = $1', [identityId, n]);",
  '  return { pin_attempts: n, pin_locked_at: lock ? new Date() : null };',
  '}',
  ''
].join('\n');

/** wentRed(file, edit, envName) — write the edited copy, run the test with env pointing at it, delete the copy; true when the test went red, null when the edit did not apply */
function wentRed(file, edit, envName) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const broken = edit(source);
  if (broken === source) return null;
  const copy = path.join(path.dirname(file), '_mutant-' + path.basename(file));
  fs.writeFileSync(path.join(ROOT, copy), broken);
  try {
    const ran = spawnSync(process.execPath, [path.join(__dirname, 'change-pin-lock.test.cjs')], { env: { ...process.env, [envName]: copy.split(path.sep).join('/') }, encoding: 'utf8' });
    return ran.status === 1 && /FAIL /.test(ran.stdout);
  } finally {
    fs.unlinkSync(path.join(ROOT, copy));
  }
}

const engineEdit = (src) => {
  const from = src.indexOf('async function countWrongPin(');
  const to = src.indexOf('async function verifyCredential(');
  return from < 0 || to < from ? src : src.slice(0, from) + READ_THEN_WRITE + '\n' + src.slice(to);
};
const cases = [
  ['the route with the count-and-lock removed', wentRed('routes/actors.js', (src) => src.replace(ROUTE_LINE, ROUTE_BARE), 'CHANGE_PIN_ROUTE')],
  ['the engine back to read-then-write (the parallel race)', wentRed('lib/identity-auth.js', engineEdit, 'CHANGE_PIN_AUTH')]
];
let bad = 0;
cases.forEach(([label, red]) => {
  if (red !== true) bad++;
  console.log((red === true ? 'ok   ' : 'FAIL ') + label + (red === null ? ' (the mutation did not apply)' : ' makes change-pin-lock.test.cjs go red'));
});
process.exit(bad ? 1 : 0);
