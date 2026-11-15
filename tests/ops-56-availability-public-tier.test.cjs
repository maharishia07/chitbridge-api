#!/usr/bin/env node
/**
 * ops-56-availability-public-tier.test.cjs — OPS-56 (proof 2026-11-15): "who stocks this?" reads a supplier's catalogue at the PUBLIC tier only.
 * @type regression
 * OWNS      the proof that GET /api/relationships/suppliers/availability builds every answer from the one lib/catalogue-view.buildPublicView, handing it the signed-in
 *           shop's own bridge id as the viewer (never the supplier's, never a widened one), the supplier's identity row as the entity, and no tier switch of its own: adding a
 *           supplier is unilateral, so the self-asserted link must not read more than a stranger could. A supplier with no published catalogue costs no read at all.
 *           (The four states and the bounded concurrency of 6 are proven in tests/relationships-availability.test.cjs, OPS-55 and OPS-57; not repeated here.)
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route over a stand-in db and auth; buildPublicView is a spy.
 * FLOW      supplier rows (stand-in db) → GET /suppliers/availability?q= → the spy's calls: viewer, entity, extra keys
 * CARD      12-suppliers-and-procurement/supplier-availability-and-their-catalogue
 *   node tests/ops-56-availability-public-tier.test.cjs
 */
'use strict';
const path = require('path');
const express = require('express');
const { API, ok, done, mock, standInDb, call } = require('./lib/cat-proof-kit.cjs');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const ME = '11111111-1111-4111-8111-111111111111', MY_BRIDGE = 'CB-ME-0001';
const row = (n, has) => ({ supplier_list_id: 's' + n, supplier_entity_id: 'e' + n, bridge_id: 'CB-S-' + n, user_id: 'u' + n, display_name: 'Supplier ' + n, nickname: null, preferred: false, currency_code: 'INR', business_status: 'open', has_catalogue: has });
const suppliers = [row('a', true), row('b', true), row('none', false)];
const { db } = standInDb((sql) => (/FROM supplier_list sl/.test(sql) && /has_catalogue/.test(sql) ? { rows: suppliers } : null));
const realAuth = require(path.join(API, 'middleware', 'auth'));
mock('middleware/auth', Object.assign((req, res, next) => { req.identity = { identity_id: ME, identity_type: 'entity', bridge_id: MY_BRIDGE }; next(); }, realAuth, { entityOf: () => ME, requireScope: () => (q, s, n) => n() }));
mock('db', db); mock('db/index', db);
const cv = require(path.join(API, 'lib', 'catalogue-view.js'));
const seen = [];
cv.buildPublicView = async (args) => { seen.push(args); return { available: true, items: [{ item_id: 'i1', item_data: { name: 'Steel bolt' } }], shop: {} }; };
const realErr = console.error, realWarn = console.warn;
console.error = () => undefined; console.warn = () => undefined;

(async () => {
  const app = express(); app.use(express.json());
  app.use('/api/relationships', require(path.join(API, 'routes', 'relationships.js')));
  const server = app.listen(0); const port = server.address().port;
  try {
    const r = await call(port, 'GET', '/api/relationships/suppliers/availability?q=bolt');
    console.error = realErr; console.warn = realWarn;
    ok('the search answered, and both published catalogues were read', r.status === 200 && seen.length === 2, JSON.stringify([r.status, seen.length]));
    ok('every read hands buildPublicView the signed-in shop\'s own bridge id as the viewer', seen.every((a) => a.viewer === MY_BRIDGE), JSON.stringify(seen.map((a) => a.viewer)));
    ok('the entity read is the supplier\'s own identity row (their id, bridge id), not the viewer\'s', seen.map((a) => a.entity.identity_id).sort().join() === 'ea,eb' && seen.every((a) => /^CB-S-/.test(a.entity.bridge_id)), JSON.stringify(seen.map((a) => a.entity)));
    ok('the route adds no tier switch of its own (no tier, scope, related or force key reaches the builder)', seen.every((a) => !('tier' in a) && !('scope' in a) && !('related' in a) && !('force' in a) && !('as_member' in a)), JSON.stringify(Object.keys(seen[0] || {})));
    ok('the supplier with no published catalogue cost no catalogue read, and is "nocat"', !seen.some((a) => a.entity.identity_id === 'enone') && (r.body.results.find((x) => x.supplier_entity_id === 'enone') || {}).state === 'nocat', JSON.stringify(r.body.results));
  } finally { server.close(); }
  done();
})();
