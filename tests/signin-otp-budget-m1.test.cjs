#!/usr/bin/env node
// @type: unit
/**
 * signin-otp-budget-m1.test.cjs — M1 (VERIFY-GF-MONEY-SECURITY): asking for a code again must not give back the guesses.
 * ATTACK    an attacker who knows an owner's address asks, guesses 5, asks again (a new random code, counter zeroed), guesses 5 more ... ~450k guesses break a 6-digit code.
 * RULE      both pre-auth writers (owner door lib/signin-code.js storeCode, customer ask door lib/identity-auth.js issueOtp) keep otp_attempts while the old code is unexpired
 *           (the lib/otp.js issueShopperOtp CASE); the count is the DB-kept budget of the code window (5 per live code, however many asks); verifyOtp then refuses.
 * RUN       node tests/signin-otp-budget-m1.test.cjs
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
const ID = '44444444-4444-4444-8444-444444444444';
const row = { identity_id: ID, otp_code: null, otp_expires_at: null, otp_attempts: 0 };
const KEEP = /otp_attempts = CASE WHEN otp_expires_at IS NULL OR otp_expires_at < NOW\(\) THEN 0 ELSE COALESCE\(otp_attempts, 0\) END/;
const issueSql = [];
/* a stand-in database that evaluates exactly the two statements involved, with Postgres' rule that the right side reads the OLD row */
const db = async (sql, args) => {
  const s = String(sql).replace(/\s+/g, ' ');
  if (/^UPDATE identities SET otp_code = \$1, otp_expires_at = \$2, /.test(s)) {
    issueSql.push(s);
    const keep = KEEP.test(s);
    const oldLive = row.otp_expires_at && row.otp_expires_at > new Date();
    row.otp_attempts = keep ? (oldLive ? row.otp_attempts || 0 : 0) : /otp_attempts = 0/.test(s) ? 0 : row.otp_attempts;
    row.otp_code = args[0]; row.otp_expires_at = args[1];
    return { rows: [], rowCount: 1 };
  }
  if (/^UPDATE identities SET otp_attempts = COALESCE\(otp_attempts, 0\) \+ 1/.test(s)) { row.otp_attempts = (row.otp_attempts || 0) + 1; return { rows: [], rowCount: 1 }; }
  throw new Error('stand-in db: unknown statement ' + s.slice(0, 100));
};
const dbPath = require.resolve(path.join(ROOT, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: db, withTransaction: async (f) => f({ query: db }), withEntity: async (i, f) => f({ query: db }) } };
const signinCode = require(path.join(ROOT, 'lib', 'signin-code'));
const identityAuth = require(path.join(ROOT, 'lib', 'identity-auth'));
const { verifyOtp, MAX_OTP_ATTEMPTS } = require(path.join(ROOT, 'lib', 'otp'));
let bad = 0;
const t = (name, ok, extra) => { say((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : ' ' + (extra || ''))); if (!ok) bad++; };

(async () => {
  for (const [door, ask] of [['owner door (signin-code storeCode)', () => signinCode.storeCode(ID)], ['customer ask door (identity-auth issueOtp)', () => identityAuth.issueOtp(db, { identity_id: ID }, null, 'customer')]]) {
    Object.assign(row, { otp_code: null, otp_expires_at: null, otp_attempts: 0 });
    let opened = 0, guesses = 0, tried = 0;
    for (let round = 0; round < 50; round++) { // the attacker asks, then guesses until refused
      const code = await ask();
      for (let g = 0; g < 6; g++) {
        const r = await verifyOtp(db, Object.assign({}, row), '000000' === code ? '111111' : '000000');
        guesses++;
        if (r.ok) opened++;
        if (r.counted === true) tried++; // a guess the door actually weighed against a code
        if (r.reason === 'OTP_LOCKED' && r.counted !== true) break;
      }
    }
    const counted = row.otp_attempts;
    t(door + ': 50 asks x 6 guesses: only ' + MAX_OTP_ATTEMPTS + ' are ever weighed (weighed ' + tried + ', counter ' + counted + ')', tried === MAX_OTP_ATTEMPTS && counted === MAX_OTP_ATTEMPTS);
    const after = await verifyOtp(db, Object.assign({}, row), row.otp_code);
    t(door + ': after the budget is spent even the right code is refused until it expires (OTP_LOCKED)', !after.ok && after.reason === 'OTP_LOCKED', JSON.stringify(after));
    row.otp_expires_at = new Date(Date.now() - 1000); // the window ends
    await ask();
    t(door + ': once the old code has expired a new ask starts a fresh budget (0)', row.otp_attempts === 0, String(row.otp_attempts));
    t(door + ': the writer states the keep rule (no bare otp_attempts = 0)', issueSql.length > 0 && issueSql.every((s) => KEEP.test(s)));
    issueSql.length = 0;
  }
  say(bad ? bad + ' failed' : 'all passed');
  process.exit(bad ? 1 : 0);
})();
