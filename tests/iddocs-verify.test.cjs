'use strict';
/**
 * iddocs-verify.test.cjs — M18: a phone / e-mail identity document is verified by a code.
 * Invariant: an unverified contact is never used for recovery. Senders are stubbed — no DB, no network.
 * Run: node tests/iddocs-verify.test.cjs
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const KEYS = ['NODE_ENV', 'DEV_OTP', 'OTP_EMAIL_ENABLED', 'RESEND_API_KEY', 'FROM_EMAIL', 'DEV_OTP_IN_RESPONSE'];
function env(o) { KEYS.forEach((k) => delete process.env[k]); Object.assign(process.env, o); }
function load() { for (const m of ['../lib/dev-otp', '../lib/otp', '../lib/iddoc-verify']) delete require.cache[require.resolve(m)]; return require('../lib/iddoc-verify'); }
const SEALED = { NODE_ENV: 'production', OTP_EMAIL_ENABLED: 'true', RESEND_API_KEY: 're_test', FROM_EMAIL: 'no-reply@x.test' };
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, queue = Promise.resolve();
const it = (what, fn) => { queue = queue.then(async () => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } }); };

// One in-memory row standing in for identity_documents.
function row(scheme, value) {
  const r = { identity_id: 'I1', scheme, value, status: 'pending', verified_at: null, verified_by: null, verification_ref: null };
  r.store = { save: async (ref) => { r.verification_ref = ref; }, verified: async (by) => { r.status = 'verified'; r.verified_at = '2026-10-07T00:00:00Z'; r.verified_by = by; r.verification_ref = null; return r.verified_at; } };
  return r;
}
const sender = (delivered = true) => { const calls = []; const f = async (channel, to, code) => { calls.push({ channel, to, code }); return { delivered }; }; f.calls = calls; return f; };
const start = (iv, r, send, now) => iv.start({ doc: r, store: r.store, send, now });
const confirm = (iv, r, code, now) => iv.confirm({ doc: r, code, store: r.store, now });

it('e-mail: code sent -> right code -> verified:true with verified_at and verified_by otp:email', async () => {
  env(SEALED); const iv = load(), r = row('EMAIL', 'kumar@shop.test'), s = sender();
  const a = await start(iv, r, s);
  assert.strictEqual(a.status, 200); assert.strictEqual(s.calls[0].channel, 'email'); assert.strictEqual(s.calls[0].to, 'kumar@shop.test');
  assert(!('dev_otp' in a.body) && !JSON.stringify(a.body).includes(s.calls[0].code), 'sealed body must not show the code');
  assert.strictEqual(r.status, 'pending');
  const b = await confirm(iv, r, s.calls[0].code);
  assert.strictEqual(b.status, 200); assert.strictEqual(b.body.verified, true); assert(b.body.verified_at);
  assert.strictEqual(r.status, 'verified'); assert.strictEqual(r.verified_by, 'otp:email'); assert.strictEqual(r.verification_ref, null);
});
it('phone: code goes to the phone channel; verified_by otp:phone', async () => {
  env({ NODE_ENV: 'development' }); const iv = load(), r = row('PHONE', '+919800000001'), s = sender();
  assert.strictEqual((await start(iv, r, s)).status, 200); assert.strictEqual(s.calls[0].channel, 'phone');
  const b = await confirm(iv, r, s.calls[0].code); assert.strictEqual(b.body.verified, true); assert.strictEqual(r.verified_by, 'otp:phone');
});
it('the stored counterfoil is a hash and fits varchar(128)', async () => {
  env(SEALED); const iv = load(), r = row('EMAIL', 'a@b.co'), s = sender(); await start(iv, r, s);
  assert(/^otp:[0-9a-f]{64}:\d+:0$/.test(r.verification_ref)); assert(r.verification_ref.length <= 128);
});
it('wrong x5 -> locked (429); the right code is then refused too; a fresh code unlocks', async () => {
  env(SEALED); const iv = load(), r = row('EMAIL', 'a@b.co'), s = sender(); await start(iv, r, s); const good = s.calls[0].code;
  const bad = good === '000000' ? '111111' : '000000';
  for (let i = 1; i <= 4; i++) { const x = await confirm(iv, r, bad); assert.strictEqual(x.status, 400); assert.strictEqual(x.body.code, 'OTP_WRONG'); }
  const fifth = await confirm(iv, r, bad); assert.strictEqual(fifth.status, 429); assert.strictEqual(fifth.body.code, 'OTP_LOCKED');
  const late = await confirm(iv, r, good); assert.strictEqual(late.status, 429); assert.strictEqual(r.status, 'pending');
  await start(iv, r, s); assert.strictEqual((await confirm(iv, r, s.calls[1].code)).body.verified, true);
});
it('expired code refused (10 min); no code asked for -> IDOC_NO_CODE', async () => {
  env(SEALED); const iv = load(), r = row('EMAIL', 'a@b.co'), s = sender(); const t0 = Date.now(); await start(iv, r, s, () => t0);
  const x = await confirm(iv, r, s.calls[0].code, () => t0 + 11 * 60 * 1000); assert.strictEqual(x.body.code, 'OTP_EXPIRED'); assert.strictEqual(r.status, 'pending');
  assert.strictEqual((await confirm(iv, row('EMAIL', 'a@b.co'), '123456')).body.code, 'IDOC_NO_CODE');
});
it('sealed: phone with no SMS provider -> 503 PHONE_DELIVERY_NOT_CONFIGURED; e-mail with no sender -> 503 EMAIL_DELIVERY_NOT_CONFIGURED; nothing stored', async () => {
  env(SEALED); const iv = load(); const p = row('PHONE', '+919800000001'), e = row('EMAIL', 'a@b.co');
  const a = await start(iv, p, sender(false)), b = await start(iv, e, sender(false));
  assert.strictEqual(a.status, 503); assert.strictEqual(a.body.code, 'PHONE_DELIVERY_NOT_CONFIGURED'); assert.strictEqual(p.verification_ref, null);
  assert.strictEqual(b.status, 503); assert.strictEqual(b.body.code, 'EMAIL_DELIVERY_NOT_CONFIGURED'); assert.strictEqual(e.verification_ref, null);
});
it('only PHONE and EMAIL are confirmed by code (PAN is refused)', async () => {
  env(SEALED); const iv = load(); const x = await start(iv, row('PAN', 'ABCDE1234F'), sender()); assert.strictEqual(x.status, 400); assert.strictEqual(x.body.code, 'IDOC_NOT_CODE_VERIFIED');
});
it('RECOVERY INVARIANT: verifiedContact returns a contact only for a verified, stamped row', async () => {
  env(SEALED); const iv = load(); const dec = (e) => ({ v: e.plain });
  // the fake honours the WHERE clause the helper sends, so a helper that dropped the filter would fail here
  const mk = (status, at) => async (q) => ({ rows: (/status = 'verified'/.test(q) && /verified_at IS NOT NULL/.test(q) && !(status === 'verified' && at)) ? [] : [{ value_enc: JSON.stringify({ plain: 'a@b.co' }) }] });
  assert.strictEqual(await iv.verifiedContact(mk('pending', null), dec, 'I1', 'EMAIL'), null);
  assert.strictEqual(await iv.verifiedContact(mk('verified', null), dec, 'I1', 'EMAIL'), null);
  assert.strictEqual(await iv.verifiedContact(mk('verified', 'now'), dec, 'I1', 'EMAIL'), 'a@b.co');
});
it('RECOVERY INVARIANT: only the document route and the verified helper read identity_documents (no recovery path touches an unverified contact)', () => {
  const hits = [];
  for (const d of ['routes', 'lib', 'middleware', 'src']) {
    const dir = path.join(ROOT, d); if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) if (/\.(js|cjs)$/.test(f) && /identity_documents/.test(read(d + '/' + f))) hits.push(d + '/' + f);
  }
  assert.deepStrictEqual(hits.sort(), ['lib/iddoc-verify.js', 'routes/identity-docs.js']);
});
it('route wiring: GET exposes verified (status + stamp), never selects verification_ref; PUT clears verification; both routes behind auth', () => {
  const s = read('routes/identity-docs.js');
  const get = s.slice(s.indexOf("router.get('/documents'"), s.indexOf('async function resolveSubject'));
  assert(/verified: d\.status === 'verified' && !!d\.verified_at/.test(get)); assert(!/SELECT[^`]*verification_ref/.test(get));
  assert(/verified_at = NULL, verified_by = NULL, verification_ref = NULL/.test(s), 'changing the value clears the verification');
  assert(/router\.post\('\/documents\/:scheme\/code', auth/.test(s) && /router\.post\('\/documents\/:scheme\/verify', auth/.test(s));
});
it('reuses the one OTP engine: generateOTP / otpEqual / MAX_OTP_ATTEMPTS come from lib/otp.js; no second generator', () => {
  const s = read('lib/iddoc-verify.js'); assert(/require\('\.\/otp'\)/.test(s)); assert(!/Math\.random|randomInt/.test(s));
});
queue.then(() => { console.log('  ' + pass + ' checks'); });
