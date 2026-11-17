#!/usr/bin/env node
// @type: contract
/**
 * ord-73-repeat-input.test.cjs — ORD-73 (BH-7): POST /api/repeat/:id/accept, /counter, /decline and /skip answer a plain 4xx for a bad id or chit, never 500.
 *
 * OWNS      the proof that a chit_id (body or ?chit=) that is not a uuid — "abc", true, -1, 1e21 — answers 400 REPEAT_BAD_REQUEST, that an agreement id that is not a uuid answers
 *           404 NOT_FOUND, both as problem+json with no database text and without the query reaching the database, and that a real call still answers 200.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/repeat-supply.js over a stand-in sign-in and a stand-in lib/repeat-supply that refuses like Postgres.
 * FLOW      stub lib + auth → real router on an express app → request over http → status · code · content type · no leak
 * CARD      02-tasks-orders-and-workflow/repeat-supply
 * MIN contract — the 4 routes × 4 bad chit values and a bad agreement id are 4xx problem+json; one real call per route stays 200.
 * TRACE     routes/repeat-supply.js chitNamed + router.param('id') ← this test
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

const ROOT = path.join(__dirname, '..');
const SHOP = '11111111-1111-4111-8111-111111111111';
const GOOD = '33333333-3333-4333-8333-333333333333';
const DRIVER_TEXT = 'invalid input syntax for type uuid';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let asked = 0;

/* the stand-in library: like Postgres it refuses a non-uuid id with its own words */
const held = () => ({ agreement_id: GOOD, entity_id: SHOP, chit_id: GOOD, state: 'active' });
const verb = async (entity, id, chit) => {
  asked++;
  for (const v of [id, chit]) if (v && !UUID.test(String(v))) throw Object.assign(new Error(DRIVER_TEXT + ': "' + v + '"'), { code: '22P02' });
  return held();
};
const repeatPath = require.resolve(path.join(ROOT, 'lib', 'repeat-supply'));
require.cache[repeatPath] = { id: repeatPath, filename: repeatPath, loaded: true, exports: { accept: verb, counter: verb, decline: verb, skip: verb, one: async () => ({ agreement: held() }), migrated: async () => true } };
const dbPath = require.resolve(path.join(ROOT, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: async () => ({ rows: [] }), withEntity: async (id, fn) => fn({ query: async () => ({ rows: [] }) }), pool: {} } };
const authPath = require.resolve(path.join(ROOT, 'middleware', 'auth'));
const stubAuth = (req, res, next) => {
  req.identity = { identity_id: SHOP, identity_type: 'entity', role: 'owner', level: 'manager' };
  next();
};
stubAuth.entityOf = () => SHOP;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: stubAuth };

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.id = 'req-test';
  next();
});
app.use('/api/repeat', require(path.join(ROOT, 'routes', 'repeat-supply.js')));

let failed = 0;
let total = 0;
const check = (ok, label) => {
  total++;
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label);
};
const ask = (server, url, body) =>
  new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request({ port: server.address().port, method: 'POST', path: url, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', text, body: (() => { try { return JSON.parse(text); } catch (e) { return {}; } })() }));
    });
    req.end(data);
  });

(async () => {
  const server = app.listen(0);
  for (const act of ['accept', 'counter', 'decline', 'skip']) {
    for (const bad of ['{"chit_id":"abc"}', '{"chit_id":true}', '{"chit_id":-1}', '{"chit_id":1e21}']) {
      asked = 0;
      const label = act + ' ' + bad;
      const a = await ask(server, '/api/repeat/' + GOOD + '/' + act, JSON.parse(bad));
      check(a.status === 400 && a.body.code === 'REPEAT_BAD_REQUEST', label + ' → 400 REPEAT_BAD_REQUEST (got ' + a.status + ' ' + a.body.code + ')');
      check(/problem\+json/.test(a.type) && !/invalid input|uuid|22P02/i.test(a.text) && asked === 0, label + ' → problem+json, no driver text, the library never asked');
    }
    asked = 0;
    const q = await ask(server, '/api/repeat/' + GOOD + '/' + act + '?chit=abc', {});
    check(q.status === 400 && asked === 0, act + ' ?chit=abc → 400 before the library (got ' + q.status + ')');
    const id = await ask(server, '/api/repeat/abc/' + act, { chit_id: GOOD });
    check(id.status === 404 && id.body.code === 'NOT_FOUND' && !/invalid input|uuid/i.test(id.text) && asked === 0, act + ' with agreement id "abc" → 404 NOT_FOUND, no driver text (got ' + id.status + ')');
    const ok = await ask(server, '/api/repeat/' + GOOD + '/' + act, { chit_id: GOOD });
    check(ok.status === 200, act + ' with real ids still answers 200 (got ' + ok.status + ')');
  }
  server.close();
  console.log(total + ' checks' + (failed ? ', ' + failed + ' FAILED' : ''));
  process.exit(failed ? 1 : 0);
})();
