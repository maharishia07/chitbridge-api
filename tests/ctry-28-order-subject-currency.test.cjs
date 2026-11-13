/**
 * tests/ctry-28-order-subject-currency.test.cjs — CTRY-28 (proof 2026-11-14): a network order's SUBJECT carries the governed currency CODE, never a symbol.
 * @type regression
 * OWNS      the proof that POST /api/catalogue/network-store/:id/order, for an operator whose governed currency is AED, mints the order chit with the
 *           subject "Order — 1 item(s), AED 180" (a code; hand-computed: one line, 2 x 90 = 180), summary_json.currency_code 'AED', and no rupee sign
 *           or INR anywhere in the minted copies (routes/catalogue.js:881 the subject, deliverEdge, lib/mint.js summary currency_code).
 * CALLED BY scripts/guards.cjs · CI. No database, no network beyond 127.0.0.1: real routes/catalogue.js and lib/mint.js; the db and the rail delivery are stand-ins.
 * FLOW      customer token → order route → regional.currencyFor(operator) (stand-in row: AED) → deliverEdge → mint.deliver (recorded) → assertions
 *   node tests/ctry-28-order-subject-currency.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const express = require('express');
const { ok, done } = require('./lib/cat-proof-kit.cjs');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-ctry-28';
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
process.env.NETWORK_STORE_ORDERS = 'true';
const API = path.join(__dirname, '..');

const S = 'aaaaaaaa-0000-4000-8000-00000000000a'; /* the brand = the network operator */
const R = 'bbbbbbbb-0000-4000-8000-00000000000b'; /* a member store */
const CUST = 'cccccccc-0000-4000-8000-00000000000c';
const R_ITEM = '17e17e17-0000-4000-8000-000000000019';
const DAL = { name: 'Dal 1kg', price: 90, category: 'Pulses' };
const has = (s, ...parts) => parts.every((part) => s.includes(part));
function rowsFor(sql, p) {
  const s = String(sql).split(/\s+/).join(' ').trim();
  p = p || [];
  if (has(s, 'SELECT currency_code, country FROM identities')) return [{ currency_code: 'AED', country: 'AE' }];
  if (has(s, 'FROM identities', 'bridge_id = $1', "identity_type = 'entity'")) return p[0] === 'brand-s' ? [{ identity_id: S, bridge_id: 'brand-s', display_name: 'Brand S' }] : [];
  if (has(s, "'built' AS via")) return p[0] === S ? [{ id: R, via: 'joined', state: 'active', edge_id: 'e1' }] : [];
  if (has(s, 'FROM identities WHERE identity_id = ANY($1::uuid[]) AND identity_type = \'entity\'')) return p[0].includes(R) ? [{ identity_id: R, bridge_id: 'store-r', display_name: 'Store R' }] : [];
  if (has(s, 'SELECT catalogue_visibility, plan, params_override, bridge_id, business_status FROM identities')) return [{ catalogue_visibility: 'public', plan: 'free', params_override: {}, bridge_id: p[0] === R ? 'store-r' : 'brand-s', business_status: 'open' }];
  if (has(s, 'FROM entity_schemas')) return p[0] === R ? [{ schema_id: 'sch-r', schema_name: 'Default' }] : [];
  if (has(s, 'SELECT item_id, item_data, created_at FROM catalogue_items WHERE entity_id = $1')) return p[0] === R ? [{ item_id: R_ITEM, item_data: DAL, created_at: '2026-10-01' }] : [];
  if (has(s, 'SELECT item_id, entity_id, item_data FROM catalogue_items WHERE item_id = ANY($1::uuid[]) AND entity_id = ANY')) return p[0].includes(R_ITEM) ? [{ item_id: R_ITEM, entity_id: R, item_data: DAL }] : [];
  if (has(s, 'SELECT identity_id, bridge_id, display_name FROM identities WHERE identity_id = ANY')) return [{ identity_id: S, bridge_id: 'brand-s', display_name: 'Brand S' }, { identity_id: R, bridge_id: 'store-r', display_name: 'Store R' }];
  return [];
}
const q = async (sql, p) => { const rows = rowsFor(sql, p); return { rows, rowCount: rows.length }; };
const tx = { query: q };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: q, pool: { query: q, connect: async () => Object.assign({ release() {} }, tx) },
  withEntity: async (id, fn) => fn(tx), withTransaction: async (fn) => fn(tx), onEntity: async (id, db, fn) => fn(tx),
  readBatch: async (ent, db, stmts) => (stmts || []).map(() => ({ rows: [] })), trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } }
} };
const sc = require(path.join(API, 'lib', 'schema'));
sc.hasColumn = async () => true; sc.hasTable = async () => false;
const DELIVERED = [];
const mint = require(path.join(API, 'lib', 'mint'));
mint.deliver = async (sender, chit_id, copies) => { DELIVERED.push({ sender, chit_id, copies }); };
const origErr = console.error; if (!process.env.DBG) console.error = () => {};
const cat = require(path.join(API, 'routes', 'catalogue'));
const app = express(); app.use(express.json());
app.use('/api/catalogue', cat);
const customer = jwt.sign({ identity_id: CUST, identity_type: 'customer', display_name: 'Cust', parent_entity_id: S, bridge_id: 'cust-1' }, process.env.JWT_SECRET, { algorithm: 'HS256' });

const post = (body) => new Promise((resolve) => {
  const srv = app.listen(0, '127.0.0.1', () => {
    const data = JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: '/api/catalogue/network-store/brand-s/order', method: 'POST',
      headers: { Authorization: 'Bearer ' + customer, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => { srv.close(); let j = {}; try { j = JSON.parse(raw); } catch (_) {} resolve({ status: res.statusCode, body: j }); });
    });
    r.end(data);
  });
});

(async () => {
  const r = await post({ items: [{ product_id: R_ITEM, qty: 2 }] });
  console.error = origErr;
  ok('the order is placed (200)', r.status === 200 && !!r.body.order_id, r.status + ' ' + JSON.stringify(r.body));
  ok('the order chit and its one fragment were delivered', DELIVERED.length === 2, String(DELIVERED.length));
  const first = DELIVERED[0] && DELIVERED[0].copies[0];
  ok('the order chit subject carries the CODE and the total: "Order — 1 item(s), AED 180"', !!first && first.auto_subject === 'Order — 1 item(s), AED 180', first && JSON.stringify(first.auto_subject));
  ok('summary_json.currency_code is the governed code AED', !!first && first.summary_json.currency_code === 'AED', first && JSON.stringify(first.summary_json));
  ok('summary_json.total_value is 180', !!first && first.summary_json.total_value === 180);
  const all = JSON.stringify(DELIVERED);
  ok('no rupee symbol and no INR in any minted copy of the order and its fragment', DELIVERED.length > 0 && !/₹|INR/.test(all), (all.match(/.{20}(₹|INR).{20}/) || [''])[0]);
  done();
})().catch((e) => { console.error = origErr; console.error(e); process.exit(1); });
