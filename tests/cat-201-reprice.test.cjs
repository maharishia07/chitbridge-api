#!/usr/bin/env node
/**
 * cat-201-reprice.test.cjs — CAT-201 (proof 2026-11-14): repriceAgainstCatalogue replaces whatever price the customer sent.
 * @type regression
 * OWNS      the proof that routes/catalogue.js repriceAgainstCatalogue() prices every order line from the shop's active catalogue row: a tampered
 *           client price/total is dropped, the line carries the catalogue price and total = catalogue price x quantity; a name-only line is found by name;
 *           an item not in the catalogue is refused 422 (never priced from the client); the order total is the sum of the repriced lines.
 * CALLED BY scripts/guards.cjs · CI. No database: the function is taken from the route source (it is not exported) and run over a stand-in db.
 * FLOW      catalogue_items rows (rice 50, oil 120) → order lines carrying price 1 / total 1 → repriced lines
 *   node tests/cat-201-reprice.test.cjs
 */
'use strict';
const fs = require('fs');
const Module = require('module');
const path = require('path');
const { API, ok, done, mock, standInDb } = require('./lib/cat-proof-kit.cjs');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const RICE = '22222222-2222-4222-8222-222222222222', OIL = '33333333-3333-4333-8333-333333333333', SHOP = '11111111-1111-4111-8111-111111111111';
const ROWS = [
  { item_id: RICE, item_data: { name: 'Rice', price: 50, unit: 'kg' }, updated_at: '2026-11-01T00:00:00Z' },
  { item_id: OIL, item_data: { name: 'Oil', price: 120, unit: 'litre' }, updated_at: '2026-11-01T00:00:00Z' }
];
const { db } = standInDb((sql) => (/FROM catalogue_items/.test(sql) ? { rows: ROWS } : { rows: [] }));
mock('db', db); mock('db/index', db);
const realAuth = require(path.join(API, 'middleware', 'auth'));
mock('middleware/auth', Object.assign((q, s, n) => n(), realAuth));
const realErr = console.error, realWarn = console.warn;
console.error = () => undefined; console.warn = () => undefined;

/** the route's own function, without exporting it: compile the source with one added export line */
function loadReprice() {
  const file = path.join(API, 'routes', 'catalogue.js');
  const m = new Module(file, module);
  m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports.__reprice = repriceAgainstCatalogue;\n', file);
  return m.exports.__reprice;
}
(async () => {
  const reprice = loadReprice();
  const OI = { negotiable: false };
  const out = await reprice(SHOP, [{ item_id: RICE, quantity: 3, price: 1, total: 1 }, { name: 'oil', quantity: 2, price: 0.01, total: 0.02 }], OI);
  const refused = await reprice(SHOP, [{ name: 'Gold bar', quantity: 1, price: 1 }], OI).then(() => null, (e) => e);
  console.error = realErr; console.warn = realWarn;
  ok('a tampered price (1) on rice is replaced by the catalogue price 50', out.items[0].price === 50, JSON.stringify(out.items[0]));
  ok('rice 3 x 50 = 150, not the client total 1', out.items[0].total === 150 && out.items[0].quantity === 3, JSON.stringify(out.items[0]));
  ok('a name-only line (oil, lower case) is priced 120 x 2 = 240', out.items[1].price === 120 && out.items[1].total === 240 && out.items[1].item_id === OIL, JSON.stringify(out.items[1]));
  ok('the order total is the sum of the repriced lines: 150 + 240 = 390', out.total === 390, out.total);
  ok('an item that is not in the catalogue is refused 422, never priced from the client', refused && refused.status === 422, refused && refused.message);
  done();
})();
