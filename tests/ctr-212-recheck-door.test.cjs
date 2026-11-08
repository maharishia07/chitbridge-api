#!/usr/bin/env node
/**
 * ctr-212-recheck-door.test.cjs — CTR-212 S1: POST /api/till/recheck answers what the catalogue says NOW, for every id asked.
 * @type regression
 * OWNS      the proof that the door (1) answers a price, a rate, an hsn and a status through the snapshot's own tillItem projection,
 *           (2) answers a product DELETED since as found:false (a delta snapshot cannot see a hard delete), never a price of 0,
 *           (3) names a retired or inactive row, (4) leaves a network line ('src:...') as checked:false and an odd id as found:false,
 *           (5) cannot read another shop's row (the read carries entity_id = $1 of the signed-in shop), (6) is ONE transaction,
 *           (4b) reads a NETWORK line as the snapshot would send it now (a brand-published price moves the answer; a withdrawn line is found:false) and sends
 *           slabs · categories · face so a rate edited through a slab or category is resolved by the counter's own pack (CTR-212 §11), (4c) a SOFT-removed product is active:false,
 *           (7) refuses no ids, more than 200 ids and a body with another key, in words, (8) computes no money. The hand figures the counter
 *           bills from these answers (23600 · 28320 · 22400) are typed in the S2a test beside the engine run.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/till.js over a stand-in db and auth (the shape of tests/till-rate-door.test.cjs).
 * FLOW      world (shop · rows) → real route → body → the facts, the refusal's words, the number of transactions
 *   node tests/ctr-212-recheck-door.test.cjs
 */
'use strict';
const path = require('path');
const assert = require('assert');
const express = require('express');
const http = require('http');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

const SHOP = '11111111-1111-4111-8111-111111111111';
const OTHER_SHOP = '99999999-9999-4999-8999-999999999999';
const A = '22222222-2222-4222-8222-222222222222'; /* Pen: price 100 → 120 */
const B = '33333333-3333-4333-8333-333333333333'; /* Pad: rate 18 → 12 */
const C = '44444444-4444-4444-8444-444444444444'; /* Ink: retired */
const D = '55555555-5555-4555-8555-555555555555'; /* Cap: inactive */
const GONE = '66666666-6666-4666-8666-666666666666'; /* deleted here: only another shop has a row by this id */
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Kaveri Stores' };

const world = { rows: [], reads: [], transactions: 0, adoption: [], brand: null };
const rowOf = (entity_id, item_id, item_data, is_active) => ({ entity_id, item_id, item_data, is_active: is_active !== false });

function rowsFor(sql, params) {
  const text = String(sql);
  if (/FROM catalogue_items WHERE entity_id = \$1 AND item_id = ANY/.test(text)) {
    world.reads.push({ text, params });
    return { rows: world.rows.filter((r) => r.entity_id === params[0] && params[1].indexOf(r.item_id) >= 0) };
  }
  if (/FROM catalogue_adoption WHERE entity_id = [$]1/.test(text)) return { rows: world.adoption };
  return { rows: [], rowCount: 0 };
}
const mock = (relative, exported) => { const file = require.resolve(path.join(HERE, relative)); require.cache[file] = { id: file, filename: file, loaded: true, exports: exported }; };
function installStubs() {
  const realAuth = require(path.join(HERE, 'middleware', 'auth'));
  const stubAuth = (req, res, next) => { req.identity = OWNER; return next(); };
  mock('middleware/auth', Object.assign(stubAuth, realAuth, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id }));
  const client = { query: async (sql, params) => rowsFor(sql, params) };
  const known = { query: async (sql, params) => rowsFor(sql, params), withEntity: async (id, run) => { world.transactions++; return run(client); }, withTransaction: async (run) => run(client),
    trySavepoint: async (handle, run, fallback) => run().catch(() => fallback), readBatch: async (entity, actor, statements) => statements.map(() => ({ rows: [], rowCount: 0 })) };
  const db = new Proxy(known, { get: (target, name) => (name in target ? target[name] : typeof name === 'symbol' || name === 'then' ? undefined : async () => ({ rows: [], rowCount: 0 })) });
  mock('db', db); mock('db/index', db);
  /* the brand's line as the shopfront's own read would resolve it NOW: world.brand = { price } or null (withdrawn) */
  require(path.join(HERE, 'lib', 'catalogue-build')).resolve = async () => ({ title: 'Brand', owner_entity_id: OTHER_SHOP, items: [{ name: 'Brand Pen' }] });
  require(path.join(HERE, 'lib', 'catalogue-read')).lines = () => (world.brand ? [{ line_id: 'src:brand:pen', source_key: 'brand', source_title: 'Brand', owner_entity_id: OTHER_SHOP, provenance: { price: 'own' }, fields: { name: 'Brand Pen', price: world.brand.price, gst_rate: 18 } }] : []);
  console.error = () => undefined; console.warn = () => undefined;
}
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});
let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('   ok   ' + name); } catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); } };
const reset = (rows) => { world.rows = rows || []; world.reads = []; world.transactions = 0; world.adoption = []; world.brand = null; };
const byId = (answer, id) => ((answer.body && answer.body.items) || []).find((x) => x.item_id === id);

(async () => {
  console.log('\n== CTR-212 S1 · the recheck door ==\n');
  installStubs();
  const app = express(); app.use(express.json()); app.use('/api/till', require(path.join(HERE, 'routes', 'till.js')));
  const server = app.listen(0); const port = server.address().port;
  const q = (p, body) => call(port, 'POST', '/api/till' + p, body);

  reset([
    rowOf(SHOP, A, { name: 'Pen', price: 120, gst_rate: 18, hsn: '9608', price_changed_at: '2026-11-08T05:00:00.000Z' }),
    rowOf(SHOP, B, { name: 'Pad', price: { amount: 100, currency: 'INR' }, gst_rate: 12, hsn: '4820' }),
    rowOf(SHOP, C, { name: 'Ink', price: 50, gst_rate: 18, status: 'retired' }),
    rowOf(SHOP, D, { name: 'Cap', price: 10, gst_rate: 5 }, false),
    rowOf(OTHER_SHOP, GONE, { name: 'Another shop product', price: 1 })
  ]);
  const all = await q('/recheck', { item_ids: [A, B, C, D, GONE, 'src:brand:sku-1', 'not-an-id'] });
  ok('answers 200 with an answer for EVERY id asked, in the order asked', () => {
    assert.strictEqual(all.status, 200, JSON.stringify(all.body).slice(0, 200));
    assert.deepStrictEqual(all.body.items.map((x) => x.item_id), [A, B, C, D, GONE, 'src:brand:sku-1', 'not-an-id']);
    assert.ok(typeof all.body.at === 'string' && !Number.isNaN(Date.parse(all.body.at)));
  });
  ok('a moved price comes back as the catalogue holds it NOW (120, not the 100 on the cart) with its stamp', () => {
    const pen = byId(all, A);
    assert.strictEqual(pen.found, true); assert.strictEqual(pen.price, 120); assert.strictEqual(pen.gst_rate, 18); assert.strictEqual(pen.hsn, '9608');
    assert.strictEqual(pen.stamp, '2026-11-08T05:00:00.000Z'); assert.strictEqual(pen.status, 'available');
  });
  ok('a moved rate comes back as 12; a money-shaped price ({ amount }) is read as the snapshot reads it; an unstamped row has stamp null', () => {
    const pad = byId(all, B); assert.strictEqual(pad.price, 100); assert.strictEqual(pad.gst_rate, 12); assert.strictEqual(pad.stamp, null);
  });
  ok('a retired product is named retired and an inactive one active:false: the counter decides from these two words', () => {
    assert.strictEqual(byId(all, C).status, 'retired'); assert.strictEqual(byId(all, C).active, true); assert.strictEqual(byId(all, D).active, false);
  });
  ok('a product that no longer exists is found:false (never a price, never 0), and another shop row is not read: the read is entity_id = $1 of the signed-in shop', () => {
    const gone = byId(all, GONE);
    assert.strictEqual(gone.found, false); assert.strictEqual(gone.checked, true); assert.ok(!('price' in gone));
    assert.match(world.reads[0].text, /entity_id = \$1/); assert.strictEqual(world.reads[0].params[0], SHOP);
  });
  ok('an id that is no id is found:false; the tax block of the snapshot rides along (slabs · categories · face) for the counter to resolve rates with', () => {
    assert.strictEqual(byId(all, 'not-an-id').found, false);
    assert.ok(Array.isArray(all.body.slabs) && Array.isArray(all.body.categories) && all.body.face && typeof all.body.face === 'object');
  });
  ok('ONE read of the rows inside ONE transaction, whatever the number of ids (no per-row query)', () => {
    assert.strictEqual(world.reads.length, 1); assert.ok(world.transactions <= 5, 'transactions ' + world.transactions);
    assert.deepStrictEqual(world.reads[0].params[1].slice().sort(), [A, B, C, D, GONE].sort());
  });

  /* a soft-removed product: the row is there, active:false - a delta never lists it, this door reads the row */
  ok('a SOFT-removed product (is_active false) is found:true, active:false - the counter treats it as removed (Remove or Cancel only)', () => { assert.strictEqual(byId(all, D).found, true); assert.strictEqual(byId(all, D).active, false); });

  /* a brand-published price change reaches a store's line with no write to any store row: read the way the snapshot reads it */
  reset(); world.adoption = [{ source_key: 'brand', commercials: {} }]; world.brand = { price: 100 };
  const before = await q('/recheck', { item_ids: ['src:brand:pen'] });
  world.brand = { price: 120 };
  const after = await q('/recheck', { item_ids: ['src:brand:pen'] });
  world.brand = null;
  const withdrawn = await q('/recheck', { item_ids: ['src:brand:pen'] });
  ok('a network line answers its CURRENT price: 100, then 120 after the brand publishes; withdrawn by the brand = found:false', () => {
    assert.strictEqual(byId(before, 'src:brand:pen').price, 100); assert.strictEqual(byId(after, 'src:brand:pen').price, 120); assert.strictEqual(byId(after, 'src:brand:pen').found, true);
    assert.strictEqual(byId(withdrawn, 'src:brand:pen').found, false); assert.strictEqual(withdrawn.status, 200);
  });

  reset();
  const none = await q('/recheck', { item_ids: [] });
  ok('no ids: 400 in words (item_ids required), nothing read', () => { assert.strictEqual(none.status, 400); assert.match(none.body.message, /item_ids required/); assert.strictEqual(world.reads.length, 0); });
  const many = await q('/recheck', { item_ids: Array.from({ length: 201 }, (_, i) => '7' + String(i).padStart(7, '0') + '-7777-4777-8777-777777777777') });
  ok('more than 200 ids: 400 "At most 200 products in one check.", nothing read', () => {
    assert.strictEqual(many.status, 400); assert.strictEqual(many.body.message, 'At most 200 products in one check.'); assert.strictEqual(world.reads.length, 0);
  });
  const extra = await q('/recheck', { item_ids: [A], price: 1 });
  ok('a body with any other key is refused (the door is strict): 400', () => { assert.strictEqual(extra.status, 400); });
  const repeated = await q('/recheck', { item_ids: [A, A, ' ', ''] });
  ok('a repeated or blank id is asked once', () => { assert.strictEqual(repeated.status, 200); assert.deepStrictEqual(repeated.body.items.map((x) => x.item_id), [A, ' ']); });

  server.close();
  console.log('\n' + (fail ? '  FAIL ' + fail + ' failed' : '  ok ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
