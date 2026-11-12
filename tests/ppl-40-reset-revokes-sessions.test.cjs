#!/usr/bin/env node
// @type: unit
/**
 * ppl-40-reset-revokes-sessions.test.cjs — PPL-40 (triage 12 Nov 2026): resetting a person's code or PIN signs them out of every phone and browser.
 *
 * OWNS      the proof that DELETE /api/actors/:id/pin and POST /api/actors/:id/otp unlist every session the person opened (lib/person-session closeBy, the
 *           writer switch-off already uses), keep the colleague's sessions, and write nothing when the reset itself is refused (no sessions touched).
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/actors.js over a stand-in sign-in and an in-memory shop row holding the device listing.
 * FLOW      owner auth → reset door → closeBy edits policy_flags.devices (one locked write) → the new code is written after → the person's jtis are gone, the colleague's stay
 * CARD      18-identity-sign-in-and-access/sessions-and-devices
 * UNIT      18/Sessions and devices
 * MUTATION  checked once: in routes/actors.js delete the `await endSessionsOnReset(...)` line of POST /:id/otp → "the code reset signs the person out" goes red.
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const say = console.log.bind(console);
['log', 'warn', 'info', 'error'].forEach((k) => { console[k] = () => {}; });

const ROOT = path.join(__dirname, '..');
const SHOP = '11111111-1111-4111-8111-111111111111';
const PERSON = '33333333-3333-4333-8333-333333333333';
const COLLEAGUE = '44444444-4444-4444-8444-444444444444';
const fresh = () => ({
  'dev-phone': { label: 'phone', kind: 'web', sessions: [{ jti: 'j-person-1', exp: 9999999999, by: PERSON }, { jti: 'j-colleague', exp: 9999999999, by: COLLEAGUE }] },
  'dev-pc': { label: 'pc', kind: 'web', sessions: [{ jti: 'j-person-2', exp: 9999999999, by: PERSON }] }
});
const world = { devices: fresh(), person: { identity_id: PERSON, display_name: 'Ravi', actor_key: 'ravik', break_status: 'active' }, codeWrites: 0, order: [] };
const jtisLeft = () => Object.values(world.devices).flatMap((d) => d.sessions.map((s) => s.jti)).sort();

const stubDb = async (sql, params) => {
  if (/SELECT policy_flags FROM identities/.test(sql)) return { rows: [{ policy_flags: { devices: JSON.parse(JSON.stringify(world.devices)) } }] };
  if (/^UPDATE identities SET policy_flags/.test(sql)) {
    const val = (params || []).find((p) => typeof p === 'string' && p.indexOf('"sessions"') >= 0);
    if (val) world.devices = JSON.parse(val);
    world.order.push('sessions');
    return { rows: [{ identity_id: SHOP }], rowCount: 1 };
  }
  if (/UPDATE identities SET .*otp_expires_at/.test(sql)) { world.codeWrites++; world.order.push('code'); return { rows: [], rowCount: 1 }; }
  if (/AND identity_type = 'actor'/.test(sql) && /FROM identities/.test(sql)) return { rows: params[0] === PERSON ? [world.person] : [] };
  return { rows: [], rowCount: 0 };
};
const dbPath = require.resolve(path.join(ROOT, 'db'));
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { query: stubDb, withEntity: async (id, fn) => fn({ query: stubDb }), onEntity: async (id, db, fn) => (typeof db === 'function' ? db({ query: stubDb }) : fn({ query: stubDb })), withTransaction: async (fn) => fn({ query: stubDb }), pool: {} }
};
const authPath = require.resolve(path.join(ROOT, 'middleware', 'auth'));
const stubAuth = (req, res, next) => { req.identity = { identity_id: SHOP, identity_type: 'entity' }; next(); };
stubAuth.entityOf = (req) => req.identity.identity_id;
stubAuth.forgetKey = () => {};
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: stubAuth };

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.id = 'req-test'; next(); });
app.use('/api/actors', require(path.join(ROOT, 'routes', 'actors.js')));

let failed = 0, checks = 0;
const check = (ok, label, why) => { checks++; if (!ok) failed++; say((ok ? 'ok   ' : 'FAIL ') + label + (ok ? '' : ' · ' + JSON.stringify(why).slice(0, 300))); };
const call = (server, method, p) => new Promise((resolve) => {
  const data = method === 'POST' ? '{}' : '';
  const req = http.request({ port: server.address().port, method, path: '/api/actors/' + p, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
    let text = '';
    res.on('data', (c) => (text += c));
    res.on('end', () => resolve({ status: res.statusCode, text, body: (() => { try { return JSON.parse(text); } catch (e) { return {}; } })() }));
  });
  req.end(data);
});

(async () => {
  const server = app.listen(0);
  for (const [name, method, p, label] of [
    ['the code reset', 'POST', PERSON + '/otp', 'POST /:id/otp'],
    ['the PIN reset', 'DELETE', PERSON + '/pin', 'DELETE /:id/pin']
  ]) {
    world.devices = fresh(); world.codeWrites = 0; world.order = [];
    const r = await call(server, method, p);
    check(r.status === 200, label + ' answers 200 (got ' + r.status + ')', r.text);
    check(world.codeWrites === 1, label + ' writes the new code', world.order);
    check(jtisLeft().join() === 'j-colleague', name + ' signs the person out of every device and leaves the colleague\'s session (left: ' + jtisLeft().join() + ')', world.devices);
    check(world.order.indexOf('sessions') < world.order.indexOf('code'), name + ' ends the sessions before the new code is written', world.order);
  }
  world.devices = fresh(); world.order = [];
  const gone = await call(server, 'POST', '55555555-5555-4555-8555-555555555555/otp');
  check(gone.status === 404 && jtisLeft().length === 3 && !world.order.length, 'a person who is not in this shop: 404, no session touched', { status: gone.status, order: world.order });
  server.close();
  say(checks + ' checks, ' + (failed ? failed + ' FAILED' : 'all passed'));
  process.exit(failed ? 1 : 0);
})();
