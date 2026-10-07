'use strict';
/**
 * employee-code.test.cjs — M02: an employee's first code is e-mailed; a sealed env needs Resend.
 * Invariants: a sealed env never shows a code in a response · a code is single-use and valid 24 h.
 * The sender is stubbed — no real e-mail, no DB, no network. Run: node tests/employee-code.test.cjs
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const { verifyOtp } = require('../lib/otp');
const KEYS = ['NODE_ENV', 'DEV_OTP', 'OTP_EMAIL_ENABLED', 'RESEND_API_KEY', 'FROM_EMAIL', 'DEV_OTP_IN_RESPONSE'];
const saved = {}; KEYS.forEach((k) => { saved[k] = process.env[k]; });
function env(o) { KEYS.forEach((k) => delete process.env[k]); Object.assign(process.env, o); }
function load() { for (const m of ['../lib/dev-otp', '../lib/employee-code']) delete require.cache[require.resolve(m)]; return require('../lib/employee-code'); }
const SEALED = { NODE_ENV: 'production', OTP_EMAIL_ENABLED: 'true', RESEND_API_KEY: 're_test', FROM_EMAIL: 'no-reply@x.test' };
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, queue = Promise.resolve();
const it = (what, fn) => { queue = queue.then(async () => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } }); };
const stub = () => { const calls = []; const f = async (to, name, otp, opts) => { calls.push({ to, name, otp, opts }); return { delivered: true }; }; f.calls = calls; return f; };

it('sealed + Resend + e-mail: the code is e-mailed; the body has no code, only a masked address', async () => {
  env(SEALED); const ec = load(); const send = stub();
  assert.strictEqual(ec.refusal('kumar@shop.test'), null);
  const { otp } = ec.mint();
  const body = await ec.deliver({ to: 'kumar@shop.test', name: 'Kumar', otp, send });
  assert.strictEqual(send.calls.length, 1); assert.strictEqual(send.calls[0].otp, otp); assert.strictEqual(send.calls[0].opts.ttl, '24 hours');
  assert.strictEqual(body.delivery, 'sent'); assert.strictEqual(body.sent_to, 'k***@shop.test');
  assert(!('otp' in body) && !('dev_otp' in body)); assert(!JSON.stringify(body).includes(otp));
});
it('sealed + no Resend key: refused 503 EMAIL_DELIVERY_NOT_CONFIGURED, no code in the body', () => {
  env({ NODE_ENV: 'production', OTP_EMAIL_ENABLED: 'true' }); const ec = load();
  const r = ec.refusal('kumar@shop.test');
  assert.strictEqual(r.status, 503); assert.strictEqual(r.body.code, 'EMAIL_DELIVERY_NOT_CONFIGURED');
  assert(!/otp|\b\d{6}\b/.test(JSON.stringify(r.body)));
});
it('sealed + OTP_EMAIL_ENABLED off, or FROM_EMAIL missing: refused too', () => {
  env({ ...SEALED, OTP_EMAIL_ENABLED: '' }); assert.strictEqual(load().refusal('a@b.co').body.code, 'EMAIL_DELIVERY_NOT_CONFIGURED');
  env({ ...SEALED, FROM_EMAIL: '' }); assert.strictEqual(load().refusal('a@b.co').status, 503);
});
it('sealed + no employee e-mail: refused 400 EMPLOYEE_EMAIL_REQUIRED (never a code to read out)', () => {
  env(SEALED); const ec = load();
  for (const to of ['', null, 'not-an-email']) { const r = ec.refusal(to); assert.strictEqual(r.status, 400); assert.strictEqual(r.body.code, 'EMPLOYEE_EMAIL_REQUIRED'); }
});
it('every sealed env name never shows a code, even if DEV_OTP / the echo opt-in survived', async () => {
  for (const NODE_ENV of ['production', 'uat', 'staging', 'live', 'prod', ' Production ']) {
    env({ ...SEALED, NODE_ENV, DEV_OTP: '123456', DEV_OTP_IN_RESPONSE: 'true' }); const ec = load();
    const { otp } = ec.mint(); assert.notStrictEqual(otp, '123456', NODE_ENV + ' minted the fixed code');
    const body = await ec.deliver({ to: 'a@b.co', name: 'A', otp, send: stub() });
    assert(!JSON.stringify(body).includes(otp), NODE_ENV + ' showed the code');
  }
});
it('sealed + the sender fails or throws: delivery failed, still no code in the body', async () => {
  env(SEALED); const ec = load();
  for (const send of [async () => ({ delivered: false }), async () => { throw new Error('boom'); }]) {
    const body = await ec.deliver({ to: 'a@b.co', name: 'A', otp: '482913', send });
    assert.strictEqual(body.delivery, 'failed'); assert(!JSON.stringify(body).includes('482913'));
  }
});
it('unsealed dev: the owner still sees the code once (no e-mail: delivery none + the words)', async () => {
  env({ NODE_ENV: 'development' }); const ec = load(); const send = stub();
  assert.strictEqual(ec.refusal(''), null);
  const body = await ec.deliver({ to: '', name: 'A', otp: '482913', send });
  assert.strictEqual(send.calls.length, 0); assert.strictEqual(body.delivery, 'none'); assert.strictEqual(body.otp, '482913');
  assert(/No e-mail on file/.test(body.delivery_note));
  const b2 = await ec.deliver({ to: 'a@b.co', name: 'A', otp: '482913', send });
  assert.strictEqual(b2.delivery, 'sent'); assert.strictEqual(b2.otp, '482913');
});
it('a code is valid 24 h: minted expiry is now + 24 h; inside works, past is refused', async () => {
  env({ NODE_ENV: 'development' }); const ec = load();
  const t0 = Date.now(), { otp, expires } = ec.mint();
  assert(Math.abs(expires.getTime() - (t0 + 86400000)) < 2000); assert.strictEqual(ec.TTL_MS, 86400000);
  const row = (at) => ({ identity_id: 'x', otp_code: otp, otp_expires_at: at, otp_attempts: 0 });
  assert.strictEqual((await verifyOtp(async () => {}, row(expires), otp)).ok, true);
  assert.strictEqual((await verifyOtp(async () => {}, row(new Date(Date.now() - 1000)), otp)).ok, false);
});
it('a code is single-use: the first login clears it, then the same code is refused', async () => {
  env({ NODE_ENV: 'development' }); const ec = load();
  const { otp, expires } = ec.mint(); const row = { identity_id: 'x', otp_code: otp, otp_expires_at: expires, otp_attempts: 0 };
  assert.strictEqual((await verifyOtp(async () => {}, row, otp)).ok, true);
  row.otp_code = null; row.otp_expires_at = null;   // what routes/actors.js login does on success (source-guarded next)
  assert.strictEqual((await verifyOtp(async () => {}, row, otp)).ok, false);
  assert(/SET otp_code = NULL, otp_expires_at = NULL, otp_attempts = 0/.test(read('routes', 'actors.js')), 'actor login no longer clears the code');
});
it('source guard: all four code-issuing routes use employee-code; no 7-day code; no bare otp in a response', () => {
  const src = read('routes', 'actors.js');
  for (const fn of ['mint', 'refusal', 'deliver']) assert.strictEqual((src.match(new RegExp('empCode\\.' + fn + '\\(', 'g')) || []).length, 4, fn);
  assert(!/7 \* 24 \* 60 \* 60 \* 1000/.test(src), 'a 7-day code is still issued');
  assert(!/^\s+otp,$/m.test(src), 'a bare `otp,` is still in a response');
  const li = src.split('\n').filter((l) => /login_instruction/.test(l)).join('\n');
  assert(/isSealed\(\)/.test(li), 'login_instruction prints the code without checking sealed');
});
it('boot guard: a sealed env without RESEND_API_KEY + FROM_EMAIL cannot start; with both it can', () => {
  const dev = () => { delete require.cache[require.resolve('../lib/dev-otp')]; return require('../lib/dev-otp'); };
  env({ NODE_ENV: 'production', OTP_EMAIL_ENABLED: 'true' });
  assert(dev().otpPostureErrors().some((e) => /RESEND_API_KEY/.test(e)));
  env(SEALED); assert.deepStrictEqual(dev().otpPostureErrors(), []);
});
it('notify.sendOtpEmail takes a ttl, so the mail says 24 hours rather than 1 hour', () => {
  const n = read('lib', 'notify.js');
  assert(/opts\.ttl\) \|\| '1 hour'/.test(n) && /expires in \$\{ttl\}/.test(n));
});

queue.then(() => { KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); console.log(pass + ' checks'); });
