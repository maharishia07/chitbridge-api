/**
 * tests/installer-token.test.cjs — THE INSTALLER'S ONE-TIME TOKEN (PLT-45, 25 Oct 2026). lib/installer-token through lib/otp.verifyOtp, the ONE verify every door uses.
 * The token makes an installation's first root entity through the ordinary register + verify door. It is fail-closed: both variables set (token 16+ characters), the right handle,
 * and NO registered business active yet. Once the root is active the token is dead whatever .env still says. A refusal looks exactly like a wrong code.
 * On main there is no installer token: the same verify answers "wrong code".
 */
'use strict';
const path = require('path');
const G = require('./support/route-golden.cjs');
const API = G.API;

let activeRegistered = false, readThrows = false;
G.harness({ rows: (s) => {
  if (/FROM identities WHERE identity_type = 'entity' AND status = 'active' AND user_id IS NOT NULL AND user_id NOT LIKE '~%'/.test(s)) {
    if (readThrows) throw new Error('db down');
    return activeRegistered ? [{ '?column?': 1 }] : [];
  }
  return [];
} });
const otp = require(path.join(API, 'lib', 'otp'));

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (extra ? '\n          ' + extra : '')); } };
const TOKEN = 'installer-token-0123456789abcdef';
const row = (patch) => Object.assign({ identity_id: 'id-1', user_id: 'cbau01-root', email: 'ops@au.example.com', bridge_id: 'CBROOT0001', otp_code: '123456', otp_expires_at: new Date(Date.now() + 600000), otp_attempts: 0 }, patch);
const run = async () => ({ rowCount: 1 });
const reset = (env) => { for (const k of ['CB_INSTALLER_TOKEN', 'CB_INSTALLER_HANDLE', 'TESTER_CODE', 'TESTER_NAMES']) delete process.env[k]; Object.assign(process.env, env || {}); activeRegistered = false; readThrows = false; };

(async () => {
  console.log('\n══ INSTALLER TOKEN · fail-closed ══\n');
  reset({ CB_INSTALLER_TOKEN: TOKEN, CB_INSTALLER_HANDLE: 'cbau01-root' });
  t('the token for the installer\'s handle, before any registered business is active, verifies', (await otp.verifyOtp(run, row(), TOKEN)).ok === true);
  t('the handle match ignores case', (await otp.verifyOtp(run, row({ user_id: 'CBAU01-ROOT' }), TOKEN)).ok === true);
  const wrong = await otp.verifyOtp(run, row(), TOKEN + 'x');
  t('…refused as OTP_WRONG with the one sign-in sentence', wrong.ok === false && wrong.reason === 'OTP_WRONG' && wrong.message === otp.SIGNIN_REFUSED_SENTENCE);
  const other = await otp.verifyOtp(run, row({ user_id: 'someone', email: 'x@y.z', bridge_id: 'CBOTHER001' }), TOKEN);
  t('the token does not work for any other entity (its handle only)', other.ok === false && other.reason === 'OTP_WRONG');
  activeRegistered = true;
  const late = await otp.verifyOtp(run, row(), TOKEN);
  t('once ANY registered business is active the token is dead, whatever .env says', late.ok === false && late.reason === 'OTP_WRONG');
  activeRegistered = false; readThrows = true;
  t('a database that cannot be read answers no (fail-closed)', (await otp.verifyOtp(run, row(), TOKEN)).ok === false);
  reset({ CB_INSTALLER_TOKEN: 'short', CB_INSTALLER_HANDLE: 'cbau01-root' });
  t('a token shorter than 16 characters never works', (await otp.verifyOtp(run, row(), 'short')).ok === false);
  reset({ CB_INSTALLER_TOKEN: TOKEN });
  t('no handle configured → no token', (await otp.verifyOtp(run, row(), TOKEN)).ok === false);
  reset({});
  t('nothing configured (every ordinary installation) → no token, behaviour as before', (await otp.verifyOtp(run, row(), TOKEN)).ok === false);
  t('the stored one-time code still works untouched', (await otp.verifyOtp(run, row(), '123456')).ok === true);
  reset({ CB_INSTALLER_TOKEN: TOKEN, CB_INSTALLER_HANDLE: 'cbau01-root' });
  t('the stored code still works with the token configured', (await otp.verifyOtp(run, row(), '123456')).ok === true);

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  console.log('  ' + pass + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
