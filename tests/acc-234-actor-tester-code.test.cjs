/**
 * tests/acc-234-actor-tester-code.test.cjs — ACC-234: an auditor (actor) seat signs in on SIT through the tester code.
 * TESTER_NAMES names the BUSINESS; an actor is typed key@business, so lib/identity-auth.js parentNames adds the parent's own names.
 * Proves: a listed business's actor signs in with the tester code · an unlisted business's actor does not · a wrong code is counted ·
 * TESTER_CODE unset → nothing · an entity is unchanged · no new door: the same testerGuess gate (name list, guess cap, account lock).
 * Run: node tests/acc-234-actor-tester-code.test.cjs · no network, no DB.
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (name, ok) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name); } };
const LOCALDB = 'postgres://cb@127.0.0.1:5432/cb_test';
const CODE = 'ab-Lantern-4217';
const KEYS = ['TESTER_CODE', 'TESTER_NAMES', 'TESTER_ALL_UNTIL', 'DEV_OTP', 'NODE_ENV', 'DATABASE_URL', 'JWT_SECRET'];
function env(vars) { KEYS.forEach((k) => { delete process.env[k]; }); Object.assign(process.env, vars); }
function load() {
  ['../lib/dev-otp', '../lib/otp', '../lib/identity-auth'].forEach((m) => { try { delete require.cache[require.resolve(m)]; } catch (_) { /* not loaded */ } });
  return require('../lib/identity-auth');
}
const PARENTS = { P1: { email: 'owner@au-trial.test', user_id: 'autrial', bridge_id: 'B-1' }, P2: { email: 'other@else.test', user_id: 'else', bridge_id: 'B-2' } };
const q = (log) => async (sql, args) => { log.push(sql); if (/FROM identities WHERE identity_id/.test(sql)) return { rows: [PARENTS[args[0]] || {}] }; return { rows: [] }; };
const actor = (parent) => ({ identity_id: 'a1', identity_type: 'actor', parent_entity_id: parent, otp_code: '402917', otp_expires_at: new Date(Date.now() + 3600e3), otp_attempts: 0, pin_hash: null });

(async () => {
  console.log('\nACC-234 · an actor signs in on SIT with the tester code\n');
  env({ NODE_ENV: 'test', DATABASE_URL: LOCALDB, TESTER_CODE: CODE, TESTER_NAMES: 'owner@au-trial.test' });
  let ia = load();
  t('the listed business\'s actor signs in with the tester code', (await ia.verifyCredential(q([]), actor('P1'), { otp: CODE, name: 'auditor@au trial' })).ok === true);
  const miss = await ia.verifyCredential(q([]), actor('P2'), { otp: CODE, name: 'auditor@else' });
  t('an actor of an UNLISTED business is refused like any wrong code', miss.ok === false && miss.reason === 'OTP_WRONG');
  const bad = await ia.verifyCredential(q([]), actor('P1'), { otp: CODE + 'x', name: 'auditor@au trial' });
  t('a wrong code for the listed business is refused', bad.ok === false && bad.reason === 'OTP_WRONG');
  t('the stored (admin-shared) code still works', (await ia.verifyCredential(q([]), actor('P2'), { otp: '402917', name: 'x@else' })).ok === true);
  const log = [];
  await ia.verifyCredential(q(log), { identity_id: 'e1', identity_type: 'entity', email: 'owner@au-trial.test', otp_code: '1', otp_expires_at: new Date(Date.now() + 3600e3), otp_attempts: 0 }, { otp: CODE, name: 'owner@au-trial.test' });
  t('an entity asks no parent (unchanged)', !log.some((s) => /identity_id = \$1/.test(s) && /email, user_id, bridge_id/.test(s)));

  env({ NODE_ENV: 'test', DATABASE_URL: LOCALDB, TESTER_CODE: CODE, TESTER_NAMES: 'owner@au-trial.test' });
  ia = load();
  const seat = (id) => Object.assign(actor('P1'), { identity_id: id });
  for (let n = 0; n < 6; n++) await ia.verifyCredential(q([]), seat('s' + (n % 3)), { otp: 'wrong-' + n, name: 'a@au trial' });
  const sixth = await ia.verifyCredential(q([]), seat('s9'), { otp: CODE, name: 'a@au trial' });
  t('6 wrong guesses over 3 actors of one listed business shut the business: the right code is then refused', sixth.ok === false && sixth.reason === 'OTP_WRONG');
  t('a business with a spent budget still signs in with the stored code', (await ia.verifyCredential(q([]), seat('s8'), { otp: '402917', name: 'a@au trial' })).ok === true);
  env({ NODE_ENV: 'test', DATABASE_URL: LOCALDB, TESTER_NAMES: 'owner@au-trial.test' });
  ia = load();
  t('TESTER_CODE unset → the tester code opens nothing for an actor', (await ia.verifyCredential(q([]), actor('P1'), { otp: CODE, name: 'auditor@au trial' })).ok === false);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
