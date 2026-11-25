#!/usr/bin/env node
// @type: unit
/**
 * pin-lock-lift-micro.test.cjs — GF-SECURITY#L73 (retest 25 Nov): the PIN lock never lifted; a right PIN was refused at 33 min against a 15 min window.
 * CAUSE     the lift UPDATE compared pin_locked_at = $2 with the row's JS Date. node-postgres returns a timestamp at MILLISECOND precision, the column holds
 *           MICROSECONDS, so the equality was false for any lock time with a sub-millisecond part (all of them in production) and nothing lifted.
 *           The older tests used ms-exact timestamps, so they stayed green (pin-timed-lock-m3, signin-compare-race-m2).
 * RULE      the window is decided IN SQL (pin_locked_at <= NOW() - window): a lock locked at 14 min stays, at 16 min lifts and the right PIN signs in; a relock made
 *           meanwhile (locked at NOW()) is not lifted; and no JS time is compared to a stored one.
 * RUN       node tests/pin-lock-lift-micro.test.cjs     (stand-in db that keeps microseconds and hands out milliseconds, like node-postgres)
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
const ID = '44444444-4444-4444-8444-444444444444';
const MIN = 60 * 1000;
const NOW_MS = Date.UTC(2026, 10, 25, 12, 0, 0);
let now = NOW_MS;
const realNow = Date.now;
Date.now = () => now;
/* the column: microseconds since epoch (BigInt), the driver: a Date at ms precision */
let lockedUs = null, attempts = 0;
const toDate = (us) => (us == null ? null : new Date(Number(us / 1000n)));
const sub = (ms) => BigInt(Math.round(ms)) * 1000n + 345n; /* a time with a sub-millisecond part, as NOW() gives */
const snapshot = (pin_hash) => ({ identity_id: ID, identity_type: 'actor', pin_hash, pin_attempts: attempts, pin_locked_at: toDate(lockedUs), status: 'active' });
let sawLift = 0;
const db = async (sql, args) => {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (/^UPDATE identities SET pin_attempts = pin_attempts \+ 1, pin_locked_at = CASE WHEN pin_attempts \+ 1 >= \$2 THEN NOW\(\) ELSE pin_locked_at END WHERE identity_id = \$1 AND pin_locked_at IS NULL RETURNING/.test(s)) {
    if (lockedUs != null) return { rows: [], rowCount: 0 };
    attempts += 1; if (attempts >= args[1]) lockedUs = sub(now);
    return { rows: [{ pin_attempts: attempts, pin_locked_at: toDate(lockedUs) }], rowCount: 1 };
  }
  if (/^UPDATE identities SET pin_locked_at = NULL WHERE identity_id = \$1 AND pin_locked_at = \$2$/.test(s)) { /* the OLD statement: microseconds against the driver's milliseconds */
    sawLift++; if (lockedUs != null && lockedUs === BigInt(new Date(args[1]).getTime()) * 1000n) lockedUs = null; return { rows: [], rowCount: 1 };
  }
  if (/^UPDATE identities SET pin_locked_at = NULL WHERE identity_id = \$1 AND pin_locked_at IS NOT NULL AND pin_locked_at <= NOW\(\) - \(\$2::float8 \* interval '1 millisecond'\)$/.test(s)) {
    sawLift++; if (lockedUs != null && lockedUs <= sub(now) - BigInt(Math.round(args[1] * 1000))) lockedUs = null; return { rows: [], rowCount: 1 };
  }
  if (/^UPDATE identities SET pin_attempts = 0, last_active_at = NOW\(\) WHERE identity_id = \$1 AND pin_locked_at IS NULL RETURNING identity_id$/.test(s)) {
    if (lockedUs != null) return { rows: [], rowCount: 0 };
    attempts = 0; return { rows: [{ identity_id: ID }], rowCount: 1 };
  }
  throw new Error('stand-in db: unknown statement ' + s.slice(0, 120));
};
const dbPath = require.resolve(path.join(ROOT, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: db, withEntity: async (i, f) => f({ query: db }), withTransaction: async (f) => f({ query: db }), pool: {} } };
const A = require(path.join(ROOT, 'lib', 'identity-auth'));
let bad = 0, n = 0;
const t = (name, ok, extra) => { n++; say((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : ' ' + (extra || ''))); if (!ok) bad++; };

(async () => {
  const hash = await A.hashPin('4821');
  /* positive control: the model reproduces the bug. The OLD statement with the driver's Date does not match a microsecond time */
  lockedUs = sub(now - 16 * MIN); attempts = 5;
  await db('UPDATE identities SET pin_locked_at = NULL WHERE identity_id = $1 AND pin_locked_at = $2', [ID, toDate(lockedUs)]);
  t('control: the old equality leaves a microsecond lock in place (the bug the model must be able to show)', lockedUs != null);

  /* a lock set by hand 14 minutes ago: locked */
  lockedUs = sub(now - 14 * MIN); attempts = 5;
  const at14 = await A.verifyCredential(db, snapshot(hash), { pin: '4821' });
  t('14 minutes locked: the right PIN is refused PIN_LOCKED', !at14.ok && at14.reason === 'PIN_LOCKED', JSON.stringify(at14));
  t('14 minutes locked: the lock marker is still set', lockedUs != null);

  /* a lock set by hand 16 minutes ago: lifted, the right PIN signs in */
  lockedUs = sub(now - 16 * MIN); attempts = 5; sawLift = 0;
  const at16 = await A.verifyCredential(db, snapshot(hash), { pin: '4821' });
  t('16 minutes after a microsecond lock time: the right PIN signs in', at16.ok === true, JSON.stringify(at16));
  t('16 minutes: the lift ran and cleared the marker and the count', sawLift === 1 && lockedUs == null && attempts === 0, 'lift ' + sawLift + ' locked ' + lockedUs + ' attempts ' + attempts);

  /* the exact retest shape: right PIN at 33 minutes after a 15 minute lock */
  lockedUs = sub(now - 33 * MIN); attempts = 5;
  const at33 = await A.verifyCredential(db, snapshot(hash), { pin: '4821' });
  t('33 minutes after the lock (the retest): the right PIN signs in', at33.ok === true, JSON.stringify(at33));

  /* a wrong try after the window lifts, counts, and relocks for twice as long (attempts kept) */
  lockedUs = sub(now - 16 * MIN); attempts = 5;
  const wrong = await A.verifyCredential(db, snapshot(hash), { pin: '0000' });
  t('a wrong PIN after the window lifts, counts and relocks, attempts 6, window 30 min', wrong.locked_now === true && attempts === 6 && lockedUs != null && A.pinLockMs(6) === 30 * MIN, JSON.stringify(wrong));
  now += 20 * MIN;
  t('20 minutes into the 30 minute relock: right PIN still refused', (await A.verifyCredential(db, snapshot(hash), { pin: '4821' })).reason === 'PIN_LOCKED');
  now += 11 * MIN;
  t('31 minutes into the 30 minute relock: right PIN signs in', (await A.verifyCredential(db, snapshot(hash), { pin: '4821' })).ok === true);

  /* M2 kept: a request that read an expired lock must not wipe a relock made in between */
  now = NOW_MS; attempts = 5;
  lockedUs = sub(now - 16 * MIN);
  const stale = snapshot(hash);
  lockedUs = sub(now); /* another request relocked the seat after this one read its row */
  const raced = await A.verifyCredential(db, stale, { pin: '4821' });
  t('a relock made after the read is not lifted and the right PIN is refused', !raced.ok && lockedUs != null, JSON.stringify(raced));

  Date.now = realNow;
  say(bad ? bad + ' failed' : n + ' checks');
  process.exit(bad ? 1 : 0);
})();
