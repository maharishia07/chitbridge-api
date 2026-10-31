#!/usr/bin/env node
// @type: contract
/**
 * con-100-101-capture-input.test.cjs — CON-100 / CON-101 (BH-8, BH-15): the capture convert route and the stores route answer a plain 4xx for a bad id or a bad phone, never a driver message.
 *
 * OWNS      the proof that POST /api/capture/:id/convert refuses an id or a chit_id that is not a uuid (404 NOT_FOUND / 400 VALIDATION_FAILED), that POST /api/capture/stores refuses a phone that is not
 *           a text of 7 to 15 digits (400 VALIDATION_FAILED), that none of these reaches the database or leaks its words, that a database fault answers 500 without its text, and that a valid call still answers 200.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/capture.js over a stand-in sign-in and a db that throws Postgres's own words.
 * FLOW      stub db + auth → real router on an express app → request over http → status · code · content type · no leak · db never asked
 * CARD      11-crm-and-marketing/capture
 * MIN       the 4xx answer shape (status, code, problem+json, no driver text, db never asked) and the 200 of a valid call are asserted below.
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

/* the stand-in db: like Postgres it refuses a non-uuid id with its own words */
const run = async (sql, params) => {
  queries.push(sql);
  if (fault) throw fault;
  if ((params || []).some((p) => typeof p === 'string' && /^abc/.test(p))) throw Object.assign(new Error(DRIVER_TEXT), { code: '22P02' });
  if (/INSERT INTO wholesaler_store/.test(sql)) return { rows: [{ store_id: GOOD, phone_key: params[1], display_name: 'x', address: null, provisional: false }] };
  if (/UPDATE capture/.test(sql)) return { rows: [{ id: GOOD, status: 'converted', chit_id: params[0] }] };
  return { rows: [] };
};
const stubDb = { query: run };
const dbPath = require.resolve(path.join(ROOT, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { withEntity: async (id, fn) => fn(stubDb), onEntity: async (id, db, fn) => (typeof db === 'function' ? db(stubDb) : fn(stubDb)), pool: stubDb, query: run } };
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
app.use('/api/capture', require(path.join(ROOT, 'routes', 'capture.js')));

let failed = 0;
let checks = 0;
const check = (ok, label) => {
  checks++;
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label);
};
const ask = (server, method, url, body) =>
  new Promise((resolve) => {
    const data = JSON.stringify(body === undefined ? {} : body);
    const req = http.request({ port: server.address().port, method, path: url, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', text, body: (() => { try { return JSON.parse(text); } catch (e) { return {}; } })() }));
    });
    req.end(data);
  });

/** one refusal: its status, code, content type, no driver text, and the database never asked */
async function refused(server, method, url, body, status, code) {
  queries.length = 0;
  const a = await ask(server, method, url, body);
  const label = method + ' ' + url.replace(GOOD, ':id') + ' ' + JSON.stringify(body);
  check(a.status === status, label + ' → ' + status + ' (got ' + a.status + ')');
  check(a.body.code === code, label + ' → code ' + code + ' (got ' + a.body.code + ')');
  check(/problem\+json/.test(a.type), label + ' → application/problem+json');
  check(!/invalid input syntax|uuid|22P02|wholesaler_store|SELECT|INSERT/i.test(a.text), label + ' → no driver text');
  check(queries.length === 0, label + ' → the database was never asked');
}

(async () => {
  const server = app.listen(0);
  // BH-8 · CON-100
  await refused(server, 'POST', '/api/capture/' + GOOD + '/convert', { chit_id: 'abc' }, 400, 'VALIDATION_FAILED');
  await refused(server, 'POST', '/api/capture/' + GOOD + '/convert', { chit_id: 5 }, 400, 'VALIDATION_FAILED');
  await refused(server, 'POST', '/api/capture/abc/convert', { chit_id: GOOD }, 404, 'NOT_FOUND');
  await refused(server, 'POST', '/api/capture/abc/dismiss', {}, 404, 'NOT_FOUND');
  // BH-15 · CON-101
  for (const phone of [-1, 1e21, 9876543210, true, {}, [], 'abc', '12', '+', '1'.repeat(40)]) await refused(server, 'POST', '/api/capture/stores', { name: 'x', phone }, 400, 'VALIDATION_FAILED');
  await refused(server, 'POST', '/api/capture/stores', { name: 'x' }, 400, 'INVALID_INPUT'); // absent: the library's own refusal, unchanged

  // valid calls still pass
  const conv = await ask(server, 'POST', '/api/capture/' + GOOD + '/convert', { chit_id: GOOD });
  check(conv.status === 200 && conv.body.status === 'converted', 'a real convert still answers 200 (got ' + conv.status + ')');
  const conv2 = await ask(server, 'POST', '/api/capture/' + GOOD + '/convert', {});
  check(conv2.status === 200, 'a convert with no chit_id still answers 200 (got ' + conv2.status + ')');
  for (const phone of ['+91 98400 12321', '09840012321', '9840012321']) {
    const saved = await ask(server, 'POST', '/api/capture/stores', { display_name: 'Anand Stores', phone });
    check(saved.status === 200, 'phone ' + phone + ' still saves (got ' + saved.status + ')');
  }

  // a database fault is a plain 500 with none of the thrown text
  fault = Object.assign(new Error('connection to server at "10.0.0.5" refused SELECT secret'), { code: '08006' });
  for (const [url, body] of [['/api/capture/' + GOOD + '/convert', { chit_id: GOOD }], ['/api/capture/stores', { phone: '9840012321' }]]) {
    const a = await ask(server, 'POST', url, body);
    check(a.status === 500 && !/10\.0\.0\.5|SELECT|refused/.test(a.text), 'POST ' + url.replace(GOOD, ':id') + ' on a database fault → 500, none of the thrown text (got ' + a.status + ')');
  }
  server.close();
  console.log(checks + ' checks' + (failed ? ', ' + failed + ' FAILED' : ''));
  process.exit(failed ? 1 : 0);
})();
