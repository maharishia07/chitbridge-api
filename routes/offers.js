// CARD 07-offers-pricing-and-combos/offers-engine-as-service
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
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { schemaValidate } = require('../middleware/validate'); // S9: the request is checked against the route's own schema
const { SAID, faultOf, contract } = require('../lib/offers-contract'); // the contract (each route's operation) and the words of a refusal and of a fault
const {
  round: roundMoney
} = require('../lib/money'); /* ⭐ money.round — the one rounder (SPEC-money-one-reader.md): half away from zero, on the decimal value */
const router = express.Router();
const auth = require('../middleware/auth');
const { withEntity } = require('../db');
const eng = require('../lib/offers-engine').CBOffers;
/** the schema check of one route (its own operation in lib/offers-contract.js), as a list to spread after the gates: a route that takes no input has none */
function checked(route) {
  const operation = contract.operationFor(route);
  return operation.parameters || operation.requestBody ? [schemaValidate(operation)] : [];
}

const FIELDS = {
  percent_off: ['percent', 'scope', 'applies_to'],
  amount_off: ['amount', 'scope', 'applies_to'],
  tier_price: ['tiers', 'applies_to'],
  threshold: ['min_amount', 'min_qty', 'percent', 'amount', 'get_item_id', 'get_item_name', 'get_qty', 'get_percent'],
  buy_x_get_y: ['buy', 'get', 'get_percent', 'get_item_id', 'get_item_name', 'max_sets', 'applies_to'],
  bundle_price: ['bundle_items', 'bundle_price', 'max_sets'],
  shipping: ['amount', 'percent', 'min_amount'],
  price_range: ['min', 'max', 'applies_to']
};

router.get('/kinds', (req, res) => {
  try {
    const kinds = (eng && eng.kinds) || [];
    res.json({
      engine: 'chitbridge-offers',
      version: 1,
      kinds: kinds.map((item) => ({ kind: item, scope: (eng.KINDS[item] || {}).scope || 'line', fields: FIELDS[item] || [] }))
    });
  } catch (e) {
    problem(req, res, faultOf(e, req));
  }
});

function normLines(body) {
  return (Array.isArray(body.lines) ? body.lines : []).map((item, index) => ({
    key: String(item.key != null ? item.key : index),
    item_id: item.item_id || null,
    sku: item.sku || null,
    name: item.name || '',
    qty: Number(item.qty != null ? item.qty : item.quantity) || 0,
    unitPrice: Number(item.unitPrice != null ? item.unitPrice : item.price) || 0,
    categories: Array.isArray(item.categories) ? item.categories.map(String) : [],
    excluded: Array.isArray(item.excluded) ? item.excluded.map(String) : []
  }));
}
async function ownOffers(req) {
  const entity_id = auth.entityOf(req);
  const catalogueView = require('../lib/catalogue-view');
  return catalogueView.liveOffers({ entity_id, withEntity });
}
/** the handler of evaluate (explain = false) and of explain (true): same engine, same answer, with a reason per adjustment on the second */
const answer = (explain) =>
  async function offersAnswer(req, res) {
    try {
      const lines = normLines(req.body || {});
      if (!lines.length)
        return problem(req, res, { status: 400, code: 'LINES_REQUIRED', detail: SAID.lines, legacy: { error: 'validation', message: SAID.lines } });
      const offers = Array.isArray(req.body.offers) && req.body.offers.length ? req.body.offers : await ownOffers(req);
      const ctx = Object.assign({ now: new Date(), currency: null }, req.body.ctx || {}); /* T2-NATDEF: the caller's stated money, never INR by name */
      /* the engine phrases every 'why' through ctx.money; a caller from another system need not know that */
      if (typeof ctx.money !== 'function') ctx.money = (n) => (ctx.currency ? String(ctx.currency) + ' ' : '') + roundMoney(Number(n) || 0).toFixed(2);
      const ev = eng.evaluate({ lines, offers, ctx });
      const out = {
        subtotal: ev.subtotal,
        total: ev.total,
        adjustments: ev.adjustments || [],
        notes: ev.notes || [],
        skipped: ev.skipped || [],
        perLine: eng.perLine ? eng.perLine(ev, lines) : {},
        offers_considered: offers.length,
        engine: 'chitbridge-offers',
        version: 1
      };
      if (explain)
        out.explain = (ev.adjustments || []).map((item) => ({ label: item.label, why: item.why, amount: item.amount, scope: item.scope, target: item.target }));
      res.json(out);
    } catch (e) {
      problem(req, res, faultOf(e, req));
    }
  };
router.post('/evaluate', auth, auth.requireScope('offers'), ...checked('POST /evaluate'), answer(false));
router.post('/explain', auth, auth.requireScope('offers'), ...checked('POST /explain'), answer(true));

/* OpenAPI 3.0 — what another system reads to attach. Kept beside the code that it describes so it cannot drift far. */
router.get('/openapi.json', (req, res) => {
  try {
    res.json(require('./openapi').assemble(req));
  } catch (e) {
    problem(req, res, faultOf(e, req));
  }
});
router.openapi = (function () {
  const line = {
    type: 'object',
    required: ['qty', 'unitPrice'],
    properties: {
      key: { type: 'string' },
      item_id: { type: 'string' },
      sku: { type: 'string' },
      name: { type: 'string' },
      qty: { type: 'number' },
      unitPrice: { type: 'number' },
      categories: { type: 'array', items: { type: 'string' } },
      excluded: { type: 'array', items: { type: 'string' } }
    }
  };
  const offer = {
    type: 'object',
    required: ['kind'],
    properties: {
      id: { type: 'string' },
      label: { type: 'string' },
      kind: { type: 'string', enum: (eng && eng.kinds) || [] },
      scope: { type: 'string', enum: ['line', 'cart'] },
      percent: { type: 'number' },
      amount: { type: 'number' },
      min_amount: { type: 'number' },
      min_qty: { type: 'number' },
      tiers: { type: 'array', items: { type: 'object', properties: { qty: { type: 'number' }, price: { type: 'number' } } } },
      buy: { type: 'number' },
      get: { type: 'number' },
      get_percent: { type: 'number' },
      get_item_id: { type: 'string' },
      get_item_name: { type: 'string' },
      get_qty: { type: 'number' },
      max_sets: { type: 'number' },
      bundle_items: { type: 'array', items: { type: 'string' } },
      bundle_price: { type: 'number' },
      min: { type: 'number' },
      max: { type: 'number' },
      applies_to: {
        type: 'object',
        properties: { item_ids: { type: 'array', items: { type: 'string' } }, category_ids: { type: 'array', items: { type: 'string' } } }
      },
      valid_from: { type: 'string' },
      valid_to: { type: 'string' }
    }
  };
  const adjustment = {
    type: 'object',
    properties: {
      offer_id: { type: 'string' },
      label: { type: 'string' },
      kind: { type: 'string' },
      scope: { type: 'string' },
      target: { type: 'string', nullable: true },
      amount: { type: 'number', description: 'negative = comes off' },
      basis: { type: 'string' },
      why: { type: 'string' },
      shortfall: { type: 'number' },
      claim: { type: 'object' }
    }
  };
  const result = {
    type: 'object',
    properties: {
      subtotal: { type: 'number' },
      total: { type: 'number' },
      adjustments: { type: 'array', items: adjustment },
      notes: { type: 'array', items: adjustment },
      skipped: { type: 'array', items: { type: 'object' } },
      perLine: { type: 'object' },
      offers_considered: { type: 'integer' },
      explain: { type: 'array', items: { type: 'object' } }
    }
  };
  const body = {
    type: 'object',
    required: ['lines'],
    properties: {
      lines: { type: 'array', items: line },
      offers: { type: 'array', items: offer, description: "omit to evaluate against the caller entity's live offers" },
      ctx: { type: 'object', properties: { currency: { type: 'string' }, now: { type: 'string', format: 'date-time' } } }
    }
  };
  return {
    schemas: { Line: line, Offer: offer, Adjustment: adjustment, Result: result, EvaluateBody: body },
    paths: contract.pathsOf()
  };
})();
module.exports = router;
