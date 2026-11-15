#!/usr/bin/env node
/**
 * net-trace-networks-listed.test.cjs — network traceability (proof 2026-11-15): the networks a shop is in, read from the trace edges it co-holds.
 * @type regression
 * OWNS      the proof of GET /api/chits/trace/networks (routes/chits-trace.js): each row names the network id, says whether the CALLER is its operator (the caller's own entity id
 *           is the only parameter, so operator-ness is never taken from the request), counts the edges as a number, keeps the SQL's order, never lists an unnamed network (the read
 *           is limited to edges with a network id), and a caller in no network gets an empty list; plus lib/trace.js buildEdge: a handoff scoped to a network carries { id, operator }
 *           (operator only when it is a uuid, id cut to 64), and an edge with neither carries no network key.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route over a stand-in db that answers the grouped read.
 * FLOW      edges (stand-in rows) → GET /trace/networks → { networks: [{ network_id, is_operator, edges }] } · buildEdge(input.network) → edge.network
 * CARD      04-network/network-traceability
 *   node tests/net-trace-networks-listed.test.cjs
 */
'use strict';
const path = require('path');
const express = require('express');
const { API, ok, done, mock, standInDb, call } = require('./lib/cat-proof-kit.cjs');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const ME = '11111111-1111-4111-8111-111111111111', OP = '22222222-2222-4222-8222-222222222222';
const world = { rows: [] };
const { db, calls } = standInDb((sql) => (/AS network_id/.test(sql) ? { rows: world.rows } : null));
const realAuth = require(path.join(API, 'middleware', 'auth'));
mock('middleware/auth', Object.assign((req, res, next) => { req.identity = { identity_id: ME, identity_type: 'entity' }; next(); }, realAuth, { entityOf: () => ME, requireScope: () => (q, s, n) => n() }));
mock('db', db); mock('db/index', db);
const realErr = console.error, realWarn = console.warn;
console.error = () => undefined; console.warn = () => undefined;

(async () => {
  const app = express(); app.use(express.json());
  app.use('/api/chits', require(path.join(API, 'routes', 'chits-trace.js')));
  const server = app.listen(0); const port = server.address().port;
  try {
    world.rows = [{ network_id: 'tea-chain', is_operator: true, edges: '7' }, { network_id: 'spice-co-op', is_operator: null, edges: '2' }, { network_id: 'mill', is_operator: false, edges: 1 }];
    const r = await call(port, 'GET', '/api/chits/trace/networks');
    const read = calls.find((c) => /AS network_id/.test(c.sql));
    world.rows = [];
    const none = await call(port, 'GET', '/api/chits/trace/networks');
    console.error = realErr; console.warn = realWarn;
    const nets = r.body.networks || [];
    ok('each network is named, in the order the read gave', r.status === 200 && JSON.stringify(nets.map((n) => n.network_id)) === JSON.stringify(['tea-chain', 'spice-co-op', 'mill']), JSON.stringify(r.body));
    ok('is_operator is a real boolean (a null from the read is false, never "unknown")', nets.map((n) => n.is_operator).join() === 'true,false,false' && nets.every((n) => typeof n.is_operator === 'boolean'), JSON.stringify(nets));
    ok('edges are numbers, whatever the driver returned (a count string "7" becomes 7)', nets.map((n) => n.edges).join() === '7,2,1' && nets.every((n) => typeof n.edges === 'number'), JSON.stringify(nets));
    ok('operator-ness is judged against the signed-in entity, passed as the one parameter', !!read && read.params.length === 1 && read.params[0] === ME, JSON.stringify(read && read.params));
    ok('the read is limited to edges that name a network, grouped by it, most edges first', !!read && /network'->>'id' IS NOT NULL/.test(read.sql) && /GROUP BY 1/.test(read.sql) && /ORDER BY edges DESC/.test(read.sql), read && read.sql.slice(0, 300));
    ok('a shop in no network gets an empty list, not an error', none.status === 200 && Array.isArray(none.body.networks) && none.body.networks.length === 0, JSON.stringify(none.body));
  } finally { server.close(); }
  const { buildEdge } = require(path.join(API, 'lib', 'trace.js'));
  const P = '33333333-3333-4333-8333-333333333333';
  const scoped = buildEdge({ is_origin: true, qty: 5, unit: 'kg', network: { id: 'tea-chain', operator: OP } }).edge;
  const badOp = buildEdge({ is_origin: true, network: { id: 'tea-chain', operator: 'not-a-uuid' } }).edge;
  const long = buildEdge({ parents: [P], network: { id: 'x'.repeat(100) } }).edge;
  const neither = buildEdge({ is_origin: true, network: { id: '  ', operator: 5 } }).edge;
  ok('buildEdge: a network-scoped handoff carries { id, operator }', scoped.network && scoped.network.id === 'tea-chain' && scoped.network.operator === OP, JSON.stringify(scoped));
  ok('buildEdge: an operator that is not a uuid is dropped (id kept)', badOp.network && badOp.network.id === 'tea-chain' && badOp.network.operator === null, JSON.stringify(badOp));
  ok('buildEdge: a network id is cut to 64 characters', long.network.id.length === 64, String(long.network && long.network.id.length));
  ok('buildEdge: a blank id and a non-uuid operator mean no network key at all', !('network' in neither), JSON.stringify(neither));
  done();
})();
