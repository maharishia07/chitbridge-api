#!/usr/bin/env node
// @type: unit
/**
 * sec3-s6-legacy-renew.test.cjs — S6 residual (VERIFY-EL-SECURITY): the legacy-token branch of /renew opened a fresh listed session with a NEW `born`.
 * ATTACK    a stolen token with no jti (issued before M05) is renewed: the chain starts again at day 0 with its own 30-day life, so legacy tokens were a way round the absolute life.
 * RULE      the old token's own issue time (JWT iat) becomes `born`: a legacy token older than the absolute life is refused SESSION_EXPIRED, a younger one is capped at born + life.
 * RUN       node tests/sec3-s6-legacy-renew.test.cjs        STANDARD  OWASP ASVS 4.0.3 V3.3.2 / V3.3.4 (session lifetime)
 * CARD      18-identity-sign-in-and-access/sessions-and-devices
 */
'use strict';
const path = require('path');
const fs = require('fs');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const say = console.log.bind(console);
['log', 'warn', 'info', 'error'].forEach((k) => { console[k] = () => {}; });
const API = path.join(__dirname, '..');
const PP = require('./support/policy-patch.cjs');
const clone = (x) => JSON.parse(JSON.stringify(x));
const SHOP = 'shop1', DAY = 86400;
const ROWS = { shop1: { identity_type: 'entity', policy_flags: { devices: {} } } };
const q = async (sql, params) => {
  const s = String(sql);
  if (PP.isPatch(s)) { const row = ROWS[PP.entityOf(s, params)]; row.policy_flags = row.policy_flags || {}; return PP.apply(s, params, row.policy_flags); }
  if (/SELECT policy_flags FROM identities/.test(s)) return { rows: [{ policy_flags: clone(ROWS.shop1.policy_flags) }], rowCount: 1 };
  return { rows: [], rowCount: 0 };
};
const withTransaction = async (fn) => fn({ query: q });
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: q, pool: { query: q }, withEntity: async (i, f) => f({ query: q }), withTransaction } };
const sessions = require(path.join(API, 'lib', 'person-session'));
const T = 1_800_000_000;
sessions.setClock(() => T * 1000);
let bad = 0;
const t = (name, ok, extra) => { say((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : ' ' + (extra || ''))); if (!ok) bad++; };

(async () => {
  let refused = null;
  try { await sessions.open(withTransaction, SHOP, { device_id: 'web-device-0001', surface: 'web', by: 'p1', born: T - 31 * DAY }); } catch (e) { refused = e; }
  t('a legacy token issued 31 days ago is refused SESSION_EXPIRED, not given a new 30-day life', !!refused && refused.code === 'SESSION_EXPIRED' && refused.status === 401, refused && refused.message);
  const young = await sessions.open(withTransaction, SHOP, { device_id: 'web-device-0001', surface: 'web', by: 'p1', born: T - 25 * DAY });
  t('a 25-day-old legacy token gets only the 5 days left (born + 30 d), not 7 more', young.exp === T - 25 * DAY + 30 * DAY, JSON.stringify(young));
  const stored = ROWS.shop1.policy_flags.devices['web-device-0001'].sessions.slice(-1)[0];
  t('the listed session keeps the first-issue time, so later renewals cannot stretch it', stored.born === T - 25 * DAY);
  const fresh = await sessions.open(withTransaction, SHOP, { device_id: 'web-device-0002', surface: 'web', by: 'p1' });
  t('an ordinary first sign-in (no born) is unchanged: born is now', ROWS.shop1.policy_flags.devices['web-device-0002'].sessions[0].born === T && fresh.exp === T + 7 * DAY);
  const forgedFuture = await sessions.open(withTransaction, SHOP, { device_id: 'web-device-0003', surface: 'web', by: 'p1', born: T + 99 * DAY });
  t('a born in the future is ignored (never later than now)', ROWS.shop1.policy_flags.devices['web-device-0003'].sessions[0].born === T && forgedFuture.exp > T);
  t('the /renew legacy branch passes the old token\'s iat', /born: claimsOf\(req\)\.iat/.test(fs.readFileSync(path.join(API, 'routes', 'signin.js'), 'utf8')));
  process.exit(bad ? 1 : 0);
})();
