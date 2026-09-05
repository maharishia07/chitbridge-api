/**
 * /api/offers — THE OFFER ENGINE AS A SERVICE.
 *
 * Athi, 2026-09-05: "can we create the entire offer as a capability and attach it to any other systems … an api or
 * micro service which can be attached to other systems?" The engine (lib/offers-engine.js, vendored verbatim from
 * app/offers.js) is PURE — lines and offers in, adjustments out — so a service is three routes and no state:
 *
 *   GET  /api/offers/kinds                → the registry: every kind, its scope, the fields it reads
 *   POST /api/offers/evaluate  (auth)     → { lines, offers?, ctx? } → { subtotal, total, adjustments, notes, skipped, perLine }
 *                                           offers omitted = THIS entity's live offers (the same shelf the storefront uses)
 *   POST /api/offers/explain   (auth)     → the same, plus a one-line 'why' per adjustment — for a screen in another system
 *
 * A line is { key, item_id?, sku?, name?, qty, unitPrice, categories? }. Money never leaves as a decision: the caller
 * still writes its own order; this only says what would come off and why. Same engine, same answer, in every system.
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { withEntity } = require('../db');
const eng = require('../lib/offers-engine').CBOffers;

const FIELDS = { percent_off: ['percent', 'scope', 'applies_to'], amount_off: ['amount', 'scope', 'applies_to'], tier_price: ['tiers', 'applies_to'],
  threshold: ['min_amount', 'min_qty', 'percent', 'amount', 'get_item_id', 'get_item_name', 'get_qty', 'get_percent'],
  buy_x_get_y: ['buy', 'get', 'get_percent', 'get_item_id', 'get_item_name', 'max_sets', 'applies_to'],
  bundle_price: ['bundle_items', 'bundle_price', 'max_sets'], shipping: ['amount', 'percent', 'min_amount'], price_range: ['min', 'max', 'applies_to'] };

router.get('/kinds', (req, res) => {
  const kinds = (eng && eng.kinds) || [];
  res.json({ engine: 'chitbridge-offers', version: 1, kinds: kinds.map((k) => ({ kind: k, scope: (eng.KINDS[k] || {}).scope || 'line', fields: FIELDS[k] || [] })) });
});

function normLines(body) {
  return (Array.isArray(body.lines) ? body.lines : []).map((l, i) => ({
    key: String(l.key != null ? l.key : i), item_id: l.item_id || null, sku: l.sku || null, name: l.name || '',
    qty: Number(l.qty != null ? l.qty : l.quantity) || 0, unitPrice: Number(l.unitPrice != null ? l.unitPrice : l.price) || 0,
    categories: Array.isArray(l.categories) ? l.categories.map(String) : [], excluded: Array.isArray(l.excluded) ? l.excluded.map(String) : [] }));
}
async function ownOffers(req) {
  const entity_id = auth.entityOf(req);
  const catalogueView = require('../lib/catalogue-view');
  return catalogueView.liveOffers({ entity_id, withEntity });
}
async function run(req, res, explain) {
  try {
    const lines = normLines(req.body || {});
    if (!lines.length) return res.status(400).json({ error: 'validation', message: 'lines[] required: { key, item_id?, qty, unitPrice }' });
    const offers = Array.isArray(req.body.offers) && req.body.offers.length ? req.body.offers : await ownOffers(req);
    const ctx = Object.assign({ now: new Date(), currency: 'INR' }, req.body.ctx || {});
    const ev = eng.evaluate({ lines, offers, ctx });
    const out = { subtotal: ev.subtotal, total: ev.total, adjustments: ev.adjustments || [], notes: ev.notes || [], skipped: ev.skipped || [],
                  perLine: eng.perLine ? eng.perLine(ev, lines) : {}, offers_considered: offers.length, engine: 'chitbridge-offers', version: 1 };
    if (explain) out.explain = (ev.adjustments || []).map((a) => ({ label: a.label, why: a.why, amount: a.amount, scope: a.scope, target: a.target }));
    res.json(out);
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
}
router.post('/evaluate', auth, (req, res) => run(req, res, false));
router.post('/explain', auth, (req, res) => run(req, res, true));
module.exports = router;
