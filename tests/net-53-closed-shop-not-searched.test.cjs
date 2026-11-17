#!/usr/bin/env node
// @type: unit
/**
 * net-53-closed-shop-not-searched.test.cjs — NET-53 (triage 12 Nov 2026): a closed shop is not searched in its network.
 *
 * OWNS      the proof that GET /api/network-design/availability (the fast path over network_search AND the per-store fan-out) and GET /api/network-design/stores
 *           leave out a member whose business_status is 'closed' (Athi, 20 Aug 2026: "network + closed, not visible to network also"), keep an open member in the same
 *           answer (the positive control), and fall back to the fan-out, still filtered, when the fast path's closed-shop read fails.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/network-design.js over a stand-in sign-in and a canned database.
 * FLOW      auth stand-in → placeOf · tree · network_search | the fan-out's entity read → the answer's stores and rows
 * CARD      04-network/search
 * UNIT      04/Network search
 * MUTATION  checked once: in routes/network-design.js delete the `withoutClosedShops` line after the network_search query → "the fast path" check goes red; delete the isClosed line of the fan-out filter → "the fan-out" goes red.
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
const ME = '11111111-1111-4111-8111-111111111111';
const OPEN = '22222222-2222-4222-8222-222222222222';
const SHUT = '33333333-3333-4333-8333-333333333333';
const shopRow = (id, name, bridge, status) => ({ identity_id: id, bridge_id: bridge, display_name: name, purpose: 'store', city: 'Chennai', lat: null, lng: null, currency_code: 'INR', service_km: null, dispatch_days: null, ship_within_days: null, ship_beyond_days: null, sort_order: null, catalogue_visibility: 'network', plan: 'free', params_override: {}, business_status: status });
const SHOPS = [shopRow(OPEN, 'Open Rice Shop', 'BR-OPEN', 'open'), shopRow(SHUT, 'Closed Rice Shop', 'BR-SHUT', 'closed')];
const world = { fastPath: true, closedReadFails: false };
const queries = [];
const stubDb = async (sql, params) => {
  queries.push(sql);
  if (/SELECT identity_id, bridge_id, display_name, lat, lng FROM identities WHERE identity_id = \$1/.test(sql)) return { rows: [{ identity_id: ME, bridge_id: 'BR-ME', display_name: 'Me', lat: null, lng: null }] };
  if (/FROM network_search/.test(sql)) {
    if (!world.fastPath) throw new Error('function network_search does not exist');
    return { rows: SHOPS.map((s) => ({ entity_id: s.identity_id, bridge_id: s.bridge_id, store_name: s.display_name, city: s.city, currency_code: 'INR', lat: null, lng: null, service_km: null, dispatch_days: null, ship_within_days: null, ship_beyond_days: null, sort_order: null, item_id: 'item-' + s.bridge_id, item_data: { name: 'Rice', price: { amount: 5000, currency: 'INR' } }, catalogue_visibility: 'network', plan: 'free', params_override: {} })) };
  }
  if (/SELECT identity_id, business_status FROM identities WHERE identity_id = ANY/.test(sql)) {
    if (world.closedReadFails) throw new Error('read failed');
    return { rows: SHOPS.filter((s) => params[0].indexOf(s.identity_id) >= 0).map((s) => ({ identity_id: s.identity_id, business_status: s.business_status })) };
  }
  if (/FROM identities\s+WHERE bridge_id = ANY/.test(sql)) return { rows: SHOPS.filter((s) => params[0].indexOf(s.bridge_id) >= 0) }; /* the member read of the fan-out and of GET /stores (the row carries business_status, as the real query selects it) */
  if (/FROM catalogue_items/.test(sql)) return { rows: [{ item_id: 'item-' + params[0], item_data: { name: 'Rice', price: { amount: 5000, currency: 'INR' } } }] };
  return { rows: [], rowCount: 0 };
};
const dbPath = require.resolve(path.join(ROOT, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: stubDb, withEntity: async (id, fn) => fn({ query: stubDb }), onEntity: async (id, db, fn) => (typeof db === 'function' ? db({ query: stubDb }) : fn({ query: stubDb })), withTransaction: async (fn) => fn({ query: stubDb }), pool: {} } };
const authPath = require.resolve(path.join(ROOT, 'middleware', 'auth'));
const stubAuth = (req, res, next) => { req.identity = { identity_id: ME, identity_type: 'entity' }; next(); };
stubAuth.entityOf = (req) => req.identity.identity_id;
stubAuth.forgetKey = () => {};
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: stubAuth };
require(path.join(ROOT, 'lib', 'network-membership')).treeOf = async () => ['BR-ME', 'BR-OPEN', 'BR-SHUT'];

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.id = 'req-test'; next(); });
app.use('/api/network-design', require(path.join(ROOT, 'routes', 'network-design.js')));

let failed = 0, checks = 0;
const check = (ok, label, why) => { checks++; if (!ok) failed++; say((ok ? 'ok   ' : 'FAIL ') + label + (ok ? '' : ' · ' + JSON.stringify(why).slice(0, 300))); };
const get = (server, p) => new Promise((resolve) => {
  http.get({ port: server.address().port, path: '/api/network-design' + p }, (res) => {
    let text = '';
    res.on('data', (c) => (text += c));
    res.on('end', () => resolve({ status: res.statusCode, text, body: (() => { try { return JSON.parse(text); } catch (e) { return {}; } })() }));
  });
});
const storesOf = (r) => (r.body.rows || []).map((x) => x.store).sort();

(async () => {
  const server = app.listen(0);
  world.fastPath = true;
  let r = await get(server, '/availability?q=rice');
  check(r.status === 200 && r.body.one_query === true, 'the fast path answers (one_query)', { status: r.status, text: r.text.slice(0, 200) });
  check(storesOf(r).join() === 'Open Rice Shop', 'the fast path: the closed shop is not in the answer, the open one is (positive control)', storesOf(r));

  world.closedReadFails = true;
  r = await get(server, '/availability?q=rice');
  check(r.status === 200 && !r.body.one_query && storesOf(r).join() === 'Open Rice Shop', 'the closed-shop read fails: the answer falls back to the fan-out and is still filtered', { status: r.status, stores: storesOf(r) });
  world.closedReadFails = false;

  world.fastPath = false;
  r = await get(server, '/availability?q=rice');
  check(r.status === 200 && storesOf(r).join() === 'Open Rice Shop', 'the fan-out: the closed shop is not searched, the open one is', { status: r.status, stores: storesOf(r) });

  r = await get(server, '/stores');
  const names = (r.body.stores || []).map((x) => x.name).sort();
  check(r.status === 200 && names.join() === 'Open Rice Shop', 'GET /stores lists the open member and not the closed one', { status: r.status, names });
  server.close();
  say(checks + ' checks, ' + (failed ? failed + ' FAILED' : 'all passed'));
  process.exit(failed ? 1 : 0);
})();
