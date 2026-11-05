#!/usr/bin/env node
// @type: contract
/**
 * rail-158-service-errors.test.cjs — RAIL-158 (BH-4): PUT /api/service/:chit_id, POST /:chit_id/respond and POST /:chit_id/pause/:pause_id/end answer a plain 4xx problem, never a driver message.
 *
 * OWNS      the proof that a chit id or pause id that is not a uuid answers 404 NOT_FOUND (problem+json, no database text, the query never reaches the database), that a bad `to` time answers 400,
 *           and that a database fault on these routes answers 500 INTERNAL with none of the thrown text.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/service.js over a stand-in sign-in and db.
 * FLOW      stub db + auth → real router on an express app → request over http → status · code · content type · no leak
 * CARD      01-rail-core-the-chit/chits-routes
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
const DRIVER_TEXT = 'invalid input syntax for type uuid: "abc"';
const queries = [];
let fault = null;

/* the stand-in db: like Postgres it refuses a non-uuid id with its own words; a chit is held when asked with GOOD */
const run = async (sql, params) => {
  queries.push(sql);
  if (fault) throw fault;
  if ((params || []).some((p, i) => i < 2 && typeof p === 'string' && p !== SHOP && !/^[0-9a-f-]{36}$/i.test(p))) throw Object.assign(new Error(DRIVER_TEXT), { code: '22P02' });
  if (/FROM chit_header/.test(sql)) return { rows: [{ role: 'x' }] };
  return { rows: [{ copies: 1, responded_at: new Date(0) }] };
};
const stubDb = { query: run };
const dbPath = require.resolve(path.join(ROOT, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { withEntity: async (id, fn) => fn(stubDb), onEntity: async (id, db, fn) => (typeof db === 'function' ? db(stubDb) : fn(stubDb)), pool: {} } };
const authPath = require.resolve(path.join(ROOT, 'middleware', 'auth'));
const stubAuth = (req, res, next) => {
  req.identity = { identity_id: SHOP, identity_type: 'entity' };
  next();
};
stubAuth.entityOf = (req) => req.identity.identity_id;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: stubAuth };

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.id = 'req-test';
  next();
});
app.use('/api/service', require(path.join(ROOT, 'routes', 'service.js')));

let failed = 0;
const check = (ok, label) => {
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label);
};
const ask = (server, method, url, body) =>
  new Promise((resolve) => {
    const data = JSON.stringify(body || {});
    const req = http.request({ port: server.address().port, method, path: url, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', text, body: (() => { try { return JSON.parse(text); } catch (e) { return {}; } })() }));
    });
    req.end(data);
  });

(async () => {
  const server = app.listen(0);
  const routes = [
    ['PUT', '/api/service/abc', {}],
    ['POST', '/api/service/abc/respond', {}],
    ['POST', '/api/service/abc/pause/def/end', {}],
    ['POST', '/api/service/' + GOOD + '/pause/def/end', {}]
  ];
  for (const [method, url, body] of routes) {
    queries.length = 0;
    const a = await ask(server, method, url, body);
    const label = method + ' ' + url;
    check(a.status === 404, label + ' → 404 (got ' + a.status + ')');
    check(a.body.code === 'NOT_FOUND', label + ' → code NOT_FOUND (got ' + a.body.code + ')');
    check(/problem\+json/.test(a.type), label + ' → application/problem+json');
    check(!/invalid input syntax|uuid|22P02/i.test(a.text), label + ' → no driver text');
    check(queries.length === 0, label + ' → the database was never asked');
  }
  queries.length = 0;
  const badTime = await ask(server, 'POST', '/api/service/' + GOOD + '/pause/' + GOOD + '/end', { to: 'not a time' });
  check(badTime.status === 400 && badTime.body.code === 'VALIDATION_FAILED' && !/syntax|timestamp/i.test(badTime.text), 'a bad `to` → 400 VALIDATION_FAILED, no driver text (got ' + badTime.status + ')');
  const okEnd = await ask(server, 'POST', '/api/service/' + GOOD + '/pause/' + GOOD + '/end', {});
  check(okEnd.status === 200, 'a real chit and pause still end (200, got ' + okEnd.status + ')');
  const okResp = await ask(server, 'POST', '/api/service/' + GOOD + '/respond', {});
  check(okResp.status === 200, 'a real chit still responds (200, got ' + okResp.status + ')');
  fault = Object.assign(new Error('connection to server at "10.0.0.5" refused SELECT secret'), { code: '08006' });
  for (const [method, url] of [['PUT', '/api/service/' + GOOD], ['POST', '/api/service/' + GOOD + '/respond'], ['POST', '/api/service/' + GOOD + '/pause/' + GOOD + '/end']]) {
    const a = await ask(server, method, url, {});
    check(a.status === 500 && a.body.code === 'INTERNAL' && !/10\.0\.0\.5|SELECT|refused/.test(a.text), method + ' ' + url.replace(GOOD, ':id') + ' on a database fault → 500 INTERNAL, none of the thrown text (got ' + a.status + ')');
  }
  server.close();
  console.log(failed ? failed + ' FAILED' : 'all passed');
  process.exit(failed ? 1 : 0);
})();
