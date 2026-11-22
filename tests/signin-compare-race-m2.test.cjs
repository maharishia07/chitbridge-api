#!/usr/bin/env node
// @type: unit
/**
 * signin-compare-race-m2.test.cjs — M2 (VERIFY-GF-MONEY-SECURITY): the lock was checked against a STALE row; a right secret that arrives after parallel wrong ones locked the account got in.
 * ATTACK    N parallel guesses are all read before the lock; the counting is atomic (5 count, the rest are refused) but the COMPARE ran on the stale row, so the one that matched still signed in.
 * RULE      the spend of a right PIN / a right code is a CONDITIONAL UPDATE (... AND pin_locked_at IS NULL / AND otp_attempts < max ... RETURNING): zero rows = refused. A lift of an expired
 *           lock only lifts the lock the request read (AND pin_locked_at = $2), so a relock made meanwhile stays.
 * RUN       node tests/signin-compare-race-m2.test.cjs
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
const ID = '77777777-7777-4777-8777-777777777777';
let row;
const stub = (rel, exports) => { const p = require.resolve(path.join(ROOT, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
async function db(sql, args) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (/^UPDATE identities SET pin_attempts = pin_attempts \+ 1, pin_locked_at = CASE WHEN pin_attempts \+ 1 >= \$2 THEN NOW\(\) ELSE pin_locked_at END WHERE identity_id = \$1 AND pin_locked_at IS NULL RETURNING/.test(s)) {
    if (row.pin_locked_at) return { rows: [], rowCount: 0 };
    row.pin_attempts += 1; if (row.pin_attempts >= args[1]) row.pin_locked_at = new Date();
    return { rows: [{ pin_attempts: row.pin_attempts, pin_locked_at: row.pin_locked_at }], rowCount: 1 };
  }
  if (/^UPDATE identities SET pin_attempts = 0, last_active_at = NOW\(\) WHERE identity_id = \$1 AND pin_locked_at IS NULL RETURNING identity_id$/.test(s)) {
    if (row.pin_locked_at) return { rows: [], rowCount: 0 };
    row.pin_attempts = 0; return { rows: [{ identity_id: ID }], rowCount: 1 };
  }
  if (/^UPDATE identities SET pin_locked_at = NULL WHERE identity_id = \$1 AND pin_locked_at = \$2$/.test(s)) {
    if (row.pin_locked_at && new Date(row.pin_locked_at).getTime() === new Date(args[1]).getTime()) row.pin_locked_at = null;
    return { rows: [], rowCount: 1 };
  }
  if (/^UPDATE identities SET otp_attempts = COALESCE\(otp_attempts, 0\) \+ 1 WHERE identity_id = \$1$/.test(s)) { row.otp_attempts = (row.otp_attempts || 0) + 1; return { rows: [], rowCount: 1 }; }
  if (/^UPDATE identities SET otp_code = NULL.*RETURNING identity_id$/.test(s)) {
    if ((row.otp_attempts || 0) >= args[1] && !args[2]) return { rows: [], rowCount: 0 };
    row.otp_code = null; row.otp_attempts = 0; return { rows: [{ identity_id: ID }], rowCount: 1 };
  }
  throw new Error('stand-in db: unknown statement ' + s.slice(0, 110));
}
stub('db', { query: db, withEntity: async (i, f) => f({ query: db }), withTransaction: async (f) => f({ query: db }), pool: {} });
stub('lib/schema', { hasColumn: async (t, c) => c !== 'auth_fail_count', hasColumns: async () => true, hasTable: async () => true, has: async () => true, columns: async () => [], table: async () => ({}) });
const A = require(path.join(ROOT, 'lib', 'identity-auth'));
let bad = 0;
const t = (name, ok, extra) => { say((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : ' ' + (extra || ''))); if (!ok) bad++; };

(async () => {
  const hash = await A.hashPin('4821');
  row = { identity_id: ID, identity_type: 'actor', pin_hash: hash, pin_attempts: 0, pin_locked_at: null, status: 'active' };
  /* thirty requests all loaded the row BEFORE any lock: they hold the same stale snapshot, and the one right PIN is the last to be decided */
  const stale = { ...row };
  const guesses = Array.from({ length: 30 }, (_, i) => (i === 29 ? '4821' : '0000'));
  const results = [];
  for (const g of guesses) results.push(await A.verifyCredential(db, { ...stale }, { pin: g })); // each compare runs on the stale snapshot
  t('PIN: parallel guesses read before the lock: the right one that is decided AFTER the lock is refused (PIN_LOCKED)', results[29].ok === false && results[29].reason === 'PIN_LOCKED', JSON.stringify(results[29]));
  t('PIN: only the wrong ones are weighed up to the lock; none signed in', results.every((r) => !r.ok) && row.pin_attempts === 5, 'attempts ' + row.pin_attempts);

  row = { identity_id: ID, identity_type: 'actor', pin_hash: hash, pin_attempts: 0, pin_locked_at: null, status: 'active' };
  const okAlone = await A.verifyCredential(db, { ...row }, { pin: '4821' });
  t('PIN: with no lock the right PIN still signs in (positive control)', okAlone.ok === true);

  /* a lift of an expired lock must not wipe a relock made in between */
  const oldLock = new Date(Date.now() - 3 * 3600 * 1000);
  row = { identity_id: ID, identity_type: 'actor', pin_hash: hash, pin_attempts: 5, pin_locked_at: oldLock, status: 'active' };
  const snapshot = { ...row };
  row.pin_locked_at = new Date(); // another request relocked the seat after this one read its row
  const lifted = await A.verifyCredential(db, snapshot, { pin: '4821' });
  t('PIN: the lift only removes the lock this request read; a fresh relock stays and the right PIN is refused', !lifted.ok && !!row.pin_locked_at, JSON.stringify(lifted));

  /* the code door: five wrong codes are counted while a right code is in flight */
  row = { identity_id: ID, identity_type: 'actor', status: 'active', pin_hash: null, otp_code: '246810', otp_expires_at: new Date(Date.now() + 600000), otp_attempts: 0 };
  const snap = { ...row };
  for (let i = 0; i < 5; i++) await db('UPDATE identities SET otp_attempts = COALESCE(otp_attempts, 0) + 1 WHERE identity_id = $1', [ID]); // five parallel wrong ones counted meanwhile
  const late = await A.verifyCredential(db, snap, { otp: '246810' });
  t('code: a right code read on a stale row but spent after the budget was used is refused (OTP_LOCKED)', !late.ok && late.reason === 'OTP_LOCKED', JSON.stringify(late));
  row.otp_attempts = 0;
  const fine = await A.verifyCredential(db, { ...row }, { otp: '246810' });
  t('code: with the budget unspent the right code signs in (positive control)', fine.ok === true, JSON.stringify(fine));
  say(bad ? bad + ' failed' : 'all passed');
  process.exit(bad ? 1 : 0);
})();
