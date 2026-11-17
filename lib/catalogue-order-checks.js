'use strict';
/**
 * lib/catalogue-order-checks.js — the order path's checks on a customer's lines: name normal form, the 422 error, the item's own template, the buyer's offer.
 * OWNS      _norm · _422 · itemDeclFor · validateProposal (no route, no state)
 * CALLED BY routes/catalogue.js (repriceAgainstCatalogue and the order doors)
 * FLOW      itemDeclFor (per-request memo, fail closed) -> validateProposal (the offer against the declared schema) -> a 422 / 503 or the admissible position
 * CARD      10-online-shop-and-storefront-orders/order-start-confirm
 */
const { withEntity } = require('../db');
const orderInput = require('./order-input');
const catalogueBuild = require('./catalogue-build'); // B3.7-ref: resolve the shop's adopted REFERENCE catalogue

const _norm = (s) =>
  String(s == null ? '' : s)
    .trim()
    .toLowerCase();
const _422 = (m) => {
  const e = new Error(m);
  e.status = 422;
  return e;
};

// Validate the buyer's proposal. NOTHING here feeds price/total — CJ-07 price integrity is untouched: the line price
// and total stay server-authoritative. This only decides whether a NON-authoritative position is admissible.
// It is strictly a NEW restriction (a fixed-price shop now REJECTS an offer that it previously ignored).
// A store may offer SEVERAL templates, and each asks for different things — the customer must be shown the fields of
// the template THEY picked, not one catalogue-wide set. So an item may carry its own `order_input`, merge-patched over
// the catalogue's (opt-in: no item declaration → the catalogue governs). Resolved SERVER-SIDE at submit, so what gets
// validated is what the ITEM declares, never what the client claims it declares.
async function itemDeclFor(entity_id, itemName, cache) {
  if (!itemName) return null;
  try {
    // T3.5 · memoise per REQUEST. This ran catalogueBuild.resolve for every visible adoption, once per line item —
    // up to 5 forms × N adoptions per confirm, on top of the identical loop in repriceAgainstCatalogue. The cache is
    // passed in by the caller so it lives exactly one request and cannot leak between tenants.
    const c = cache || {};
    if (!c._decls) {
      const ado = await withEntity(entity_id, (db) =>
        db.query(
          // T3.6 · ORDER BY makes resolution DETERMINISTIC. Without it the same submission could validate against a
          // different schema on different requests, at the database's discretion.
          `SELECT source_key, commercials FROM catalogue_adoption
          WHERE entity_id = $1 AND visible = true ORDER BY source_key`,
          [entity_id]
        )
      );
      const decls = new Map(); // normalised name → [{source_key, order_input}]
      for (const row of ado.rows) {
        const resolved = await catalogueBuild.resolve(row.source_key, row.commercials || {}, { entity_id });
        for (const it of (resolved && resolved.items) || []) {
          const k = _norm(it.name);
          if (!decls.has(k)) decls.set(k, []);
          decls.get(k).push({ source_key: row.source_key, order_input: it.order_input || null });
        }
      }
      c._decls = decls;
    }
    const hits = c._decls.get(_norm(itemName)) || [];
    // T3.6 · reject AMBIGUITY rather than silently picking one. The commerce path already refuses when a name exists
    // under two brands ("available from more than one brand"); the payload path used to take whichever came first.
    const distinct = hits.filter((item) => item.order_input).map((item) => item.source_key);
    if (distinct.length > 1) {
      const err = new Error(`"${itemName}" is offered by more than one source (${distinct.join(', ')}) — choose the source`);
      err.status = 422;
      throw err;
    }
    if (hits.length) return hits[0].order_input || null;
  } catch (e) {
    if (e && e.status === 422) throw e; // ambiguity is the caller's problem to fix, not a retry
    // T1.3 — FAIL CLOSED. This used to swallow the error and return null, so a transient DB fault meant the item's
    // stricter schema (and its REQUIRED document rule) silently did not apply, and the looser submission was sealed
    // onto a chit indistinguishable from a correctly-validated one. A retryable error is far better than that.
    const err = new Error('Could not resolve the template for "' + itemName + '" — please retry');
    err.status = 503;
    throw err;
  }
  // No adoption matched the name: there is no item declaration, so the CATALOGUE's contract governs. That is the
  // designed opt-in path, not a failure.
  return null;
}

// Validate the buyer's offer AGAINST THE DECLARED SCHEMA, bounded by the seller's own band/options.
// NOTHING here feeds price/total — CJ-07 price integrity is untouched: the line price and total stay
// server-authoritative. This only decides whether a NON-authoritative position is admissible.
function validateProposal(raw, oi, sellerBand, label) {
  if (raw == null) return null;
  if (!oi.negotiable) throw _422(`This shop does not take offers — "${label}" is sold at the listed price`);
  // the seller's band/options bound the buyer (source-governed: the seller sets the bounds, not the host)
  const schema = orderInput.withBounds(oi.schema, 'price', sellerBand);
  const priceOnly = { type: 'object', properties: { price: (schema.properties || {}).price || {} }, required: ['price'] };
  const r = orderInput.validate({ price: raw.price != null ? raw.price : raw.min }, priceOnly);
  if (!r.ok) throw _422(`Offer for "${label}": ${r.errors.join('; ')}`);
  const out = { price: r.value.price };
  if (raw.max != null) {
    // buyer proposing a BAND rather than a number
    const m = orderInput.validate({ price: raw.max }, priceOnly);
    if (!m.ok) throw _422(`Offer for "${label}": ${m.errors.join('; ')}`);
    out.min = out.price;
    out.max = m.value.price;
    delete out.price;
    if (out.min > out.max) throw _422(`Offer range for "${label}" is inverted`);
  }
  if (raw.note != null) out.note = String(raw.note).slice(0, 500);
  return out;
}

module.exports = { _norm, _422, itemDeclFor, validateProposal };
