#!/usr/bin/env node
/**
 * cat-93-group-offers-link.test.cjs — CAT-93 (proof 2026-11-14): customer-group offers are priced per VIEWER group over the supplier link.
 * @type regression
 * OWNS      the proof that GET /api/relationships/suppliers answers each supplier's `for_you` with only the offers scoped to a group the signed-in
 *           shop is in (its segment, or customer:<id>): a 'regular' viewer sees the regular offer, a 'high_value' viewer sees the high_value one,
 *           an offer for neither group is never shown, and an offer with no group is not listed as "for you". The groups are read from
 *           customer_list through lib/customer-groups (real); the supplier's live offers are a stand-in.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route over a stand-in db and auth.
 * FLOW      viewer segment (db) + supplier offers (stand-in) → GET /suppliers → rows[0].for_you labels
 *   node tests/cat-93-group-offers-link.test.cjs
 */
'use strict';
const path = require('path');
const express = require('express');
const { API, ok, done, mock, standInDb, call } = require('./lib/cat-proof-kit.cjs');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const ME = '11111111-1111-4111-8111-111111111111', SUP = '99999999-9999-4999-8999-999999999999';
const world = { segment: 'regular' };
const OFFERS = [
  { offer_id: 'o1', label: '5% for regulars', kind: 'percent_off', value: 5, scope: 'line', customer_group: 'regular' },
  { offer_id: 'o2', label: '12% for high value', kind: 'percent_off', value: 12, scope: 'line', customer_group: 'high_value' },
  { offer_id: 'o3', label: 'Everyone 2%', kind: 'percent_off', value: 2, scope: 'line' }
];
const { db } = standInDb((sql) => {
  if (/FROM supplier_list sl/.test(sql)) return { rows: [{ supplier_entity_id: SUP, display_name: 'Chola Traders', on_rail: true, supplier_money: 'INR' }] };
  if (/FROM customer_list cl/.test(sql) && /AS segment/.test(sql)) return { rows: [{ segment: world.segment, groups: [] }] };
  return { rows: [], rowCount: 0 };
});
const realAuth = require(path.join(API, 'middleware', 'auth'));
mock('middleware/auth', Object.assign((req, res, next) => { req.identity = { identity_id: ME, identity_type: 'entity' }; next(); }, realAuth, { entityOf: () => ME, requireScope: () => (q, s, n) => n() }));
mock('db', db); mock('db/index', db);
const cv = require(path.join(API, 'lib', 'catalogue-view.js'));
cv.liveOffers = async ({ entity_id }) => (String(entity_id) === SUP ? OFFERS.map((x) => Object.assign({}, x)) : []);
const realErr = console.error, realWarn = console.warn;
console.error = () => undefined; console.warn = () => undefined;

(async () => {
  const app = express(); app.use(express.json());
  app.use('/api/relationships', require(path.join(API, 'routes', 'relationships.js')));
  const server = app.listen(0); const port = server.address().port;
  const forYou = async (segment) => {
    world.segment = segment;
    const r = await call(port, 'GET', '/api/relationships/suppliers');
    const row = ((r.body.suppliers || r.body.data || r.body.rows || r.body.items || []).find((x) => x.supplier_entity_id === SUP)) || {};
    return { status: r.status, labels: (row.for_you || []).map((x) => x.label), row, body: r.body };
  };
  try {
    const reg = await forYou('regular'), hv = await forYou('high_value'), none = await forYou('inactive');
    console.error = realErr; console.warn = realWarn;
    ok('a regular viewer is shown only the regular offer (5% for regulars)', reg.status === 200 && JSON.stringify(reg.labels) === JSON.stringify(['5% for regulars']), JSON.stringify([reg.status, reg.labels, Object.keys(reg.body)]));
    ok('a high_value viewer is shown only the high_value offer (12%)', JSON.stringify(hv.labels) === JSON.stringify(['12% for high value']), JSON.stringify(hv.labels));
    ok('a viewer in neither group is shown none (and the all-customers offer is not listed as "for you")', none.labels.length === 0, JSON.stringify(none.labels));
  } finally { server.close(); }
  done();
})();
