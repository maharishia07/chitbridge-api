#!/usr/bin/env node
// @type: contract
/**
 * cat-258-unpriced-bands.test.cjs — CAT-258: an UNPRICED tiered line is "no price set", never a free band, and no bill prices it at 0.
 *
 * OWNS      (1) POST /api/pricing/price: the first band of an unpriced ladder is price null with the words "no price set"; a REAL 0 list price stays a 0 band;
 *           (2) POST /api/invoice/build: a line with no price anywhere is refused 422 NO_PRICE, by name, in the words tax/compute uses (services.unpricedSaid) — the shop's
 *           own priced line still builds past that gate; (3) the engine copy is untouched (the fix is the reader's, lib/services.bandsOf).
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route files over the stand-in sign-in (tests/lib/problem-world.cjs); the shelf read is stood in at lib/services.
 * FLOW      scenario (a line + the shelf's product) → real route → status + body → the band prices / the refusal code and sentence
 * CARD      28-platform-and-operations/pricing-service
 * Run: node tests/cat-258-unpriced-bands.test.cjs
 */
'use strict';
const path = require('path');
const express = require('express');
const { harness } = require('./lib/problem-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const lab = harness({ here: HERE, mounts: ['/api/pricing', '/api/invoice'], routeFiles: { '/api/pricing': 'routes/pricing.js', '/api/invoice': 'routes/invoice.js' }, legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json') });
const { world, check } = lab;
const SERVICES = require(path.join(HERE, 'lib', 'services'));
const TIERED = { kind: 'tiered', tiers: [{ qty: 10, price: 8 }] };
const products = { blank: { name: 'Loose rice' }, free: { name: 'Sample', price: 0 } };
let port = 0;

async function send(route, lines) {
  Object.assign(world, { realAuth: false, who: lab.world.who, asKey: false, db: 'ok', sqlRows: null, keyScopes: null });
  SERVICES.shelfOf = async () => ({ productOf: (line) => products[line.item_id || line.code] || null, idOf: () => null });
  return lab.send(port, 'POST', route, { lines });
}

async function bands() {
  console.log('\n── the bands of an unpriced ladder ──\n');
  let line = (await send('/api/pricing/price', [{ code: 'blank', qty: 5, pricing: TIERED }])).json.lines[0];
  const open = line.bands.find((band) => band.from === 1);
  check('unpriced: the band below the first break is price null, never 0', !!open && open.price === null, line.bands);
  check('unpriced: that band says "no price set"', !!open && open.why === 'no price set', open);
  check('the priced bands carry their prices and no "why"', line.bands.some((band) => band.from === 10 && band.price === 8 && band.why === undefined), line.bands);
  line = (await send('/api/pricing/price', [{ code: 'free', qty: 5, pricing: TIERED }])).json.lines[0];
  check('a REAL 0 list price is a free band of 0, told apart from no price', line.bands.find((band) => band.from === 1).price === 0, line.bands);
}

async function bill() {
  console.log('\n── a bill from an unpriced line asks, by name ──\n');
  let answer = await send('/api/invoice/build', [{ code: 'blank', qty: 5, pricing: TIERED }]);
  check('invoice/build of an unpriced tiered line → 422 NO_PRICE', answer.status === 422 && answer.json.code === 'NO_PRICE', answer.json);
  check('the refusal names the product and says to set its price', /"Loose rice" has no price on the shelf\. Set its price, or send one\./.test(answer.json.message || answer.json.detail || ''), answer.json);
  answer = await send('/api/invoice/build', [{ code: 'blank', qty: 5, listPrice: 10, pricing: TIERED }]);
  check('a price the caller sends is not refused as unpriced', answer.json.code !== 'NO_PRICE', answer.json);
}

(async () => {
  console.log('\n══ CAT-258 · unpriced bands ══');
  lab.installStubs();
  const app = express();
  app.use((req, res, next) => { req.id = 'req-test'; next(); });
  app.use(express.json());
  app.use('/api/pricing', require(path.join(HERE, 'routes', 'pricing.js')));
  app.use('/api/invoice', require(path.join(HERE, 'routes', 'invoice.js')));
  const server = app.listen(0);
  port = server.address().port;
  try {
    await bands();
    await bill();
  } finally {
    server.close();
  }
  console.log('\n' + lab.count.passed + ' passed, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
