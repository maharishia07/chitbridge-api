'use strict';
/**
 * tests/sec-75-order-freeze.test.cjs — SEC-75: the order freeze at routes/catalogue.js (POST /api/catalogue/:bridge_id/order/confirm), through the real router, in BOTH pipelines.
 * @type regression
 * OWNS      the route-level proof that freeze-at-send (A10) still stamps the SHOP's default schema on the order chit now that entity_schemas is row-secured:
 *             · the commerce pipeline and the payload pipeline each read the freeze through the ONE definer, `ops.shop_default_schema($1)`, with the SHOP's id
 *               (the buyer is a customer and cannot see the shop's schema row; a plain read or a read bound to the buyer would freeze null, silently);
 *             · the schema id and version from that read ride on the minted copies (the chit_deliver path) AND on the pre-b50 inline chit_header rows (the fallback path);
 *             · a shop with no default schema freezes null, never another shop's schema.
 * CALLED BY scripts/guards.cjs · CI. No database, no network beyond 127.0.0.1: the real routes/catalogue.js and lib/mint.js; the db, the rail delivery and the catalogue read are stand-ins.
 *   node tests/sec-75-order-freeze.test.cjs
 */
const path = require('path');
const http = require('http');
const express = require('express');
const { ok, done } = require('./lib/cat-proof-kit.cjs');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-sec-75-order';
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
const API = path.join(__dirname, '..');

const SHOP = 'aaaaaaaa-0000-4000-8000-00000000000a';
const OTHER_SHOP = 'bbbbbbbb-0000-4000-8000-00000000000b';
const BUYER = 'cccccccc-0000-4000-8000-00000000000c';
const ITEM = 'dddddddd-0000-4000-8000-00000000000d';
const CODE = '654321';
const FROZEN = { schema_id: 'eeeeeeee-0000-4000-8000-00000000000e', schema_version: 7 };

const world = { shopHasSchema: true, orderInput: { pipeline: 'commerce' }, noB50: false };
const asked = []; /* every statement: { sql, params, via } */
const minted = []; /* the copies handed to the rail */
const inlineHeaders = []; /* the pre-b50 chit_header inserts */

function rowsFor(sql, params, via) {
  const s = String(sql).split(/\s+/).join(' ').trim();
  const p = params || [];
  asked.push({ sql: s, params: p, via });
  if (/FROM identities WHERE \(bridge_id = \$1 OR LOWER\(user_id\)/.test(s)) return [{ identity_id: SHOP, display_name: 'Shop S', bridge_id: 'shop-s', user_id: 'shop-s', currency_code: 'INR', business_status: 'active', population: 'live' }];
  if (/otp_code, otp_expires_at, otp_attempts FROM identities WHERE email = \$1/.test(s)) {
    return [{ identity_id: BUYER, bridge_id: 'BUYER01', display_name: 'Buyer', otp_code: CODE, otp_expires_at: new Date(Date.now() + 600000).toISOString(), otp_attempts: 0 }];
  }
  if (/AND otp_code = \$2 RETURNING identity_id/.test(s)) return [{ identity_id: BUYER }];
  if (/SELECT currency_code, country FROM identities WHERE identity_id = \$1/.test(s)) return [{ currency_code: 'INR', country: 'IN' }];
  /* the ONE definer door: the shop's default schema, only when asked about a shop that has one */
  if (/FROM ops\.shop_default_schema\(\$1\)/.test(s)) return world.shopHasSchema && p[0] === SHOP ? [FROZEN] : [];
  if (/FROM catalogue_items/.test(s)) return [{ item_id: ITEM, entity_id: SHOP, item_data: { name: 'Rice', price: 10, category: 'Food' }, created_at: '2026-11-01' }];
  if (/INSERT INTO chit_header/.test(s)) inlineHeaders.push({ params: p, via });
  return [];
}
const q = (via) => async (sql, params) => { const rows = rowsFor(sql, params, via); return { rows, rowCount: rows.length }; };
const tx = { query: q('tx') };
const mock = (relative, exported) => {
  const file = require.resolve(path.join(API, relative));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exported };
};
const db = {
  query: q('query'),
  queryAs: async (id, sql, params) => ({ rows: rowsFor(sql, params, 'queryAs:' + id), rowCount: 0 }),
  queryFor: (id) => async (sql, params) => ({ rows: rowsFor(sql, params, 'queryAs:' + id), rowCount: 0 }),
  pool: { query: q('pool'), connect: async () => Object.assign({ release() {} }, tx) },
  withEntity: async (id, fn) => fn({ query: q('withEntity:' + id) }),
  withTransaction: async (fn) => fn({ query: q('transaction') }),
  onEntity: async (id, client, fn) => fn(tx),
  readBatch: async () => [],
  trySavepoint: async (client, fn, fallback) => { try { return await fn(client); } catch (_) { return fallback; } },
};
mock('db', db);
mock('db/index', db);
const view = require(path.join(API, 'lib', 'catalogue-view'));
mock('lib/catalogue-view', Object.assign({}, view, { getOrderInput: async () => world.orderInput, buildPublicView: async () => ({ available: true, items: [] }) }));
const idem = require(path.join(API, 'middleware', 'idempotency'));
mock('middleware/idempotency', Object.assign({}, idem, { requireKey: () => (req, res, next) => next() })); /* the key store is not what this proves */
const sc = require(path.join(API, 'lib', 'schema'));
sc.hasColumn = async () => true; sc.hasTable = async () => false;
const mint = require(path.join(API, 'lib', 'mint'));
mint.deliver = async (sender, chit_id, copies) => {
  if (world.noB50) throw Object.assign(new Error('function chit_deliver does not exist'), { code: '42883' }); /* the pre-b50 database: the route falls back to the inline fan-out */
  minted.push({ sender, chit_id, copies });
};
const origErr = console.error; if (!process.env.DBG) console.error = () => {};
const app = express(); app.use(express.json());
app.use('/api/catalogue', require(path.join(API, 'routes', 'catalogue')));

const PIPELINES = {
  commerce: { setup: { pipeline: 'commerce' }, body: { line_items: [{ product_id: ITEM, name: 'Rice', quantity: 1 }] } },
  payload: { setup: { pipeline: 'payload', schema: { properties: {}, required: [] }, _raw: { pipeline: 'payload' } }, body: { line_items: [{ name: 'Enquiry', payload: {} }] } },
};

const confirm = (pipeline) => new Promise((resolve) => {
  asked.length = 0; minted.length = 0; inlineHeaders.length = 0;
  world.orderInput = PIPELINES[pipeline].setup;
  const data = JSON.stringify(Object.assign({ phone: '9876543210', otp: CODE }, PIPELINES[pipeline].body));
  const srv = app.listen(0, '127.0.0.1', () => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: '/api/catalogue/shop-s/order/confirm', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'idempotency-key': 'k-' + Math.random() } }, (res) => {
      let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => { srv.close(); let j = {}; try { j = JSON.parse(raw); } catch (_) {} resolve({ status: res.statusCode, body: j }); });
    });
    r.end(data);
  });
});
const freezeReads = () => asked.filter((a) => /ops\.shop_default_schema/.test(a.sql));
const plainSchemaReads = () => asked.filter((a) => /FROM entity_schemas/.test(a.sql));

(async () => {
  for (const pipeline of ['commerce', 'payload']) {
    world.shopHasSchema = true; world.noB50 = false;
    const r = await confirm(pipeline);
    ok(pipeline + ': the order is placed (200)', r.status === 200, r.status + ' ' + JSON.stringify(r.body).slice(0, 300));
    const reads = freezeReads();
    ok(pipeline + ': the freeze reads through the ONE definer, once, with the SHOP id (not the buyer, not another shop)', reads.length === 1 && reads[0].params[0] === SHOP && reads[0].via === 'query', JSON.stringify(reads));
    ok(pipeline + ': no plain read of entity_schemas anywhere in the order', plainSchemaReads().length === 0, JSON.stringify(plainSchemaReads()));
    const header = minted[0] && minted[0].copies[0];
    ok(pipeline + ': the minted copy carries the frozen schema id and version', !!header && header.schema_id === FROZEN.schema_id && header.schema_version === FROZEN.schema_version, header && JSON.stringify([header.schema_id, header.schema_version]));
    ok(pipeline + ': the shop copy carries the same freeze', !!minted[0] && minted[0].copies.every((c) => c.schema_id === FROZEN.schema_id && c.schema_version === FROZEN.schema_version));

    world.noB50 = true;
    const fb = await confirm(pipeline);
    ok(pipeline + ' (pre-b50 fallback): the order is still placed (200)', fb.status === 200, fb.status + ' ' + JSON.stringify(fb.body).slice(0, 300));
    ok(pipeline + ' (pre-b50 fallback): still ONE freeze read, through the definer, with the shop id', freezeReads().length === 1 && freezeReads()[0].params[0] === SHOP);
    ok(pipeline + ' (pre-b50 fallback): both inline chit_header rows carry the frozen schema version and id ($9, $10)',
      inlineHeaders.length === 2 && inlineHeaders.every((h) => h.params[8] === FROZEN.schema_version && h.params[9] === FROZEN.schema_id), JSON.stringify(inlineHeaders.map((h) => [h.params[8], h.params[9]])));

    world.noB50 = false; world.shopHasSchema = false;
    const none = await confirm(pipeline);
    const bare = minted[0] && minted[0].copies[0];
    ok(pipeline + ': a shop with no default schema freezes null (never a stranger\'s schema)', none.status === 200 && !!bare && bare.schema_id == null && bare.schema_version == null, bare && JSON.stringify([bare.schema_id, bare.schema_version]));
  }
  console.error = origErr;
  ok('the stand-in answers the definer for the shop only: another shop id reads no schema', rowsFor('SELECT schema_id FROM ops.shop_default_schema($1)', [OTHER_SHOP], 'probe').length === 0);
  done();
})().catch((e) => { console.error = origErr; console.error(e); process.exit(1); });
