#!/usr/bin/env node
/**
 * till-rate-door.test.cjs — F5 A1: the counter carries the item's TAX FACTS, and the owner sets a missing rate ONCE at the till.
 * @type regression
 * OWNS      the proof that GET /api/till/snapshot's item projection (tillItem) carries gst_rate · tax_slab_name · cess_rate · categories[] (every id)
 *           and hsn from `sac` (never from `code`); that POST /api/till/rate refuses a till KEY and a cashier in words, lets an owner or a manager
 *           set the slab through tax-slab.setOn + catalogue-write.patchItems (merge-patch), says it twice without a second write, refuses a shop
 *           that charges no tax (tax-shelf.chargesTax: a composition shop with a GSTIN) and an unknown slab; and the walk's arithmetic through
 *           the ENGINE: Veg Meals ₹120 including tax (the India pack's prices_include_tax) at 5%.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/till.js over a stand-in db and auth (the shape of tests/api-problem-till.test.cjs).
 * FLOW      world (who · key · rows) → real route → body → the facts, the refusal's words, the UPDATE's merge-patch
 *   node tests/till-rate-door.test.cjs
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
const ITEM = '22222222-2222-4222-8222-222222222222';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Kaveri Mess' };
const CASHIER = { identity_id: '44444444-4444-4444-8444-444444444444', parent_entity_id: SHOP, identity_type: 'actor', access_level: 'editor', hat: 'act' };
const MANAGER = { identity_id: '55555555-5555-4555-8555-555555555555', parent_entity_id: SHOP, identity_type: 'actor', access_level: 'editor', hat: 'manager' };

/* ── the world: who asks, which rows the shop has, what was written ────────────────────────────────────────────── */
const world = { who: OWNER, key: null, shop: { gstn: '33AAAAA0000A1Z5', country: 'IN', policy_flags: { gst_registration: 'regular' } }, items: [], slabs: [], writes: [] };
const VEG_MEALS = { name: 'Veg Meals', code: 'D01', sac: '996331', price: 120, categories: ['cat-meals', 'cat-lunch'], category: 'Meals', gst_rate: 5, tax_slab: 'gst-5', tax_slab_name: 'GST 5%' };
const UNRATED = { name: 'Poori', code: 'D02', price: 40, categories: ['cat-meals'] };
const GST5 = { definition_id: 'gst-5', kind: 'tax', name: 'GST 5%', current_version: 1, status: 'live', rules: { rate: 5 } };

function rowsFor(sql, params) {
  const text = String(sql);
  if (/FROM catalogue_items WHERE entity_id = \$1 AND is_active = true ORDER BY updated_at/.test(text)) return { rows: world.items.map((d, i) => ({ item_id: i ? ITEM.replace(/^2/, '3') : ITEM, item_data: d, is_active: true, updated_at: '2026-10-24T05:00:00.000Z' })) };
  if (/SELECT item_data FROM catalogue_items WHERE entity_id = \$1 AND item_id = \$2/.test(text)) return { rows: world.items.length ? [{ item_data: world.items[0] }] : [] };
  if (/FROM identities WHERE identity_id = \$1/.test(text)) return { rows: [Object.assign({ display_name: 'Kaveri Mess', identity_id: SHOP }, world.shop)] };
  if (/FROM definition d/.test(text)) return { rows: world.slabs };
  if (/^\s*UPDATE catalogue_items/.test(text)) { world.writes.push(params); return { rows: [{ item_id: ITEM }], rowCount: 1 }; }
  return { rows: [], rowCount: 0 };
}
const mock = (relative, exported) => { const file = require.resolve(path.join(HERE, relative)); require.cache[file] = { id: file, filename: file, loaded: true, exports: exported }; };
function installStubs() {
  const realAuth = require(path.join(HERE, 'middleware', 'auth'));
  const { holderOf } = require(path.join(HERE, 'lib', 'holder'));
  const stubAuth = (req, res, next) => {
    req.identity = world.who;
    if (world.key) { req.api_key = { jti: 'j1', scopes: world.key }; req.till = holderOf({ kind: 'api_key', jti: 'j1', scopes: world.key }, null, null); }
    return next();
  };
  mock('middleware/auth', Object.assign(stubAuth, realAuth, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id }));
  const client = { query: async (sql, params) => rowsFor(sql, params) };
  const known = { query: async (sql, params) => rowsFor(sql, params), withEntity: async (id, run) => run(client), withTransaction: async (run) => run(client),
    trySavepoint: async (handle, run, fallback) => run().catch(() => fallback), readBatch: async (entity, actor, statements) => statements.map(() => ({ rows: [], rowCount: 0 })) };
  const db = new Proxy(known, { get: (target, name) => (name in target ? target[name] : typeof name === 'symbol' || name === 'then' ? undefined : async () => ({ rows: [], rowCount: 0 })) });
  mock('db', db); mock('db/index', db);
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
const reset = (patch) => { Object.assign(world, { who: OWNER, key: null, shop: { gstn: '33AAAAA0000A1Z5', country: 'IN', policy_flags: { gst_registration: 'regular' } }, items: [], slabs: [], writes: [] }, patch || {}); };

(async () => {
  console.log('\n══ F5 A1 · the counter carries the item’s tax facts, and the owner sets a missing rate once ══\n');
  installStubs();
  const app = express(); app.use(express.json()); app.use('/api/till', require(path.join(HERE, 'routes', 'till.js')));
  const server = app.listen(0); const port = server.address().port;
  const q = (method, p, body) => call(port, method, '/api/till' + p, body);

  /* ── 1 · tillItem: the tax facts travel ─────────────────────────────────────────────────────────────────────── */
  reset({ items: [VEG_MEALS, UNRATED] });
  const snap = await q('GET', '/snapshot');
  const items = (snap.body && snap.body.items) || [];
  const meals = items.find((x) => x.name === 'Veg Meals'), poori = items.find((x) => x.name === 'Poori');
  ok('GET /snapshot answers 200 with the shop’s two items', () => { assert.strictEqual(snap.status, 200, JSON.stringify(snap.body).slice(0, 200)); assert.ok(meals && poori, JSON.stringify(items).slice(0, 300)); });
  ok('the item carries gst_rate · tax_slab · tax_slab_name · cess_rate (null = nobody said, never 0) — the shape tax-slab inputOf reads', () => {
    assert.strictEqual(meals.gst_rate, 5); assert.strictEqual(meals.tax_slab, 'gst-5'); assert.strictEqual(meals.tax_slab_name, 'GST 5%'); assert.strictEqual(meals.cess_rate, null);
    assert.strictEqual(poori.gst_rate, null); assert.strictEqual(poori.tax_slab, null); assert.strictEqual(poori.tax_slab_name, null);
  });
  ok('categories[] is EVERY id the product cites (the category rung keys by id); the legacy `category` name still travels for old tills', () => {
    assert.deepStrictEqual(meals.categories, ['cat-meals', 'cat-lunch']); assert.ok('category' in meals, 'legacy category kept'); assert.ok('category_id' in meals, 'first id kept');
  });
  ok('hsn reads `sac` when there is no hsn (a service’s code), and NEVER `code`: D01 stays the shop code, Poori has no hsn', () => {
    assert.strictEqual(meals.hsn, '996331'); assert.strictEqual(meals.code, 'D01'); assert.strictEqual(poori.hsn, null); assert.strictEqual(poori.code, 'D02');
  });

  /* ── 2 · the door ──────────────────────────────────────────────────────────────────────────────────────────── */
  reset({ key: ['till'], items: [UNRATED], slabs: [GST5] });
  const asKey = await q('POST', '/rate', { item_id: ITEM, slab_id: 'gst-5' });
  ok('a till KEY is refused 403 TILL_RATE_OWNER_ONLY, in words (it may not edit tax), and nothing is read or written', () => {
    assert.strictEqual(asKey.status, 403); assert.strictEqual(asKey.body.code, 'TILL_RATE_OWNER_ONLY'); assert.match(asKey.body.message, /^Ask the owner or a manager to set the tax rate\.$/);
    assert.strictEqual(asKey.body.may, false); assert.strictEqual(world.writes.length, 0);
  });
  reset({ who: CASHIER, items: [UNRATED], slabs: [GST5] });
  const asCashier = await q('POST', '/rate', { item_id: ITEM, slab_id: 'gst-5' });
  ok('a cashier (hat act) is refused with the same sentence — the door checks the signed-in person’s hat, not the key', () => {
    assert.strictEqual(asCashier.status, 403); assert.strictEqual(asCashier.body.code, 'TILL_RATE_OWNER_ONLY'); assert.match(asCashier.body.why, /Ask the owner/); assert.strictEqual(world.writes.length, 0);
  });
  reset({ items: [UNRATED], slabs: [GST5] });
  const noItem = await q('POST', '/rate', { slab_id: 'gst-5' });
  ok('the owner with no item_id: 400 naming the field (the strict schema answers first, in the counter’s old validation shape)', () => { assert.strictEqual(noItem.status, 400); assert.strictEqual(noItem.body.error, 'validation'); assert.match(noItem.body.message, /item_id/); assert.strictEqual(world.writes.length, 0); });
  reset({ items: [UNRATED], slabs: [GST5], shop: { gstn: '33AAAAA0000A1Z5', country: 'IN', policy_flags: { gst_registration: 'composition' } } });
  const composition = await q('POST', '/rate', { item_id: ITEM, slab_id: 'gst-5' });
  ok('a composition shop WITH a GSTIN charges none: 409 TILL_NO_TAX_SCHEME, the pack’s word (GST), nothing written — never "has a GSTIN"', () => {
    assert.strictEqual(composition.status, 409); assert.strictEqual(composition.body.code, 'TILL_NO_TAX_SCHEME'); assert.strictEqual(composition.body.message, 'This shop charges no GST, so no rate is needed.');
    assert.strictEqual(world.writes.length, 0);
  });
  reset({ items: [UNRATED], slabs: [GST5] });
  const unknown = await q('POST', '/rate', { item_id: ITEM, slab_id: 'gst-99' });
  ok('a slab the shop does not have: 404 in words, the caller’s value never echoed (Q19)', () => {
    assert.strictEqual(unknown.status, 404); assert.strictEqual(unknown.body.message, 'That rate is not one of this shop’s GST slabs.'); assert.ok(!/gst-99/.test(JSON.stringify(unknown.body)));
  });
  reset({ items: [UNRATED], slabs: [GST5] });
  const set = await q('POST', '/rate', { item_id: ITEM, slab_id: 'gst-5' });
  ok('the OWNER sets it: 200 changed:true, rate 5, in words — ONE merge-patch through catalogue-write.patchItems carrying setOn’s three keys', () => {
    assert.strictEqual(set.status, 200, JSON.stringify(set.body)); assert.deepStrictEqual([set.body.ok, set.body.changed, set.body.rate, set.body.slab_id], [true, true, 5, 'gst-5']);
    assert.strictEqual(set.body.words, 'Poori now carries GST 5%.');
    assert.strictEqual(world.writes.length, 1);
    const [ids, datas, modes] = world.writes[0];
    assert.deepStrictEqual(ids, [ITEM]); assert.deepStrictEqual(modes, ['merge']);
    assert.deepStrictEqual(JSON.parse(datas[0]), { tax_slab: 'gst-5', tax_slab_name: 'GST 5%', gst_rate: 5 });
  });
  reset({ who: MANAGER, items: [UNRATED], slabs: [GST5] });
  const byManager = await q('POST', '/rate', { item_id: ITEM, slab_id: 'gst-5' });
  ok('a MANAGER (hat manager) may set it too', () => { assert.strictEqual(byManager.status, 200, JSON.stringify(byManager.body)); assert.strictEqual(world.writes.length, 1); });
  reset({ items: [VEG_MEALS], slabs: [GST5] });
  const again = await q('POST', '/rate', { item_id: ITEM, slab_id: 'gst-5' });
  ok('idempotent: a product already citing that slab answers changed:false and NOTHING is written', () => {
    assert.strictEqual(again.status, 200); assert.strictEqual(again.body.changed, false); assert.strictEqual(again.body.words, 'Veg Meals already carries GST 5%.'); assert.strictEqual(world.writes.length, 0);
  });
  reset({ items: [], slabs: [GST5] });
  const gone = await q('POST', '/rate', { item_id: ITEM, slab_id: 'gst-5' });
  ok('a product not in the catalogue: 404 in words', () => { assert.strictEqual(gone.status, 404); assert.strictEqual(gone.body.message, 'That product is not in this shop’s catalogue.'); });

  /* ── 3 · the walk’s arithmetic, through the engine ──────────────────────────────────────────────────────── */
  const tax = require(path.join(HERE, 'lib', 'tax.js'));
  const packs = require(path.join(HERE, 'lib', 'tax-packs.js'));
  const policy = require(path.join(HERE, 'lib', 'policy.js'));
  ok('the shop’s setting: the India pack says prices_include_tax, and the policy flag defaults to yes — so ₹120 INCLUDES the tax', () => {
    assert.strictEqual(packs.packFor('IN').prices_include_tax, true); assert.strictEqual(policy.flagOf({}, 'price_includes_tax'), 'yes');
  });
  const split = tax.splitLineTax({ net: 120, rate: 5, priceIncludesTax: true, supply: 'intra', split: true, currency: 'INR' });
  ok('Veg Meals ₹120 including tax at 5%: CGST 2.86 + SGST 2.86 (each head rounded on its own, equal) = GST 5.72; taxable = 120 − 5.72 = 114.28; the line still totals ₹120 exactly', () => {
    assert.deepStrictEqual([split.heads.cgst, split.heads.sgst, split.heads.igst], [2.86, 2.86, 0]);
    assert.strictEqual(split.tax, 5.72);
    assert.strictEqual(split.assessable, 114.28);
    assert.strictEqual(Math.round((split.assessable + split.tax) * 100), 12000);
  });
  ok('the naive figures (taxable 114.29, GST 5.71) are NOT what the engine stamps: heads 2.86 + 2.86 do not make 5.71, and the taxable is total − tax (engines v1.43)', () => {
    assert.notStrictEqual(split.tax, 5.71); assert.notStrictEqual(split.assessable, 114.29);
  });

  server.close();
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
