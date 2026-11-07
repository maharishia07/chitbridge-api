#!/usr/bin/env node
// @type: unit
/**
 * net-edge-answer-keys.test.cjs — NET-EDGE (owner cb-network): the five POST /api/network/connections/:id/{approve,decline,suspend,resume,disconnect} answers name their keys.
 *
 * RULE      the service answers the raw `returning *` cb_edge row (14 columns); the closed output schema (docs/contracts/api-output-shapes.json) lists 8.
 *           The route answers EDGE_KEYS only (service edgeView), so a column added to cb_edge never reaches a client unasked (SEC-134 pattern, lib/network-offers.js memberColumns).
 * HAND-COMPUTED  the service is stood in with a row of the 14 cb_edge columns plus one invented column; each of the five routes must answer exactly
 *           id, parent_id, child_id, type, state, requested_by, in_flight, created_at (8 keys) and none of approved_by, decided_at, archived_at, alias_name, assign_to, legacy_id, planted.
 * RUN       node tests/net-edge-answer-keys.test.cjs
 * CARD      04-network/connections-and-invitations
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
const EDGE = '22222222-2222-4222-8222-222222222222';
const A = '11111111-1111-4111-8111-111111111111';
const stub = (file, exports) => { const id = require.resolve(path.join(ROOT, file)); require.cache[id] = { id, filename: id, loaded: true, exports }; };
const none = async () => ({ rows: [], rowCount: 0 });
const dbExports = { query: none, pool: { query: none }, withTx: async (fn) => fn({ query: none }), withEntity: async (id, fn) => fn({ query: none }), withTransaction: async (fn) => fn({ query: none }) };
stub('db', dbExports);
stub('src/db', dbExports);
const authStub = (req, res, next) => { req.identity = { identity_id: A, identity_type: 'entity' }; req.entityId = A; next(); };
authStub.entityOf = () => A;
authStub.requireRole = () => (req, res, next) => next();
authStub.requireIdentity = authStub;
stub('middleware/auth', authStub);

const ALLOWED = ['id', 'parent_id', 'child_id', 'type', 'state', 'requested_by', 'in_flight', 'created_at'];
const WHOLE_ROW = { id: EDGE, parent_id: 'p1', child_id: 'c1', type: 'commercial', state: 'active', requested_by: 'p1', in_flight: false, created_at: '2026-11-07T00:00:00Z',
  approved_by: 'c1', decided_at: '2026-11-07T01:00:00Z', archived_at: null, alias_name: 'x', assign_to: null, legacy_id: null, planted: 'secret' };
const real = require(path.join(ROOT, 'src', 'services', 'network.js'));
const wholeRow = async () => ({ ...WHOLE_ROW });
const standIn = { ...real, nodeOf: async () => ({ id: 'p1' }), approve: wholeRow, decline: wholeRow, suspend: wholeRow, resume: wholeRow, disconnect: wholeRow };
stub('src/services/network.js', standIn);

let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; say((ok ? 'ok   ' : 'FAIL ') + label + (ok ? '' : ' :: ' + detail)); };
function post(server, verb) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port: server.address().port, path: '/api/network/connections/' + EDGE + '/' + verb, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': 2 } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, text, body: text ? JSON.parse(text) : {} }));
    });
    req.on('error', reject);
    req.end('{}');
  });
}
(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/network', require(path.join(ROOT, 'src', 'routes', 'network.js')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try {
    check('the allowed keys are the 8 the schema names', ALLOWED.join() === (real.EDGE_KEYS || []).join(), String(real.EDGE_KEYS));
    for (const verb of ['approve', 'decline', 'suspend', 'resume', 'disconnect']) {
      const r = await post(server, verb);
      const keys = Object.keys(r.body).sort().join();
      check(verb + ': 200 and exactly the 8 keys', r.status === 200 && keys === ALLOWED.slice().sort().join(), r.status + ' ' + r.text);
      check(verb + ': the values are the row\'s', r.body.id === EDGE && r.body.state === 'active' && r.body.in_flight === false, r.text);
    }
  } finally { server.close(); }
  say(failed ? failed + ' FAILED' : 'all ok');
  process.exit(failed ? 1 : 0);
})();
