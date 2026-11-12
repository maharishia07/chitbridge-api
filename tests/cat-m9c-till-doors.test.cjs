#!/usr/bin/env node
// @type: contract
/**
 * cat-m9c-till-doors.test.cjs — M9c (12 Nov 2026): the counter's write doors and the starter-list adopt are bounded.
 *
 * OWNS      CAT-223  POST /api/till/offer-item adding a product to a live offer is asked the clash question: a product already under another live 10% offer is 409 OFFER_CLASH and no
 *                    version is written; a product that is under no other offer still goes in (version 2); taking a product OUT is never asked
 *           CAT-230  (held by #1147, which this branch contains) POST /till/price, /till/rate and /till/offer-item with an id that is no uuid answer 404 (the unknown product's answer), never the database's cast as a 500;
 *                    stock and stock/bulk are held by the one fold of the product writer (#1147): one bad id in 500 does not fail the batch
 *           CAT-207  (photos: no media mint exists that takes a link, so the strip stays and the answer says so) POST /products/lists/adopt hands the writer rows WITHOUT image (the picture links are the server's to mint), so the veg list is no longer refused whole
 *           The stand-in database throws the cast error (22P02) when an id that is no uuid reaches a query, as Postgres does.
 * CALLED BY scripts/guards.cjs · CI. No database, no network (tests/lib/problem-world.cjs).
 * CARD      07-offers-pricing-and-combos/till-price-and-worth-an-offer
 * Run: node tests/cat-m9c-till-doors.test.cjs
 */
'use strict';
const path = require('path');
const express = require('express');
const { harness, PARTY, answering, firstOf } = require('./lib/problem-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const lab = harness({
  here: HERE,
  mounts: ['/api/till', '/api/products'],
  routeFiles: { '/api/till': 'routes/till.js', '/api/products': 'routes/products.js' },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json')
});
const { world, check } = lab;
let port = 0;
if (process.env.M9_DEBUG) process.on('unhandledRejection', console.error);

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OFFER_B = '33333333-3333-4333-8333-333333333333';
const OFFER_A = '66666666-6666-4666-8666-666666666666';
const RICE = '77777777-7777-4777-8777-777777777777';
const SUGAR = '88888888-8888-4888-8888-888888888888';
const AUD = answering(/SELECT currency_code, country FROM identities/, [{ currency_code: 'AUD', country: 'AU' }]);

/** Postgres refuses a uuid cast of a word: the stand-in does too, for any bound text that is not a uuid but looks like an id we send */
const castLike = (junk) => (sql, params) => {
  if ((params || []).some((one) => typeof one === 'string' && junk.includes(one))) throw Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' });
  return null;
};

let versionsWritten = [];
let patches = [];
const catwrite = require(path.join(HERE, 'lib', 'catalogue-write.js'));
catwrite.patchItems = async (db, entity, rows) => {
  patches = rows;
  return { rows: (Array.isArray(rows) ? rows : []).map((one) => ({ item_id: one.item_id, item_data: Object.assign({ name: 'Rice' }, one.merge) })), rowCount: 1 };
};
catwrite.codesInUse = async () => [];
let adopted = null;
catwrite.writeCitedItems = async (opts) => {
  adopted = opts.items;
  return { ok: true, rows: opts.items.map((one, index) => ({ item_id: PARTY.slice(0, 30) + String(10 + index), item_data: one })), declared: { declared: [], warnings: [] } };
};

/** the offers: A is live at 10% on rice; B is live at 5% on nothing yet (the counter adds to B) */
const offersWorld = () => (sql, params) => {
  if (/INSERT INTO definition_version/.test(sql)) {
    versionsWritten.push(params);
    return { rows: [], rowCount: 1 };
  }
  if (/UPDATE definition SET current_version/.test(sql)) return { rows: [], rowCount: 1 };
  if (/d\.entity_id = \$1 AND d\.definition_id = \$2/.test(sql)) {
    return { rows: [{ definition_id: OFFER_B, name: 'Five off', sub_kind: 'percent_off', current_version: 1, status: 'live', kind: 'offer', rules: { percent: 5, applies_to: { item_ids: [] } } }], rowCount: 1 };
  }
  if (/d\.kind = 'offer' AND d\.status = 'live'/.test(sql)) {
    return { rows: [{ definition_id: OFFER_A, name: 'Rice 10% off', sub_kind: 'percent_off', rules: { percent: 10, applies_to: { item_ids: [RICE] } } }], rowCount: 1 };
  }
  return null;
};
const ask = (method, url, body, rows) => {
  Object.assign(world, { realAuth: false, who: lab.world.who, asKey: false, db: 'ok', sqlRows: rows || null });
  world.keyScopes = null;
  versionsWritten = [];
  patches = [];
  return lab.send(port, method, url, body);
};
const code = (answer) => (answer.json && answer.json.code) || null;
const words = (answer) => String((answer.json && (answer.json.detail || answer.json.message)) || '');

async function offerItem() {
  console.log('\n── CAT-223 · adding a product to a live offer is a live save ──\n');
  const T = '/api/till/offer-item';
  let r = await ask('POST', T, { offer_id: OFFER_B, item_id: RICE, on: true }, offersWorld());
  check('rice is already under the live 10% offer → 409 OFFER_CLASH naming it, no version written', r.status === 409 && code(r) === 'OFFER_CLASH' && /Rice 10% off/.test(words(r)) && versionsWritten.length === 0, [r.status, code(r), words(r)]);
  r = await ask('POST', T, { offer_id: OFFER_B, item_id: SUGAR, on: true }, offersWorld());
  check('sugar is under no other offer → 200, version 2 written', r.status === 200 && r.json.version === 2 && versionsWritten.length === 1, r.json);
  r = await ask('POST', T, { offer_id: OFFER_B, item_id: RICE, on: false }, offersWorld());
  check('taking rice OUT of the offer is never asked the question (nothing to remove → unchanged 200)', r.status === 200 && versionsWritten.length === 0, r.json);
  r = await ask('POST', T, { offer_id: 'not-a-uuid', item_id: SUGAR, on: true }, firstOf(castLike(['not-a-uuid']), offersWorld()));
  check('offer_id "not-a-uuid" → 404 (it was the cast as a 500)', r.status === 404, r.status);
  r = await ask('POST', T, { offer_id: OFFER_B, item_id: 'x', on: true }, firstOf(castLike(['x']), offersWorld()));
  check('item_id "x" → 404', r.status === 404, r.status);
}

async function ids() {
  console.log('\n── CAT-230 · an id that is no uuid names no row (held by #1147; proved here at the counter doors) ──\n');
  const shelf = firstOf(AUD, castLike(['abc']), answering(/SELECT item_data FROM catalogue_items/, [{ item_data: { name: 'Rice', price: { amount: 5, currency: 'AUD' } } }]));
  let r = await ask('POST', '/api/till/price', { item_id: 'abc', price: 10 }, shelf);
  check('price: item_id "abc" → 404 (the cast was a 500 on main before #1147)', r.status === 404 && patches.length === 0, r.status);
  r = await ask('POST', '/api/till/rate', { item_id: 'abc', slab_id: 'gst-10' }, shelf);
  check('rate: item_id "abc" → a refusal, not a 500', r.status >= 400 && r.status < 500, r.status);
  r = await ask('POST', '/api/till/stock/bulk', { item_ids: [PARTY, 'abc'], status: 'unavailable' }, shelf);
  check('stock/bulk: one id that is no uuid does not fail the batch → 200', r.status === 200, r.status);
}

async function starterList() {
  console.log('\n── CAT-207 · the starter list is adopted without its picture links ──\n');
  const shelf = firstOf(AUD, answering(/SELECT schema_id FROM entity_schemas/, [{ schema_id: PARTY }]), answering(/FROM schema_fields WHERE schema_id/, [{ field_key: 'name', field_name: 'Name', field_type: 'text', required: true }]));
  adopted = null;
  const r = await ask('POST', '/api/products/lists/adopt', { list: 'veg' }, shelf);
  const rows = adopted || [];
  check('adopt veg → 200', r.status === 200, [r.status, r.json]);
  check('…the answer says in words that the photos were not copied', /photos were not copied/.test(String(r.json && r.json.message)), r.json && r.json.message);
  check('…the writer was handed rows, none of them carrying image or media', rows.length > 0 && rows.every((one) => !('image' in one) && !('media' in one)), [rows.length, rows.filter((one) => 'image' in one).length]);
}

(async () => {
  console.log('\n══ M9c · the counter doors and the starter list ══');
  lab.installStubs();
  const app = express();
  app.use((req, res, next) => {
    req.id = 'req-test';
    next();
  });
  app.use(express.json());
  app.use('/api/till', require(path.join(HERE, 'routes', 'till.js')));
  app.use('/api/products', require(path.join(HERE, 'routes', 'products.js')));
  const server = app.listen(0);
  port = server.address().port;
  try {
    await offerItem();
    await ids();
    await starterList();
  } finally {
    server.close();
  }
  void UUID_SHAPE;
  console.log('\n' + lab.count.passed + ' passed, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
