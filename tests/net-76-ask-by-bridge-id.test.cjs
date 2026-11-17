'use strict';
/**
 * tests/net-76-ask-by-bridge-id.test.cjs — NET-76 (owner cb-network): POST /api/network/connections {childBridgeId} for a LOCAL shop that has no node yet makes its node and the edge;
 * a REMOTE shop's bridge id is refused (409 NETWORK_REMOTE_NOT_YET) with nothing written; a shop that already has a node (a remote stub included) is still found first.
 * CALLED BY scripts/guards.cjs. Reuses src/services/network.js askableNodeOfHandle and tests/lib/network-memory.cjs. No DB, no network.
 * CARD      network-and-trade/network-connections
 * Run: node tests/net-76-ask-by-bridge-id.test.cjs
 */
const path = require('path');
const http = require('http');
const express = require('express');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const say = console.log.bind(console);
['log', 'warn', 'info', 'error'].forEach((k) => { console[k] = () => {}; });
const ROOT = path.join(__dirname, '..');
const { memory, A, C } = require('./lib/network-memory.cjs');
let world;
let remote = new Set();
const run = async (sql, params) => world.answer(sql, params) || { rows: [], rowCount: 0 };
const stub = (file, exports) => { const id = require.resolve(path.join(ROOT, file)); require.cache[id] = { id, filename: id, loaded: true, exports }; };
const dbExports = { query: run, pool: { query: run }, withTx: async (fn) => fn({ query: run }), withEntity: async (id, fn) => fn({ query: run }), withTransaction: async (fn) => fn({ query: run }) };
stub('db', dbExports);
stub('src/db', dbExports);
stub('lib/ctpaddress', { ...require(path.join(ROOT, 'lib', 'ctpaddress')), resolve: async (entity_id) => (remote.has(entity_id) ? { entity_id, local: false, installation_key: 'sit-in' } : { entity_id, local: true }) });
const authId = require.resolve(path.join(ROOT, 'middleware', 'auth'));
const authStub = (req, res, next) => { req.identity = { identity_id: A, identity_type: 'entity' }; req.entityId = A; next(); };
Object.assign(authStub, { entityOf: () => A, requireRole: () => (req, res, next) => next(), requireIdentity: authStub });
require.cache[authId] = { id: authId, filename: authId, loaded: true, exports: authStub };

let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; say((ok ? 'ok   ' : 'FAIL ') + label + (ok ? '' : ' :: ' + detail)); };
const ask = (server, body) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
  const req = http.request({ port: server.address().port, path: '/api/network/connections', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
    let text = '';
    res.on('data', (c) => (text += c));
    res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : {} }));
  });
  req.on('error', reject);
  req.end(data);
});

(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/network', require(path.join(ROOT, 'src', 'routes', 'network.js')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try {
    world = memory({ bare: true });
    remote = new Set();
    const made = await ask(server, { childBridgeId: 'CCCC4444', type: 'commercial' });
    check('a local shop with no node, asked by bridge id: 200, its node is made and the edge is requested', made.status === 200 && world.data.entityInserts === 1 && world.data.edges.length === 1 && world.data.edges[0].state === 'requested', made.status + ' ' + JSON.stringify(made.body) + ' inserts ' + world.data.entityInserts);

    world = memory({ bare: true });
    remote = new Set([C]);
    const refused = await ask(server, { childBridgeId: 'CCCC4444', type: 'commercial' });
    check('a remote shop with no node: 409 NETWORK_REMOTE_NOT_YET', refused.status === 409 && refused.body.code === 'NETWORK_REMOTE_NOT_YET', refused.status + ' ' + JSON.stringify(refused.body));
    check('and nothing is written: no node, no edge', world.data.entityInserts === 0 && world.data.edges.length === 0, world.data.entityInserts + ' inserts, ' + world.data.edges.length + ' edges');

    world = memory({ childClaimed: false });
    remote = new Set();
    const known = await ask(server, { childBridgeId: 'CCCC4444', type: 'commercial' });
    check('control: a shop that already has a node is found first and asked (200, no new node)', known.status === 200 && world.data.entityInserts === 0 && world.data.edges.length === 1, known.status + ' ' + JSON.stringify(known.body));

    world = memory({ bare: true });
    remote = new Set();
    const nobody = await ask(server, { childBridgeId: 'ZZZZ9999', type: 'commercial' });
    check('an unknown bridge id is still 404 and writes nothing', nobody.status === 404 && world.data.entityInserts === 0 && world.data.edges.length === 0, nobody.status + ' ' + JSON.stringify(nobody.body));
  } finally {
    server.close();
  }
  say(failed ? failed + ' FAILED' : 'all ok');
  process.exit(failed ? 1 : 0);
})().catch((e) => { say('FAIL crashed :: ' + (e && e.stack || e)); process.exit(1); });
