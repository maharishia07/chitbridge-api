#!/usr/bin/env node
// @type: contract
/**
 * api-18-text-cap.test.cjs — API-18 (BH-16): free text on three routes has a length cap; a longer value is a 400, not a stored row.
 *
 * OWNS      the proof that POST /api/definitions (kind, name: 200), POST /api/keys (name: 200) and POST /api/integrations/heartbeat (id: 200) take a value of exactly the cap,
 *           and refuse cap+1 and 100,000 characters with 400 problem+json naming the field and the database never asked, and refuse a non-string where text belongs (400).
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routers over a stand-in sign-in and a stand-in db that records every query.
 * FLOW      stub db + auth → real routers on an express app → request over http → status · field · content type · queries asked
 * Run: node tests/api-18-text-cap.test.cjs · MIN unit-per-rule · refusal-path · fail-closed (an over-long value is refused before the database)
 * CARD      28-platform-and-operations
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
const CAP = 200;
const queries = [];

const run = async (sql) => {
  queries.push(sql);
  return { rows: [] };
};
const stubDb = { query: run };
const stubTx = async (fn) => fn(stubDb);
const dbPath = require.resolve(path.join(ROOT, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: run, withEntity: async (id, fn) => fn(stubDb), onEntity: async (id, db, fn) => (typeof db === 'function' ? db(stubDb) : fn(stubDb)), withTransaction: stubTx, readBatch: async () => [], pool: {} } };
const schemaPath = require.resolve(path.join(ROOT, 'lib', 'schema'));
require.cache[schemaPath] = { id: schemaPath, filename: schemaPath, loaded: true, exports: { hasTable: async () => true, hasColumn: async () => true, hasColumns: async () => true, checkAllows: async () => true } };
const authPath = require.resolve(path.join(ROOT, 'middleware', 'auth'));
const stubAuth = (req, res, next) => {
  req.identity = { identity_id: SHOP, identity_type: 'entity' };
  next();
};
stubAuth.entityOf = () => SHOP;
stubAuth.requireScope = () => (req, res, next) => next();
stubAuth.SCOPE_NAMES = ['offers', 'connector', 'till'];
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: stubAuth };

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.id = 'req-test';
  next();
});
app.use('/api/definitions', require(path.join(ROOT, 'routes', 'definitions.js')));
app.use('/api/keys', require(path.join(ROOT, 'routes', 'keys.js')));
app.use('/api/integrations', require(path.join(ROOT, 'routes', 'integrations.js')));

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

/* each route: its url, the other fields a good request carries, and the one text field under test */
const CASES = [
  { url: '/api/definitions', field: 'kind', rest: { name: 'Summer' } },
  { url: '/api/definitions', field: 'name', rest: { kind: 'offer' } },
  { url: '/api/keys', field: 'name', rest: {} },
  { url: '/api/integrations/heartbeat', field: 'id', rest: { name: 'tally', host: 'pc' } }
];

(async () => {
  const server = app.listen(0);
  for (const c of CASES) {
    const tag = 'POST ' + c.url + ' ' + c.field;
    const send = (value) => ask(server, c.url, Object.assign({}, c.rest, { [c.field]: value }));

    const atCap = await send('a'.repeat(CAP));
    check(atCap.status !== 400, tag + ' at ' + CAP + ' characters is not refused (got ' + atCap.status + ')');

    for (const size of [CAP + 1, 100000]) {
      queries.length = 0;
      const a = await send('a'.repeat(size));
      check(a.status === 400, tag + ' at ' + size + ' characters → 400 (got ' + a.status + ')');
      check(/problem\+json/.test(a.type), tag + ' at ' + size + ' → problem+json');
      check(a.text.includes(c.field) && a.text.length < 5000, tag + ' at ' + size + ' → names the field, does not echo the value');
      check(queries.length === 0, tag + ' at ' + size + ' → 0 database writes (got ' + queries.length + ')');
    }

    for (const bad of [12345, ['x'], { a: 1 }, true]) {
      queries.length = 0;
      const a = await send(bad);
      check(a.status === 400 && queries.length === 0, tag + ' = ' + JSON.stringify(bad) + ' → 400, database never asked (got ' + a.status + ')');
    }
  }
  server.close();
  console.log('\n' + (total - failed) + '/' + total + ' passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
