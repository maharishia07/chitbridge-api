#!/usr/bin/env node
// @type: unit
/**
 * plt86c-bills-inflight-503.test.cjs — PLT-86c: a database connection killed under GET /api/till/bills answers 503 DB_CONNECTION_LOST.
 *
 * SIT kill test (62 backends killed under 120 requests): 6 answered 500 INTERNAL. ROOT CAUSE: the route's catch is problem(req, res, failed(e, req)),
 * and failed() = lib/problem.js internalSpec, which never asked lib/knownerr connectionLost, so knownerr's own 57P01 / "not queryable" mapping was not reached.
 * The real routes/till.js over a stand-in auth and a db whose withEntity throws the exact error pg throws (stack inside node_modules/pg/lib/client.js).
 * HAND-COMPUTED: 57P01 FATAL, "not queryable" (no code), "Connection terminated unexpectedly" -> 503 problem+json code DB_CONNECTION_LOST, no driver words;
 * an ordinary error (and a look-alike message from a non-pg stack) -> 500 INTERNAL.
 * RUN node tests/plt86c-bills-inflight-503.test.cjs      CARD 28-platform-and-operations/api-standard
 */
'use strict';
const path = require('path');
const express = require('express');
const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const SHOP = '11111111-1111-4111-8111-111111111111';
const mock = (relative, exported) => {
  const file = require.resolve(path.join(HERE, relative));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exported };
};
let toThrow = null;
const realAuth = require(path.join(HERE, 'middleware', 'auth'));
const stubAuth = (req, res, next) => { req.identity = { identity_id: SHOP, identity_type: 'entity', display_name: 'Test shop' }; next(); };
mock('middleware/auth', Object.assign(stubAuth, realAuth, { entityOf: () => SHOP }));
const db = new Proxy({ withEntity: async () => { throw toThrow; } }, { get: (t, n) => (n in t ? t[n] : typeof n === 'symbol' || n === 'then' ? undefined : async () => ({ rows: [], rowCount: 0 })) });
mock('db', db);
mock('db/index', db);
const logged = [];
console.error = (...a) => logged.push(a.join(' '));
console.warn = () => undefined;

const PG_STACK = (what) => 'error: ' + what + '\n    at Parser.parseErrorMessage (/x/node_modules/pg-protocol/dist/parser.js:285:98)\n    at Client._handleErrorMessage (/x/node_modules/pg/lib/client.js:652:17)';
const pgFatal = () => Object.assign(new Error('terminating connection due to administrator command'), { name: 'error', severity: 'FATAL', code: '57P01', stack: PG_STACK('terminating connection due to administrator command') });
const notQueryable = () => Object.assign(new Error('Client has encountered a connection error and is not queryable'), { stack: PG_STACK('Client has encountered a connection error and is not queryable') });
const terminated = () => Object.assign(new Error('Connection terminated unexpectedly'), { stack: PG_STACK('x') });
const lookAlike = () => new Error('Client has encountered a connection error and is not queryable');

const CASES = [
  ['57P01 FATAL from the db call', pgFatal, 503, 'DB_CONNECTION_LOST'],
  ['"not queryable", no code', notQueryable, 503, 'DB_CONNECTION_LOST'],
  ['"Connection terminated unexpectedly", no code', terminated, 503, 'DB_CONNECTION_LOST'],
  ['the same words from a non-pg stack stay a fault', lookAlike, 500, 'INTERNAL'],
  ['an ordinary error stays a fault', () => new Error('boom'), 500, 'INTERNAL']
];
let failed = 0;
const check = (what, ok, extra) => { console.log((ok ? '  ok  ' : '  FAIL ') + what + (ok ? '' : ' ' + JSON.stringify(extra))); if (!ok) failed++; };
(async () => {
  const router = require(path.join(HERE, 'routes/till.js'));
  const app = express();
  app.use((req, res, next) => { req.id = 'req-test'; next(); });
  app.use('/api/till', router);
  const server = app.listen(0);
  for (const [what, make, status, code] of CASES) {
    toThrow = make();
    logged.length = 0;
    const res = await fetch('http://127.0.0.1:' + server.address().port + '/api/till/bills');
    const text = await res.text();
    let body = {};
    try { body = JSON.parse(text); } catch (e) { /* reported below */ }
    check(what + ' -> ' + status + ' ' + code, res.status === status && body.code === code, { status: res.status, text: text.slice(0, 200) });
    check(what + ': problem+json', /application\/problem\+json/.test(res.headers.get('content-type') || ''), res.headers.get('content-type'));
    check(what + ': no driver words in the answer', !/administrator command|not queryable|Connection terminated/.test(text), text);
    check(what + ': the API error line carries the code', !make().code || logged.some((line) => line.includes('"code":"' + make().code + '"')), logged);
  }
  server.close();
  console.log(failed ? failed + ' FAILED' : 'all ok');
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 50);
})();
