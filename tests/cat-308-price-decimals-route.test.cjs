#!/usr/bin/env node
// @type: contract
/**
 * cat-308-price-decimals-route.test.cjs — CAT-308 M9b: a price finer than its currency is 400 "at most N decimal places" at the product door.
 *
 * OWNS      POST /api/products and PATCH /api/products/:id with the engines money v1.96.0 stamp: INR 10.999 is 400 "at most N decimal places" in words, nothing written;
 *           INR 10.99 and 10.9 are 200; JPY (no decimals) 10.5 is 400 and 10 is 200; a PATCH that leaves a legacy price (10.999) as it was passes (`stored`), one that changes it to another finer price is 400.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file over the stand-in sign-in and database (tests/lib/problem-world.cjs).
 * FLOW      scenario → real route → status + code + the row written
 * CARD      06-catalogue-pim/README
 * Hand figures: INR has 2 decimals, so 10.999 is a third decimal (refused) and 10.99 is not; JPY has 0, so 10.5 is refused; float noise (0.1 + 0.2) passes.
 * Run: node tests/cat-308-price-decimals-route.test.cjs
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
  mounts: ['/api/products'],
  routeFiles: { '/api/products': 'routes/products.js' },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json')
});
const { world, check } = lab;
let port = 0;
const SHOP = (currency, country) => answering(/FROM identities WHERE identity_id/, [{ currency_code: currency, country }]);
const INR = SHOP('INR', 'IN');
const JPY = SHOP('JPY', 'JP');
const COLUMNS = firstOf(
  answering(/SELECT schema_id FROM entity_schemas/, [{ schema_id: PARTY }]),
  answering(/FROM schema_fields WHERE schema_id/, [
    { field_key: 'name', field_name: 'Name', field_type: 'text', required: true },
    { field_key: 'price', field_name: 'Price', field_type: 'number', required: false }
  ])
);
const row = (data) => ({ item_id: PARTY, entity_id: '11111111-1111-4111-8111-111111111111', is_active: true, schema_id: null, item_data: Object.assign({ name: 'Tea', unit: 'kg' }, data) });
let written = [];
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
const words = (answer) => String((answer.json && (answer.json.detail || answer.json.message)) || '');

async function doors() {
  console.log('\n── CAT-308 · a price finer than its money, at the product door ──\n');
  let r = await ask('POST', P, { item_data: { name: 'Tea', price: 10.999 } }, shelf(INR));
  check('INR 10.999 → 400 "at most N decimal places", nothing written', r.status === 400 && /decimal place/.test(words(r)) && written.length === 0, r.json);
  for (const [price, ok] of [[10.99, true], [10.9, true], [10, true], [0.1 + 0.2, true], [10.991, false]]) {
    r = await ask('POST', P, { item_data: { name: 'Tea', price } }, shelf(INR));
    check('INR ' + price + (ok ? ' → 200' : ' → 400 "at most N decimal places"'), ok ? r.status === 200 : r.status === 400 && /decimal place/.test(words(r)), r.json);
  }
  r = await ask('POST', P, { item_data: { name: 'Tea', price: 10.5 } }, shelf(JPY));
  check('JPY (no decimals) 10.5 → 400 "at most N decimal places"', r.status === 400 && /decimal place/.test(words(r)), r.json);
  r = await ask('POST', P, { item_data: { name: 'Tea', price: 10 } }, shelf(JPY));
  check('JPY 10 → 200', r.status === 200, r.json);
  /* hand: a legacy row already holds 10.999; an edit that does not touch the price must not be refused (CAT-323), one that changes it to another finer price must be */
  r = await ask('PATCH', P + '/' + PARTY, { merge: true, item_data: { name: 'Tea 2' } }, shelf(INR, { price: { amount: 10.999, currency: 'INR' } }));
  check('PATCH a name only over a stored INR 10.999 → 200 (an unchanged legacy price passes)', r.status === 200, r.json);
  r = await ask('PATCH', P + '/' + PARTY, { merge: true, item_data: { price: 10.998 } }, shelf(INR, { price: { amount: 10.999, currency: 'INR' } }));
  check('PATCH the price to another finer one (10.998) → 400 "at most N decimal places"', r.status === 400 && /decimal place/.test(words(r)), r.json);
}

(async () => {
  lab.installStubs();
  const app = express();
  app.use((req, res, next) => {
    req.id = 'req-test';
    next();
  });
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/products', require(path.join(HERE, 'routes', 'products.js')));
  const server = app.listen(0);
  port = server.address().port;
  try {
    await doors();
  } finally {
    server.close();
  }
  console.log('\n' + lab.count.passed + ' passed, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
