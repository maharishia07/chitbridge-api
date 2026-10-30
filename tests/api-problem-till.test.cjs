#!/usr/bin/env node
/**
 * api-problem-till.test.cjs — API-4 sweep, till: every refusal of routes/till.js (the counter's 41 routes).
 *
 * OWNS      the proof that each refusal of the counter's routes is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from the
 *           code before the sweep), and this file's rows of docs/contracts/api-error-tests.json (the statuses each route is tested for, which the register's error_tests column reads).
 *           Also: no answer outside the statuses the route's contract declares (lib/till-contract.js), every code answered is registered, and the contract's words as units.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/till.js over a stand-in db and auth.
 * FLOW      route list (read from the router) x world (signed out, a counter key, a key for something else, staff, a bad id, a failing db, an empty db) + the named extras
 *           → real route → body → Problem fields present · frozen legacy keys equal · no leak on a 5xx · statuses tested → manifest
 *
 *   node tests/api-problem-till.test.cjs                    check
 *   node tests/api-problem-till.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json
 *   node tests/api-problem-till.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-till.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-till.test.cjs --compare F        the answers now against a capture F: byte for byte (status, content type, body)
 */
'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const kit = require('./problem-sweep-kit.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.OUTPUT_ALLOWLIST = 'enforce'; /* S34: a sweep test runs the allow-list for real; production defaults to report */
const crypto = require('crypto');
const LEGACY_FILE = path.join(HERE, 'docs', 'contracts', 'api-legacy.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json'); /* R2-4: the area tests' own evidence file, one writer per file */
const FOREIGN = require('./lib/foreign-id-world.cjs');
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const MOUNT = '/api/till';
const ROUTE_FILE = 'routes/till.js'; /* named in full so the graph links this test to the route file */
const CONTRACT_FILE = 'lib/till-contract.js';
const MINE = (route) => route.includes(' ' + MOUNT + '/');
const argv = process.argv.slice(2);
const flagValue = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null);
const { check, tally } = kit.checker(argv);
const replaying = argv.includes('--capture') || argv.includes('--compare');

/* ── stand-ins: auth and the db ────────────────────────────────────────────────────────────────────────────── */
const SHOP = '11111111-1111-4111-8111-111111111111';
const ITEM = '22222222-2222-4222-8222-222222222222';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Test shop' };
const STAFF = { identity_id: '44444444-4444-4444-8444-444444444444', parent_entity_id: SHOP, identity_type: 'actor', access_level: 'editor' };
const SECRET_SQL = 'relation "party_secret" does not exist -- SELECT secret FROM vault';
const FRESH = { realAuth: false, who: OWNER, key: null, db: 'ok', sqlRows: null };
const world = Object.assign({}, FRESH);

/** the rows a statement gets: a scenario's own rows first, then nothing (or the secret failure when the db is down) */
function rowsFor(sql) {
  if (world.sqlRows) {
    const given = world.sqlRows(String(sql));
    if (given) return given;
  }
  if (world.db === 'fail') throw new Error(SECRET_SQL);
  return { rows: [], rowCount: 0 };
}
const mock = (relative, exported) => {
  const file = require.resolve(path.join(HERE, relative));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exported };
};

function installStubs() {
  const realAuth = require(path.join(HERE, 'middleware', 'auth'));
  const { holderOf } = require(path.join(HERE, 'lib', 'holder'));
  const stubAuth = (req, res, next) => {
    if (world.realAuth) return realAuth(req, res, next);
    req.identity = world.who;
    if (world.key) {
      req.api_key = { jti: 'j1', scopes: world.key };
      req.till = holderOf({ kind: 'api_key', jti: 'j1', scopes: world.key }, null, null);
    }
    return next();
  };
  mock('middleware/auth', Object.assign(stubAuth, realAuth, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id }));
  const client = { query: async (sql) => rowsFor(sql) };
  const known = {
    query: async (sql) => rowsFor(sql),
    withEntity: async (id, run) => run(client),
    withTransaction: async (run) => run(client),
    trySavepoint: async (handle, run, fallback) => run().catch(() => fallback),
    readBatch: async (entity, actor, statements) => {
      if (world.db === 'fail') throw new Error(SECRET_SQL);
      return statements.map(() => ({ rows: [], rowCount: 0 }));
    }
  };
  const db = new Proxy(known, {
    get: (target, name) => (name in target ? target[name] : typeof name === 'symbol' || name === 'then' ? undefined : async () => ({ rows: [], rowCount: 0 }))
  });
  mock('db', db);
  mock('db/index', db);
  console.error = () => undefined; /* the routes log a 5xx here; the scenarios read the answer */
  console.warn = () => undefined;
}

/* ── the scenarios: every route the router holds x the worlds, then the named extras ───────────────────────── */
const PARAM_VALUES = { name: 'offers' };
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'counter-key', setup: { key: ['till'] } },
  { id: 'key-for-something-else', setup: { key: ['connector'] } },
  { id: 'staff-asks', setup: { who: STAFF } },
  { id: 'bad-id', setup: {}, badId: true },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} }
];
const X = (id, route, status, extra) => Object.assign({ id, route, expect: status, setup: {} }, extra);
const THROWS = () => {
  throw new Error(SECRET_SQL);
};
const throwsLater = async () => THROWS();
/** a refusal a library throws (lib/reward-store): .code and .say */
const refusal = (code, say) => async () => {
  throw Object.assign(new Error('internal ' + code), { code, say });
};
const COUNTER_KEYS = ['lib/api-keys.js', 'listOf', async () => [{ jti: 'j1', counter: 'C1', scopes: ['till'] }]];
const KEYS_NOT_LISTED = ['lib/api-keys.js', 'listOf', async () => []];
const KEY_ROWS = (scopes) => (sql) => (/SELECT policy_flags FROM identities/.test(sql) ? { rows: [{ policy_flags: { api_keys: [{ jti: 's1', scopes }] } }], rowCount: 1 } : undefined);
const SHOP_ROW = (sql) => (/SELECT currency_code, country FROM identities/.test(sql) ? { rows: [{ currency_code: 'INR', country: 'IN' }], rowCount: 1 } : undefined);
const PROGRAMME = ['lib/reward-store.js', 'programme', async () => ({ name: 'Points', walk_in_earns: true })];
const OFFER_ROW = (kind, status) => (sql) =>
  /FROM definition d/.test(sql) ? { rows: [{ definition_id: ITEM, name: 'Spring', current_version: 1, status, kind, rules: {} }], rowCount: 1 } : undefined;
const PARTY = (country) => ['lib/profile.js', 'invoiceParty', async () => ({ country })];
/* F5 A1 · the rate door's worlds: a shop's registration row (regular charges, composition does not), and a shelf holding one slab but no product */
const SLAB = '00000000-0000-4000-8000-0000000001d1'; /* a slab's definition id (the generated hardening case plays this recorded request: tools/api-contract-tests PATH_ID) */
const RATE_BODY = { item_id: ITEM, slab_id: SLAB };
const RATE_SHOP = (registration) => (sql) =>
  /FROM identities WHERE identity_id = \$1/.test(sql) ? { rows: [{ gstn: '33AAAAA0000A1Z5', country: 'IN', policy_flags: { gst_registration: registration } }], rowCount: 1 } : undefined;
const RATE_SHELF = (sql) =>
  RATE_SHOP('regular')(sql) || (/FROM definition d/.test(sql) ? { rows: [{ definition_id: SLAB, kind: 'tax', name: 'GST 5%', current_version: 1, status: 'live', rules: { rate: 5 } }], rowCount: 1 } : undefined);
/* …and the product itself, unrated, so the door reaches its 200 (the success answer the output allow-list is derived from) */
const RATE_ITEM = (sql) =>
  RATE_SHELF(sql) ||
  (/SELECT item_data FROM catalogue_items/.test(sql) ? { rows: [{ item_data: { name: 'Poori', price: 40 } }], rowCount: 1 } : /^\s*UPDATE catalogue_items/.test(sql) ? { rows: [{ item_id: ITEM }], rowCount: 1 } : undefined);
/* API-8 (till): the stand-ins the success scenes below share */
const ITEM2 = '33333333-3333-4333-8333-333333333333';
const WHEN = new Date('2026-10-29T04:00:00Z');
const rowsOf = (rows) => ({ rows, rowCount: rows.length });
/** the product writer answering one row whose item_data is `data` (the statement itself is the catalogue's, tested elsewhere) */
const PATCH_ITEM = (data) => ['lib/catalogue-write.js', 'patchItems', async () => rowsOf([{ item_id: ITEM, item_data: data }])];
const PATCH_ROWS = (rows) => ['lib/catalogue-write.js', 'patchItems', async () => rowsOf(rows)];
/** the product row a handler reads before it writes */
const ITEM_ROW = (data) => (sql) => (/SELECT item_data FROM catalogue_items/.test(sql) ? rowsOf([{ item_data: data }]) : undefined);
const PRICE_ROWS = (data) => (sql) => SHOP_ROW(sql) || ITEM_ROW(data)(sql);
/** identities.display_name and bridge_id are both nullable: a shop row with them, or no row at all (null and null) */
const SHOP_NAMES = (sql) => (/SELECT display_name(, bridge_id)? FROM identities/.test(sql) ? rowsOf([{ display_name: 'Test shop', bridge_id: 'BR-1' }]) : undefined);
const DIAG_HEARD = ['lib/api-keys.js', 'setDiag', async (entity, jti, patch) => Object.assign({}, patch, { at: '2026-10-29T04:00:00.000Z' })];
const KEY_WITHOUT_COUNTER = ['lib/api-keys.js', 'listOf', async () => [{ jti: 'j1', scopes: ['till'] }]];
const COUNTER_WITH_PREFIX = ['lib/api-keys.js', 'listOf', async () => [{ jti: 'j1', counter: 'c1', scopes: ['till'], till: { id: 'AB' } }]];
const COUNTER_ROW = (sql) => (/policy_flags->'counters'/.test(sql) ? rowsOf([{ c: { held_by: 'j1', next: 3, period: '2026-10' } }]) : undefined);
const ENROL_OK = (released) => ['lib/counters-store.js', 'claim', async () => ({ status: 200, key: 'cbk_test', counter: 'C1', released })];
const MINT_OK = ['lib/api-keys.js', 'mint', async () => ({ key: 'cbk_screen' })];
/** the read selects three columns; the write returns the whole row (RETURNING *) */
const QK_STATE_ROWS = (shift) => (sql) => {
  const three = { shift_id: shift, active_group_ids: [ITEM], updated_at: WHEN };
  if (/SELECT active_group_ids/.test(sql)) return rowsOf([{ active_group_ids: three.active_group_ids, shift_id: three.shift_id, updated_at: three.updated_at }]);
  return /counter_quick_key_state/.test(sql) ? rowsOf([Object.assign({ entity_id: SHOP, counter_id: 'C1', business_date: new Date('2026-10-29T00:00:00Z') }, three)]) : undefined;
};
const QK_HIDDEN_ROWS = (shift, by) => (sql) =>
  /INSERT INTO counter_hidden_item/.test(sql) ? rowsOf([{ entity_id: SHOP, counter_id: 'C1', shift_id: shift, product_id: ITEM, hidden_at: WHEN, hidden_by: by }]) : undefined;
const SCREEN_CONFIG_ROW = (sql) =>
  /INSERT INTO device_screen_config/.test(sql) ? rowsOf([{ id: ITEM, entity_id: SHOP, counter_id: 'C1', config: { theme: 'dark' }, updated_by: null, updated_at: WHEN }]) : undefined;
const PROGRAMME_EARNS = ['lib/reward-store.js', 'programme', async () => ({ definition_id: ITEM, name: 'Points', walk_in_earns: true, earn: { kind: 'per_amount', per: 100, points: 1 } })];
const PROGRAMME_EXPIRES = ['lib/reward-store.js', 'programme', async () => ({ definition_id: ITEM, name: 'Points', walk_in_earns: true, expires_months: 6, earn: { kind: 'per_amount', per: 100, points: 1 }, redeem: [{ kind: 'money', points: 100, amount: 10 }] })];
const LEDGER_ROWS = (at) => (sql) => (/FROM reward_ledger/.test(sql) ? rowsOf([{ points: 50, why: 'earn', ref: 'C1-0001', note: null, at: new Date(at), total: 50 }]) : undefined);
const SETTLE_OK = ['lib/reward-store.js', 'settle', async (entity, holder, prog, posted) => ({ before: { points: 40 }, added: posted.earn ? 5 : 0 })];
const SCREEN_KEYS = (sql) => (/SELECT policy_flags FROM identities/.test(sql) ? rowsOf([{ policy_flags: { api_keys: [{ jti: 's1', name: 'TV', scopes: ['screen'] }] } }]) : undefined);
const WRITE_ITEMS_OK = ['lib/catalogue-write.js', 'writeItems', async ({ items }) => ({ ok: true, rows: items.map((item, index) => ({ item_id: 'row-' + index })) })];
/** the extras: an answer the generic worlds cannot reach (a named refusal inside a handler, a fault behind a body the handler accepts) */
const EXTRAS = [
  X('snapshot-breaks', 'GET /api/till/snapshot', 500, { patch: [['lib/profile.js', 'countryOf', THROWS]] }),
  X('stock-no-item', 'POST /api/till/stock', 400, { body: {} }),
  X('stock-bad-status', 'POST /api/till/stock', 400, { body: { item_id: ITEM, status: 'retired' } }),
  X('stock-item-not-there', 'POST /api/till/stock', 404, { body: { item_id: ITEM, status: 'unavailable' } }),
  X('stock-write-breaks', 'POST /api/till/stock', 500, { setup: { db: 'fail' }, body: { item_id: ITEM, status: 'unavailable' } }),
  X('bulk-no-ids', 'POST /api/till/stock/bulk', 400, { body: {} }),
  X('bulk-too-many', 'POST /api/till/stock/bulk', 400, { body: { item_ids: Array.from({ length: 501 }, (nothing, index) => 'i' + index), status: 'available' } }),
  X('bulk-bad-status', 'POST /api/till/stock/bulk', 400, { body: { item_ids: [ITEM], status: 'retired' } }),
  X('bulk-write-breaks', 'POST /api/till/stock/bulk', 500, { setup: { db: 'fail' }, body: { item_ids: [ITEM], status: 'available' } }),
  X('diagnostic-by-a-person', 'POST /api/till/diagnostic', 400, { body: { code: 'x' } }),
  X('diagnostic-key-not-listed', 'POST /api/till/diagnostic', 404, { setup: { key: ['till'] }, body: { code: 'x' }, patch: [['lib/api-keys.js', 'setDiag', async () => null]] }),
  X('diagnostic-write-breaks', 'POST /api/till/diagnostic', 500, { setup: { key: ['till'] }, body: { code: 'x' }, patch: [['lib/api-keys.js', 'setDiag', throwsLater]] }),
  X('close-by-a-person', 'POST /api/till/close', 400, { body: {} }),
  X('close-counter-not-listed', 'POST /api/till/close', 404, { setup: { key: ['till'] }, body: {}, patch: [KEYS_NOT_LISTED] }),
  X('close-write-breaks', 'POST /api/till/close', 500, { setup: { key: ['till'] }, body: {}, patch: [COUNTER_KEYS, ['lib/api-keys.js', 'patchTill', throwsLater]] }),
  X('flags-no-item', 'POST /api/till/flags', 400, { body: {} }),
  X('flags-nothing-to-set', 'POST /api/till/flags', 400, { body: { item_id: ITEM } }),
  X('flags-item-not-there', 'POST /api/till/flags', 404, { body: { item_id: ITEM, screen: true } }),
  X('flags-write-breaks', 'POST /api/till/flags', 500, { setup: { db: 'fail' }, body: { item_id: ITEM, screen: true } }),
  X('qk-no-counter', 'GET /api/till/quick-keys/state', 403, { setup: { key: ['till'] }, patch: [KEYS_NOT_LISTED] }),
  X('qk-no-date', 'GET /api/till/quick-keys/state', 400, { setup: { key: ['till'] }, patch: [COUNTER_KEYS] }),
  X('qk-state-no-counter', 'POST /api/till/quick-keys/state', 403, { setup: { key: ['till'] }, body: {}, patch: [KEYS_NOT_LISTED] }),
  X('qk-state-no-date', 'POST /api/till/quick-keys/state', 400, { setup: { key: ['till'] }, body: {}, patch: [COUNTER_KEYS] }),
  X('qk-hide-no-counter', 'POST /api/till/quick-keys/hide', 403, { setup: { key: ['till'] }, body: {}, patch: [KEYS_NOT_LISTED] }),
  X('qk-hide-no-product', 'POST /api/till/quick-keys/hide', 400, { setup: { key: ['till'] }, body: {}, patch: [COUNTER_KEYS] }),
  X('qk-unhide-no-counter', 'POST /api/till/quick-keys/unhide', 403, { setup: { key: ['till'] }, body: {}, patch: [KEYS_NOT_LISTED] }),
  X('qk-unhide-no-product', 'POST /api/till/quick-keys/unhide', 400, { setup: { key: ['till'] }, body: {}, patch: [COUNTER_KEYS] }),
  X('qk-screen-no-counter', 'POST /api/till/quick-keys/screen-config', 403, { setup: { key: ['till'] }, body: {}, patch: [KEYS_NOT_LISTED] }),
  X('offer-item-no-ids', 'POST /api/till/offer-item', 400, { body: {} }),
  X('offer-not-there', 'POST /api/till/offer-item', 404, { body: { offer_id: ITEM, item_id: ITEM, on: true } }),
  X('not-an-offer', 'POST /api/till/offer-item', 400, { body: { offer_id: ITEM, item_id: ITEM, on: true }, setup: { sqlRows: OFFER_ROW('reward', 'live') } }),
  X('offer-not-live', 'POST /api/till/offer-item', 400, { body: { offer_id: ITEM, item_id: ITEM, on: true }, setup: { sqlRows: OFFER_ROW('offer', 'draft') } }),
  X('offer-item-write-breaks', 'POST /api/till/offer-item', 500, { setup: { db: 'fail' }, body: { offer_id: ITEM, item_id: ITEM, on: true } }),
  X('price-no-item', 'POST /api/till/price', 400, { body: {} }),
  X('price-not-a-number', 'POST /api/till/price', 400, { body: { item_id: ITEM, price: -1 } }),
  /* CTR-168: no number at all is refused in PATCH /products' words, never read as 0 or 1 */
  X('price-null', 'POST /api/till/price', 400, { body: { item_id: ITEM, price: null }, said: 'Price is required' }),
  X('price-blank', 'POST /api/till/price', 400, { body: { item_id: ITEM, price: '' }, said: 'Price is required' }),
  X('price-empty-list', 'POST /api/till/price', 400, { body: { item_id: ITEM, price: [] }, said: 'Price is required' }),
  X('price-true', 'POST /api/till/price', 400, { body: { item_id: ITEM, price: true }, said: 'Price must be a number' }),
  X('price-cost-blind', 'POST /api/till/price', 403, {
    body: { item_id: ITEM, price: 5 },
    patch: [['lib/cost.js', 'writeRefusal', async () => ({ error: 'Not permitted', code: 'COST_BLIND', blocked: ['price'], message: 'Your access does not include cost or price.' })]]
  }),
  X('price-no-money', 'POST /api/till/price', 422, { body: { item_id: ITEM, price: 5 } }),
  X('price-item-not-there', 'POST /api/till/price', 404, { body: { item_id: ITEM, price: 5 }, setup: { sqlRows: SHOP_ROW } }),
  X('price-write-breaks', 'POST /api/till/price', 500, { body: { item_id: ITEM, price: 5 }, setup: { db: 'fail', sqlRows: SHOP_ROW } }),
  /* F5 A1 · POST /rate: the door (a key, a cashier) with a full body, since the strict schema answers an empty one first; the shop that charges none; the slab and the product not there; the write breaking */
  X('rate-key-asks', 'POST /api/till/rate', 403, { body: RATE_BODY, setup: { key: ['till'] } }),
  X('rate-cashier-asks', 'POST /api/till/rate', 403, { body: RATE_BODY, setup: { who: STAFF } }),
  X('rate-unknown-key-in-body', 'POST /api/till/rate', 400, { body: Object.assign({ colour: 'red' }, RATE_BODY) }),
  X('rate-shop-charges-none', 'POST /api/till/rate', 409, { body: RATE_BODY, setup: { sqlRows: RATE_SHOP('composition') } }),
  X('rate-slab-not-there', 'POST /api/till/rate', 404, { body: RATE_BODY, setup: { sqlRows: RATE_SHOP('regular') } }),
  X('rate-item-not-there', 'POST /api/till/rate', 404, { body: RATE_BODY, setup: { sqlRows: RATE_SHELF } }),
  X('rate-write-breaks', 'POST /api/till/rate', 500, { body: RATE_BODY, setup: { db: 'fail', sqlRows: RATE_SHELF } }),
  X('rate-set', 'POST /api/till/rate', 200, { body: RATE_BODY, setup: { sqlRows: RATE_ITEM } }),
  X('alias-no-words', 'POST /api/till/alias', 400, { body: { item_id: ITEM } }),
  X('alias-too-long', 'POST /api/till/alias', 400, { body: { item_id: ITEM, text: 'x'.repeat(121) } }),
  X('alias-bad-factor', 'POST /api/till/alias', 400, { body: { item_id: ITEM, text: 'SUNFL OIL', factor: -2 } }),
  X('alias-product-not-there', 'POST /api/till/alias', 404, { body: { item_id: ITEM, text: 'SUNFL OIL' } }),
  X('alias-write-breaks', 'POST /api/till/alias', 500, { setup: { db: 'fail' }, body: { item_id: ITEM, text: 'SUNFL OIL' } }),
  X('reconcile-read-breaks', 'POST /api/till/reconcile', 500, { setup: { db: 'fail' }, body: { bills: [{ no: 'C1/1', at: 'x', chit_id: ITEM }] } }),
  X('qk-hidden-read-breaks', 'GET /api/till/quick-keys/hidden', 500, { setup: { key: ['till'], db: 'fail' }, patch: [COUNTER_KEYS] }),
  X('qk-state-read-breaks', 'GET /api/till/quick-keys/state', 500, { url: '/api/till/quick-keys/state?business_date=2026-10-23', setup: { key: ['till'], db: 'fail' }, patch: [COUNTER_KEYS] }),
  X('qk-state-write-breaks', 'POST /api/till/quick-keys/state', 500, { setup: { key: ['till'], db: 'fail' }, body: { business_date: '2026-10-23' }, patch: [COUNTER_KEYS] }),
  X('qk-hide-write-breaks', 'POST /api/till/quick-keys/hide', 500, { setup: { key: ['till'], db: 'fail' }, body: { product_id: ITEM }, patch: [COUNTER_KEYS] }),
  X('qk-unhide-write-breaks', 'POST /api/till/quick-keys/unhide', 500, { setup: { key: ['till'], db: 'fail' }, body: { product_id: ITEM }, patch: [COUNTER_KEYS] }),
  X('qk-screen-write-breaks', 'POST /api/till/quick-keys/screen-config', 500, { setup: { key: ['till'], db: 'fail' }, body: { config: {} }, patch: [COUNTER_KEYS] }),
  X('blueprints-break', 'GET /api/till/catalogue/blueprints', 500, { patch: [['lib/catalogue-blueprint.js', 'blueprint', THROWS], ['lib/catalogue-blueprint.js', 'pin', THROWS]] }),
  X('reward-read-no-holder', 'GET /api/till/reward', 400, {}),
  X('reward-read-breaks', 'GET /api/till/reward', 500, { url: '/api/till/reward?scheme=phone&value=9840012345', setup: { db: 'fail' } }),
  X('reward-no-bill-number', 'POST /api/till/reward', 400, { body: {} }),
  X('reward-bill-not-recorded', 'POST /api/till/reward', 409, {
    body: { ref: 'C1/1', holder: { scheme: 'phone', value: '9840012345' } },
    patch: [PROGRAMME, ['lib/reward-store.js', 'settle', refusal('BILL_NOT_RECORDED', 'That bill has not reached the server yet.')]]
  }),
  X('reward-write-breaks', 'POST /api/till/reward', 500, {
    body: { ref: 'C1/1', holder: { scheme: 'phone', value: '9840012345' } },
    patch: [PROGRAMME, ['lib/reward-store.js', 'settle', throwsLater]]
  }),
  X('claim-no-holders', 'POST /api/till/reward/claim', 400, { body: {} }),
  X('claim-no-programme', 'POST /api/till/reward/claim', 400, { body: { from: { scheme: 'phone', value: '9840012345' }, to: { scheme: 'identity', value: ITEM } } }),
  X('claim-refused', 'POST /api/till/reward/claim', 400, {
    body: { from: { scheme: 'phone', value: '9840012345' }, to: { scheme: 'identity', value: ITEM } },
    patch: [PROGRAMME, ['lib/reward-store.js', 'claim', async () => ({ ok: false, why: 'There is nothing to move.' })]]
  }),
  X('claim-already-recorded', 'POST /api/till/reward/claim', 409, {
    body: { from: { scheme: 'phone', value: '9840012345' }, to: { scheme: 'identity', value: ITEM } },
    patch: [PROGRAMME, ['lib/reward-store.js', 'claim', refusal('CLAIM_RECORDED', 'That claim is already recorded.')]]
  }),
  X('claim-write-breaks', 'POST /api/till/reward/claim', 500, {
    body: { from: { scheme: 'phone', value: '9840012345' }, to: { scheme: 'identity', value: ITEM } },
    patch: [PROGRAMME, ['lib/reward-store.js', 'claim', throwsLater]]
  }),
  X('pair-by-another-key', 'POST /api/till/pair', 403, { setup: { key: ['screen'] }, body: {} }),
  X('pair-lookup-breaks', 'POST /api/till/pair', 500, { setup: { db: 'fail' }, body: {} }),
  X('enrol-counter-held', 'POST /api/till/enrol', 409, {
    body: { counter: 'C1' },
    patch: [['lib/counters-store.js', 'claim', async () => ({ status: 409, body: { error: 'conflict', code: 'COUNTER_HELD', message: 'C1 is open on another PC.' } })]]
  }),
  X('enrol-library-says-no', 'POST /api/till/enrol', 400, {
    body: { counter: 'C1' },
    patch: [['lib/counters-store.js', 'claim', async () => { throw Object.assign(new Error('That counter name is not allowed.'), { status: 400 }); }]]
  }),
  X('enrol-claim-breaks', 'POST /api/till/enrol', 500, { body: { counter: 'C1' }, patch: [['lib/counters-store.js', 'claim', throwsLater]] }),
  X('claim-key-breaks', 'POST /api/till/pair/claim', 500, { body: { code: 'ZZZZZZ' }, patch: [['lib/api-keys.js', 'mint', throwsLater]], before: 'pair-code' }),
  /* API-8 (till): a pairing success; it clears this address's count of wrong codes, so 'too-many-wrong-codes' below spends the count itself */
  X('pair-claimed', 'POST /api/till/pair/claim', 200, { body: { code: 'ZZZZZZ' }, before: 'pair-code', patch: [MINT_OK] }),
  X('pair-claimed-named-shop', 'POST /api/till/pair/claim', 200, { body: { code: 'ZZZZZZ' }, before: 'pair-code', pairSetup: { sqlRows: SHOP_NAMES }, patch: [MINT_OK] }),
  X('claim-code-unknown', 'POST /api/till/pair/claim', 404, { body: { code: 'ZZZZZZ' } }),
  X('claim-code-unknown-again', 'POST /api/till/pair/claim', 404, { body: { code: 'ZZZZZZ' } }),
  X('too-many-wrong-codes', 'POST /api/till/pair/claim', 429, { body: { code: 'ZZZZZZ' }, before: 'wrong-codes' }),
  X('revoke-no-screen', 'POST /api/till/screens/revoke', 400, { body: {} }),
  X('revoke-not-a-screen', 'POST /api/till/screens/revoke', 403, { body: { jti: 's1' }, setup: { sqlRows: KEY_ROWS(['till']) } }),
  X('revoke-not-paired', 'POST /api/till/screens/revoke', 404, { body: { jti: 's1' } }),
  X('revoke-breaks', 'POST /api/till/screens/revoke', 500, { body: { jti: 's1' }, setup: { db: 'fail' } }),
  X('rename-no-screen', 'POST /api/till/screens/rename', 400, { body: {} }),
  X('rename-not-a-screen', 'POST /api/till/screens/rename', 403, { body: { jti: 's1' }, setup: { sqlRows: KEY_ROWS(['till']) } }),
  X('rename-not-paired', 'POST /api/till/screens/rename', 404, { body: { jti: 's1' } }),
  X('rename-breaks', 'POST /api/till/screens/rename', 500, { body: { jti: 's1' }, setup: { db: 'fail' } }),
  X('shop-no-country', 'POST /api/till/shop', 400, { body: { gstin: '29AAAAA0000A1Z5' } }),
  X('shop-bad-gstin-in', 'POST /api/till/shop', 400, { body: { gstin: 'not a gstin' }, patch: [PARTY('IN')] }),
  X('shop-bad-gstin-checksum', 'POST /api/till/shop', 400, { body: { gstin: '29AAAAA0000A1Z0' }, patch: [PARTY('IN')] }),
  X('shop-bad-tax-id-abroad', 'POST /api/till/shop', 400, { body: { gstin: '1' }, patch: [PARTY('AU')] }),
  X('shop-write-breaks', 'POST /api/till/shop', 500, { body: { phone: '9876543210' }, patch: [['lib/profile.js', 'applyProfileMap', throwsLater]] }),
  X('catalogue-not-empty', 'POST /api/till/catalogue', 409, { body: { blueprint: 'veg' }, patch: [['lib/catalogue-write.js', 'countItems', async () => 3]] }),
  X('catalogue-no-valid-rows', 'POST /api/till/catalogue', 400, { body: { products: [{ colour: 'red' }] } }),
  X('catalogue-unknown-trade', 'POST /api/till/catalogue', 400, { body: { blueprint: 'nonesuch' } }),
  X('catalogue-nothing-chosen', 'POST /api/till/catalogue', 400, { body: {} }),
  X('catalogue-categories-break', 'POST /api/till/catalogue', 500, { body: { blueprint: 'veg' }, patch: [['lib/categories.js', 'ensureCategories', throwsLater]] }),
  X('catalogue-write-refused', 'POST /api/till/catalogue', 422, {
    body: { blueprint: 'veg' },
    patch: [['lib/catalogue-write.js', 'writeItems', async () => ({ ok: false, status: 422, error: 'Invalid products', message: 'One product has no name.', invalid: [{ row: 1 }] })]]
  }),
  X('catalogue-write-breaks', 'POST /api/till/catalogue', 500, { body: { blueprint: 'veg' }, patch: [['lib/catalogue-write.js', 'writeItems', throwsLater]] }),
  X('summary-trend-bad-period', 'GET /api/till/summary', 400, { url: '/api/till/summary?compare=1&period=decade' }),
  X('summary-trend-no-country', 'GET /api/till/summary', 422, { url: '/api/till/summary?compare=1&period=week' }),
  /* API-8 (till): the READY side of the reads whose stand-in answer is the not-ready or the empty one; the output schema is learned from both branches of each handler */
  X('summary-trend-ready', 'GET /api/till/summary', 200, { url: '/api/till/summary?compare=1&period=week', patch: [['lib/till-summary.js', 'trend', async () => ({ status: 200, body: { period: 'week', n: 12, currency: 'INR', fy_start_month: 4, slots: [] } })]] }),
  X('bills-over-the-cap', 'GET /api/till/bills', 200, { url: '/api/till/bills?limit=100000' }),
  X('match-no-orders', 'GET /api/till/match', 200, {}),
  X('match-one-head', 'GET /api/till/match', 200, { patch: [['lib/select.js', 'rows', async () => [{ chit_id: ITEM, created_at: '2026-10-01T00:00:00Z', counterparty_id: null }]]] }),
  X('stock-detail-not-switched-on', 'GET /api/till/stock', 200, { url: '/api/till/stock?detail=1', patch: [['lib/schema.js', 'hasTable', async () => false]] }),
  X('stock-detail-ready', 'GET /api/till/stock', 200, { url: '/api/till/stock?detail=1', patch: [['lib/schema.js', 'hasTable', async () => true], ['lib/stock-store.js', 'onHand', async () => ({})]] }),
  X('stock-plain', 'GET /api/till/stock', 200, { patch: [['lib/stock-store.js', 'onHand', async () => ({})]] }),
  X('hidden-for-a-counter', 'GET /api/till/quick-keys/hidden', 200, { setup: { key: ['till'] }, patch: [COUNTER_KEYS] }),
  X('screen-config-for-a-counter', 'GET /api/till/quick-keys/screen-config', 200, { setup: { key: ['till'] }, patch: [COUNTER_KEYS] }),
  X('snapshot-for-a-tv', 'GET /api/till/snapshot', 200, { setup: { key: ['screen'] } }),
  X('snapshot-delta', 'GET /api/till/snapshot', 200, { url: '/api/till/snapshot?since=2026-10-01T00:00:00Z' }),
  X('snapshot-counter-key', 'GET /api/till/snapshot', 200, { setup: { key: ['till'] }, patch: [COUNTER_KEYS] }),
  /* API-8 (till, writes): the SUCCESS side of every counter write and of the reads that had none, each over the real route with a stand-in db that answers the library's own statements;
     the nullable columns of the tables behind them are held as null in one scene and as a value in another */
  X('stock-set', 'POST /api/till/stock', 200, { body: { item_id: ITEM, status: 'unavailable' }, patch: [PATCH_ITEM({ name: 'Poori' })] }),
  X('stock-set-unnamed', 'POST /api/till/stock', 200, { body: { item_id: ITEM, status: 'available' }, patch: [PATCH_ITEM({})] }),
  X('bulk-moved-some', 'POST /api/till/stock/bulk', 200, { body: { item_ids: [ITEM, ITEM2], status: 'available' }, patch: [PATCH_ROWS([{ item_id: ITEM }])] }),
  X('bulk-moved-all', 'POST /api/till/stock/bulk', 200, { body: { item_ids: [ITEM], status: 'unavailable' }, patch: [PATCH_ROWS([{ item_id: ITEM }])] }),
  X('diagnostic-heard', 'POST /api/till/diagnostic', 200, { setup: { key: ['till'] }, body: { code: 'AB12', verdict: 'queue stuck', queued: 3 }, patch: [DIAG_HEARD] }),
  X('diagnostic-heard-bare', 'POST /api/till/diagnostic', 200, { setup: { key: ['till'] }, body: {}, patch: [DIAG_HEARD] }),
  X('close-no-counter-name', 'POST /api/till/close', 200, { setup: { key: ['till'] }, body: { last_no: 'C1-0007', bills: 7 }, patch: [KEY_WITHOUT_COUNTER, ['lib/api-keys.js', 'patchTill', async () => undefined]] }),
  X('close-a-counter', 'POST /api/till/close', 200, {
    setup: { key: ['till'], sqlRows: COUNTER_ROW },
    body: { last_no: 'C1-0007', bills: 7, next: 8, period: '2026-10' },
    patch: [COUNTER_WITH_PREFIX, ['lib/api-keys.js', 'patchTill', async () => undefined], ['lib/counters-store.js', 'patchCounter', async () => undefined]]
  }),
  X('close-a-counter-no-prefix', 'POST /api/till/close', 200, {
    setup: { key: ['till'], sqlRows: COUNTER_ROW },
    body: {},
    patch: [COUNTER_KEYS, ['lib/api-keys.js', 'patchTill', async () => undefined], ['lib/counters-store.js', 'patchCounter', async () => undefined]]
  }),
  X('enrol-opened', 'POST /api/till/enrol', 200, { body: { counter: 'C1', name: 'Front' }, setup: { sqlRows: SHOP_NAMES }, patch: [ENROL_OK(false)] }),
  X('enrol-took-over-unnamed-shop', 'POST /api/till/enrol', 200, { body: { counter: 'C1', takeover: true }, patch: [ENROL_OK(true)] }),
  X('flags-screen-on', 'POST /api/till/flags', 200, { body: { item_id: ITEM, screen: true }, patch: [PATCH_ITEM({ name: 'Poori', screen: true })] }),
  X('flags-screen-off-unnamed', 'POST /api/till/flags', 200, { body: { item_id: ITEM, screen: false }, patch: [PATCH_ITEM({})] }),
  X('flags-offer-out', 'POST /api/till/flags', 200, {
    body: { item_id: ITEM, offer_id: ITEM2, excluded: true },
    setup: { sqlRows: ITEM_ROW({ offers_excluded: [] }) },
    patch: [PATCH_ITEM({ name: 'Poori', offers_excluded: [ITEM2] })]
  }),
  X('offer-item-added', 'POST /api/till/offer-item', 200, { body: { offer_id: ITEM, item_id: ITEM2, on: true, by: 'Asha' }, setup: { sqlRows: OFFER_ROW('offer', 'live') } }),
  X('offer-item-unchanged', 'POST /api/till/offer-item', 200, { body: { offer_id: ITEM, item_id: ITEM2, on: false }, setup: { sqlRows: OFFER_ROW('offer', 'live') } }),
  X('price-changed', 'POST /api/till/price', 200, {
    body: { item_id: ITEM, price: 45, by: 'Asha' },
    setup: { sqlRows: PRICE_ROWS({ name: 'Poori', price: { amount: 40, currency: 'INR' } }) },
    patch: [PATCH_ITEM({ name: 'Poori' })]
  }),
  X('price-first-time-unnamed', 'POST /api/till/price', 200, { body: { item_id: ITEM, price: 45 }, setup: { sqlRows: PRICE_ROWS({}) }, patch: [PATCH_ITEM({})] }),
  X('qk-state-read-default', 'GET /api/till/quick-keys/state', 200, { url: '/api/till/quick-keys/state?business_date=2026-10-29', setup: { key: ['till'] }, patch: [COUNTER_KEYS] }),
  X('qk-state-read-saved', 'GET /api/till/quick-keys/state', 200, { url: '/api/till/quick-keys/state?business_date=2026-10-29', setup: { key: ['till'], sqlRows: QK_STATE_ROWS('S1') }, patch: [COUNTER_KEYS] }),
  X('qk-state-read-no-shift', 'GET /api/till/quick-keys/state', 200, { url: '/api/till/quick-keys/state?business_date=2026-10-29', setup: { key: ['till'], sqlRows: QK_STATE_ROWS(null) }, patch: [COUNTER_KEYS] }),
  X('qk-state-set', 'POST /api/till/quick-keys/state', 200, {
    body: { business_date: '2026-10-29', shift_id: 'S1', active_group_ids: [ITEM] },
    setup: { key: ['till'], sqlRows: QK_STATE_ROWS('S1') },
    patch: [COUNTER_KEYS]
  }),
  X('qk-state-set-no-shift', 'POST /api/till/quick-keys/state', 200, { body: { business_date: '2026-10-29' }, setup: { key: ['till'], sqlRows: QK_STATE_ROWS(null) }, patch: [COUNTER_KEYS] }),
  X('qk-hide', 'POST /api/till/quick-keys/hide', 200, { body: { product_id: ITEM, shift_id: 'S1', by: ITEM2 }, setup: { key: ['till'], sqlRows: QK_HIDDEN_ROWS('S1', ITEM2) }, patch: [COUNTER_KEYS] }),
  X('qk-hide-bare', 'POST /api/till/quick-keys/hide', 200, { body: { product_id: ITEM }, setup: { key: ['till'], sqlRows: QK_HIDDEN_ROWS(null, null) }, patch: [COUNTER_KEYS] }),
  X('qk-unhide', 'POST /api/till/quick-keys/unhide', 200, {
    body: { product_id: ITEM },
    setup: { key: ['till'], sqlRows: (sql) => (/DELETE FROM counter_hidden_item/.test(sql) ? { rows: [], rowCount: 2 } : undefined) },
    patch: [COUNTER_KEYS]
  }),
  X('qk-screen-config-set', 'POST /api/till/quick-keys/screen-config', 200, { body: { config: { theme: 'dark' } }, setup: { key: ['till'], sqlRows: SCREEN_CONFIG_ROW }, patch: [COUNTER_KEYS] }),
  X('reward-read-no-programme', 'GET /api/till/reward', 200, { url: '/api/till/reward?scheme=phone&value=9840012345' }),
  X('reward-read-ready', 'GET /api/till/reward', 200, { url: '/api/till/reward?scheme=phone&value=9840012345', setup: { sqlRows: LEDGER_ROWS('2026-10-20T04:00:00Z') }, patch: [PROGRAMME_EARNS] }),
  X('reward-read-with-expiry', 'GET /api/till/reward', 200, { url: '/api/till/reward?scheme=identity&value=' + ITEM, setup: { sqlRows: LEDGER_ROWS('2025-01-02T04:00:00Z') }, patch: [PROGRAMME_EXPIRES] }),
  X('reward-no-customer', 'POST /api/till/reward', 200, { body: { ref: 'C1-0007' } }),
  X('reward-no-programme', 'POST /api/till/reward', 200, { body: { ref: 'C1-0007', holder: { scheme: 'phone', value: '9840012345' } } }),
  X('reward-settled', 'POST /api/till/reward', 200, { body: { ref: 'C1-0007', holder: { scheme: 'phone', value: '9840012345' }, spend: 20, at: '2026-10-29T04:00:00Z' }, patch: [PROGRAMME_EXPIRES, SETTLE_OK] }),
  X('reward-overspent', 'POST /api/till/reward', 200, { body: { ref: 'C1-0008', holder: { scheme: 'phone', value: '9840012345' }, spend: 500 }, patch: [PROGRAMME_EARNS, SETTLE_OK] }),
  X('claim-moved', 'POST /api/till/reward/claim', 200, {
    body: { from: { scheme: 'phone', value: '9840012345' }, to: { scheme: 'identity', value: ITEM }, ref: 'claim-1' },
    patch: [PROGRAMME, ['lib/reward-store.js', 'claim', async () => ({ ok: true, points: 30 })]]
  }),
  X('screen-switched-off', 'POST /api/till/screens/revoke', 200, { body: { jti: 's1' }, setup: { key: ['till'], sqlRows: SCREEN_KEYS } }),
  X('screen-renamed', 'POST /api/till/screens/rename', 200, { body: { jti: 's1', name: 'Window TV' }, setup: { key: ['till'], sqlRows: SCREEN_KEYS } }),
  X('screen-name-cleared', 'POST /api/till/screens/rename', 200, { body: { jti: 's1', name: '  ' }, setup: { key: ['till'], sqlRows: SCREEN_KEYS } }),
  X('alias-saved', 'POST /api/till/alias', 200, {
    body: { item_id: ITEM, text: 'SUNFL OIL', by: 'Hari Traders', unit: 'carton', factor: 12 },
    setup: { sqlRows: ITEM_ROW({ name: 'Sunflower oil' }) }
  }),
  X('alias-saved-bare', 'POST /api/till/alias', 200, { body: { item_id: ITEM, text: 'SUNFL OIL' }, setup: { sqlRows: ITEM_ROW({ name: 'Sunflower oil' }) } }),
  X('alias-said-again', 'POST /api/till/alias', 200, {
    body: { item_id: ITEM, text: 'SUNFL OIL', factor: 6 },
    setup: { sqlRows: ITEM_ROW({ name: 'Sunflower oil', aliases: [{ by: null, text: 'sunfl oil', unit: null, factor: null, at: '2026-10-01T00:00:00.000Z' }] }) }
  }),
  X('catalogue-started-from-a-list', 'POST /api/till/catalogue', 200, { body: { blueprint: 'veg' }, patch: [WRITE_ITEMS_OK] }),
  X('catalogue-started-from-a-file', 'POST /api/till/catalogue', 200, {
    body: { blueprint: 'veg', products: [{ name: 'Poori', price: 40 }, { name: '', price: 5 }] },
    patch: [WRITE_ITEMS_OK]
  }),
  X('engine-file-unreadable', 'GET /api/till/engine/:name', 500, { patch: [['fs', 'readFileSync', null]] })
];

/** a scenario that needs a library function to fail or answer otherwise swaps it, then puts the real one back: [file, 'name' | 'Object.name', function | { get }] */
function applyPatch(patch) {
  const undo = [];
  (patch || []).forEach(([file, dotted, replacement]) => {
    const parts = dotted.split('.');
    const target = file === 'fs' ? require('fs') : require(path.join(HERE, file));
    const owner = parts.slice(0, -1).reduce((one, part) => one[part], target);
    const name = parts[parts.length - 1];
    const original = Object.getOwnPropertyDescriptor(owner, name);
    let swap = replacement;
    if (file === 'fs') {
      const real = original.value;
      swap = function readFileSync(target, ...rest) {
        if (/offers-engine/.test(String(target))) THROWS();
        return real.call(this, target, ...rest);
      };
    }
    Object.defineProperty(owner, name, typeof swap === 'function' ? { value: swap, writable: true, configurable: true } : Object.assign({ configurable: true }, swap));
    undo.push(() => Object.defineProperty(owner, name, original));
  });
  return () => undo.reverse().forEach((back) => back());
}

/** a scenario that needs a live pairing code asks the shop for one first (the codes are kept in memory by the route) */
async function pairingCode(port, setup) {
  Object.assign(world, FRESH, setup);
  const made = await kit.send(port, 'POST', MOUNT + '/pair', {});
  return made.json && made.json.code;
}

async function runScenario(port, scenario) {
  if (scenario.before === 'wrong-codes') for (let miss = 0; miss < 8; miss++) await kit.send(port, 'POST', MOUNT + '/pair/claim', { code: 'ZZZZZZ' }); /* the limit is eight wrong codes a minute: a right code (above) clears the count, so this scene spends it itself */
  const code = scenario.before === 'pair-code' ? await pairingCode(port, scenario.pairSetup) : null;
  Object.assign(world, FRESH, scenario.setup);
  const restore = applyPatch(scenario.patch);
  const method = scenario.route.split(' ')[0];
  const body = code ? { code } : scenario.body;
  const answer = await kit.send(port, method, scenario.url, body === undefined && kit.BODY_METHODS.includes(method) ? {} : body);
  restore();
  return answer;
}

/** a body's random ids and clock stamps are the same answer on every run: masked before a body is hashed */
const steady = (text) => text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g, 'UUID').replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, 'STAMP').replace(/"code":"[A-Z0-9]{6}"/g, '"code":"PAIRCODE"');
const shaOf = (answer) => crypto.createHash('sha256').update(steady(answer.text)).digest('hex');
/** --compare F: the answers now against a capture of the code before, byte for byte (status, content type, body); every difference printed */
function compare(captureFile, recording) {
  const before = JSON.parse(fs.readFileSync(captureFile, 'utf8'));
  const differing = Object.keys(before).filter((key) => !recording[key] || recording[key].status !== before[key].status || recording[key].type !== before[key].type || recording[key].sha !== before[key].sha);
  console.log('compared ' + Object.keys(before).length + ' answers: ' + (Object.keys(before).length - differing.length) + ' identical, ' + differing.length + ' different');
  differing.forEach((key) => console.log('  ' + key + ' [' + before[key].status + ' -> ' + (recording[key] && recording[key].status) + ']'));
  return differing.length;
}

/** the sign-in middleware's own 401 and requireScope's 403 are still the old body: tested, not yet a Problem (a follow-up for the auth middleware) */
const inherited = (scenario, answer) => (answer.status === 401 && scenario.id === 'signed-out') || (answer.status === 403 && scenario.id === 'key-for-something-else');

/** the statuses a test may see from a route, by the contract that owns it */
function allowedFor() {
  const contract = require(path.join(HERE, CONTRACT_FILE)).contract;
  return (route) => contract.allowedStatuses()(route) || [];
}
const registeredCodes = () => new Set(JSON.parse(fs.readFileSync(path.join(HERE, 'docs', 'error-codes.json'), 'utf8')).codes.filter((row) => row.shopkeeper !== 'PENDING').map((row) => row.code));

async function checkRoutes(port, scenarios, recording) {
  const tested = {};
  const capturing = replaying;
  const allowed = capturing ? null : allowedFor();
  const registered = capturing ? null : registeredCodes();
  for (const scenario of scenarios) {
    const answer = await runScenario(port, scenario);
    const label = scenario.route + ' · ' + scenario.id;
    /* the request is kept so tools/api-allowlist.cjs can hand the generated output_allowlist case a request known to reach the success answer (R2-13) */
    recording[scenario.route + '|' + scenario.id] = { route: scenario.route, status: answer.status, type: answer.type, sha: shaOf(answer), body: answer.json, request: { url: scenario.url, body: scenario.body } };
    if (answer.status >= 400) (tested[scenario.route] = tested[scenario.route] || new Set()).add(answer.status);
    if (capturing) continue;
    check(label + ': answers (not a hang)', answer.status !== 0);
    if (scenario.extra) check(label + ': answers the status the scenario is for (' + scenario.expect + ')', answer.status === scenario.expect, answer.status);
    if (answer.status < 400) {
      check(label + ': a success is not a Problem body', !/problem+json/.test(answer.type), answer.type);
      continue;
    }
    check(label + ': ' + answer.status + ' is a status the contract declares for this route', allowed(scenario.route).includes(answer.status), allowed(scenario.route));
    if (inherited(scenario, answer)) continue;
    kit.checkProblemBody(check, label, answer);
    if (answer.json && answer.json.code) check(label + ': its code ' + answer.json.code + ' is registered with a shopkeeper sentence', registered.has(answer.json.code), answer.json.code);
    if (answer.status >= 500) check(label + ': a 5xx says nothing of its cause', !/party_secret|SELECT|vault|relation/.test(answer.text), answer.text);
    else kit.checkLegacy(check, label, answer, kit.frozenOf(LEGACY_FILE, scenario.route, scenario.id));
    if (scenario.said) check(label + ': ' + scenario.expect + ' "' + scenario.said + '"', answer.status === scenario.expect && answer.json && answer.json.message === scenario.said, answer.json);
  }
  return tested;
}

/**
 * API-3 output allow-list (S34), the way tests/api-problem-storefront.test.cjs proves it: a route whose 200 schema is CLOSED (additionalProperties false) and whose
 * recorded 200 fits that schema is proved here, in the counter's own world — the generator's proxy world cannot seat a slab on the shelf, so POST /rate never
 * reaches its 200 there. → { route: { output_allowlist: true } } for the routes that held (today: POST /api/till/rate, scenario rate-set)
 */
/*
 * API-8 (till): the same proof for every counter route whose 200 schema is CLOSED (derived in docs/contracts/api-output-shapes.json): EVERY recorded 200 of the route fits that schema
 * and loses no key to the allow-list (lib/output-allowlist prune). The schema is learned from the not-ready AND the ready side of each handler, so the scenarios above carry both.
 */
function checkAllowList(recording) {
  const proved = {};
  const words = require(path.join(HERE, CONTRACT_FILE));
  const engine = require(path.join(HERE, 'middleware', 'validate.js')).bodyEngine;
  const { prune } = require(path.join(HERE, 'lib', 'output-allowlist.js'));
  const routes = [...new Set(Object.values(recording).filter((one) => one.status === 200 && one.body && MINE(one.route)).map((one) => one.route))].sort();
  routes.forEach((route) => {
    const operation = words.operationFor(route.replace(' ' + MOUNT, ' '));
    const schema = (((operation && operation.responses[200] && operation.responses[200].content) || {})['application/json'] || {}).schema;
    if (!schema || schema.additionalProperties !== false) return;
    const answers = Object.values(recording).filter((one) => one.route === route && one.status === 200 && one.body);
    const fits = engine.compile(schema);
    const held = answers.every((one) => fits(one.body) && prune(schema, one.body).dropped.length === 0);
    check(route + ': every recorded 200 (' + answers.length + ') holds only the keys its operation lists (a closed schema the answers fit)', held, { answers: answers.length, errors: fits.errors });
    if (held) proved[route] = { output_allowlist: true };
  });
  return proved;
}
/** the counter routes the evidence file says output_allowlist for */
function allowListEvidenceOnDisk() {
  const routes = JSON.parse(fs.readFileSync(EVIDENCE_FILE, 'utf8')).routes || {};
  return Object.fromEntries(Object.keys(routes).filter((route) => MINE(route) && routes[route].output_allowlist).sort().map((route) => [route, { output_allowlist: true }]));
}

/** the words of the contract as units: each helper answers the spec the routes spread into problem() */
function checkWords() {
  const words = require(path.join(HERE, CONTRACT_FILE));
  const bad = words.badRequest('item_id required');
  check('words: badRequest() keeps the old validation body', JSON.stringify(bad.legacy) === JSON.stringify({ error: 'validation', message: 'item_id required' }) && bad.detail === 'item_id required', bad);
  const gone = words.notFound();
  check('words: notFound() keeps the bare "Not found"', JSON.stringify(gone.legacy) === JSON.stringify({ error: 'Not found' }) && gone.code === 'NOT_FOUND', gone);
  const relayed = words.relayed({ error: 'conflict', code: 'COUNTER_HELD', message: 'C1 is open elsewhere.' });
  check('words: relayed() keeps the code and the words of a body a library made', relayed.code === 'COUNTER_HELD' && relayed.detail === 'C1 is open elsewhere.' && relayed.legacy.error === 'conflict', relayed);
  const plain = words.relayed({ error: 'Not found' });
  check('words: relayed() without a code or message still has both', plain.code === 'TILL_REFUSED' && plain.detail === 'Not found', plain);
  const fault = words.failed(new Error(SECRET_SQL), { id: 'r1' });
  check('words: failed() is a 500 that says nothing of its cause', fault.status === 500 && !/party_secret/.test(JSON.stringify(fault)), fault);
  const refusalOfLibrary = words.refusalOf(Object.assign(new Error('That counter name is not allowed.'), { status: 400 }), { id: 'r1' });
  check('words: a library refusal of 400 keeps its own words', refusalOfLibrary.status === 400 && refusalOfLibrary.detail === 'That counter name is not allowed.', refusalOfLibrary);
  const schemaWords = words.schemaOptions.legacy([{ detail: 'Some of what was sent is missing or not valid.' }]);
  check('words: a body the schema refuses is answered at 400 in the old validation shape', words.schemaOptions.status === 400 && schemaWords.error === 'validation', schemaWords);
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  if (flagValue('--freeze')) {
    console.log('froze ' + kit.freeze(flagValue('--freeze'), LEGACY_FILE, MINE) + ' routes');
    return;
  }
  installStubs();
  const router = require(path.join(HERE, ROUTE_FILE));
  const routes = kit.routesOf(router, MOUNT);
  const app = express();
  app.use((req, res, next) => {
    req.id = 'req-test';
    next();
  });
  app.use(express.json());
  app.use(MOUNT, router);
  const server = app.listen(0);
  const recording = {};
  const tested = await checkRoutes(server.address().port, kit.scenariosOf(routes, WORLDS, EXTRAS, PARAM_VALUES), recording);
  server.close();
  if (flagValue('--compare')) process.exit(compare(flagValue('--compare'), recording) ? 1 : 0);
  if (flagValue('--capture')) {
    fs.writeFileSync(flagValue('--capture'), JSON.stringify(recording, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers over ' + Object.keys(routes).length + ' routes');
    process.exit(0);
  }
  checkWords();
  check('the output allow-list dropped no key from any answer', require(path.join(HERE, 'lib', 'output-allowlist')).droppedKeys().length === 0, require(path.join(HERE, 'lib', 'output-allowlist')).droppedKeys());
  const proved = checkAllowList(recording);
  const coverage = Object.fromEntries(
    Object.keys(tested)
      .sort()
      .map((route) => [route, [...tested[route]].sort((a, b) => a - b)])
  );
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  if (argv.includes('--write')) {
    const others = Object.fromEntries(
      Object.keys(onDisk)
        .filter((route) => !MINE(route))
        .map((route) => [route, onDisk[route]])
    );
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(
      TESTED_FILE,
      JSON.stringify(
        Object.fromEntries(
          Object.keys(merged)
            .sort()
            .map((route) => [route, merged[route]])
        ),
        null,
        1
      ) + '\n'
    );
    const evidence = JSON.parse(fs.readFileSync(EVIDENCE_FILE, 'utf8'));
    Object.keys(evidence.routes || {}).filter(MINE).forEach((route) => {
      delete evidence.routes[route].output_allowlist;
      if (!Object.keys(evidence.routes[route]).length) delete evidence.routes[route];
    });
    fs.writeFileSync(EVIDENCE_FILE, JSON.stringify(evidence, null, 1) + '\n');
    FOREIGN.writeEvidence(EVIDENCE_FILE, MINE, proved);
  } else {
    check('docs/contracts/api-hardening-evidence-areas.json says output_allowlist for exactly the counter routes whose 200 held closed here', kit.sameValue(allowListEvidenceOnDisk(), proved), {
      onDisk: allowListEvidenceOnDisk(),
      proved
    });
    const mine = Object.fromEntries(
      Object.keys(onDisk)
        .filter(MINE)
        .sort()
        .map((route) => [route, onDisk[route]])
    );
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for the counter routes', kit.sameValue(mine, coverage), {
      onDisk: Object.keys(mine).length,
      covered: Object.keys(coverage).length
    });
  }
  console.log('\n  ' + tally.passed + ' checks, ' + tally.failed + ' failed');
  process.exit(tally.failed ? 1 : 0);
})();
