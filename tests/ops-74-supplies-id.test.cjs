#!/usr/bin/env node
// @type: contract
/**
 * ops-74-supplies-id.test.cjs — OPS-74 (SIT-FULLSET-2026-10-31): PATCH /api/supplies/:id and POST /api/supplies/:id/issue answer 404 for an id that is not a uuid, never 500.
 *
 * OWNS      the proof that a supply id — "abc", "1", a uuid with an extra character, "true" — answers 404 NOT_FOUND as problem+json with no database text and without the store being asked,
 *           and that a real uuid still reaches the handler (200).
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/supplies.js over a stand-in sign-in and a stand-in lib/supply-store that refuses like Postgres.
 * FLOW      stub store + auth → real router on an express app → request over http → status · code · content type · no leak
 * CARD      16-finance/supplies-routes
 * MIN contract — every /:id route × 4 bad ids is 404 problem+json with 0 store calls; one real id per route stays 200.
 * TRACE     routes/supplies.js router.param('id') ← this test
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

/* the stand-in store: like Postgres it refuses a non-uuid id with its own words */
const guardId = (id) => {
  asked++;
  if (!UUID.test(String(id))) throw Object.assign(new Error(DRIVER_TEXT + ': "' + id + '"'), { code: '22P02' });
};
const stub = (rel, exports) => {
  const p = require.resolve(path.join(ROOT, rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
};
stub('lib/supply-store', {
  update: async (entity, id) => (guardId(id), { supply_item_id: id, name: 'x' }),
  issue: async (entity, id) => (guardId(id), { ok: true, balance: 1 }),
  list: async () => [],
  ensure: async () => ({}),
  purchase: async () => ({ recorded: [] })
});
stub('db', { query: async () => ({ rows: [] }), withEntity: async (id, fn) => fn({ query: async () => ({ rows: [] }) }), pool: {} });
const stubAuth = (req, res, next) => {
  req.identity = { identity_id: SHOP, identity_type: 'entity', role: 'owner', level: 'manager' };
  next();
};
stubAuth.entityOf = () => SHOP;
stub('middleware/auth', stubAuth);

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.id = 'req-test';
  next();
});
app.use('/api/supplies', require(path.join(ROOT, 'routes', 'supplies.js')));

let failed = 0;
let total = 0;
const check = (ok, label) => {
  total++;
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label);
};
const ask = (server, method, url, body) =>
  new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request({ port: server.address().port, method, path: url, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', text, body: (() => { try { return JSON.parse(text); } catch (e) { return {}; } })() }));
    });
    req.end(data);
  });

(async () => {
  const server = app.listen(0);
  const routes = [['PATCH', '', { name: 'n' }], ['POST', '/issue', { qty: 1 }]];
  for (const [method, tail, body] of routes) {
    for (const bad of ['abc', '1', GOOD + '0', 'true']) {
      asked = 0;
      const label = method + ' /:id' + tail + ' id "' + bad + '"';
      const a = await ask(server, method, '/api/supplies/' + bad + tail, body);
      check(a.status === 404 && a.body.code === 'NOT_FOUND', label + ' → 404 NOT_FOUND (got ' + a.status + ' ' + a.body.code + ')');
      check(/problem\+json/.test(a.type) && !/invalid input|uuid|22P02/i.test(a.text) && asked === 0, label + ' → problem+json, no driver text, the store never asked');
    }
    asked = 0;
    const ok = await ask(server, method, '/api/supplies/' + GOOD + tail, body);
    check(ok.status === 200 && asked === 1, method + ' /:id' + tail + ' with a real uuid still answers 200 (got ' + ok.status + ')');
  }
  server.close();
  console.log(total + ' checks' + (failed ? ', ' + failed + ' FAILED' : ''));
  process.exit(failed ? 1 : 0);
})();
