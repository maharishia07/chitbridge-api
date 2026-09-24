'use strict';
// @stage tested
// @stage-note [TILL-187] No route reaches this yet — Offer Lab's own catalogue-read endpoint (the piece that
// @stage-note lets a signed-in shopkeeper's real cost figures reach the lab) is the next step, not this one.
// @stage-note tests/item-cost.test.js exercises the shape with no server, no browser, no database.
/**
 * item-cost.js — THE ONE PLACE AN ITEM'S ROUGH COST IS READ AND WRITTEN.
 *
 * Athi: "the cost column should be in the product field, this should be the sum of many other data... a field
 * what... can be used to directly type currently, or... store the value based on a rule engine which
 * calculates the cost... a trigger can be set to find the cost from this field" — and, asked what else could
 * fill it: "access the cost from tally, zoho or compute and so on."
 *
 * ── ⭐⭐ WHY item_data.cost, NOT A NEW COLUMN ─────────────────────────────────────────────────────────────────
 * catalogue_items has exactly two real columns worth reading (item_id, item_data) — everything an item is,
 * name, price, category, tax, is already inside item_data (jsonb). A new top-level `cost` column would be the
 * one attribute on the whole table that broke that pattern for no reason a reader could see later.
 *
 * ── ⚠️⚠️⚠️ THIS VALUE MUST NEVER REACH A CUSTOMER-FACING SURFACE ────────────────────────────────────────────
 * lib/exposure.js deletes item_data.cost unconditionally — not one of the seller's own switches, because
 * unlike tax or synonyms a seller never gets to choose to show it. See tests/exposure-cost.test.js.
 * Offer Lab is the only reader this module is written for; nothing else should import it.
 *
 * ── ⭐ THE SHAPE, matching the priced_by/priced_why idiom already on a bill line (till.html's addItem) ───────
 *   { value: 38, source: 'manual' | 'rule' | 'tally' | 'zoho', updated_at: '2026-…', note: null }
 * `value == null` means UNKNOWN, never zero (spec §8) — Offer Lab excludes it from totals and counts it beside
 * them, never guesses. `source` is the provenance a reprint or a dispute would want; it is never shown to a
 * customer either, but it is what lets a shopkeeper trust a number they did not type themselves.
 * ⚠️ 'rule' AND THE CONNECTOR SOURCES ARE NAMED HERE, NOT BUILT HERE. Nothing today writes 'rule', 'tally' or
 * 'zoho' into this field — this module only defines the shape so that when a cost rule or a connector sync is
 * built, it writes into the SAME field Offer Lab already reads, rather than a second cost living somewhere
 * else. [[feedback-no-duplicate-functions]]
 */

const SOURCES = ['manual', 'rule', 'tally', 'zoho'];

/** the effective cost object for an item, or null if none has ever been set */
function costOf(item_data) {
  const c = item_data && item_data.cost;
  if (!c || typeof c !== 'object' || c.value == null || !isFinite(Number(c.value))) return null;
  return { value: Number(c.value), source: SOURCES.indexOf(c.source) >= 0 ? c.source : 'manual',
           updated_at: c.updated_at || null, note: c.note || null };
}

/** the patch to merge into item_data when a person or a process sets the cost */
function setCost(value, source, note) {
  const v = value == null ? null : Number(value);
  if (v != null && !(isFinite(v) && v >= 0)) throw new Error('cost must be a non-negative number or null');
  if (v == null) return { cost: null };   /* explicitly cleared — "unknown" again, never zero */
  return { cost: { value: v, source: SOURCES.indexOf(source) >= 0 ? source : 'manual',
                   updated_at: new Date().toISOString(), note: note || null } };
}

module.exports = { SOURCES, costOf, setCost };
