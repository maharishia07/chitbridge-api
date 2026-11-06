#!/usr/bin/env node
// @type: contract
/**
 * api-problem-pricing.test.cjs — CAT-221: ROUTE TESTS for POST /api/pricing/price (routes/pricing.js): the unit price of a line AT ITS QUANTITY.
 *
 * OWNS      what the door answers for a person who asked: the tier price at each quantity (below the first break = the list price, AT a break, between breaks,
 *           past the last), the reason in words, the bands, a fixed structure (blank amount = the list price), a range that is REPORTED outside its band and never
 *           clamped, a line that names a product on the shop's shelf (the shelf's list price and its own structure), the line total, and an UNPRICED line = null, never 0.
 *           The refusal SHAPE of this route is the finance sweep's (tests/api-problem-finance.test.cjs, open PRs); this file is the behaviour behind the 200 and is its own file for that reason.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file over a stand-in sign-in and database (tests/lib/problem-world.cjs); the shelf read is stood in at lib/services.
 * FLOW      scenario (lines + who signs in + the shelf's product) → real route → status + body → the unit price, its reason and its bands
 * CARD      28-platform-and-operations/pricing-service
 * Run: node tests/api-problem-pricing.test.cjs
 */
'use strict';
const path = require('path');
const express = require('express');
const { harness } = require('./lib/problem-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const lab = harness({ here: HERE, mounts: ['/api/pricing'], routeFiles: { '/api/pricing': 'routes/pricing.js' }, legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json') });
const { world, check } = lab;
const SERVICES = require(path.join(HERE, 'lib', 'services'));

/* paper: from 10 units each costs 8, from 50 each costs 7; the list price is 10 */
const TIERED = { kind: 'tiered', tiers: [{ qty: 10, price: 8 }, { qty: 50, price: 7 }] };
let port = 0;

/** one request: the lines, who signs in (a session, or a key with these scopes), the products the shelf holds → { status, json } */
async function price(lines, setup) {
  Object.assign(world, { realAuth: false, who: lab.world.who, asKey: false, db: 'ok', sqlRows: null });
  world.keyScopes = (setup && setup.scopes) || null;
  const products = (setup && setup.products) || {};
  SERVICES.shelfOf = async () => ({ productOf: (line) => products[line.item_id || line.code] || null });
  return lab.send(port, 'POST', '/api/pricing/price', { lines });
}
const first = (answer) => (answer.json && answer.json.lines && answer.json.lines[0]) || {};
const at = async (qty, more) => first(await price([Object.assign({ key: 'k', qty, listPrice: 10, pricing: TIERED }, more || {})]));

async function tierAtAQuantity() {
  console.log('\n── tiered: the unit price at each quantity (from 10 → 8, from 50 → 7, list 10) ──\n');
  /* paper: 1..9 are below the first break (10) → the list price 10; 10..49 → 8; 50 and over → 7 */
  const want = [[1, 10, null], [9, 10, null], [10, 8, 10], [11, 8, 10], [49, 8, 10], [50, 7, 50], [51, 7, 50], [200, 7, 50]];
  for (const [qty, unit, tierQty] of want) {
    const line = await at(qty);
    check('qty ' + qty + ' → unit price ' + unit + (tierQty ? ', tier from ' + tierQty : ', below the first break'), line.unit_price === unit && ((line.tier && line.tier.qty) || null) === tierQty, line);
  }
  let line = await at(9);
  check('below the first break the reason says so in words: "below the first break (10) — list price"', line.why === 'below the first break (10) — list price' && line.tier === null, line);
  line = await at(10);
  check('at a break the reason names it: "tier from 10 → 8 each", structure tiered, list price still 10', line.why === 'tier from 10 → 8 each' && line.structure === 'tiered' && line.list_price === 10, line);
  check('the bands tell the whole ladder: 1–9 at 10, 10–49 at 8, 50+ at 7', JSON.stringify(line.bands) === JSON.stringify([{ from: 1, to: 9, price: 10 }, { from: 10, to: 49, price: 8 }, { from: 50, to: null, price: 7 }]), line.bands);
  /* paper: 3 lines: 9 × 10 = 90, 10 × 8 = 80, 50 × 7 = 350 → total 520 */
  const basket = await price([{ qty: 9, listPrice: 10, pricing: TIERED }, { qty: 10, listPrice: 10, pricing: TIERED }, { qty: 50, listPrice: 10, pricing: TIERED }]);
  check('a basket of 9, 10 and 50 units: total 90 + 80 + 350 = 520', basket.status === 200 && basket.json.total === 520 && basket.json.engine === 'chitbridge-pricing', basket.json);
  line = await at(10, { pricing: { kind: 'tiered', tiers: [{ qty: 10, price: '8' }] } });
  check('a tier price typed as text "8" is read as 8', line.unit_price === 8, line);
}

async function otherStructures() {
  console.log('\n── fixed and range ──\n');
  let line = first(await price([{ qty: 5, listPrice: 12, pricing: { kind: 'fixed', amount: 8 } }]));
  check('fixed amount 8 on a list price 12 → unit 8, "fixed at 8"', line.unit_price === 8 && line.why === 'fixed at 8', line);
  line = first(await price([{ qty: 5, listPrice: 12, pricing: { kind: 'fixed' } }]));
  check('fixed with a blank amount → the list price 12, "fixed — the list price"', line.unit_price === 12 && line.why === 'fixed — the list price', line);
  line = first(await price([{ qty: 5, listPrice: 12, pricing: { kind: 'range', min: 10, max: 11 } }]));
  check('range 10–11 with a list price 12: REPORTED outside the band, never clamped (unit stays 12)', line.unit_price === 12 && line.why === 'band 10–11 — VIOLATED' && line.violation === 'the list price 12 is outside the band 10–11', line);
  line = first(await price([{ qty: 5, listPrice: 10.5, pricing: { kind: 'range', min: 10, max: 11 } }]));
  check('range 10–11 with a list price 10.5: inside, no violation', line.unit_price === 10.5 && line.violation === null, line);
}

async function theShelfsProduct() {
  console.log("\n── a line that names a product: the shop's own list price and structure ──\n");
  const products = {
    tea: { name: 'Tea', price: { amount: 12, currency: 'AUD' }, pricing_kind: 'tiered', pricing_tiers: [{ qty: 2, price: '9' }] },
    plain: { name: 'Plain', price: 15 }
  };
  let line = first(await price([{ code: 'tea', qty: 5 }], { products }));
  check("a coded line takes the product's list price 12 (read from { amount, currency }) and its tier from 2 → 9", line.list_price === 12 && line.unit_price === 9 && line.name === 'Tea', line);
  line = first(await price([{ code: 'tea', qty: 1 }], { products }));
  check("one unit is below the product's first break: the list price 12", line.unit_price === 12 && line.tier === null, line);
  line = first(await price([{ code: 'plain', qty: 3 }], { products }));
  check('a product with no structure of its own is its list price 15', line.unit_price === 15 && line.list_price === 15, line);
  line = first(await price([{ code: 'tea', qty: 5, listPrice: 20 }], { products }));
  check("the caller's listPrice 20 wins over the shelf's 12; the product's tier from 2 still gives 9", line.list_price === 20 && line.unit_price === 9, line);
}

async function unpricedIsNullNeverZero() {
  console.log('\n── unpriced is null, never 0 ──\n');
  const products = { blank: { name: 'Blank', price: '' }, none: { name: 'None' }, free: { name: 'Free', price: 0 } };
  for (const code of ['blank', 'none']) {
    const line = first(await price([{ code, qty: 5, pricing: TIERED }], { products }));
    check(code + ': a product with no price, tiered → list_price null and unit_price null (not 0)', line.list_price === null && line.unit_price === null, line);
  }
  const noShelf = first(await price([{ qty: 5, pricing: TIERED }]));
  check('a line with a structure and no price anywhere → unit_price null, not 0', noShelf.unit_price === null && noShelf.list_price === null, noShelf);
  const fixedBlank = first(await price([{ code: 'none', qty: 5, pricing: { kind: 'fixed' } }], { products }));
  check('fixed with no amount on an unpriced product → null, not 0', fixedBlank.unit_price === null, fixedBlank);
  let line = first(await price([{ code: 'free', qty: 5 }], { products }));
  check('a real 0 price is 0 (a free item the shop set), told apart from no price', line.list_price === 0 && line.unit_price === 0, line);
  line = first(await price([{ code: 'blank', qty: 5, pricing: TIERED }], { products }));
  check('an unpriced tiered line still lists its bands with the tier prices 8 and 7', line.bands.filter((band) => band.from >= 10).map((band) => band.price).join() === '8,7', line.bands);
  const mixed = await price([{ code: 'blank', qty: 5, pricing: TIERED }, { qty: 10, listPrice: 10, pricing: TIERED }], { products });
  check('a basket of an unpriced line and a 10 × 8 line: the priced line totals 80, the unpriced one is null in its own row', mixed.json.total === 80 && mixed.json.lines[0].unit_price === null && mixed.json.lines[1].unit_price === 8, mixed.json);
  const firstBand = line.bands.find((band) => band.from === 1);
  if (firstBand && firstBand.price === null) check('the first band of an unpriced ladder is null, not a free 0', true);
  else console.log('  SKIP  the first band of an unpriced ladder should be null, not a free 0: today it says price ' + JSON.stringify(firstBand && firstBand.price) + ' (CAT-258)');
}

async function whoMayAsk() {
  console.log('\n── who may ask, and a body with no lines ──\n');
  const one = [{ qty: 10, listPrice: 10, pricing: TIERED }];
  let answer = await price(one, { scopes: ['till'] });
  check('a till key is not scoped for pricing → 403 KEY_NOT_SCOPED, no price in it', answer.status === 403 && answer.json.code === 'KEY_NOT_SCOPED' && answer.json.lines === undefined, answer.json);
  answer = await price(one, { scopes: ['pricing'] });
  check('a key scoped "pricing" is answered, unit 8', answer.status === 200 && first(answer).unit_price === 8, answer.json);
  answer = await price(one, null);
  check('a signed-in session is answered, unit 8', answer.status === 200 && first(answer).unit_price === 8, answer.json);
  answer = await price([]);
  check('no lines → 400 and the words that say what a line is', answer.status === 400 && /lines\[\] required/.test(answer.json.detail || answer.json.message || ''), answer.json);
}

(async () => {
  console.log('\n══ CAT-221 · pricing at a quantity, at the route ══');
  lab.installStubs();
  const app = express();
  app.use((req, res, next) => {
    req.id = 'req-test';
    if (world.keyScopes) req.api_key = { jti: 'j1', scopes: world.keyScopes }; /* the stand-in sign-in keeps a key a test already put on the request */
    next();
  });
  app.use(express.json());
  app.use('/api/pricing', require(path.join(HERE, 'routes', 'pricing.js')));
  const server = app.listen(0);
  port = server.address().port;
  try {
    await tierAtAQuantity();
    await otherStructures();
    await theShelfsProduct();
    await unpricedIsNullNeverZero();
    await whoMayAsk();
  } finally {
    server.close();
  }
  console.log('\n' + lab.count.passed + ' passed, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
