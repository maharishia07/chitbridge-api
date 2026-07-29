'use strict';
// Regression — the OTP posture (security review, 2026-07-29).
//
// The finding was LIVE on production: POST /api/catalogue/:shop/order/start returned {"dev_otp":"123123"} to an
// unauthenticated caller for ANY email — takeover of any storefront customer. Two defects allowed it:
//   (a) lib/notify.js said production meant NODE_ENV === 'production' while server.js sealed on
//       ['production','uat','staging','live'] — so NODE_ENV=uat would block DEV_OTP at boot while notify.js kept
//       leaking the code. A half-seal that looks sealed.
//   (b) routes/actors.js gated exposure on process.env.DEV_OTP alone, with NO environment check at all.
// These assertions exist so neither can come back.
// Run:  node tests/dev-otp.test.js
const assert = require('node:assert');
const path = require('node:path');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log('  \x1b[32mok\x1b[0m  ' + name); pass++; } catch (e) { console.log('  \x1b[31mXX\x1b[0m  ' + name + ' — ' + e.message); fail++; } };

// fresh module per case — the module reads env at call time, but be explicit
const load = (env) => {
  const p = require.resolve('../lib/dev-otp.js');
  delete require.cache[p];
  const saved = { ...process.env };
  Object.assign(process.env, env);
  const m = require(p);
  // snapshot the answers while the env is applied, then restore
  const out = { isSealed: m.isSealed(), armed: m.armed(), mayExpose: m.mayExposeOtp(),
                entity: m.fixedOtp('entity'), customer: m.fixedOtp('customer'), connector: m.fixedOtp('connector'),
                errors: m.otpPostureErrors(), SEALED_ENVS: m.SEALED_ENVS };
  process.env = saved;
  return out;
};

// ── the three codes are distinct, so a test tells you WHICH flow issued the code ──
t('dev: three DISTINCT fixed codes — entity 123456 · customer 123123 · connector 654321', () => {
  const d = load({ NODE_ENV: 'development', DEV_OTP: '123456' });
  assert.strictEqual(d.entity, '123456');
  assert.strictEqual(d.customer, '123123');
  assert.strictEqual(d.connector, '654321');
  assert.strictEqual(new Set([d.entity, d.customer, d.connector]).size, 3, 'they must differ or they identify nothing');
});
t('dev: one switch disarms all three', () => {
  const d = load({ NODE_ENV: 'development', DEV_OTP: '' });
  assert.strictEqual(d.armed, false);
  assert.strictEqual(d.entity, null); assert.strictEqual(d.customer, null); assert.strictEqual(d.connector, null);
  assert.strictEqual(d.mayExpose, false, 'no fixed codes ⇒ nothing to expose');
});
t('dev: each code is overridable by its own env var', () => {
  const d = load({ NODE_ENV: 'development', DEV_OTP: '111111', DEV_OTP_CUSTOMER: '222222', DEV_OTP_CONNECTOR: '333333' });
  assert.strictEqual(d.entity, '111111');
  assert.strictEqual(d.customer, '222222');
  assert.strictEqual(d.connector, '333333');
});

// ── THE FIX for defect (a): one definition of sealed, and it covers every sealed name ──
t('every sealed env name blocks exposure — not just "production"', () => {
  for (const e of ['production', 'uat', 'staging', 'live', 'prod']) {
    const d = load({ NODE_ENV: e, DEV_OTP: '123456' });
    assert.strictEqual(d.isSealed, true, e + ' must be sealed');
    assert.strictEqual(d.mayExpose, false, e + ' must never echo an OTP');
    assert.strictEqual(d.customer, null, e + ' must not issue a FIXED customer code');
  }
});
t('NODE_ENV is trimmed — a leading space must not defeat the seal', () => {
  const d = load({ NODE_ENV: '  production ', DEV_OTP: '123456' });
  assert.strictEqual(d.isSealed, true, 'production has been observed carrying a leading space in real deployments');
  assert.strictEqual(d.mayExpose, false);
});
t('a sealed env NEVER issues a fixed code, even if DEV_OTP survived (defence behind the boot guard)', () => {
  const d = load({ NODE_ENV: 'uat', DEV_OTP: '123456' });
  assert.strictEqual(d.entity, null);
  assert.strictEqual(d.customer, null);
  assert.strictEqual(d.connector, null);
});

// ── THE FIX for defect (b): exposure is never gated on the raw env var ──
t('dev + armed is the ONLY state that may echo a code', () => {
  assert.strictEqual(load({ NODE_ENV: 'development', DEV_OTP: '123456' }).mayExpose, true);
  assert.strictEqual(load({ NODE_ENV: 'production',  DEV_OTP: '123456' }).mayExpose, false);
  assert.strictEqual(load({ NODE_ENV: 'development', DEV_OTP: '' }).mayExpose, false);
});

// ── the boot guard: you cannot HALF-seal ──
t('boot: sealed + DEV_OTP still set → fatal', () => {
  const d = load({ NODE_ENV: 'production', DEV_OTP: '123456', OTP_EMAIL_ENABLED: 'true' });
  assert.ok(d.errors.some((e) => /DEV_OTP is set/.test(e)), JSON.stringify(d.errors));
});
t('boot: sealed without proven OTP delivery → fatal (else codes silently fall back to the dev branch)', () => {
  const d = load({ NODE_ENV: 'production', DEV_OTP: '', OTP_EMAIL_ENABLED: '' });
  assert.ok(d.errors.some((e) => /OTP_EMAIL_ENABLED/.test(e)), JSON.stringify(d.errors));
});
t('boot: a correctly sealed environment starts cleanly', () => {
  const d = load({ NODE_ENV: 'production', DEV_OTP: '', OTP_EMAIL_ENABLED: 'true' });
  assert.deepStrictEqual(d.errors, []);
});
t('boot: dev is never blocked — we are still developing', () => {
  assert.deepStrictEqual(load({ NODE_ENV: 'development', DEV_OTP: '123456' }).errors, []);
});

// ── no route may gate exposure on the raw env var again ──
t('no route gates dev_otp on process.env.DEV_OTP directly', () => {
  const fs = require('node:fs');
  const dir = path.join(__dirname, '..', 'routes');
  const offenders = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/dev_otp/.test(line) && /process\.env\.DEV_OTP/.test(line)) offenders.push(`${f}:${i + 1}`);
    });
  }
  assert.deepStrictEqual(offenders, [], 'gate on devOtp.mayExposeOtp() instead — found: ' + offenders.join(', '));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
