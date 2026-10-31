#!/usr/bin/env node
// @type: contract
/**
 * api-17-query-day.test.cjs — API-17 (BH-6): a ?since= that is not a day answers 400 VALIDATION_FAILED, never 500, on the three report routes.
 *
 * OWNS      the proof that GET /api/folders/mis, GET /api/relationships/scorecard and GET /api/capture/consolidate refuse a since of 7, -1, abc, an impossible
 *           day (2026-02-30) or a value given twice with 400 application/problem+json code VALIDATION_FAILED, without asking the database, and that a real day still answers 200.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes over a stand-in sign-in and a db that refuses a bad timestamp with Postgres's own words (22007).
 * FLOW      stub db + auth → real routers on an express app → request over http → status · code · content type · no driver text · queries asked
 * CARD      01-rail-core-the-chit/chits-routes
 *
 * MIN 3 checks
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
const DRIVER_TEXT = 'invalid input syntax for type timestamp';
const queries = [];

/* the stand-in db: like Postgres it refuses a text that is not a timestamp with its own words; every other read is an empty list */
const run = async (sql, params) => {
  queries.push(sql);
  if (/::timestamp/.test(sql) && (params || []).some((p) => ['7', '-1', 'abc'].includes(p))) throw Object.assign(new Error(DRIVER_TEXT), { code: '22007' });
  return { rows: [] };
};
const stubDb = { query: run };
const dbPath = require.resolve(path.join(ROOT, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: run, withEntity: async (id, fn) => fn(stubDb), onEntity: async (id, db, fn) => (typeof db === 'function' ? db(stubDb) : fn(stubDb)), pool: {} } };
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
app.use('/api/folders', require(path.join(ROOT, 'routes', 'folders.js')));
app.use('/api/relationships', require(path.join(ROOT, 'routes', 'relationships.js')));
app.use('/api/capture', require(path.join(ROOT, 'routes', 'capture.js')));

let failed = 0;
let total = 0;
const check = (ok, label) => {
  total++;
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label);
};
const ask = (server, url) =>
  new Promise((resolve) => {
    http.get({ port: server.address().port, path: url }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', text, body: (() => { try { return JSON.parse(text); } catch (e) { return {}; } })() }));
    });
  });

(async () => {
  const server = app.listen(0);
  const paths = ['/api/folders/mis', '/api/relationships/scorecard', '/api/capture/consolidate'];
  const bad = ['since=7', 'since=-1', 'since=abc', 'since=2026-02-30', 'since=2026-10-01&since=2026-10-02'];
  for (const base of paths) {
    for (const q of bad) {
      queries.length = 0;
      const a = await ask(server, base + '?' + q);
      const label = base + '?' + q;
      check(a.status === 400, label + ' → 400 (got ' + a.status + ')');
      check(a.body.code === 'VALIDATION_FAILED', label + ' → code VALIDATION_FAILED (got ' + a.body.code + ')');
      check(/problem\+json/.test(a.type), label + ' → application/problem+json');
      check(!/invalid input syntax|22007/i.test(a.text), label + ' → no driver text');
      check(queries.length === 0, label + ' → the database was never asked');
    }
    const ok = await ask(server, base + '?since=2026-10-01');
    check(ok.status === 200, base + '?since=2026-10-01 → 200 (got ' + ok.status + ')');
    const none = await ask(server, base);
    check(none.status === 200, base + ' with no since → 200 (got ' + none.status + ')');
  }
  server.close();
  console.log(total + ' checks' + (failed ? ', ' + failed + ' FAILED' : ''));
  process.exit(failed ? 1 : 0);
})();
