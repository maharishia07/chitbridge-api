#!/usr/bin/env node
// @type: contract
/**
 * net-48-connection-input.test.cjs — NET-48 (BH-9): POST /api/network/connections and POST /api/connections/request answer a plain 4xx for a value that names no one, never a driver message.
 *
 * OWNS      the proof that a parent or child id that is not a uuid (or not text) answers 404 PARENT_NOT_FOUND / CHILD_NOT_FOUND, a handle or bridge id outside 3-64 of [A-Za-z0-9._~-] the same,
 *           a to_entity_id that is not a uuid 404 NOT_FOUND, all as problem+json with no database text and the database never asked; and that a well-formed call is still answered by the service.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes over a stand-in sign-in and a db that throws Postgres's own words.
 * FLOW      stub db + auth → real routers on an express app → request over http → status · code · content type · no leak · queries asked
 * MIN       contract - 404 problem+json with the code the service already uses (PARENT_NOT_FOUND, CHILD_NOT_FOUND, NOT_FOUND); a valid uuid still reaches the service (a 404 from its own lookup, not from the guard).
 * CARD      04-network/connections-and-invitations
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

const ROOT = path.join(__dirname, '..');
const ME = '11111111-1111-4111-8111-111111111111';
const GOOD = '33333333-3333-4333-8333-333333333333';
const DRIVER_TEXT = 'invalid input syntax for type uuid: "abc"';
const queries = [];

/* the stand-in db: the signed-in shop has a node; like Postgres a non-uuid id gets its own words; nothing else is ever found */
const NODE = { id: '44444444-4444-4444-8444-444444444444', bridge_id: 'CBME000000', name: 'Me' };
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const run = async (sql, params) => {
  queries.push(sql);
  const first = (params || [])[0];
  if (/\bid *= *\$1/.test(sql) && !(typeof first === 'string' && UUID_SHAPE.test(first))) throw Object.assign(new Error(DRIVER_TEXT), { code: '22P02' });
  if (/from identities where identity_id/i.test(sql)) return { rows: [{ identity_id: ME, bridge_id: NODE.bridge_id, display_name: 'Me' }] };
  if (/from cb_entity where bridge_id *= *\$1/i.test(sql) && first === NODE.bridge_id) return { rows: [NODE] };
  return { rows: [] };
};
const stubDb = { query: run, connect: async () => ({ query: run, release() {} }) };
const dbPath = require.resolve(path.join(ROOT, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: run, pool: stubDb, withEntity: async (id, fn) => fn(stubDb), onEntity: async (id, db, fn) => (typeof db === 'function' ? db(stubDb) : fn(stubDb)) } };
const srcDb = require.resolve(path.join(ROOT, 'src', 'db'));
require.cache[srcDb] = { id: srcDb, filename: srcDb, loaded: true, exports: { pool: stubDb, withTx: async (fn) => fn(stubDb) } };
const authPath = require.resolve(path.join(ROOT, 'middleware', 'auth'));
const stubAuth = (req, res, next) => {
  req.identity = { identity_id: ME, identity_type: 'entity' };
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
app.use('/api/network', require(path.join(ROOT, 'src', 'routes', 'network.js')));
app.use('/api/connections', require(path.join(ROOT, 'routes', 'connections.js')));

let checks = 0;
let failed = 0;
const check = (ok, label) => {
  checks++;
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

/** [url, body, expected code] — every one names someone who cannot exist */
const BAD = [
  ['/api/network/connections', { parentId: 'abc', childId: 'def' }, 'PARENT_NOT_FOUND'],
  ['/api/network/connections', { parentId: GOOD, childId: 'def' }, 'CHILD_NOT_FOUND'],
  ['/api/network/connections', { parentId: 5 }, 'PARENT_NOT_FOUND'],
  ['/api/network/connections', { childId: { a: 1 } }, 'CHILD_NOT_FOUND'],
  ['/api/network/connections', { parentHandle: 'no spaces allowed' }, 'PARENT_NOT_FOUND'],
  ['/api/network/connections', { parentHandle: 'ab' }, 'PARENT_NOT_FOUND'],
  ['/api/network/connections', { childBridgeId: 'x'.repeat(65) }, 'CHILD_NOT_FOUND'],
  ['/api/network/connections', { childBridgeId: ['CBAAAAAAAA'] }, 'CHILD_NOT_FOUND'],
  ['/api/network/connections', { childHandle: 'shop@else.example' }, 'CHILD_NOT_FOUND'],
  ['/api/connections/request', { to_entity_id: 'abc' }, 'NOT_FOUND'],
  ['/api/connections/request', { to_entity_id: 12345 }, 'NOT_FOUND'],
  ['/api/connections/request', { to_entity_id: true }, 'NOT_FOUND']
];

(async () => {
  const server = app.listen(0);
  for (const [url, body, code] of BAD) {
    queries.length = 0;
    const a = await ask(server, url, body);
    const label = url.replace('/api/', '') + ' ' + JSON.stringify(body).slice(0, 50);
    check(a.status === 404, label + ' → 404 (got ' + a.status + ')');
    check(a.body.code === code, label + ' → code ' + code + ' (got ' + a.body.code + ')');
    check(/problem\+json/.test(a.type), label + ' → application/problem+json');
    check(!/invalid input syntax|uuid|22P02/i.test(a.text), label + ' → no driver text');
    check(queries.length === 0, label + ' → the database was never asked');
  }
  /* a well-formed call is not stopped by the guard: the service looks and finds no one */
  queries.length = 0;
  const known = await ask(server, '/api/network/connections', { parentId: GOOD, childBridgeId: 'CBAAAAAAAA' });
  check(known.status === 404 && queries.length > 0, 'a uuid and a bridge id reach the service (404 from its own lookup, got ' + known.status + ', queries ' + queries.length + ')');
  queries.length = 0;
  const unknownReceiver = await ask(server, '/api/connections/request', { to_entity_id: GOOD });
  check(unknownReceiver.status === 404 && queries.length > 0, 'a uuid receiver reaches the lookup (404 from the database answer)');
  const toSelf = await ask(server, '/api/connections/request', { to_entity_id: ME });
  check(toSelf.status === 400, 'a request to yourself is still refused 400 (got ' + toSelf.status + ')');
  server.close();
  console.log('\n' + checks + ' checks');
  console.log(failed ? failed + ' FAILED' : 'all passed');
  process.exit(failed ? 1 : 0);
})();
