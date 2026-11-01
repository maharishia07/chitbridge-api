/**
 * tests/sec-126-network-store-public.test.cjs — SEC-126 · THE NETWORK STORE SHOWS WHAT EACH SHOP'S OWN STOREFRONT SHOWS, NOTHING MORE.
 *
 * GET /api/catalogue/network-store/:networkId is public and unauthenticated. It read every active item of every member straight
 * from catalogue_items (only sign-in-first was filtered), so a private, closed, over-cap or network-only member's items and prices
 * reached anyone with the brand's handle — and the order door would take them by id. Now both doors read each shop through the ONE
 * public view (publicViewFor → lib/catalogue-view buildPublicView), the same as GET /network/:bridge_id and every storefront.
 *
 * Real routes/catalogue.js, real lib/catalogue-view.js, real lib/visibility-cap.js; only the database is a stand-in.
 * Run: node tests/sec-126-network-store-public.test.cjs · no DB, no network beyond 127.0.0.1.
 */
'use strict';
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const express = require('express');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-sec-126';
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
delete process.env.NETWORK_STORE_ORDERS;
const API = path.join(__dirname, '..');

/* ── the world: the brand S and its members, one of each kind ── */
const id = (n) => n.padEnd(8, '0') + '-0000-4000-8000-' + '0'.repeat(12);
const S = id('5'),
  P = id('a1'),
  V = id('a2'),
  C = id('a3'),
  K = id('a4'),
  N = id('a5'),
  Z = id('a6'),
  U = id('a7'),
  L = id('a8');
const CUST = id('cc');
const item = (n) => '17e17e17-0000-4000-8000-' + String(n).padStart(12, '0');
const shop = (identity_id, bridge_id, over) =>
  Object.assign(
    {
      identity_id,
      bridge_id,
      display_name: bridge_id,
      catalogue_visibility: 'public',
      plan: 'free',
      params_override: {},
      business_status: 'open',
      storefront_access: 'browse',
      schema: true,
      items: []
    },
    over || {}
  );
const WORLD = {};
const put = (s) => (WORLD[s.identity_id] = s);
function reset(brandOver) {
  for (const k of Object.keys(WORLD)) delete WORLD[k];
  put(shop(S, 'brand-s', Object.assign({ items: [{ item_id: item(1), item_data: { name: 'Brand tea', price: 50, category: 'Tea' } }] }, brandOver || {})));
  put(shop(P, 'pub', { items: [{ item_id: item(2), item_data: { name: 'Dal 1kg', price: 90, category: 'Pulses' } }] }));
  put(shop(V, 'priv', { catalogue_visibility: 'private', items: [{ item_id: item(3), item_data: { name: 'Private rice', price: 70, category: 'Rice' } }] }));
  put(shop(C, 'closed', { business_status: 'closed', items: [{ item_id: item(4), item_data: { name: 'Closed oil', price: 200, category: 'Oil' } }] }));
  put(
    shop(K, 'capped', {
      params_override: { caps: { catalogue_visibility: 'private' } },
      items: [{ item_id: item(5), item_data: { name: 'Capped salt', price: 20, category: 'Salt' } }]
    })
  );
  put(
    shop(N, 'netonly', { catalogue_visibility: 'network', items: [{ item_id: item(6), item_data: { name: 'Network sugar', price: 45, category: 'Sugar' } }] })
  );
  put(shop(Z, 'noschema', { schema: false, items: [{ item_id: item(7), item_data: { name: 'Schemaless flour', price: 30, category: 'Flour' } }] }));
  put(
    shop(U, 'stock', {
      items: [
        { item_id: item(8), item_data: { name: 'In stock jam', price: 60, category: 'Jam' } },
        { item_id: item(9), item_data: { name: 'Gone ghee', price: 500, category: 'Ghee', status: 'unavailable' } }
      ]
    })
  );
  put(shop(L, 'login', { storefront_access: 'login', items: [{ item_id: item(10), item_data: { name: 'Members honey', price: 300, category: 'Honey' } }] }));
}
let MEMBERS = [P, V, C, K, N, Z, U, L];
const allItems = () => Object.values(WORLD).flatMap((s) => s.items.map((it) => ({ item_id: it.item_id, entity_id: s.identity_id, item_data: it.item_data })));

function rowsFor(sql, p) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  p = p || [];
  /* the brand by its handle (resolveEntity) */
  if (/FROM identities/.test(s) && /bridge_id = \$1/.test(s) && /identity_type = 'entity'/.test(s))
    return Object.values(WORLD).filter((x) => x.bridge_id === p[0]);
  /* the members by id (liveShopsOf) */
  if (/FROM identities WHERE identity_id = ANY\(\$1::uuid\[\]\) AND identity_type = 'entity'/.test(s)) return p[0].map((x) => WORLD[x]).filter(Boolean);
  /* the roster from the edges (lib/network-membership) */
  if (/'built' AS via/.test(s)) return p[0] === S ? MEMBERS.map((m, n) => ({ id: m, via: 'joined', state: 'active', edge_id: 'e' + n })) : [];
  /* the view: visibility row, public schema, own items, storefront mode */
  if (/SELECT catalogue_visibility, plan, params_override, bridge_id, business_status FROM identities/.test(s)) return WORLD[p[0]] ? [WORLD[p[0]]] : [];
  if (/FROM entity_schemas/.test(s)) return WORLD[p[0]] && WORLD[p[0]].schema ? [{ schema_id: 'sch-' + p[0], schema_name: 'Default' }] : [];
  if (/SELECT item_id, item_data, created_at FROM catalogue_items WHERE entity_id = \$1/.test(s))
    return WORLD[p[0]] ? WORLD[p[0]].items.map((it) => Object.assign({ created_at: '2026-10-01' }, structuredClone(it))) : [];
  if (/SELECT storefront_access, policy_flags, country FROM identities/.test(s))
    return WORLD[p[0]] ? [{ storefront_access: WORLD[p[0]].storefront_access, policy_flags: {}, country: 'IN' }] : [];
  /* the order door: the cart's rows by id, then the parties */
  if (/SELECT item_id, entity_id, item_data FROM catalogue_items WHERE item_id = ANY\(\$1::uuid\[\]\) AND entity_id = ANY/.test(s))
    return allItems().filter((r) => p[0].includes(r.item_id) && p[1].includes(r.entity_id));
  if (/SELECT identity_id, bridge_id, display_name FROM identities WHERE identity_id = ANY/.test(s))
    return Object.values(WORLD)
      .map((x) => ({ identity_id: x.identity_id, bridge_id: x.bridge_id, display_name: x.display_name }))
      .concat([{ identity_id: CUST, bridge_id: 'cust-1', display_name: 'Cust' }]);
  if (/SELECT currency_code, country FROM identities/.test(s)) return [{ currency_code: 'INR', country: 'IN' }];
  return [];
}
const q = async (sql, p) => {
  const rows = rowsFor(sql, p);
  return { rows, rowCount: rows.length };
};
const tx = { query: q };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: q,
    pool: { query: q, connect: async () => Object.assign({ release() {} }, tx) },
    withEntity: async (eid, fn) => fn(tx),
    withTransaction: async (fn) => fn(tx),
    onEntity: async (eid, db, fn) => fn(tx),
    readBatch: async (ent, db, stmts) => (stmts || []).map(() => ({ rows: [] })),
    trySavepoint: async (db, fn, fb) => {
      try {
        return await fn(db);
      } catch (_) {
        return fb;
      }
    }
  }
};
const sc = require(path.join(API, 'lib', 'schema'));
sc.hasColumn = async () => true;
sc.hasTable = async () => false;
const DELIVERED = [];
require(path.join(API, 'lib', 'mint')).deliver = async (sender, chit_id, copies) => {
  DELIVERED.push({ sender, chit_id, copies });
};
if (!process.env.SEC126_DEBUG) console.error = () => {};

const app = express();
app.use(express.json());
app.use('/api/catalogue', require(path.join(API, 'routes', 'catalogue')));
const customer = (shopId) =>
  jwt.sign({ identity_id: CUST, identity_type: 'customer', parent_entity_id: shopId, bridge_id: 'cust-1', display_name: 'Cust' }, process.env.JWT_SECRET, {
    algorithm: 'HS256'
  });

function call(method, url, token, body) {
  return new Promise((done) => {
    const srv = app.listen(0, '127.0.0.1', () => {
      const data = body ? JSON.stringify(body) : '';
      const headers = token ? { Authorization: 'Bearer ' + token } : {};
      if (body) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(data);
      }
      const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: url, method, headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          srv.close();
          let j = {};
          try {
            j = JSON.parse(Buffer.concat(chunks).toString());
          } catch (_) {}
          done({ status: res.statusCode, body: j });
        });
      });
      r.on('error', (e) => {
        srv.close();
        done({ status: 'ERR ' + e.code, body: {} });
      });
      r.end(data);
    });
  });
}

let pass = 0,
  fail = 0;
const t = (name, ok, extra) => {
  if (ok) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    fail++;
    console.log('  ✗ ' + name + (extra ? '\n       ' + extra : ''));
  }
};
const show = (r) => r.status + ' ' + JSON.stringify(r.body).slice(0, 300);
const ids = (r) => (r.body.products || []).map((x) => x.product_id);

(async () => {
  console.log("\n— SEC-126 · GET /network-store lists only what each shop's anonymous storefront shows —");
  reset();
  let r = await call('GET', '/api/catalogue/network-store/brand-s?limit=100', null);
  const got = ids(r);
  t("200, and the public member's item is listed", r.status === 200 && got.includes(item(2)), show(r));
  t("…the brand root's own public item is listed", got.includes(item(1)), show(r));
  t("…a CATALOGUE-PRIVATE member's item is absent", !got.includes(item(3)), show(r));
  t("…a CLOSED member's item is absent", !got.includes(item(4)), show(r));
  t('…a member OVER ITS VISIBILITY CAP (operator cap private, chose public) is absent', !got.includes(item(5)), show(r));
  t('…a NETWORK-ONLY member is absent to an anonymous reader', !got.includes(item(6)), show(r));
  t('…a member with NO PUBLIC SCHEMA (nothing published) is absent', !got.includes(item(7)), show(r));
  t("…an UNAVAILABLE item is absent; its shop's available item stays", !got.includes(item(9)) && got.includes(item(8)), show(r));
  t('…a SIGN-IN-FIRST member is absent (SEC4 still holds)', !got.includes(item(10)), show(r));
  t('…exactly the three visible items, and no member is named', got.length === 3 && !JSON.stringify(r.body).includes(P) && r.body.count === 3, show(r));
  t('…no `truncated` when every member was read', r.body.truncated === undefined, show(r));

  reset({ catalogue_visibility: 'private' });
  r = await call('GET', '/api/catalogue/network-store/brand-s?limit=100', null);
  t(
    "the BRAND ROOT made private: its own item is gone, the public member's stays",
    r.status === 200 && !ids(r).includes(item(1)) && ids(r).includes(item(2)),
    show(r)
  );

  reset();
  const many = Array.from({ length: 45 }, (_, n) => id('b' + String(n).padStart(2, '0')));
  MEMBERS = [P].concat(many);
  r = await call('GET', '/api/catalogue/network-store/brand-s', null);
  t(
    'more members than MAX_DEPARTMENTS: the cut is REPORTED as truncated { shown, total }',
    r.status === 200 && r.body.truncated && r.body.truncated.shown === 40 && r.body.truncated.total === 47,
    show(r)
  );
  MEMBERS = [P, V, C, K, N, Z, U, L];

  console.log('\n— SEC-126 · the order door takes only what the GET shows —');
  process.env.NETWORK_STORE_ORDERS = 'true';
  const ORDER = '/api/catalogue/network-store/brand-s/order';
  for (const [label, it] of [
    ['catalogue-private', item(3)],
    ['closed', item(4)],
    ['capped', item(5)],
    ['network-only', item(6)],
    ['unavailable', item(9)]
  ]) {
    DELIVERED.length = 0;
    r = await call('POST', ORDER, customer(P), { items: [{ product_id: it, qty: 1 }] });
    t(
      'a customer of a public member ordering a ' + label + ' item by its id → 404, nothing written',
      r.status === 404 && r.body.code === 'NO_MATCHING_PRODUCTS' && DELIVERED.length === 0,
      show(r)
    );
  }
  DELIVERED.length = 0;
  r = await call('POST', ORDER, customer(P), {
    items: [
      { product_id: item(2), qty: 1 },
      { product_id: item(3), qty: 1 }
    ]
  });
  const lines = DELIVERED.length ? JSON.stringify(DELIVERED[0].copies[0].business_json || {}) : '';
  t(
    'a cart mixing a public and a private item → the public one is ordered, the private one never reaches a chit',
    r.status === 200 && DELIVERED.length > 0 && !lines.includes('Private rice'),
    show(r)
  );
  delete process.env.NETWORK_STORE_ORDERS;

  console.log('\n' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('crashed: ' + e.stack);
  process.exit(1);
});
