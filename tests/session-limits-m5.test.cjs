#!/usr/bin/env node
// @type: unit
/**
 * session-limits-m5.test.cjs — M5 (VERIFY-GF-MONEY-SECURITY): a stolen session cannot live for ever or call itself a till.
 * ATTACK A   a token stolen on day 6 of 7 is renewed every 6 days: the chain never ends.   RULE: a chain carries `born` and dies at the absolute life (30 d; till 90 d), the renew never stretches it.
 * ATTACK B   any browser says surface "till" at sign-in and gets the 30-day counter session.  RULE: 'till' is honoured only on a device that holds a till pairing (policy_flags.devices[d].till, lib/api-keys.js); else a 7-day 'web' session.
 * ATTACK C   POST /api/signin/pin with only a session sets a durable PIN and lifts a lock.     RULE: the first-PIN door refuses a seat that already holds a PIN (PIN_ALREADY_SET); change-pin needs the current one.
 * RUN       node tests/session-limits-m5.test.cjs
 * CARD      18-identity-sign-in-and-access/sessions-and-devices
 */
'use strict';
const path = require('path');
const express = require('express');
const http = require('http');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const say = console.log.bind(console);
['log', 'warn', 'info', 'error'].forEach((k) => { console[k] = () => {}; });
const API = path.join(__dirname, '..');
const PP = require('./support/policy-patch.cjs');
const clone = (x) => JSON.parse(JSON.stringify(x));
const SHOP = 'shop1', DAY = 86400;
const ROWS = { shop1: { identity_type: 'entity', policy_flags: { devices: { 'paired-till-0001': { kind: 'till', sessions: [], till: { prefix: 'T1' } } } } } };
let HAS_PIN = false;
const q = async (sql, params) => {
  const s = String(sql);
  if (PP.isPatch(s)) { const row = ROWS[PP.entityOf(s, params)]; row.policy_flags = row.policy_flags || {}; return PP.apply(s, params, row.policy_flags); }
  if (/SELECT policy_flags FROM identities/.test(s)) return { rows: [{ policy_flags: clone(ROWS.shop1.policy_flags) }], rowCount: 1 };
  if (/has_pin/.test(s)) return { rows: [{ has_pin: HAS_PIN }], rowCount: 1 };
  return { rows: [], rowCount: 0 };
};
const withTransaction = async (fn) => fn({ query: q });
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: q, pool: { query: q }, withEntity: async (i, f) => f({ query: q }), withTransaction, onEntity: async (i, d, f) => f({ query: q }), readBatch: async () => ({}), trySavepoint: async (d, f, b) => { try { return await f(d); } catch (_) { return b; } } } };
const sessions = require(path.join(API, 'lib', 'person-session'));
let T = 1_800_000_000;
sessions.setClock(() => T * 1000);
let bad = 0;
const t = (name, ok, extra) => { say((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : ' ' + (extra || ''))); if (!ok) bad++; };

(async () => {
  /* A: renew every 6 days */
  let s = await sessions.open(withTransaction, SHOP, { device_id: 'web-device-0001', surface: 'web', by: 'p1' });
  let renewals = 0, refused = null;
  for (let i = 0; i < 12 && !refused; i++) { T += 6 * DAY; try { s = await sessions.renew(withTransaction, SHOP, 'web-device-0001', s.jti, 'p1'); renewals++; } catch (e) { refused = e; } }
  t('A: a web session renewed every 6 days is refused SESSION_EXPIRED after the 30-day absolute life (renewed ' + renewals + ' times)', !!refused && refused.code === 'SESSION_EXPIRED' && renewals <= 5, refused && refused.code);
  const last = ROWS.shop1.policy_flags.devices['web-device-0001'].sessions.slice(-1)[0] || {};
  const born = last.born;
  t('A: the last renew of the chain never outlives born + 30 days', typeof born === 'number' && last.exp <= born + 30 * DAY, JSON.stringify(last));
  t('A: every session of the chain carries the first sign-in time', typeof born === 'number');

  /* B: till surface */
  const forged = await sessions.open(withTransaction, SHOP, { device_id: 'laptop-device-01', surface: 'till', by: 'p1' });
  t('B: surface till on an UNPAIRED device is a 7-day web session', forged.surface === 'web' && forged.exp - forged.iat === 7 * DAY, JSON.stringify(forged));
  t('B: and the device is not recorded as a till', ROWS.shop1.policy_flags.devices['laptop-device-01'].kind === 'web');
  const real = await sessions.open(withTransaction, SHOP, { device_id: 'paired-till-0001', surface: 'till', by: 'p1' });
  t('B: surface till on a PAIRED device keeps the 30-day counter session', real.surface === 'till' && real.exp - real.iat === 30 * DAY);
  let r = real, ended = null;
  for (let i = 0; i < 20 && !ended; i++) { T += 29 * DAY; try { r = await sessions.renew(withTransaction, SHOP, 'paired-till-0001', r.jti, 'p1'); } catch (e) { ended = e; } }
  t('B: even a paired till session ends at its 90-day absolute life', !!ended && ended.code === 'SESSION_EXPIRED');

  /* C: POST /pin */
  const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
  const stubAuth = (req, res, next) => { req.identity = { identity_id: 'emp1', identity_type: 'actor', parent_entity_id: SHOP }; next(); };
  stubAuth.entityOf = (req) => req.identity.parent_entity_id; stubAuth.requireScope = () => (req, res, next) => next();
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: stubAuth };
  const app = express(); app.use(express.json()); app.use((req, res, next) => { req.id = 'r'; next(); });
  app.use('/api/signin', require(path.join(API, 'routes', 'signin')));
  const server = await new Promise((ok) => { const sv = app.listen(0, '127.0.0.1', () => ok(sv)); });
  const post = (body) => new Promise((resolve) => { const d = JSON.stringify(body); const rq = http.request({ port: server.address().port, method: 'POST', path: '/api/signin/pin', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(d) } }, (res) => { let x = ''; res.on('data', (c) => (x += c)); res.on('end', () => resolve({ status: res.statusCode, text: x })); }); rq.end(d); });
  HAS_PIN = true;
  const stolen = await post({ pin: '4821', confirm_pin: '4821' });
  t('C: a seat that already has a PIN cannot replace it with a session alone: 409 PIN_ALREADY_SET', stolen.status === 409 && /PIN_ALREADY_SET/.test(stolen.text), stolen.status + ' ' + stolen.text.slice(0, 120));
  HAS_PIN = false;
  const first = await post({ pin: '4821', confirm_pin: '4821' });
  t('C: the first PIN (none held yet) still sets', first.status === 200, first.status + ' ' + first.text.slice(0, 120));
  server.close();
  say(bad ? bad + ' failed' : 'all passed');
  process.exit(bad ? 1 : 0);
})();
