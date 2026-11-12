#!/usr/bin/env node
// @type: contract
/**
 * cat-m9a-product-doors.test.cjs — M9a (12 Nov 2026): the product / price write doors are bounded.
 *
 * OWNS      CAT-308  a price finer than the currency's minor unit is REFUSED (400 PRICE_DECIMALS), never rounded: AUD 10.999 no, 10.99 yes; JPY 10.5 no; KWD 10.999 yes (3 places);
 *           float noise 19.990000000000002 passes; an UNCHANGED legacy 10.999 still passes on an edit of another field; a bulk import fails PER ROW; POST /bulk names the row
 *           CAT-281  gst_rate 150 · unit 123 · price 1e20 are 400 at the product door (a name of 100,000 characters was already held, CAT-317)
 *           CAT-231  an absurd price at POST /api/products and PATCH is a 400 in words (the till door is m9c's)
 *           CAT-310  POST /api/combo-templates price 1e20 is 400 COMBO_PRICE_INVALID, not a 500
 *           CAT-232  PUT /api/products/:id/availability refuses qty true, an as_of that is no date, an as_of in the future, a source off the list
 *           CAT-246  PUT /api/assist/catalogue-source refuses a 60,000-character source_key
 *           Hand figures are in the cases (AUD 2 places, JPY 0, KWD 3). Each of these answered 200 (or a 500 at the column) on main.
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
const JPY = SHOP('JPY', 'JP');
const KWD = SHOP('KWD', 'KW');
/* the shop's columns: a name and a price (a number), as the default schema declares them */
const COLUMNS = firstOf(
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

/** the price the INSERT / UPDATE carried, read back from its parameters (the stamped { amount, currency }) */
const storedPrice = () => {
  for (const one of written) {
    for (const param of one.params || []) {
      const found = /"price":{"amount":([0-9.e+-]+),"currency":"([A-Z]{3})"/.exec(JSON.stringify(param).split('\\"').join('"'));
      if (found) return found[1] + ' ' + found[2];
    }
  }
  return null;
};

async function priceDecimals() {
  console.log('\n── CAT-308 · a price finer than the currency is refused, never rounded ──\n');
  /* hand: AUD has 2 places; 10.999 has 3 → 400 PRICE_DECIMALS, nothing written. 10.99 → stored 10.99 AUD (the value, not 11.00). */
  let r = await ask('POST', P, { item_data: { name: 'Tea', price: 10.999 } }, shelf(AUD));
  check('AUD price 10.999 → 400 PRICE_DECIMALS, nothing written', r.status === 400 && code(r) === 'PRICE_DECIMALS' && written.length === 0, r.json);
  check('…the sentence names the price and the 2 places AUD allows', /Price can have at most 2 decimal places in AUD \(not 10\.999\)/.test(words(r)), words(r));
  r = await ask('POST', P, { item_data: { name: 'Tea', price: 10.99 } }, shelf(AUD));
  check('AUD price 10.99 → 200, stored as 10.99 AUD', r.status === 200 && storedPrice() === '10.99 AUD', [r.status, storedPrice()]);
  r = await ask('POST', P, { item_data: { name: 'Tea', price: 19.990000000000002 } }, shelf(AUD));
  check('float noise 19.990000000000002 passes (the grain is the minor unit, not the string length) → 200', r.status === 200, r.json);
  r = await ask('POST', P, { item_data: { name: 'Tea', price: '12.345' } }, shelf(AUD));
  check('a typed text "12.345" is the same refusal → 400 PRICE_DECIMALS', r.status === 400 && code(r) === 'PRICE_DECIMALS', r.json);
  /* hand: JPY has 0 places: 10.5 no, 11 yes. KWD has 3: 10.999 yes, 10.9999 no. */
  r = await ask('POST', P, { item_data: { name: 'Tea', price: 10.5 } }, shelf(JPY));
  check('JPY price 10.5 → 400 (0 places)', r.status === 400 && code(r) === 'PRICE_DECIMALS' && /at most 0 decimal places in JPY/.test(words(r)), r.json);
  r = await ask('POST', P, { item_data: { name: 'Tea', price: 11 } }, shelf(JPY));
  check('JPY price 11 → 200', r.status === 200 && storedPrice() === '11 JPY', [r.status, storedPrice()]);
  r = await ask('POST', P, { item_data: { name: 'Tea', price: 10.999 } }, shelf(KWD));
  check('KWD price 10.999 → 200 (3 places)', r.status === 200 && storedPrice() === '10.999 KWD', [r.status, storedPrice()]);
  r = await ask('POST', P, { item_data: { name: 'Tea', price: 10.9999 } }, shelf(KWD));
  check('KWD price 10.9999 → 400 (a 4th place)', r.status === 400 && code(r) === 'PRICE_DECIMALS', r.json);

  console.log('\n── …on an edit: a legacy value that did not change passes, a new one does not ──\n');
  const legacy = { price: { amount: 10.999, currency: 'AUD' } };
  r = await ask('PATCH', P + '/' + PARTY, { merge: true, item_data: { name: 'Tea 2', price: { amount: 10.999, currency: 'AUD' } } }, shelf(AUD, legacy));
  check('stored 10.999, edit sends the SAME 10.999 with a new name → 200 (an unchanged legacy price never blocks the edit)', r.status === 200, r.json);
  r = await ask('PATCH', P + '/' + PARTY, { merge: true, item_data: { name: 'Tea 2' } }, shelf(AUD, legacy));
  check('stored 10.999, edit sends only the new name → 200', r.status === 200, r.json);
  r = await ask('PATCH', P + '/' + PARTY, { merge: true, item_data: { price: 11.999 } }, shelf(AUD, legacy));
  check('stored 10.999, edit CHANGES it to 11.999 (3 places) → 400 PRICE_DECIMALS', r.status === 400 && code(r) === 'PRICE_DECIMALS', r.json);
  r = await ask('PATCH', P + '/' + PARTY, { merge: true, item_data: { price: 11.5 } }, shelf(AUD, legacy));
  check('stored 10.999, edit changes it to 11.50 → 200, stored 11.5 AUD', r.status === 200 && storedPrice() === '11.5 AUD', [r.status, storedPrice()]);

  console.log('\n── …in bulk: the rows are named; an import fails per row ──\n');
  r = await ask('POST', P + '/bulk', { items: [{ name: 'A', price: 10.999 }, { name: 'B', price: 5 }] }, shelf(AUD));
  const invalid = (r.json && r.json.invalid) || [];
  check('POST /bulk: row 0 (10.999) is named with PRICE_DECIMALS, row 1 (5) is not; 400, nothing written', r.status === 400 && invalid.length === 1 && invalid[0].index === 0 && invalid[0].code === 'PRICE_DECIMALS' && written.length === 0, r.json);
  const sheet = 'sku,name,unit,price\nA1,Tea,kg,10.999\nA2,Rice,kg,5\n';
  const decisions = ['sku', 'name', 'unit', 'price'].map((incoming) => ({ incoming, action: 'map', field: incoming }));
  r = await ask('POST', P + '/import', { csv: sheet, decisions, confirm: true }, shelf(AUD));
  const outcome = (r.json && r.json.outcome) || [];
  const failedRows = outcome.filter((one) => one.action === 'failed');
  const madeRows = outcome.filter((one) => one.action === 'created');
  check('import: the 10.999 row FAILS with its sentence and the 5 row is CREATED (per row, not the whole batch)', r.status === 200 && failedRows.length === 1 && /at most 2 decimal places/.test(failedRows[0].message || '') && madeRows.length === 1, r.json);
}

async function shapes() {
  console.log('\n── CAT-281 / CAT-231 · rate, unit and an absurd price at the product door ──\n');
  let r = await ask('POST', P, { item_data: { name: 'Tea', gst_rate: 150 } }, shelf(AUD));
  check('gst_rate 150 → 400 "Tax rate must be between 0 and 100 percent"', r.status === 400 && /Tax rate must be between 0 and 100 percent/.test(words(r)), r.json);
  r = await ask('POST', P, { item_data: { name: 'Tea', gst_rate: 18 } }, shelf(AUD));
  check('gst_rate 18 → 200', r.status === 200, r.json);
  r = await ask('POST', P, { item_data: { name: 'Tea', unit: 123 } }, shelf(AUD));
  check('unit 123 (a number) → 400 "Unit must be a word"', r.status === 400 && /Unit must be a word/.test(words(r)), r.json);
  r = await ask('POST', P, { item_data: { name: 'Tea', price: 1e20 } }, shelf(AUD));
  check('price 1e20 → 400 "too large (at most 1000000000000)", never a 500 at the column', r.status === 400 && /too large \(at most 1000000000000\)/.test(words(r)), r.json);
  r = await ask('PATCH', P + '/' + PARTY, { merge: true, item_data: { price: 1e20 } }, shelf(AUD, { price: { amount: 5, currency: 'AUD' } }));
  check('PATCH price 1e20 → 400 in words', r.status === 400 && /too large/.test(words(r)), r.json);
  r = await ask('POST', P, { item_data: { name: 'x'.repeat(100000) } }, shelf(AUD));
  check('a 100,000-character name → 400 (held since CAT-317; kept)', r.status === 400 && /too long/.test(words(r)), r.json);
  r = await ask('PATCH', P + '/' + PARTY, { merge: true, item_data: { name: 'Tea 2', gst_rate: 150 } }, shelf(AUD, { gst_rate: 150 }));
  check('stored gst_rate 150 (legacy), an edit that sends it unchanged → 200', r.status === 200, r.json);
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
  const feed = firstOf(AUD, answering(/FROM catalogue_items WHERE entity_id/, [{ item_id: PARTY, code: null, sku: null }]), answering(/UPDATE catalogue_items/, [row({})]));
  r = await ask('POST', P + '/availability/bulk', { items: [{ item_id: PARTY, qty: true }, { item_id: PARTY, qty: 3 }] }, feed);
  check('feed: the row with qty true is counted bad, the row with qty 3 is written (per row)', r.status === 200 && r.json.bad === 1 && r.json.written === 1, r.json);
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
    await priceDecimals();
    await shapes();
    await elsewhere();
  } finally {
    server.close();
  }
  console.log('\n' + lab.count.passed + ' passed, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
