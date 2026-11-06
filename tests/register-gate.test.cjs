/**
 * tests/register-gate.test.cjs — RAIL-90: the register (RAIDA) is a per-shop capability, off for a shop that never used it.
 *
 * OWNS      the gate lib/register-gate.js on the real routes of routes/chits.js: a shop with no 'register' key and no rows is refused 403 CAPABILITY_OFF
 *           (the code and body keys the connector gate answers); a shop with the key works; a shop with existing register rows works with no key at all (no flip, no migration).
 * CALLED BY scripts/guards.cjs (the offline gate).
 * FLOW      real routes/chits.js on express ──▶ stubbed auth + a stand-in db (identities.capabilities, register rows) ──▶ GET /register/subjects · GET /raida/report · GET /:chit_id/raida
 * CARD      01-rail-core-the-chit/raida
 * MIN unit-per-rule
 * MIN refusal-path
 * MIN fail-closed
 * Run: node tests/register-gate.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
const SHOP = '11111111-1111-4111-8111-111111111111';
const CHIT = '22222222-2222-4222-8222-222222222222';

const world = { caps: [], rows: false, fault: false };
const rowsFor = (s) => {
  if (/SELECT capabilities FROM identities/.test(s)) {
    if (world.fault) throw new Error('identities unreadable');
    return [{ capabilities: world.caps }];
  }
  if (/AS used/.test(s)) return [{ used: world.rows }];
  return [];
};
const tx = { query: async (s) => { const rows = rowsFor(String(s).replace(/\s+/g, ' ').trim()); return { rows, rowCount: rows.length }; } };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: tx.query, withEntity: async (id, fn) => fn(tx), withTransaction: async (fn) => fn(tx),
  trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } }, onEntity: async (id, db, fn) => fn(tx) } };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(
  (req, res, next) => { req.identity = { identity_id: SHOP, identity_type: 'entity', display_name: 'Shop' }; next(); },
  { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (q, s, n) => n(), userOf: (req) => req.identity, forgetKey: () => {}, keyAlive: async () => true }) };
const schema = require(path.join(API, 'lib', 'schema'));
schema.hasTable = async (t) => t === 'register_subject' || t === 'register_entry';
schema.hasColumn = async () => true;

const express = require('express');
const app = express(); app.use(express.json());
app.use('/api/chits', require(path.join(API, 'routes', 'chits')));

const gate = require(path.join(API, 'lib', 'register-gate'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + JSON.stringify(why).slice(0, 400) : '')); } };

/* the rules, one each */
ok('hasCap: the key in the list is on; a list without it, an empty list, null and a non-list are off', gate.hasCap(['register'], 'register') && !gate.hasCap(['connector'], 'register') && !gate.hasCap([], 'register') && !gate.hasCap(null, 'register') && !gate.hasCap('register', 'register'));
const words = gate.registerOff();
ok('registerOff: the code and keys of the connector gate, words of the register', words.code === 'CAPABILITY_OFF' && Object.keys(words.legacy).join() === 'error,code,message' && /register/.test(words.detail) && /register/.test(words.hint), words);

const srv = app.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${srv.address().port}/api/chits`;
  const call = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const DOORS = [['GET', '/register/subjects'], ['GET', '/register/attachables'], ['GET', '/register/templates'], ['GET', '/raida/report'], ['GET', '/' + CHIT + '/raida'],
    ['POST', '/register/subjects', { type_key: 'audit' }], ['POST', '/' + CHIT + '/raida', { kind: 'risk', body: 'x' }]];

  /* off: never used it, no key */
  world.caps = ['connector']; world.rows = false;
  for (const [m, p, b] of DOORS) {
    const r = await call(m, p, b);
    ok(`off shop: ${m} ${p.replace(CHIT, ':chit_id')} is refused 403 CAPABILITY_OFF`, r.status === 403 && r.body.code === 'CAPABILITY_OFF' && r.body.error === 'Capability off' && /register/.test(r.body.message), r);
  }
  const off = await call('GET', '/register/subjects');
  ok('the refusal has the connector gate keys (error · code · message) and the Problem fields', ['error', 'code', 'message', 'type', 'title', 'status', 'detail', 'hint', 'request_id'].every((k) => k in off.body), off.body);
  /* on: the key */
  world.caps = ['register']; world.rows = false;
  for (const [m, p, b] of DOORS.slice(0, 5)) {
    const r = await call(m, p, b);
    ok(`on shop (key): ${m} ${p.replace(CHIT, ':chit_id')} is not refused by the gate (${r.status})`, r.body.code !== 'CAPABILITY_OFF', r);
  }
  /* existing rows, no key: works with no flip */
  world.caps = []; world.rows = true;
  for (const [m, p, b] of DOORS.slice(0, 5)) {
    const r = await call(m, p, b);
    ok(`shop with register rows, no key: ${m} ${p.replace(CHIT, ':chit_id')} works (${r.status})`, r.body.code !== 'CAPABILITY_OFF', r);
  }
  gate.KNOWN_USERS.clear(); /* the yes of the rows case is remembered per process */
  /* a null capability list is off */
  world.caps = null; world.rows = false;
  ok('a shop whose capability list is null is off', (await call('GET', '/raida/report')).status === 403);
  /* a fault reading the switch closes the door, in the route's own 500 words */
  world.fault = true; world.caps = [];
  const broken = await call('GET', '/raida/report');
  ok('the switch unreadable: 500 INTERNAL in the own words of the route, never open', broken.status === 500 && broken.body.code === 'INTERNAL' && broken.body.error === 'Failed to read the register', broken);
  world.fault = false;
  /* a route that is not the register is untouched */
  world.caps = []; world.rows = false;
  ok('a chit route outside the register is not gated', (await call('GET', '/pulse')).body.code !== 'CAPABILITY_OFF');

  console.log(`\n  ${pass} passed, ${fail} failed`);
  srv.close(); process.exit(fail ? 1 : 0);
});
