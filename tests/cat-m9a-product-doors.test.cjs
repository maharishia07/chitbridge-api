#!/usr/bin/env node
// @type: contract
/**
 * cat-m9a-product-doors.test.cjs — M9a (12 Nov 2026): the product / price write doors are bounded.
 *
 * OWNS      CAT-281  gst_rate 150 · a unit that is a number or 5,000 characters · price 1e20 are 400 at the product door ("500g" and "per 100 g" are units); a legacy stored value an edit leaves alone passes
 *           CAT-231  an absurd price at POST /api/products and PATCH is a 400 in words; the till's POST /price already holds the same 1e12 (it reads catwrite.validateAgainst)
 *           CAT-310  POST /api/combo-templates price 1e20 is 400 COMBO_PRICE_INVALID, not a 500
 *           CAT-232  PUT /api/products/:id/availability refuses qty true, an as_of that is no date or more than 5 minutes ahead, a source off the list; 'connector' is accepted and STILL stored as 'unknown'
 *           CAT-246  PUT /api/assist/catalogue-source refuses a 60,000-character source_key
 *           NO money.js, no pin move, no PRICE_DECIMALS (CAT-308 waits for the money pin decision). Each of these answered 200 (or a 500 at the column) on main.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route files over the stand-in sign-in and database (tests/lib/problem-world.cjs).
 * FLOW      scenario → real route → status + code + the row written → the sentence a person reads
 * CARD      06-catalogue-pim/README
 * Run: node tests/cat-m9a-product-doors.test.cjs
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
  mounts: ['/api/products', '/api/combo-templates', '/api/assist'],
  routeFiles: { '/api/products': 'routes/products.js', '/api/combo-templates': 'routes/combo-templates.js', '/api/assist': 'routes/assist.js' },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json')
});
const { world, check } = lab;
let port = 0;

const SHOP = (currency, country) => answering(/FROM identities WHERE identity_id/, [{ currency_code: currency, country }]);
const AUD = SHOP('AUD', 'AU');
/* the shop's columns: a name and a price (a number), as the default schema declares them */
const COLUMNS = firstOf(
  answering(/WITH d AS .SELECT schema_id FROM entity_schemas/, [
    { schema_id: PARTY, field_key: 'name', field_name: 'Name', field_type: 'text', required: true, min_value: null },
    { schema_id: PARTY, field_key: 'price', field_name: 'Price', field_type: 'number', required: false, min_value: null }
  ]), /* SEC-75: the default schema AND its rules in ONE bound read */
  answering(/SELECT schema_id FROM entity_schemas/, [{ schema_id: PARTY }]),
  answering(/FROM schema_fields WHERE schema_id/, [
    { field_key: 'name', field_name: 'Name', field_type: 'text', required: true },
    { field_key: 'price', field_name: 'Price', field_type: 'number', required: false }
  ])
);
const row = (data) => ({ item_id: PARTY, entity_id: '11111111-1111-4111-8111-111111111111', is_active: true, schema_id: null, item_data: Object.assign({ name: 'Tea', unit: 'kg' }, data) });
let written = [];
/** the shop: its money, its columns, the stored row (if any), and every INSERT / UPDATE recorded with its parameters */
const shelf = (money, stored) => (sql, params) => {
  if (/^\s*(INSERT INTO catalogue_items|UPDATE catalogue_items)/.test(sql)) {
    written.push({ sql, params });
    return { rows: [row(stored)], rowCount: 1 };
  }
  return firstOf(money, COLUMNS, answering(/SELECT .*item_data.* FROM catalogue_items/, stored ? [row(stored)] : []))(sql, params);
};
const ask = (method, url, body, rows) => {
  Object.assign(world, { realAuth: false, who: lab.world.who, asKey: false, db: 'ok', sqlRows: rows || null });
  written = [];
  return lab.send(port, method, url, body);
};
const P = '/api/products';
const code = (answer) => (answer.json && answer.json.code) || null;
const words = (answer) => String((answer.json && (answer.json.detail || answer.json.message)) || '');

async function shapes() {
  console.log('\n── CAT-281 / CAT-231 · rate, unit and an absurd price at the product door ──\n');
  let r = await ask('POST', P, { item_data: { name: 'Tea', gst_rate: 150 } }, shelf(AUD));
  check('gst_rate 150 → 400 "Tax rate must be between 0 and 100 percent"', r.status === 400 && /Tax rate must be between 0 and 100 percent/.test(words(r)), r.json);
  r = await ask('POST', P, { item_data: { name: 'Tea', gst_rate: 18 } }, shelf(AUD));
  check('gst_rate 18 → 200', r.status === 200, r.json);
  /* hand: the range is 0 to 100 inclusive; the text "18" reads as 18 */
  for (const [rate, ok] of [[-1, false], [0, true], [100, true], ['18', true], [100.5, false]]) {
    r = await ask('POST', P, { item_data: { name: 'Tea', gst_rate: rate } }, shelf(AUD));
    check('gst_rate ' + JSON.stringify(rate) + (ok ? ' → 200' : ' → 400'), ok ? r.status === 200 : r.status === 400, r.json);
  }
  r = await ask('POST', P, { item_data: { name: 'Tea', unit: 123 } }, shelf(AUD));
  check('unit 123 (a number) → 400 "Unit must be a word"', r.status === 400 && /Unit must be a word/.test(words(r)), r.json);
  /* hand: a unit is text that is not purely a number, at most 40 characters, no control characters */
  for (const [unit, ok] of [['500g', true], ['per 100 g', true], ['12-pack', true], ['1x6', true], ['kg', true], ['123', false], ['12.5', false], ['x'.repeat(40), true], ['x'.repeat(41), false], ['x'.repeat(5000), false], ['a' + String.fromCharCode(7) + 'b', false]]) {
    r = await ask('POST', P, { item_data: { name: 'Tea', unit } }, shelf(AUD));
    check('unit ' + JSON.stringify(unit).slice(0, 14) + (ok ? ' → 200' : ' → 400'), ok ? r.status === 200 : r.status === 400, r.json);
  }
  r = await ask('PATCH', P + '/' + PARTY, { merge: true, item_data: { name: 'Tea 2', unit: 123 } }, shelf(AUD, { unit: 123 }));
  check('stored unit 123 (legacy), an edit that sends it unchanged → 200', r.status === 200, r.json);
  const { unitRefusal } = require(path.join(HERE, 'lib', 'catalogue-write.js'));
  const seeded = ['bag', 'box', 'bunch', 'cup', 'dozen', 'gram', 'kg', 'pack', 'piece', 'plate'];
  check('every unit the blueprints seed (' + seeded.length + ') is a word', seeded.every((u) => unitRefusal(u) === null), seeded.filter((u) => unitRefusal(u)));
  r = await ask('POST', P, { item_data: { name: 'Tea', price: 1e20 } }, shelf(AUD));
  check('price 1e20 → 400 "too large (at most 1000000000000)", never a 500 at the column', r.status === 400 && /too large \(at most 1000000000000\)/.test(words(r)), r.json);
  /* hand: the ceiling is 1e12 inclusive; one more, and 1e300, are refused in words */
  for (const [price, ok] of [[1e12, true], [1e12 + 1000, false], [1e300, false], [1e308, false]]) {
    r = await ask('POST', P, { item_data: { name: 'Tea', price } }, shelf(AUD));
    check('price ' + price + (ok ? ' → 200' : ' → 400, never a 500'), ok ? r.status === 200 : r.status === 400 && /too large/.test(words(r)), r.json);
  }
  r = await ask('PATCH', P + '/' + PARTY, { merge: true, item_data: { price: 1e20 } }, shelf(AUD, { price: { amount: 5, currency: 'AUD' } }));
  check('PATCH price 1e20 → 400 in words', r.status === 400 && /too large/.test(words(r)), r.json);
  r = await ask('POST', P, { item_data: { name: 'x'.repeat(100000) } }, shelf(AUD));
  check('a 100,000-character name → 400 (held since CAT-317; kept)', r.status === 400 && /too long/.test(words(r)), r.json);
  r = await ask('PATCH', P + '/' + PARTY, { merge: true, item_data: { name: 'Tea 2', gst_rate: 150 } }, shelf(AUD, { gst_rate: 150 }));
  check('stored gst_rate 150 (legacy), an edit that sends it unchanged → 200', r.status === 200, r.json);
}

/** the till's POST /price already holds the product door's ceiling: it asks catwrite.validateAgainst with a price column (routes/till.js noNumber), so no second check was added (the critic read "no MAX_NUMBER check today"; this pins what is there) */
function tillCeiling() {
  console.log('\n── CAT-281 · the till price door holds the same 1e12 (no second rule) ──\n');
  const catwrite = require(path.join(HERE, 'lib', 'catalogue-write.js'));
  const column = [{ field_key: 'price', field_name: 'Price', field_type: 'number', required: true }];
  check('till price 1e12 → allowed, 1e12 + 1000 → "too large", 1e308 → "too large" (hand: the ceiling is 1e12 inclusive)', catwrite.validateAgainst(column, { price: 1e12 }) === null && /too large/.test(catwrite.validateAgainst(column, { price: 1e12 + 1000 })) && /too large/.test(catwrite.validateAgainst(column, { price: 1e308 })));
  check('routes/till.js asks that same function before it writes (revert it and a huge price is a 500 at the column)', /catwrite\.validateAgainst\(PRICE_FIELD, \{ price: sent \}\)/.test(require('fs').readFileSync(path.join(HERE, 'routes', 'till.js'), 'utf8')));
}

async function elsewhere() {
  console.log('\n── CAT-310 combo price · CAT-232 availability · CAT-246 source_key ──\n');
  let r = await ask('POST', '/api/combo-templates', { name: 'Meal', definition: [{ name: 'Pick', options: [{ name: 'Idli' }] }], price: 1e20 }, shelf(AUD));
  check('combo price 1e20 → 400 COMBO_PRICE_INVALID "Price is too large", not a 500', r.status === 400 && code(r) === 'COMBO_PRICE_INVALID' && /too large/.test(words(r)), r.json);
  const avail = (body) => ask('PUT', P + '/' + PARTY + '/availability', body, shelf(AUD, {}));
  r = await avail({ qty: true });
  check('availability qty true → 400 (it was kept as 1)', r.status === 400 && /quantity must be a number/.test(words(r)), r.json);
  r = await avail({ qty: 5, as_of: 'not a date' });
  check('as_of "not a date" → 400 (it became now)', r.status === 400 && /as_of must be a date/.test(words(r)), r.json);
  r = await avail({ qty: 5, as_of: '2030-01-01T00:00:00Z' });
  check('as_of 2030 → 400 (it was kept)', r.status === 400 && /cannot be in the future/.test(words(r)), r.json);
  r = await avail({ qty: 5, source: 'wizard' });
  check('source "wizard" → 400 (it became unknown)', r.status === 400 && /source must be one of/.test(words(r)), r.json);
  r = await avail({ qty: 6, as_of: '2026-11-01T00:00:00Z', source: 'erp' });
  check('qty 6, as_of 1 Nov 2026, source erp → 200 (control)', r.status === 200 && r.json.availability && r.json.availability.qty === 6, r.json);
  /* the revert's case: 'connector' is what sourceOf() calls a connector-fed shop and the Tally kit family PUTs it. It is ACCEPTED; what is STORED stays 'unknown' (stamp() unchanged) */
  r = await avail({ qty: 7, source: 'connector' });
  const storedSource = (written.map((w) => JSON.stringify(w.params)).join('').match(/source[^a-z]+(erp|iot|manual|ledger|connector|unknown)/) || [])[1];
  check("source 'connector' → 200 and the stored source is still 'unknown' (nothing new is stored)", r.status === 200 && storedSource === 'unknown', [r.status, storedSource]);
  /* hand: the clock tolerance is 5 minutes. +4 min passes, +6 min is refused; a kit clock a little fast must not drop the feed */
  r = await avail({ qty: 5, as_of: new Date(Date.now() + 4 * 60000).toISOString() });
  check('as_of 4 minutes ahead → 200 (kit clock skew)', r.status === 200, r.json);
  r = await avail({ qty: 5, as_of: new Date(Date.now() + 6 * 60000).toISOString() });
  check('as_of 6 minutes ahead → 400', r.status === 400 && /cannot be in the future/.test(words(r)), r.json);
  const A = require(path.join(HERE, 'lib', 'availability.js'));
  check('refusal is pure: now 12:00, as_of 12:05:00 passes, 12:05:01 is refused', A.refusal({ qty: 1, as_of: '2026-11-12T12:05:00Z' }, '2026-11-12T12:00:00Z') === null && /future/.test(A.refusal({ qty: 1, as_of: '2026-11-12T12:05:01Z' }, '2026-11-12T12:00:00Z')));
  check('one accepted list: every SOURCES word plus connector, connector still coerced by stamp', A.ACCEPTED_SOURCES.length === A.SOURCES.length + 1 && A.SOURCES.every((w) => A.ACCEPTED_SOURCES.includes(w)) && A.stamp({ qty: 1, source: 'connector' }).source === 'unknown');
  const feed = firstOf(AUD, answering(/FROM catalogue_items WHERE entity_id/, [{ item_id: PARTY, code: null, sku: null }]), answering(/UPDATE catalogue_items/, [row({})]));
  r = await ask('POST', P + '/availability/bulk', { items: [{ item_id: PARTY, qty: true }, { item_id: PARTY, qty: 3 }] }, feed);
  check('feed: the row with qty true is counted bad, the row with qty 3 is written (per row)', r.status === 200 && r.json.bad === 1 && r.json.written === 1, r.json);
  r = await ask('POST', P + '/availability/bulk', { items: [{ item_id: PARTY, qty: 3, as_of: 'banana' }, { item_id: PARTY, qty: 3, source: 'connector' }, { item_id: PARTY, qty: 2, as_of: '2030-01-01' }] }, feed);
  check('feed: 3 rows, the bad as_of and the 2030 row are counted bad, the connector row is written; the batch is NOT a 400', r.status === 200 && r.json.bad === 2 && r.json.written === 1, r.json);
  r = await ask('PUT', '/api/assist/catalogue-source', { source_key: 'y'.repeat(60000) }, shelf(AUD));
  check('assist catalogue-source: a 60,000-character source_key → 400 (it was stored with 200)', r.status === 400 && /source_key is too long \(at most 200 characters\)/.test(words(r)), [r.status, words(r).slice(0, 100)]);
}

(async () => {
  console.log('\n══ M9a · the product and price doors are bounded ══');
  lab.installStubs();
  const app = express();
  app.use((req, res, next) => {
    req.id = 'req-test';
    next();
  });
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/products', require(path.join(HERE, 'routes', 'products.js')));
  app.use('/api/combo-templates', require(path.join(HERE, 'routes', 'combo-templates.js')));
  app.use('/api/assist', require(path.join(HERE, 'routes', 'assist.js')));
  const server = app.listen(0);
  port = server.address().port;
  try {
    await shapes();
    tillCeiling();
    await elsewhere();
  } finally {
    server.close();
  }
  console.log('\n' + lab.count.passed + ' passed, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
