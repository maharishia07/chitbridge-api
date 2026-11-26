#!/usr/bin/env node
// @type: unit
/**
 * pin-timed-lock-m3.test.cjs — M3 (VERIFY-GF-MONEY-SECURITY): a stranger's 5 wrong PINs must not shut a person out for good.
 * ATTACK    anyone who knows key@shop types 5 wrong PINs; the seat was locked until the owner reset it (denial of service on the till).
 * RULE      the lock is timed: 15 min x 2^(attempts-5), cap 24 h; attempts persist until a right PIN, so each relock doubles (NIST 800-63B 5.2.2); a right PIN after the window signs in and clears the count;
 *           a lock time that cannot be read stays locked (fail closed); the owner's reset (routes/actors.js reset-pin) is the unlock.
 * RUN       node tests/pin-timed-lock-m3.test.cjs
 * CARD      17-people-employees-hr-and-payroll/pin-otp-first-sign-in
 */
'use strict';
const path = require('path');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const say = console.log.bind(console);
['log', 'warn', 'info', 'error'].forEach((k) => { console[k] = () => {}; });
const ROOT = path.join(__dirname, '..');
const pinCount = require('./lib/pin-count-stub.cjs');
const ID = '33333333-3333-4333-8333-333333333333';
let row;
let now = Date.now();
const realNow = Date.now;
Date.now = () => now;
const db = async (sql, args) => {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  const counted = pinCount.answer(s, args, () => row, new Date(now));
  if (counted) return counted;
  if (/^UPDATE identities SET pin_locked_at = NULL WHERE identity_id = \$1 AND pin_locked_at IS NOT NULL AND pin_locked_at <= NOW\(\) - \(\$2::float8 \* interval '1 millisecond'\)$/.test(s)) { if (row.pin_locked_at && new Date(row.pin_locked_at).getTime() <= now - args[1]) row.pin_locked_at = null; return { rows: [], rowCount: 1 }; }
  if (/^UPDATE identities SET pin_attempts = 0, last_active_at = NOW\(\) WHERE identity_id = \$1 AND pin_locked_at IS NULL RETURNING identity_id$/.test(s)) { if (row.pin_locked_at) return { rows: [], rowCount: 0 }; row.pin_attempts = 0; return { rows: [{ identity_id: ID }], rowCount: 1 }; }
  throw new Error('stand-in db: unknown statement ' + s.slice(0, 100));
};
const dbPath = require.resolve(path.join(ROOT, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: db, withEntity: async (i, f) => f({ query: db }), withTransaction: async (f) => f({ query: db }), pool: {} } };
const A = require(path.join(ROOT, 'lib', 'identity-auth'));
let bad = 0;
const t = (name, ok, extra) => { say((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : ' ' + (extra || ''))); if (!ok) bad++; };
const MIN = 60 * 1000;

(async () => {
  const hash = await A.hashPin('4821');
  row = { identity_id: ID, identity_type: 'actor', pin_hash: hash, pin_attempts: 0, pin_locked_at: null, status: 'active' };
  const typed = (pin) => A.verifyCredential(db, { ...row }, { pin });
  for (let i = 0; i < 5; i++) await typed('0000');
  t('5 wrong PINs lock the seat', !!row.pin_locked_at && row.pin_attempts === 5);
  t('locked: even the RIGHT PIN is refused PIN_LOCKED', (await typed('4821')).reason === 'PIN_LOCKED');
  now += 14 * MIN;
  t('14 minutes later: still locked', (await typed('4821')).reason === 'PIN_LOCKED');
  now += 2 * MIN;
  const open = await typed('4821');
  t('16 minutes later the right PIN signs in (no owner reset needed)', open.ok === true, JSON.stringify(open));
  t('…and a right PIN clears the count and the lock', row.pin_attempts === 0 && !row.pin_locked_at);

  for (let i = 0; i < 5; i++) await typed('0000');
  now += 16 * MIN;
  const again = await typed('0000'); // a wrong try after the window: attempts 6 -> locks for 30 min
  t('a wrong try after the window relocks (attempts kept)', again.locked_now === true && row.pin_attempts === 6 && !!row.pin_locked_at, JSON.stringify(again));
  t('the second lock lasts 30 minutes (back-off doubles)', A.pinLockMs(6) === 30 * MIN && A.pinLockMs(7) === 60 * MIN);
  now += 20 * MIN;
  t('20 minutes into a 30-minute lock: still locked', (await typed('4821')).reason === 'PIN_LOCKED');
  now += 11 * MIN;
  t('after 31 minutes the right PIN works', (await typed('4821')).ok === true);
  t('the back-off is capped at 24 hours', A.pinLockMs(40) === 24 * 60 * MIN);
  t('an unreadable lock time stays locked (fail closed)', A.pinLockActive({ pin_locked_at: 'garbage', pin_attempts: 5 }) === true);
  Date.now = realNow;
  say(bad ? bad + ' failed' : 'all passed');
  process.exit(bad ? 1 : 0);
})();
