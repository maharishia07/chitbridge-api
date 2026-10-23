/**
 * OWNS      /api/pricing: the pricing structure as a service — the kinds of structure, and the unit price of each line at its quantity.
 * CALLED BY server.js (mounted at /api/pricing); a key with scope pricing, the cart and the storefront through lib/pricing-engine.
 * FLOW      (price) auth → scope → schema check (lib/pricing-contract.js) → lib/services → lib/pricing-engine → the answer; a refusal → problem(req, res, { status, ...said(...) }), its old body frozen in docs/contracts/api-legacy.json
 * CARD      28-platform-and-operations/pricing-service
 * /api/pricing — THE PRICING STRUCTURE AS A SERVICE (rung 2). Same engine as the product page, the cart, the storefront
 * and the order line (lib/pricing-engine.js, vendored from app/pricing.js).
 *   GET  /api/pricing/kinds              → fixed · tiered · range, and the fields each reads
 *   POST /api/pricing/price   (key: pricing)  { lines:[{ key?, item_id?|code?, qty, listPrice?, pricing?:{kind,tiers,amount,min,max} }] }
 *                                         → { lines:[{ unit_price, list_price, structure, tier, why, bands, violation }] }
 *        a line without `pricing` takes the structure the entity's product cites (by item_id or code); without a
 *        listPrice it takes the product's list price.
 */
const express = require('express');
const { SAFE_SENTENCE } = require('../lib/respond');
const { problem, internalSpec } = require('../lib/problem'); // API-STANDARD S1: the one error writer
const { schemaValidate } = require('../middleware/validate'); // S9: the request is checked against the route's own schema
const { said, SCHEMAS, operationFor, pathsOf } = require('../lib/pricing-contract'); // the contract (each route's operation) and the words of a refusal
const router = express.Router();
const auth = require('../middleware/auth');
const S = require('../lib/services');
/** the schema check of one route (its own operation in lib/pricing-contract.js), as a list to spread after the gates: a route that takes no input has none */
function checked(route) {
  const operation = operationFor(route);
  return operation.parameters || operation.requestBody ? [schemaValidate(operation)] : [];
}

const KINDS = {
  engine: 'chitbridge-pricing',
  version: 1,
  order: ['pricing structure', 'offers', 'tax'],
  kinds: [
    { kind: 'fixed', fields: ['amount'], note: 'one declared amount; blank = the list price' },
    {
      kind: 'tiered',
      fields: ['tiers[{qty,price}]'],
      note: 'from quantity q each unit costs p; below the first break the list price; a RE-PRICE, not a discount'
    },
    { kind: 'range', fields: ['min', 'max'], note: 'a band the price must sit in; reported, never clamped' }
  ]
};

/* public: no sign-in, so the only refusal is a fault of ours */
router.get('/kinds', (req, res) => {
  try {
    res.json(KINDS);
  } catch (e) {
    problem(req, res, internalSpec(req, e, { error: 'Failed', message: SAFE_SENTENCE }));
  }
});

router.post('/price', auth, auth.requireScope('pricing'), ...checked('POST /price'), async (req, res) => {
  try {
    const lines = S.normLines(req.body);
    if (!lines.length) return problem(req, res, { status: 400, ...said('NO_LINES', 'validation', 'lines[] required: { item_id|code, qty, listPrice?, pricing? }') });
    const needShelf = lines.some((item) => !item.pricing || item.listPrice == null);
    const sh = needShelf ? await S.shelfOf(auth.entityOf(req)) : null;
    const out = lines.map((item) => S.priceLine(item, sh ? sh.productOf(item) : null));
    res.json({ engine: 'chitbridge-pricing', version: 1, lines: out, total: S.R2(out.reduce((total, item) => total + (item.unit_price || 0) * item.qty, 0)) });
  } catch (e) {
    problem(req, res, internalSpec(req, e, { error: 'Failed', message: SAFE_SENTENCE }));
  }
});

router.openapi = { paths: pathsOf(), schemas: SCHEMAS };
module.exports = router;
