#!/usr/bin/env node
// @type: unit
/**
 * signin-account-budget-one-counter.test.cjs — M1 follow-up (VERIFY-GF-MONEY-SECURITY; NIST SP 800-63B 5.2.2): ONE ATTEMPT COUNTER, NEVER RESET BY AN ASK, across every code and the PIN.
 * ATTACK    5 guesses per code is a per-code limit; a guesser who lets a code expire, asks for another, and alternates the code door and the PIN door got a fresh budget each time.
 * RULE      lib/account-budget.js counts consecutive wrong secrets per account (30 inside 24 h): an ask never touches it, a right secret clears it, a spent budget refuses even the right secret;
 *           with the column absent (b900 not run) the sign-in behaves as before; with the column present and the read failing it refuses (fail closed).
 * RUN       node tests/signin-account-budget-one-counter.test.cjs
 * CARD      18-identity-sign-in-and-access/sign-in
 */
'use strict';
const path = require('path');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const say = console.log.bind(console);
['log', 'warn', 'info', 'error'].forEach((k) => { console[k] = () => {}; });
const ROOT = path.join(__dirname, '..');
const ID = '55555555-5555-4555-8555-555555555555';
let row, columnThere = true, readBreaks = false;
const stub = (rel, exports) => { const p = require.resolve(path.join(ROOT, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub('db', { query: (...a) => db(...a), withEntity: async (i, f) => f({ query: db }), withTransaction: async (f) => f({ query: db }), pool: {} });
stub('lib/schema', { hasColumn: async (t, c) => (c === 'auth_fail_count' ? columnThere : true), has: async () => true, columns: async () => [], table: async () => ({}) });
async function db(sql, args) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (/^SELECT auth_fail_count, auth_fail_at FROM identities WHERE identity_id = \$1$/.test(s)) {
    if (readBreaks) throw new Error('read failed');
    return { rows: [{ auth_fail_count: row.auth_fail_count, auth_fail_at: row.auth_fail_at }], rowCount: 1 };
  }
  if (/^UPDATE identities SET auth_fail_count = CASE WHEN auth_fail_at IS NULL OR auth_fail_at < NOW\(\) - INTERVAL '24 hours' THEN 1 ELSE COALESCE\(auth_fail_count, 0\) \+ 1 END, auth_fail_at = NOW\(\) WHERE identity_id = \$1$/.test(s)) {
    const stale = !row.auth_fail_at || row.auth_fail_at < new Date(Date.now() - 24 * 3600 * 1000);
    row.auth_fail_count = stale ? 1 : (row.auth_fail_count || 0) + 1; row.auth_fail_at = new Date();
    return { rows: [], rowCount: 1 };
  }
  if (/^UPDATE identities SET auth_fail_count = 0, auth_fail_at = NULL WHERE identity_id = \$1 AND auth_fail_count <> 0$/.test(s)) { row.auth_fail_count = 0; row.auth_fail_at = null; return { rows: [], rowCount: 1 }; }
  if (/^UPDATE identities SET otp_attempts = COALESCE\(otp_attempts, 0\) \+ 1 WHERE identity_id = \$1$/.test(s)) { row.otp_attempts = (row.otp_attempts || 0) + 1; return { rows: [], rowCount: 1 }; }
  if (/^UPDATE identities SET otp_code = NULL.*RETURNING identity_id$/.test(s)) { if ((row.otp_attempts || 0) >= args[1] && !args[2]) return { rows: [], rowCount: 0 }; row.otp_code = null; row.otp_attempts = 0; return { rows: [{ identity_id: ID }], rowCount: 1 }; }
  if (/^UPDATE identities SET otp_code = \$1, otp_expires_at = \$2, otp_attempts = CASE/.test(s)) { /* an ask: new code, count kept while the old code is live */
    const live = row.otp_expires_at && row.otp_expires_at > new Date();
    row.otp_attempts = live ? row.otp_attempts || 0 : 0; row.otp_code = args[0]; row.otp_expires_at = args[1];
    return { rows: [], rowCount: 1 };
  }
  throw new Error('stand-in db: unknown statement ' + s.slice(0, 110));
}
const A = require(path.join(ROOT, 'lib', 'identity-auth'));
const budget = require(path.join(ROOT, 'lib', 'account-budget'));
let bad = 0;
const t = (name, ok, extra) => { say((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : ' ' + (extra || ''))); if (!ok) bad++; };
const fresh = () => { row = { identity_id: ID, identity_type: 'entity', status: 'active', pin_hash: null, otp_code: '123456', otp_expires_at: new Date(Date.now() + 600000), otp_attempts: 0, auth_fail_count: 0, auth_fail_at: null }; };
const typed = (otp) => A.verifyCredential(db, { ...row }, { otp });

(async () => {
  fresh();
  let weighed = 0, last;
  for (let round = 0; round < 40; round++) { // each round the code EXPIRES and a new one is asked for: the per-code budget alone would start again every time
    row.otp_expires_at = new Date(Date.now() - 1000);
    await db('UPDATE identities SET otp_code = $1, otp_expires_at = $2, otp_attempts = CASE WHEN otp_expires_at IS NULL OR otp_expires_at < NOW() THEN 0 ELSE COALESCE(otp_attempts, 0) END WHERE identity_id = $3', ['999999', new Date(Date.now() + 600000), ID]);
    for (let g = 0; g < 5; g++) { last = await typed('000000'); if (last.reason !== 'ACCOUNT_BUDGET' && last.reason !== 'OTP_LOCKED') weighed++; }
  }
  t('one attempt counter, never reset by an ask: 40 asks x 5 guesses weigh at most ' + budget.MAX_ACCOUNT_FAILS + ' wrong secrets (counter ' + row.auth_fail_count + ', weighed ' + weighed + ')', row.auth_fail_count === budget.MAX_ACCOUNT_FAILS && weighed <= budget.MAX_ACCOUNT_FAILS, String(row.auth_fail_count));
  row.otp_attempts = 0; row.otp_code = '424242'; row.otp_expires_at = new Date(Date.now() + 600000);
  const right = await typed('424242');
  t('a spent account budget refuses even the right code (ACCOUNT_BUDGET, the one refusal sentence)', !right.ok && right.reason === 'ACCOUNT_BUDGET' && right.message === require(path.join(ROOT, 'lib', 'otp')).SIGNIN_REFUSED_SENTENCE, JSON.stringify(right));
  const before = row.auth_fail_count;
  await typed('111111');
  t('a refused try is not counted again (the budget does not climb while locked)', row.auth_fail_count === before);
  row.auth_fail_at = new Date(Date.now() - 25 * 3600 * 1000);
  const after = await typed('424242');
  t('after the window the budget has decayed: the right code signs in and clears the count', after.ok === true && row.auth_fail_count === 0, JSON.stringify(after) + ' ' + row.auth_fail_count);

  fresh();
  for (let i = 0; i < 3; i++) await typed('000000');
  t('wrong codes count one each on the account', row.auth_fail_count === 3, String(row.auth_fail_count));
  const ok = await typed('123456');
  t('a right secret of the person clears the account count', ok.ok === true && row.auth_fail_count === 0);

  fresh(); columnThere = false; row.auth_fail_count = 99;
  const old = await typed('123456');
  t('column absent (b900 not run): the sign-in works as before and reads no budget', old.ok === true);
  const miss = (fresh(), await typed('000000'));
  t('column absent: a wrong code is still weighed by the per-code limit only', !miss.ok && miss.reason === 'OTP_WRONG' && row.auth_fail_count === 0);
  columnThere = true;

  fresh(); readBreaks = true;
  const closed = await typed('123456');
  t('column present and the budget read fails: refused (fail closed), never waved through', !closed.ok && closed.reason === 'ACCOUNT_BUDGET', JSON.stringify(closed));
  readBreaks = false;

  fresh(); row.auth_fail_count = budget.MAX_ACCOUNT_FAILS; row.auth_fail_at = new Date();
  await budget.clear(db, ID);
  t('the owner\'s reset (budget.clear) lifts a spent budget', row.auth_fail_count === 0);
  say(bad ? bad + ' failed' : 'all passed');
  process.exit(bad ? 1 : 0);
})();
