'use strict';
/**
 * sec106-staff-code-hash.test.cjs — SEC-106: a staff first sign-in code is kept as a KEYED hash, never in plain text.
 *
 * Proves, offline (no DB, no network; the codes are drawn at random in the test, no fixed 6-digit code lives in this file):
 *   1 the issuer stores a 64-hex keyed hash and sets otp_code NULL; the code is in no SQL argument
 *   2 the same code under two people, or under another VAULT_ENC_KEY, gives a different hash; no key = no hash (503), never a plain fallback on a sealed stack
 *   3 verifyOtp: the right code passes, a wrong one is refused and counted, a held hash wins over a plain column, a legacy plain code still passes
 *   4 every issue zeroes the attempt count (also on the reset-PIN and reactivate paths) and puts a code_issued row on the trail without the code
 *   5 no key (sealed too): the code is kept plain, ERROR in the log, sign-in never blocked; a held hash nobody can check is a miss, never a 503
 *   5b before the migration (no column): the code is kept the old way, said in the log, and nothing throws
 *   6 an idempotent answer that carries a code is never recorded, so a replay can never return one (memory store; the durable store shares the branch)
 * Run: node tests/sec106-staff-code-hash.test.cjs
 */
const assert = require('assert'), path = require('path'), crypto = require('crypto');
const API = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-sec106';
const jwt = require('jsonwebtoken');
let pass = 0, queue = Promise.resolve();
const it = (what, fn) => { queue = queue.then(async () => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } }); };

const KEY_A = crypto.randomBytes(32).toString('base64'), KEY_B = crypto.randomBytes(32).toString('base64');
const setKey = (k) => { if (k) process.env.VAULT_ENC_KEY = k; else delete process.env.VAULT_ENC_KEY; };
const events = [], warns = [], errors = [];
let hasHash = true;
const stub = (rel, exports) => { const id = path.join(API, rel); require.cache[require.resolve(id)] = { id, filename: id, loaded: true, exports }; };
stub('db', { query: async () => ({ rows: [] }), withEntity: async (entity, fn) => fn({ query: async (sql, args) => { if (/idempotency_key/.test(sql)) throw Object.assign(new Error('no table'), { code: '42P01' }); /* the durable store is off: the memory store answers */ events.push({ entity, sql, args }); return { rows: [] }; } }), withTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }) });
stub('lib/schema', { hasColumn: async () => hasHash });
stub('lib/logger', { warn: (m) => warns.push(String(m)), info() {}, debug() {}, error: (m) => errors.push(String(m)), critical() {}, fellBack() {} });
const empCode = require(path.join(API, 'lib', 'employee-code'));
const otp = require(path.join(API, 'lib', 'otp'));
const idempotency = require(path.join(API, 'middleware', 'idempotency'));
const ID = crypto.randomUUID(), OTHER = crypto.randomUUID(), SHOP = crypto.randomUUID(), OWNER = crypto.randomUUID();
const recorder = () => { const calls = []; const run = async (sql, args) => { calls.push({ sql, args }); return { rows: [], rowCount: 1 }; }; run.calls = calls; return run; };
const HEX64 = /^[0-9a-f]{64}$/;
const draw = () => String(crypto.randomInt(100000, 1000000));
const other = (code) => String(((Number(code) - 100000 + 1) % 900000) + 100000);

it('the issuer keeps a 64-hex keyed hash and NULL in otp_code; the code is in no SQL argument', async () => {
  setKey(KEY_A); hasHash = true;
  const run = recorder(); const { otp: code, expires } = await empCode.issue(run, ID, { entity_id: SHOP, by: OWNER, channel: 'screen' });
  assert(/^\d{6}$/.test(code)); assert(expires > new Date());
  const c = run.calls[0]; assert(/otp_code = NULL, otp_code_hash = \$1/.test(c.sql), c.sql);
  assert(HEX64.test(c.args[0]), 'stored value is a keyed hash'); assert.notStrictEqual(c.args[0], code);
  assert(!JSON.stringify(run.calls).includes(code), 'the code is in an argument');
  assert.strictEqual(c.args[0], otp.codeHash(ID, code));
});
it('the same code gives a different hash for another person and under another key', () => {
  setKey(KEY_A); const code = draw();
  const mine = otp.codeHash(ID, code);
  assert.notStrictEqual(mine, otp.codeHash(OTHER, code));
  setKey(KEY_B); assert.notStrictEqual(mine, otp.codeHash(ID, code)); setKey(KEY_A);
  assert.strictEqual(mine, otp.codeHash(ID, ' ' + code + ' '), 'typed spaces do not change it');
});
it('verifyOtp: right code passes, wrong code is refused and counted, an expired one says so, a locked one stays locked', async () => {
  setKey(KEY_A); hasHash = true; const run = recorder();
  const { otp: code } = await empCode.issue(recorder(), ID, {});
  const row = { identity_id: ID, otp_code: null, otp_code_hash: otp.codeHash(ID, code), otp_expires_at: new Date(Date.now() + 60000), otp_attempts: 0 };
  assert.strictEqual((await otp.verifyOtp(run, row, code, { names: [] })).ok, true);
  const bad = await otp.verifyOtp(run, row, other(code), { names: [] });
  assert.strictEqual(bad.ok, false); assert.strictEqual(bad.reason, 'OTP_WRONG');
  assert(run.calls.some((c) => /otp_attempts = COALESCE\(otp_attempts, 0\) \+ 1/.test(c.sql)), 'the wrong try is counted');
  const late = await otp.verifyOtp(run, { ...row, otp_expires_at: new Date(Date.now() - 1000) }, code, { names: [] });
  assert.strictEqual(late.reason, 'OTP_EXPIRED');
  assert.strictEqual((await otp.verifyOtp(run, { ...row, otp_attempts: 5 }, code, { names: [] })).reason, 'OTP_LOCKED');
});
it('a held hash wins over a plain column; a legacy plain code (issued before b781) still passes', async () => {
  setKey(KEY_A); const run = recorder(); const real = draw(), old = other(real);
  const future = new Date(Date.now() + 60000);
  const both = { identity_id: ID, otp_code: old, otp_code_hash: otp.codeHash(ID, real), otp_expires_at: future, otp_attempts: 0 };
  assert.strictEqual((await otp.verifyOtp(run, both, real, { names: [] })).ok, true);
  assert.strictEqual((await otp.verifyOtp(run, both, old, { names: [] })).ok, false, 'the plain value is ignored once a hash is held');
  const legacy = { identity_id: ID, otp_code: old, otp_code_hash: null, otp_expires_at: future, otp_attempts: 0 };
  assert.strictEqual((await otp.verifyOtp(run, legacy, old, { names: [] })).ok, true);
});
it('a held hash with no key to check it: no 503, a not-matched result, the error logged; a plain held code still verifies with no key', async () => {
  setKey(KEY_A); const code = draw(); errors.length = 0;
  const row = { identity_id: ID, otp_code_hash: otp.codeHash(ID, code), otp_expires_at: new Date(Date.now() + 60000), otp_attempts: 0 };
  setKey(null);
  const r = await otp.verifyOtp(recorder(), row, code, { names: [] });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'OTP_WRONG'); assert.strictEqual(r.status, 400, 'a sign-in answer, not a 503');
  assert(errors.some((e) => /cannot be checked/.test(e)), 'logged at ERROR'); assert(!errors.join(' ').includes(code));
  const plain = { identity_id: ID, otp_code: code, otp_expires_at: new Date(Date.now() + 60000), otp_attempts: 0 };
  assert.strictEqual((await otp.verifyOtp(recorder(), plain, code, { names: [] })).ok, true, 'a plain code verifies with no key');
  const idAuth = require(path.join(API, 'lib', 'identity-auth'));
  assert.strictEqual(idAuth.holdsLiveCode(row), false, 'so the next ask makes a fresh code instead of keeping one nobody can check');
  setKey(KEY_A);
});
it('every issue zeroes the attempts and the PIN reset / reactivate fragments ride the same statement', async () => {
  setKey(KEY_A); hasHash = true;
  for (const also of [undefined, 'pin_hash = NULL, pin_set_at = NULL, pin_attempts = 0, pin_locked_at = NULL', "break_status = 'active', deactivated_at = NULL, return_date = NULL"]) {
    const run = recorder(); await empCode.issue(run, ID, { entity_id: SHOP, by: OWNER, also });
    assert.strictEqual(run.calls.length, 1, 'one statement'); assert(/otp_attempts = 0/.test(run.calls[0].sql));
    if (also) assert(run.calls[0].sql.includes(also));
  }
});
it("the owner's issue puts a code_issued row on the trail: channel and expiry, never the code; a sign-in ask writes none", async () => {
  setKey(KEY_A); hasHash = true; events.length = 0;
  const { otp: code } = await empCode.issue(recorder(), ID, { entity_id: SHOP, by: OWNER, channel: 'screen' });
  assert.strictEqual(events.length, 1); const e = events[0];
  assert.strictEqual(e.entity, SHOP); assert(/INSERT INTO access_events/.test(e.sql));
  assert.strictEqual(e.args[2], 'code_issued'); assert.strictEqual(e.args[5], OWNER);
  assert.strictEqual(JSON.parse(e.args[4]).channel, 'screen'); assert(JSON.parse(e.args[4]).expires_at);
  assert(!JSON.stringify(e.args).includes(code));
  events.length = 0; await empCode.issue(recorder(), ID, { ttlMs: 3600000 }); assert.strictEqual(events.length, 0);
});
it('sealed + column + NO key: mayIssue goes ahead, issue writes the plain column (and clears a stale hash), logs an ERROR without the code; before the column: plain, said as a warning', async () => {
  const names = ['NODE_ENV', 'OTP_EMAIL_ENABLED', 'RESEND_API_KEY', 'FROM_EMAIL'];
  const prev = {}; names.forEach((k) => { prev[k] = process.env[k]; });
  Object.assign(process.env, { NODE_ENV: 'production', OTP_EMAIL_ENABLED: 'true', RESEND_API_KEY: 're_test', FROM_EMAIL: 'no-reply@x.test' });
  const reload = () => { for (const m of ['lib/dev-otp', 'lib/employee-code']) delete require.cache[require.resolve(path.join(API, m))]; return require(path.join(API, 'lib', 'employee-code')); };
  const sealed = reload();
  hasHash = true; setKey(null); errors.length = 0;
  assert.strictEqual(await sealed.mayIssue('a@b.co'), null, 'a missing key is not a refusal');
  const noMail = await sealed.mayIssue('');
  assert.strictEqual(noMail.body.code, 'EMPLOYEE_EMAIL_REQUIRED', 'the delivery refusal stays');
  const run = recorder(); const { otp: code } = await sealed.issue(run, ID, { entity_id: SHOP });
  assert(/otp_code = \$1, otp_code_hash = NULL, otp_expires_at/.test(run.calls[0].sql), run.calls[0].sql); assert.strictEqual(run.calls[0].args[0], code);
  assert(errors.some((e) => /VAULT_ENC_KEY is not set: the staff code is kept in plain text until it is/.test(e)), 'ERROR in words'); assert(!errors.join(' ').includes(code));
  hasHash = false; warns.length = 0; const run2 = recorder(); setKey(KEY_A);
  const { otp: code2 } = await sealed.issue(run2, ID, { entity_id: SHOP });
  assert(/otp_code = \$1, otp_expires_at/.test(run2.calls[0].sql) && !/otp_code_hash/.test(run2.calls[0].sql)); assert.strictEqual(run2.calls[0].args[0], code2);
  assert(warns.some((w) => /plain text until b781/.test(w)), 'said in the log');
  assert.strictEqual(await sealed.clearSql(), '');
  names.forEach((k) => { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; });
  reload(); hasHash = true;
});
it('clearSql names the hash column once it exists', async () => {
  const fresh = require(path.join(API, 'lib', 'employee-code')); hasHash = true;
  assert.strictEqual(await fresh.clearSql(), ', otp_code_hash = NULL');
});

/* ── 7 the pre-auth ask cannot be used to reset the guess count ── */
it('a sign-in ask may replace a code only ASK_REMINT_MAX times an hour and never twice inside the cooldown: the next one is refused (the held code is kept, attempts not reset)', async () => {
  const person = crypto.randomUUID(); warns.length = 0;
  for (let n = 0; n < empCode.ASK_REMINT_MAX; n++) {
    assert.strictEqual(await empCode.mayReplaceOnAsk(person), true, 'ask ' + (n + 1) + ' may replace');
    assert.strictEqual(await empCode.mayReplaceOnAsk(person), false, 'a second ask inside the cooldown may not');
    await empCode._askCooldown.resetKey('ask:' + person); /* the cooldown minute passes */
  }
  assert.strictEqual(await empCode.mayReplaceOnAsk(person), false, 'the N+1th in the hour may not, even after the cooldown');
  assert(warns.some((w) => /guesses not reset/.test(w)), 'said in words in the log');
  assert.strictEqual(await empCode.mayReplaceOnAsk(crypto.randomUUID()), true, 'another person is not affected');
});
it('the answer to a refused ask has the same words as a fresh mailed one, and the refusal never touches the row (no SQL)', async () => {
  assert.strictEqual(empCode.askMessage(true, false, null), empCode.askMessage(true, true, { delivered: true }), 'mailed ask: kept and fresh say the same');
  assert.strictEqual(empCode.askMessage(false, false, null), empCode.askMessage(false, true, null), 'no-mail ask: kept and fresh say the same');
  const person = crypto.randomUUID(); await empCode.mayReplaceOnAsk(person);
  const run = recorder(); assert.strictEqual(await empCode.mayReplaceOnAsk(person), false); assert.strictEqual(run.calls.length, 0);
  assert(!/@|d{6}/.test(warns.join(' ')), 'the log line names no e-mail and no code');
});

/* ── 6 the idempotency layer ── */
const send = (key, answer) => {
  const token = jwt.sign({ identity_id: SHOP, identity_type: 'entity', jti: 'j-' + key }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: 600 });
  const req = { id: 'r-' + key, method: 'POST', path: '/api/actors/x/otp', body: { n: key }, headers: { authorization: 'Bearer ' + token, 'idempotency-key': key } };
  const res = { statusCode: 200, headers: {}, locals: {}, status(s) { this.statusCode = s; return this; }, setHeader(k, v) { this.headers[k] = v; }, json(b) { this.body = b; return this; } };
  return new Promise((resolve) => idempotency(req, res, () => { res.status(200).json(answer); setTimeout(() => resolve(res), 10); }));
};
it('carriesCode: an answer with a code in it (show_code, otp, dev_otp) is one; plain answers and tokens are not', () => {
  const c = idempotency._carriesCode;
  for (const body of [{ show_code: 'x' }, { otp: 'x' }, { dev_otp: 'x' }, { message: 'ok', show_code: 'x' }]) assert.strictEqual(c(body), true);
  for (const body of [null, 'x', {}, { id: 1 }, { token: 't' }, { show_code: '' }, { delivery: 'sent' }]) assert.strictEqual(c(body), false);
});
it('an answer that carries a code is not stored, so a replay cannot return it; a plain answer is stored (control)', async () => {
  idempotency._memory.clear();
  const code = draw();
  const first = await send('k-code', { message: 'ok', show_code: code });
  assert.strictEqual(first.body.show_code, code, 'the issuing call itself answers the code');
  assert.strictEqual(idempotency._memory.size(), 0, 'nothing is held for it');
  const again = await send('k-code', { message: 'ok', show_code: code });
  assert.strictEqual(again.headers['X-Idempotent-Replay'], undefined, 'a retry runs again, it is not a replay');
  await send('k-plain', { message: 'ok' });
  assert.strictEqual(idempotency._memory.size(), 1, 'the control: a plain answer IS held');
  idempotency._memory.clear();
});
it('source guard: no staff code written inline in routes/actors.js, both idempotency stores skip a code, the migration has the column and the action', () => {
  const fs = require('fs'); const read = (p) => fs.readFileSync(path.join(API, p), 'utf8');
  const actors = read('routes/actors.js');
  assert(!/otp_code\s*=\s*\$/.test(actors), 'routes/actors.js writes a code inline'); assert(!/empCode\.mint\(\)/.test(actors));
  assert.strictEqual((actors.match(/empCode\.issue\(/g) || []).length, 4, 'create, reset PIN, reset code, reactivate');
  const idem = read('middleware/idempotency.js');
  assert.strictEqual((idem.match(/notSettled\(status\) \|\| carriesCode\(body\)/g) || []).length, 2, 'both stores');
  const sql = read('migrations/b781_staff_code_hash.sql');
  assert(/ADD COLUMN IF NOT EXISTS otp_code_hash varchar\(64\)/.test(sql)); assert(/'code_issued'/.test(sql));
});
queue.then(() => console.log('\n  ' + pass + ' checks'));
