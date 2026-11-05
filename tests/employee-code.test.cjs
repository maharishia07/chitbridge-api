'use strict';
/**
 * employee-code.test.cjs — M02: an employee's first code is e-mailed; a sealed env needs Resend.
 * Invariants: a sealed env never shows a code in a response · a code is single-use and valid 24 h.
 * The sender is stubbed — no real e-mail, no DB, no network. Run: node tests/employee-code.test.cjs
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const { verifyOtp } = require('../lib/otp');
const KEYS = ['NODE_ENV', 'DEV_OTP', 'OTP_EMAIL_ENABLED', 'RESEND_API_KEY', 'FROM_EMAIL', 'DEV_OTP_IN_RESPONSE', 'DATABASE_URL'];
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
it('R112 · sealed + no e-mail (blank, null or malformed): never refused, even with no sender — the owner is shown the code', () => {
  for (const e of [SEALED, { NODE_ENV: 'production' }]) { env(e); const ec = load(); for (const to of ['', null, '   ', 'not-an-email']) assert.strictEqual(ec.refusal(to), null); }
});
it('R112 · sealed + an e-mail + no sender stays refused 503 (no mail-failed fallback to the screen)', () => {
  env({ NODE_ENV: 'production' }); const r = load().refusal('kumar@shop.test');
  assert.strictEqual(r.status, 503); assert.strictEqual(r.body.code, 'EMAIL_DELIVERY_NOT_CONFIGURED');
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
it('SEC2 · unsealed but not a local stack: no code in the answer either (no e-mail: delivery none + what to do)', async () => {
  env({ NODE_ENV: 'development', DATABASE_URL: 'postgres://u:p@db.example.com:5432/x' }); const ec = load(); const send = stub();
  assert.strictEqual(ec.refusal(''), null);
  const body = await ec.deliver({ to: '', name: 'A', otp: '482913', send });
  assert.strictEqual(send.calls.length, 0); assert.strictEqual(body.delivery, 'none'); assert(!('otp' in body));
  assert(!JSON.stringify(body).includes('482913'));
  assert(/No e-mail on file.*Add their e-mail/.test(body.delivery_note));
  const b2 = await ec.deliver({ to: 'a@b.co', name: 'A', otp: '482913', send });
  assert.strictEqual(b2.delivery, 'sent'); assert(!JSON.stringify(b2).includes('482913'));
});
it('SEC2 · the one door: a local stack that opted in (DEV_OTP + DEV_OTP_IN_RESPONSE) still shows it', async () => {
  env({ NODE_ENV: 'development', DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/x', DEV_OTP: '1', DEV_OTP_IN_RESPONSE: 'true' }); const ec = load();
  assert.strictEqual((await ec.deliver({ to: '', name: 'A', otp: '482913', send: stub() })).otp, '482913');
  env({ NODE_ENV: 'development', DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/x', DEV_OTP: '1' }); const ec2 = load();
  assert(!('otp' in (await ec2.deliver({ to: '', name: 'A', otp: '482913', send: stub() }))), 'no opt-in, yet the code was shown');
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
  /* M06: actor login answers through the one engine (lib/identity-auth.js verifyCredential) — that is where the code is cleared */
  assert(/SET otp_code = NULL\$\{await empCode\.clearSql\(\)\}, otp_expires_at = NULL, otp_attempts = 0/.test(read('lib', 'identity-auth.js')), 'actor login no longer clears the code');
  assert(/signin\.handlers\.verify/.test(read('routes', 'actors.js')), 'actor login is no longer the shared verify handler');
});
it('source guard: all four code-issuing routes use employee-code; no 7-day code; no bare otp in a response', () => {
  const src = read('routes', 'actors.js');
  for (const fn of ['issue', 'mayIssue', 'deliver']) assert.strictEqual((src.match(new RegExp('empCode\\.' + fn + '\\(', 'g')) || []).length, 4, fn);
  assert(!/7 \* 24 \* 60 \* 60 \* 1000/.test(src), 'a 7-day code is still issued');
  /* iter1: the formatter puts each SQL parameter on its own line, so `otp,` followed by `otp_expires,` is the INSERT's parameter list, not a response */
  assert(!/^\s+otp,\r?\n(?!\s+otp_expires,)/m.test(src), 'a bare `otp,` is still in a response');
  const li = src.split('\n').filter((l) => /login_instruction:/.test(l)).join('\n');
  assert(li && !/\botp\b|OTP:/.test(li), 'SEC2: login_instruction prints the code');
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

/* ── R112 · a worker with no e-mail: the code is SHOWN to the owner, once, for 30 minutes ── */
it('R112 · deliver({ show }) with no e-mail answers show_code, 30 minutes, expires_at, delivery shown; nothing is e-mailed', async () => {
  env(SEALED); const ec = load(); const send = stub(); const { otp, expires } = ec.mint(ec.SHOW_TTL_MS);
  const body = await ec.deliver({ to: '', name: 'Asha Devi', otp, send, show: true, expires });
  assert.strictEqual(body.show_code, otp); assert.strictEqual(body.expires_in, '30 minutes'); assert.strictEqual(body.delivery, 'shown');
  assert.strictEqual(body.expires_at, expires.toISOString()); assert.strictEqual(send.calls.length, 0); assert(!('otp' in body) && !('dev_otp' in body));
});
it('R112 · a person with an e-mail gets no show_code even when the route asks to show; a call that does not ask shows nothing', async () => {
  env(SEALED); const ec = load(); const { otp } = ec.mint();
  const mailed = await ec.deliver({ to: 'asha@shop.test', name: 'Asha', otp, send: stub(), show: true });
  assert(!('show_code' in mailed) && mailed.delivery === 'sent' && !JSON.stringify(mailed).includes(otp));
  const quiet = await ec.deliver({ to: '', name: 'Asha', otp, send: stub() });
  assert(!('show_code' in quiet) && !JSON.stringify(quiet).includes(otp), 'reactivate, a list or a GET never shows');
});
it('R112 · the shown answer is one the idempotency store refuses to record (a replay can never return it)', async () => {
  env(SEALED); const ec = load(); const { otp } = ec.mint();
  const body = await ec.deliver({ to: '', name: 'Asha', otp, send: stub(), show: true });
  const idem = require('../middleware/idempotency');
  assert(idem._carriesCode(body) === true, 'show_code must mark the answer as unrecordable');
});
it('R112 · issue(): a screen code lives 30 minutes, a mailed one 24 hours; the one writer, in the row', async () => {
  env({ NODE_ENV: 'test' }); const ec = load(); const rows = [];
  const run = async (sql, args) => { rows.push({ sql, args }); };
  const screen = await ec.issue(run, 'p1', { channel: 'screen' }); const mail = await ec.issue(run, 'p1', { channel: 'email' });
  const min = (d) => Math.round((d.getTime() - Date.now()) / 60000);
  assert.strictEqual(min(screen.expires), 30); assert.strictEqual(min(mail.expires), 24 * 60);
  assert(rows.every((r) => /otp_attempts = 0/.test(r.sql)), 'every issue zeroes the guess count');
});
it('R112 · the issue limiter: five codes per person in the window pass, the sixth is 429 in words; another person is unaffected', async () => {
  env({ NODE_ENV: 'test' }); const ec = load(); ec._resetAsk();
  const who = { entity_id: 'shop-1', identity_id: 'p1' };
  for (let n = 0; n < ec.ISSUE_MAX; n++) assert.strictEqual(await ec.mayIssue('', who), null);
  const six = await ec.mayIssue('', who);
  assert.strictEqual(six.status, 429); assert.strictEqual(six.body.code, 'CODE_ISSUE_LIMIT'); assert(/minutes/.test(six.body.message) && !/p1|shop-1/.test(six.body.message), 'in words, no caller value echoed');
  assert.strictEqual(await ec.mayIssue('', { entity_id: 'shop-1', identity_id: 'p2' }), null);
  assert.strictEqual(await ec.mayIssue('', { entity_id: 'shop-2', identity_id: 'p1' }), null);
  ec._resetAsk();
});
it('R112 · the shown code is never logged and routes/actors.js passes show only on create, reset PIN and new code', () => {
  const a = read('routes', 'actors.js');
  assert.strictEqual((a.match(/show: true/g) || []).length, 3, 'three issuing doors show; reactivate does not');
  const lib = read('lib', 'employee-code.js');
  assert(!lib.split(String.fromCharCode(10)).some((l) => l.includes('log.') && l.includes('show_code')), 'show_code is never logged');
});

queue.then(() => { KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); console.log(pass + ' checks'); });
