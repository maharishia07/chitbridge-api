/**
 * tests/sec-desk-why-and-verify-trips.test.cjs — two follow-ups of the review of api#1064/#1065.
 *
 * OWNS      (1) lib/workroute routeFor: a routing read that throws gives `why` ONE fixed sentence, never the exception's own text (lib/raiseticket
 *           joins route.why into the preview and raise answers); the text goes to the log. (2) POST /api/catalogue/:bridge_id/login/verify (SEC-139 class):
 *           an unknown contact, a wrong code, a locked row and an expired code give one answer and run the same database round trips, and no row is
 *           written for a contact that does not exist.
 * ⚠️ WHAT THIS PROVES: the same NUMBER of database round trips, not the same latency (a no-match UPDATE takes no xid and does no WAL flush, so a
 *    count proves the count, not the timing). EXCEPTION, stated plainly: for a real row with a wrong code verifyOtp also asks otherCodeOk first
 *    (lib/installer-token installerOk, lib/dev-otp testerGuess: an in-memory guess counter, not a DB trip, and only where TESTER_CODE or the installer
 *    token is set - the testing-phase door); unknown and locked rows skip it, and this test does not cover that gap.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/catalogue.js and lib/otp.js over a stand-in db.
 * FLOW      stand-in db records each statement → routeFor / the real route → answers compared → round trips compared
 * CARD      18-identity-sign-in-and-access/sign-in
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const API = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-sec-desk-why';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
let pass = 0;
let fail = 0;
const t = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra === undefined ? '' : '\n       ' + JSON.stringify(extra).slice(0, 400))); }
};
const SECRET = 'connection to server at 10.0.0.7 port 5432 failed: password authentication failed for user cb_secret';
const SHOP = 'aaaaaaaa-0000-4000-8000-00000000000a';
const BUYER = 'cccccccc-0000-4000-8000-00000000000c';
const NIL = '00000000-0000-0000-0000-000000000000';
const world = { buyer: false, attempts: 0, expired: false, throwOnRouting: false };
const statements = [];
const rowsFor = (sql, params) => {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  statements.push({ s, params });
  if (world.throwOnRouting) throw new Error(SECRET);
  if (/FROM identities WHERE \(bridge_id = \$1 OR LOWER\(user_id\)/.test(s)) return [{ identity_id: SHOP, display_name: 'Shop S', bridge_id: 'shop-s', user_id: 'shop-s', currency_code: 'INR', business_status: 'active', population: 'live' }];
  if (/otp_code, otp_expires_at, otp_attempts FROM identities WHERE email = \$1/.test(s)) {
    const expires = new Date(Date.now() + (world.expired ? -600000 : 600000)).toISOString();
    return world.buyer ? [{ identity_id: BUYER, bridge_id: 'BUYER01', display_name: 'Buyer', otp_code: '654321', otp_expires_at: expires, otp_attempts: world.attempts }] : [];
  }
  return [];
};
const mock = (rel, exported) => { const f = require.resolve(path.join(API, rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports: exported }; };
const q = async (sql, params) => { const rows = rowsFor(sql, params); return { rows, rowCount: rows.length }; };
const tx = { query: q };
const db = {
  query: q,
  pool: { query: q, connect: async () => Object.assign({ release() {} }, tx) },
  withEntity: async (id, run) => run(tx),
  withTransaction: async (run) => run(tx),
  onEntity: async (id, c, run) => run(tx),
  readBatch: async () => ({}),
  trySavepoint: async (c, run, fb) => { try { return await run(c); } catch (e) { return fb; } }
};
mock('db', db);
mock('db/index', db);
const logged = [];
const log = require(path.join(API, 'lib', 'logger'));
['warn', 'error', 'info', 'debug', 'log'].forEach((k) => { log[k] = (...a) => { logged.push(JSON.stringify(a)); }; });

const post = (base, url, body) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
  const r = http.request(base + url, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
    let s = '';
    res.on('data', (c) => { s += c; });
    res.on('end', () => resolve({ status: res.statusCode, raw: s }));
  });
  r.on('error', reject);
  r.end(data);
});
const shape = (s) => String(s).replace(/"request_id":"[^"]*"/g, '"request_id":"-"');

(async () => {
  console.log('\n== 1. routeFor: a thrown internal text never reaches why ==');
  const workroute = require(path.join(API, 'lib', 'workroute'));
  world.throwOnRouting = true;
  workroute.invalidate();
  const route = await workroute.routeFor(SHOP, 'incident');
  world.throwOnRouting = false;
  const leak = /password|10\.0\.0\.7|cb_secret|5432/;
  t('why is a sentence, not the exception text', typeof route.why === 'string' && route.why.length > 0 && !leak.test(route.why), route.why);
  t('the raw text is in the log', logged.some((l) => l.includes('cb_secret')));
  const joined = [null, route.why].filter(Boolean).join(' · ');
  t('what raise() joins into its answer holds no internal text', !leak.test(joined), joined);

  console.log('\n== 2. login/verify: one answer, the same round trips ==');
  const app = express();
  app.use(express.json());
  app.use('/api/catalogue', require(path.join(API, 'routes', 'catalogue.js')));
  const server = app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const body = { phone: '9876543210', otp: '111111' };
  const cases = {
    unknown: { buyer: false },
    wrong: { buyer: true },
    locked: { buyer: true, attempts: 9 },
    expired: { buyer: true, expired: true }
  };
  const out = {};
  for (const [name, c] of Object.entries(cases)) {
    Object.assign(world, { buyer: c.buyer, attempts: c.attempts || 0, expired: !!c.expired });
    statements.length = 0;
    const r = await post(base, '/api/catalogue/shop-s/login/verify', body);
    const after = statements.filter((x) => !/idempotency/.test(x.s));
    const tail = after.slice(after.findIndex((x) => /FROM identities WHERE email = \$1/.test(x.s)) + 1);
    out[name] = { status: r.status, raw: shape(r.raw), updates: tail.filter((x) => /^UPDATE/.test(x.s)), trips: tail.length };
  }
  server.close();
  const ref = out.wrong;
  t('wrong code is refused 400', ref.status === 400, ref);
  for (const n of ['unknown', 'locked', 'expired']) {
    t(n + ': same status and body as a wrong code', out[n].status === ref.status && out[n].raw === ref.raw, [out[n].raw, ref.raw]);
    t(n + ': same number of database round trips after the lookup', out[n].trips === ref.trips && ref.trips > 0, [out[n].trips, ref.trips]);
  }
  t('unknown contact: the UPDATE matches no real identity (nothing written)', out.unknown.updates.length === 1 && out.unknown.updates[0].params[0] === NIL, out.unknown.updates);
  t('wrong code on a real contact still counts the miss on that identity', ref.updates.length === 1 && ref.updates[0].params[0] === BUYER, ref.updates);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('CRASH', e); process.exit(1); });
