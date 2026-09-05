/**
 * /api/pricing — THE PRICING STRUCTURE AS A SERVICE (rung 2). Same engine as the product page, the cart, the storefront
 * and the order line (lib/pricing-engine.js, vendored from app/pricing.js).
 *   GET  /api/pricing/kinds              → fixed · tiered · range, and the fields each reads
 *   POST /api/pricing/price   (key: pricing)  { lines:[{ key?, item_id?|code?, qty, listPrice?, pricing?:{kind,tiers,amount,min,max} }] }
 *                                         → { lines:[{ unit_price, list_price, structure, tier, why, bands, violation }] }
 *        a line without `pricing` takes the structure the entity's product cites (by item_id or code); without a
 *        listPrice it takes the product's list price.
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const S = require('../lib/services');
const pricing = require('../lib/pricing-engine').CBPricing;

router.get('/kinds', (req, res) => res.json({ engine: 'chitbridge-pricing', version: 1, order: ['pricing structure', 'offers', 'tax'],
  kinds: [{ kind: 'fixed', fields: ['amount'], note: 'one declared amount; blank = the list price' }, { kind: 'tiered', fields: ['tiers[{qty,price}]'], note: 'from quantity q each unit costs p; below the first break the list price; a RE-PRICE, not a discount' }, { kind: 'range', fields: ['min', 'max'], note: 'a band the price must sit in; reported, never clamped' }] }));

router.post('/price', auth, auth.requireScope('pricing'), async (req, res) => {
  try {
    const lines = S.normLines(req.body);
    if (!lines.length) return res.status(400).json({ error: 'validation', message: 'lines[] required: { item_id|code, qty, listPrice?, pricing? }' });
    const needShelf = lines.some((l) => !l.pricing || l.listPrice == null);
    const sh = needShelf ? await S.shelfOf(auth.entityOf(req)) : null;
    const out = lines.map((l) => S.priceLine(l, sh ? sh.productOf(l) : null));
    res.json({ engine: 'chitbridge-pricing', version: 1, lines: out, total: S.R2(out.reduce((t, l) => t + (l.unit_price || 0) * l.qty, 0)) });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

router.openapi = {
  paths: {
    '/api/pricing/kinds': { get: { summary: 'Pricing structure kinds', tags: ['pricing'], responses: { 200: { description: 'kinds' } } } },
    '/api/pricing/price': { post: { summary: 'Unit price at a quantity, per line', tags: ['pricing'], security: [{ apiKey: [] }, { bearer: [] }],
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/PriceBody' } } } },
      responses: { 200: { description: 'priced lines', content: { 'application/json': { schema: { $ref: '#/components/schemas/PriceResult' } } } } } } } },
  schemas: {
    PricingStructure: { type: 'object', properties: { kind: { type: 'string', enum: pricing.kinds }, name: { type: 'string' }, amount: { type: 'number' }, tiers: { type: 'array', items: { type: 'object', properties: { qty: { type: 'number' }, price: { type: 'number' } } } }, min: { type: 'number' }, max: { type: 'number' } } },
    PriceBody: { type: 'object', required: ['lines'], properties: { lines: { type: 'array', items: { type: 'object', required: ['qty'], properties: { key: { type: 'string' }, item_id: { type: 'string' }, code: { type: 'string' }, qty: { type: 'number' }, listPrice: { type: 'number' }, pricing: { $ref: '#/components/schemas/PricingStructure' } } } } } },
    PriceResult: { type: 'object', properties: { total: { type: 'number' }, lines: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, unit_price: { type: 'number' }, list_price: { type: 'number' }, structure: { type: 'string', nullable: true }, tier: { type: 'object', nullable: true }, why: { type: 'string' }, violation: { type: 'string', nullable: true }, bands: { type: 'array', items: { type: 'object' } } } } } } },
  },
};
module.exports = router;
