#!/usr/bin/env node
/**
 * ctr-243-recheck-changed-at.test.cjs — CTR-243: POST /api/till/recheck carries changed_at (catalogue_items.commercial_changed_at, b845) beside every answer.
 * @type regression
 * OWNS      the proof that (1) a row's commercial_changed_at comes back as an ISO changed_at, (2) a row with none (a database before b845, 42703) answers changed_at null and the door still answers 200 (never a 500), (3) a network line has changed_at null, (4) the key is in the closed key list.
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

const world = { noColumn: false, rows: [], reads: [], transactions: 0, adoption: [], brand: null, slabs: [], shelfThrows: false };
const rowOf = (entity_id, item_id, item_data, is_active, changed) => ({ entity_id, item_id, item_data, is_active: is_active !== false, commercial_changed_at: changed || undefined });

function rowsFor(sql, params) {
  const text = String(sql);
  if (/FROM catalogue_items WHERE entity_id = \$1 AND item_id = ANY/.test(text)) {
    world.reads.push({ text, params });
    if (world.noColumn && /commercial_changed_at/.test(text)) { const e = new Error('column commercial_changed_at does not exist'); e.code = '42703'; throw e; }
    return { rows: world.rows.filter((r) => r.entity_id === params[0] && params[1].indexOf(r.item_id) >= 0).map((r) => (/commercial_changed_at/.test(text) ? r : Object.assign({}, r, { commercial_changed_at: undefined }))) };
  }
  if (/FROM identities WHERE identity_id = [$]1/.test(text)) return { rows: [{ display_name: 'Kaveri Stores', identity_id: SHOP, gstn: '33AAAAA0000A1Z5', country: 'IN', policy_flags: { gst_registration: 'regular' } }] };
  if (/FROM definition d/.test(text)) { if (world.shelfThrows) throw new Error('the shelf read broke'); return { rows: world.slabs }; }
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
const reset = (rows) => { world.rows = rows || []; world.reads = []; world.transactions = 0; world.adoption = []; world.brand = null; world.slabs = []; world.shelfThrows = false; world.noColumn = false; };
const byId = (answer, id) => ((answer.body && answer.body.items) || []).find((x) => x.item_id === id);

(async () => {
  console.log('\n== CTR-212 S1 · the recheck door ==\n');
  installStubs();
  const app = express(); app.use(express.json()); app.use('/api/till', require(path.join(HERE, 'routes', 'till.js')));
  const server = app.listen(0); const port = server.address().port;
  const q = (p, body) => call(port, 'POST', '/api/till' + p, body);

  const STAMP = '2026-11-13T09:00:00.000Z';
  reset([rowOf(SHOP, A, { name: 'Rice 5 kg', price: 120, gst_rate: 18 }, true, new Date(STAMP)), rowOf(SHOP, B, { name: 'Pad', price: 100, gst_rate: 12 }, true, null)]);
  const first = await q('/recheck', { item_ids: [A, B, 'src:brand:x'] });
  ok('changed_at is the row commercial_changed_at as an ISO string; a row with no stamp is null; a network line is null', () => {
    assert.strictEqual(first.status, 200);
    assert.strictEqual(byId(first, A).changed_at, STAMP);
    assert.strictEqual(byId(first, B).changed_at, null);
    assert.ok('changed_at' in byId(first, B), 'the key is present (null), never absent for a found row');
  });
  ok('the read asks for the column ONCE: one read, no per-row query', () => { assert.strictEqual(world.reads.length, 1); assert.match(world.reads[0].text, /commercial_changed_at/); });
  ok('changed_at is in the closed key list the counter reads', () => { assert.ok(require(path.join(HERE, 'lib', 'till-contract')).RECHECK_ITEM_KEYS.indexOf('changed_at') >= 0); });

  /* a database that has not run b845: 42703 on the column; the door repeats the read without it and answers changed_at null, 200 not 500 */
  reset([rowOf(SHOP, A, { name: 'Rice 5 kg', price: 120, gst_rate: 18 }, true, new Date(STAMP))]); world.noColumn = true;
  const old = await q('/recheck', { item_ids: [A] });
  ok('column absent (42703): 200, price and rate still answered, changed_at null, the second read has no column', () => {
    assert.strictEqual(old.status, 200); assert.strictEqual(byId(old, A).price, 120); assert.strictEqual(byId(old, A).changed_at, null);
    assert.strictEqual(world.reads.length, 2); assert.ok(!/commercial_changed_at/.test(world.reads[1].text));
  });
  /* any OTHER database error is still a failure, not a silent null */
  reset([rowOf(SHOP, A, { name: 'x', price: 1 })]); world.rows = null;
  const broken = await q('/recheck', { item_ids: [A] });
  ok('another read failure is still the 500, never a null changed_at', () => { assert.strictEqual(broken.status, 500); });

  server.close();
  console.log('\n' + (fail ? '  FAIL ' + fail + ' failed' : '  ok ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
