#!/usr/bin/env node
// @type: unit
/**
 * otp-one-counter-never-reset-by-ask.test.cjs — "one attempt counter, never reset by an ask" at the three writers that still zeroed it (M1 class, batch 1128).
 * ATTACK    asking again wrote otp_attempts = 0 beside the new code, so "5 guesses, ask, 5 guesses ..." never ran out (lib/otp.js issueShopperOtp had the fix, these did not).
 * RULE      the same CASE as lib/otp.js (count kept while the old code is live, zero once it has expired) in lib/employee-code.js issue (a SIGN-IN ASK; the owner's own act, `entity_id` given, is the unlock
 *           and still zeroes), routes/connectors.js reissue-code, routes/network-design.js reissueClaim.
 * RUN       node tests/otp-one-counter-never-reset-by-ask.test.cjs
 * CARD      18-identity-sign-in-and-access/sign-in
 */
'use strict';
const fs = require('fs');
const path = require('path');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const say = console.log.bind(console);
['log', 'warn', 'info', 'error'].forEach((k) => { console[k] = () => {}; });
const ROOT = path.join(__dirname, '..');
const stub = (rel, exports) => { const p = require.resolve(path.join(ROOT, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
const sqls = [];
const db = async (sql) => { sqls.push(String(sql).replace(/\s+/g, ' ').trim()); return { rows: [], rowCount: 1 }; };
stub('db', { query: db, withEntity: async (i, f) => f({ query: db }), withTransaction: async (f) => f({ query: db }), pool: {} });
stub('lib/schema', { hasColumn: async (t, c) => c !== 'auth_fail_count', hasColumns: async () => true, hasTable: async () => true, has: async () => true, columns: async () => [], table: async () => ({}) });
const empCode = require(path.join(ROOT, 'lib', 'employee-code'));
const KEEP = /otp_attempts = CASE WHEN otp_expires_at IS NULL OR otp_expires_at < NOW\(\) THEN 0 ELSE COALESCE\(otp_attempts, 0\) END/;
const ZERO = /otp_attempts = 0\b/;
let bad = 0;
const t = (name, ok, extra) => { say((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : ' ' + (extra || ''))); if (!ok) bad++; };
const ID = '66666666-6666-4666-8666-666666666666';

(async () => {
  /* the CASE itself, evaluated the way Postgres reads it (right side sees the OLD row) */
  const caseOf = (oldExpires, oldAttempts) => (oldExpires == null || oldExpires < Date.now() ? 0 : oldAttempts || 0);
  t('one attempt counter, never reset by an ask: a live code keeps its count, an expired one starts again at 0', caseOf(Date.now() + 1000, 4) === 4 && caseOf(Date.now() - 1000, 4) === 0 && caseOf(null, 4) === 0);

  sqls.length = 0;
  await empCode.issue(db, ID, { ttlMs: 60000 });
  t('one attempt counter, never reset by an ask: lib/employee-code.js issue on a SIGN-IN ASK keeps the count (the CASE, no bare = 0)', sqls.length === 1 && KEEP.test(sqls[0]) && !/otp_attempts = 0\b(?! THEN)/.test(sqls[0].replace(KEEP, '')), sqls[0]);
  sqls.length = 0;
  await empCode.issue(db, ID, { entity_id: 'shop-1', by: 'owner-1', channel: 'email' });
  t('the owner\'s own reset (entity_id given) is the unlock and still zeroes the count', sqls.some((s) => /^UPDATE identities SET /.test(s) && ZERO.test(s) && !KEEP.test(s)), sqls.join(' || '));

  const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\s+/g, ' ');
  const updates = (text) => text.split('UPDATE identities SET ').slice(1).map((x) => x.slice(0, 260)).filter((x) => /^(otp_code = \$1|\$\{kept\.sql\}), otp_expires_at = \$2/.test(x));
  const conn = updates(src('routes/connectors.js'));
  t('one attempt counter, never reset by an ask: routes/connectors.js reissue-code keeps the count', conn.length === 1 && KEEP.test(conn[0]) && !ZERO.test(conn[0].replace(KEEP, '')), conn.join(' | '));
  const net = updates(src('routes/network-design.js'));
  t('one attempt counter, never reset by an ask: routes/network-design.js reissueClaim keeps the count', net.length === 1 && KEEP.test(net[0]) && !ZERO.test(net[0].replace(KEEP, '')), net.join(' | '));
  say(bad ? bad + ' failed' : 'all passed');
  process.exit(bad ? 1 : 0);
})();
