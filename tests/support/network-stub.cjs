/**
 * tests/support/network-stub.cjs — the offline stand-in for the member view: a stubbed database answering each statement routes/network-offers.js,
 * lib/network-offers.js, lib/network-membership.js and lib/network-catalogue.js send, the REAL router mounted on express. No DB, no network.
 * Used by tests/network-member-view.test.cjs (NET-SRV1 G1–G3) and tests/support/contract-network.cjs (the contract's /api/network-offers half).
 *
 *   const S = require('./support/network-stub.cjs');  S.as({…identity}, isKey) · await S.start() · await S.get(url) · await S.post(url, body) · S.stop()
 *
 * THE WORLD (one store, four brands — every standing the route can show):
 *   store-1  built under brand-a (governance edge g-1, active) and SELLS its catalogue (apex@v1)
 *            ASKED brand-b (commercial edge e-b, requested by the store) — sells nothing of brand-b's      ← G1: was invisible
 *            INVITED by brand-c (e-c, requested by the brand)
 *            joined brand-d and PAUSED (e-d suspended)
 *   brand-b sits under a root of its own (CB-ROOT-X): its network store is the ROOT's bridge id, not the brand's      ← G3
 *   brand-a's roster: store-1 (built, active) and store-2 (asked to join: requested by the store)                    ← G2, the brand half
 */
'use strict';
const path = require('path'), http = require('http');
const API = path.join(__dirname, '..', '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
const stubMod = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };

const STORE = 'store-1', STORE2 = 'store-2', A = 'brand-a', B = 'brand-b', C = 'brand-c', D = 'brand-d';
const OFF = '0f0f0f0f-0000-4000-8000-000000000001';
const IDENT = {
  [STORE]: { display_name: 'Fresh Mart', bridge_id: 'CB-STORE-1', policy_flags: { network_choices: { [OFF]: 'in' } } },
  [STORE2]: { display_name: 'Corner Shop', bridge_id: 'CB-STORE-2', policy_flags: {} },
  [A]: { display_name: 'apex-mu4u0alb465', bridge_id: 'CB-BRAND-A', policy_flags: { network_offers: { policy: 'opt_in', released: { [OFF]: { version: 1, at: '2026-10-15T00:00:00.000Z', until: '2026-11-05T00:00:00.000Z', released_at: '2026-10-14T06:00:00.000Z', released_by: 'Apex' } } } } },
  [B]: { display_name: 'Bharat Mills', bridge_id: 'CB-BRAND-B', policy_flags: {} },
  [C]: { display_name: 'Chola Foods', bridge_id: 'CB-BRAND-C', policy_flags: {} },
  [D]: { display_name: 'Delta Dairy', bridge_id: 'CB-BRAND-D', policy_flags: {} },
};
/* the tree: node id · root bridge id */
const NODE = { [STORE]: 'n-store', [STORE2]: 'n-store-2', [A]: 'n-a', [B]: 'n-b', [C]: 'n-c', [D]: 'n-d' };
const ROOT = { [A]: 'CB-BRAND-A', [B]: 'CB-ROOT-X', [C]: 'CB-BRAND-C', [D]: 'CB-BRAND-D' };
/* how store-1 stands with each brand, as standing()'s one statement would answer */
const STANDING = {
  [A]: { built: true, tree_state: 'active', tree_edge: 'g-1', edge_id: null, edge_state: null, asked_by: null },
  [B]: { built: false, tree_state: null, tree_edge: null, edge_id: 'e-b', edge_state: 'requested', asked_by: 'store' },
  [C]: { built: false, tree_state: null, tree_edge: null, edge_id: 'e-c', edge_state: 'requested', asked_by: 'brand' },
  [D]: { built: false, tree_state: null, tree_edge: null, edge_id: 'e-d', edge_state: 'suspended', asked_by: 'store' },
};
const EDGES = [{ brand_id: B, edge_id: 'e-b', state: 'requested', asked_by: 'store' }, { brand_id: C, edge_id: 'e-c', state: 'requested', asked_by: 'brand' }, { brand_id: D, edge_id: 'e-d', state: 'suspended', asked_by: 'store' }];
const ROSTER_A = [
  { id: STORE, via: 'built', state: 'active', edge_id: 'g-1', asked_by: null, node_id: 'n-store', brand_node: 'n-a' },
  { id: STORE2, via: 'joined', state: 'requested', edge_id: 'e-2', asked_by: 'store', node_id: 'n-store-2', brand_node: 'n-a' },
];
const SOURCES = [{ source_key: 'apex@v1', owner_entity_id: A, title: 'Apex Foods', items: [{ name: 'Rice 5kg', price: 450 }], active: true }];
const OFFER_ROW = { definition_id: OFF, name: 'Festive 10%', sub_kind: 'percent_off', status: 'live', current_version: 1 };

const D_ = { statements: [], writes: [] };
function answer(sqlRaw, p, entity) {
  const sql = String(sqlRaw).replace(/\s+/g, ' ').trim();
  D_.statements.push(sql);
  const a = p || [];
  if (/^UPDATE identities/.test(sql)) { D_.writes.push({ sql, params: a }); return { rows: [] }; }
  if (/^SELECT display_name, policy_flags FROM identities WHERE identity_id = \$1/.test(sql)) { const i = IDENT[a[0]]; return { rows: i ? [{ display_name: i.display_name, policy_flags: i.policy_flags }] : [] }; }
  if (/^SELECT display_name, gstn, address, phone, email, country, currency_code FROM identities/.test(sql)) { const i = IDENT[a[0]]; return { rows: i ? [{ display_name: i.display_name, country: 'IN', currency_code: 'INR' }] : [] }; }
  if (/^SELECT source_key, commercials FROM catalogue_adoption/.test(sql)) return { rows: entity === STORE ? [{ source_key: 'apex@v1', commercials: {} }] : [] };
  if (/^SELECT source_key, owner_entity_id FROM catalogue_source WHERE source_key = ANY/.test(sql)) return { rows: SOURCES.filter((s) => a[0].indexOf(s.source_key) >= 0).map((s) => ({ source_key: s.source_key, owner_entity_id: s.owner_entity_id })) };
  if (/^SELECT source_key, owner_entity_id, items FROM catalogue_source WHERE source_key = ANY/.test(sql)) return { rows: SOURCES.filter((s) => a[0].indexOf(s.source_key) >= 0) };
  if (/^SELECT source_key, title, items FROM catalogue_source WHERE owner_entity_id = \$1 AND active = true/.test(sql)) return { rows: SOURCES.filter((s) => s.owner_entity_id === a[0]) };
  if (/^SELECT 1 FROM catalogue_source WHERE owner_entity_id = \$1/.test(sql)) return { rows: SOURCES.some((s) => s.owner_entity_id === a[0]) ? [{ '?column?': 1 }] : [] };
  if (/^SELECT title FROM catalogue_source WHERE owner_entity_id = \$1/.test(sql)) return { rows: SOURCES.filter((s) => s.owner_entity_id === a[0]).map((s) => ({ title: s.title })) };
  /* lib/network-membership — the one member reader */
  if (/AS brand_id, e\.id::text AS edge_id, e\.state,/.test(sql) && /WHERE mi\.identity_id = \$1/.test(sql)) return { rows: a[0] === STORE ? EDGES.map((e) => Object.assign({}, e)) : [] };
  if (/^WITH s AS \(SELECT c\.id, c\.path FROM identities i JOIN cb_entity c/.test(sql)) {
    if (a[0] !== STORE) return { rows: [] };
    return { rows: a[1].filter((b) => IDENT[b] && NODE[b]).map((b) => Object.assign({ brand_id: b, brand_node: NODE[b], store_node: NODE[STORE], brand_bridge_id: IDENT[b].bridge_id, root_bridge_id: ROOT[b] },
      STANDING[b] || { built: false, tree_state: null, tree_edge: null, edge_id: null, edge_state: null, asked_by: null })) };
  }
  if (/^WITH b AS \(SELECT c\.id, c\.path FROM identities i JOIN cb_entity c/.test(sql)) return { rows: a[0] === A ? ROSTER_A.map((m) => Object.assign({}, m)) : [] };
  if (/^SELECT b FROM unnest\(\$1::text\[\]\) AS b WHERE EXISTS/.test(sql)) return { rows: a[1] === STORE ? a[0].filter((b) => b === A).map((b) => ({ b })) : [] };
  /* the brand's offers, read under the brand */
  if (/FROM definition WHERE entity_id = \$1 AND kind = 'offer' AND status IN/.test(sql)) return { rows: a[0] === A ? [Object.assign({}, OFFER_ROW)] : [] };
  if (/FROM definition WHERE entity_id = \$1 AND kind = 'offer' AND definition_id::text = ANY/.test(sql)) return { rows: a[0] === A ? [Object.assign({}, OFFER_ROW)] : [] };
  if (/FROM catalogue_items WHERE entity_id = \$1 AND is_active = true/.test(sql)) return { rows: [] };
  return { rows: [] };
}
stubMod('db/index.js', {
  query: async (sql, p) => answer(sql, p, null),
  withEntity: async (entity, fn) => fn({ query: async (sql, p) => answer(sql, p, entity) }),
  onEntity: async (entity, db, fn) => fn(db || { query: async (sql, p) => answer(sql, p, entity) }),
});
const OWNER = { identity_id: STORE, identity_type: 'entity', display_name: 'Fresh Mart' };
let WHO = Object.assign({}, OWNER), KEY = false;
stubMod('middleware/auth.js', Object.assign((req, res, next) => { req.identity = WHO; if (KEY) req.api_key = { id: 'k' }; next(); },
  { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (q, r, n) => n(), userOf: (r) => r.identity }));

const express = require('express');
const app = express(); app.use(express.json()); app.use('/api/network-offers', require('../../routes/network-offers'));
const srv = http.createServer(app);

function call(method, url, body) {
  return new Promise((resolve, reject) => {
    const b = body ? JSON.stringify(body) : null;
    const r = http.request({ port: srv.address().port, path: url, method, headers: b ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } : {} },
      (res) => { let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => { try { resolve({ status: res.statusCode, body: s ? JSON.parse(s) : null }); } catch (e) { reject(e); } }); });
    r.on('error', reject); if (b) r.write(b); r.end();
  });
}
const get = (url) => call('GET', url);
const post = (url, body) => call('POST', url, body || {});
const as = (o, key) => { WHO = Object.assign({}, OWNER, o); KEY = !!key; };
async function start() { await new Promise((r) => srv.listen(0, '127.0.0.1', r)); }
function stop() { srv.close(); }
module.exports = { LOG: D_, STORE, STORE2, A, B, C, D, OFF, ROOT, IDENT, as, get, post, start, stop };
