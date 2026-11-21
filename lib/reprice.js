'use strict';
// lib/reprice.js — pull prices from the catalogue onto a chit that arrived without them (case 5).
// OWNS      the reprice of a chit's lines from the catalogue: plan (preview, writes nothing) and apply (amendments, never a price edit)
// FLOW      plan → itemmatch (the reader's own matcher) → shelfPrice (services.priceLine: the structure at the quantity) → will_price / needs_price / unchanged → apply → amend.record
// CARD      06-catalogue-pim/items-create-edit-bulk-status
// CALLED BY routes/chits.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
// OWNS pricing a chit's unpriced lines from the catalogue, as amendments (preview writes nothing)
// FLOW chit line without a price -> match to a catalogue item -> sellable price (lib/sellable-price.js) -> amendment, or needs_price; stored prices are read with { stored: true } so an old withdrawn-code price still shows
// CARD 07-offers-pricing-and-combos/till-price-and-worth-an-offer
//
// Athi, 2026-08-13: *"Assume if the price is not available, there must be a way to pick from the catalogue... Either
// wholistically or for an individual item the price should be pulled in. Price update as a whole chit or maybe
// select few items... Whether price is already there or not, it really doesn't matter."*
//
// ── ⚠️ IT WRITES AMENDMENTS, NOT PRICES ─────────────────────────────────────────────────────────────────────────
// A chit is a record. Setting a price directly on the line would be exactly the invisible edit b138 exists to
// prevent — the customer's ₹0 would vanish and nobody could later say what arrived versus what we charged. So a
// reprice is a normal correction: the old value stays struck through, the new one is live, and it carries who did
// it and why. The mechanism already exists; this only chooses the numbers.
//
// ── ⚠️ PREVIEW BEFORE APPLY, AND THAT IS THE POINT ──────────────────────────────────────────────────────────────
// Pricing a whole chit in one tap is the useful version and also the dangerous one. `preview` computes exactly what
// would change and writes nothing, so the decision is made against a list rather than a promise. Same discipline as
// the folder-rules preview.
//
// ── ⚠️ WHAT CANNOT BE PRICED IS REPORTED, NEVER GUESSED ─────────────────────────────────────────────────────────
// Athi: *"if the exact item not found, then highlight for the cost to be updated."* An unmatched line, an ambiguous
// one, or a catalogue item with no price comes back in `needs_price` — visible, and still at whatever it was.
// Silently leaving it at 0 is how a chit ends up looking priced when a third of it is not.
const { withEntity } = require('../db');
const { round: roundMoney } = require('./money'); /* ⭐ money.round — the one rounder (SPEC-money-one-reader.md): half away from zero, on the decimal value */
const itemmatch = require('./itemmatch');
const money = require('./money');
const sellablePrice = require('./sellable-price'); // CAT-324: when a stored price cannot be sold
const amend = require('./amend');
const services = require('./services'); /* CAT-251: priceLine is the ONE reader of a product's price structure at a quantity (tiered, banded, ...) */

/** round a price to the money rule, for comparing and showing */
const roundedPrice = (v) => roundMoney(Number(v));
/** why the matcher's answer cannot be priced (several items, no grade named, no match), in words — or null when it names one item */
function unmatchedReason(found) {
  if (found.ambiguous) return found.matches + ' catalogue items answer to this name';
  if (found.variant_unspecified) return 'grade not named (' + (found.variants || []).join(' / ') + ')';
  return found.item ? null : found.reason || 'no catalogue match';
}
/** ⭐ CAT-251: the shelf price AT THIS LINE'S QUANTITY, by the product's own pricing structure — the reader invoice/build uses (services.priceLine), never the bare list price */
const shelfPrice = (row, item) => services.priceLine({ key: row.line_id, qty: Number(row.quantity) || 0, listPrice: null, pricing: null }, item);

/** the price the chit line arrived with (a number), or null when it came without one */
function statedPrice(line) {
  return line.price === null || line.price === undefined ? null : Number(line.price);
}

/** one line's verdict: which of will_price / needs_price / unchanged it belongs in, and the row to show for it */
function priceVerdict(line, catalogue, has_catalogue, opts) {
  const current = statedPrice(line);
  const entry = { line_id: line.line_id, particulars: line.particulars, quantity: line.quantity, unit: line.unit, price: current };
  const needs = (reason) => ({ bucket: 'needs_price', row: { ...entry, reason } });
  if (!has_catalogue) return needs('no catalogue on this entity');
  if (opts.only_unpriced && current) return { bucket: 'unchanged', row: entry };

  /* ⚠️ THE SAME MATCHER THE READER USED. A price arrived at by a different resolution than the name on the line
     would attach somebody else's figure to this item, and it would look completely normal. */
  const found = itemmatch.match(line.asked_as || line.particulars, line.comment, catalogue);
  const unmatched = unmatchedReason(found);
  if (unmatched) return needs(unmatched);

  const read = shelfPrice(line, found.item);
  const ours = sellablePrice.soldAt(read.unit_price); // CAT-251 reads the price at the quantity; CAT-324: a negative one is no price (needs_price)
  if (ours === null) return needs(read.why || 'the catalogue item has no price');
  if (current !== null && roundedPrice(current) === roundedPrice(ours)) return { bucket: 'unchanged', row: { ...entry, matched: found.item.name } };

  return { bucket: 'will_price', row: willPriceRow(entry, found, read, ours, current) };
}

/** the preview row for a line that WOULD be repriced */
function willPriceRow(entry, found, read, ours, current) {
  return {
    ...entry,
    to: roundedPrice(ours),
    matched: found.item.name + (found.item.variant ? ' · ' + found.item.variant : ''),
    currency: money.currencyOf(found.item.price, { stored: true }) || null,
    ...(read.structure ? { structure: read.structure, tier: read.tier || null } : {}),
    ...(found.fuzzy ? { matched_by_spelling: true } : {}),
    /* Shown because it is a decision, not a formality: replacing a figure the customer stated is different from
       filling an empty one, and only a person can say which is right. */
    replaces_stated_price: current !== null
  };
}

/**
 * plan(entity_id, chit_id, opts) — what repricing WOULD do.
 *
 * opts: { line_ids?: [uuid], only_unpriced?: bool }
 *
 * ⚠️ `only_unpriced` DEFAULTS FALSE, deliberately. Athi: *"whether price is already there or not, it really
 * doesn't matter."* A shop that quoted its own figure and a catalogue that says otherwise is a real disagreement
 * someone may want to resolve in either direction — so the default is to show BOTH and let a person choose,
 * rather than quietly protecting whichever number happened to arrive first.
 */
async function plan(entity_id, chit_id, opts = {}) {
  const rows = await amend.readLines(entity_id, chit_id);
  if (!rows) {
    const e = new Error('This chit has no line rows yet (b142).');
    e.status = 503;
    throw e;
  }

  const want = opts.line_ids && opts.line_ids.length ? new Set(opts.line_ids) : null;
  const catalogue = await itemmatch.loadCatalogue(entity_id);
  const has_catalogue = catalogue.items.length > 0;

  const buckets = { will_price: [], needs_price: [], unchanged: [] };
  for (const line of rows) {
    if (line.removed) continue; // a struck line is not priced; it is not happening
    if (want && !want.has(line.line_id)) continue;
    const verdict = priceVerdict(line, catalogue, has_catalogue, opts);
    buckets[verdict.bucket].push(verdict.row);
  }
  const { will_price, needs_price, unchanged } = buckets;

  return {
    has_catalogue,
    will_price,
    needs_price,
    unchanged,
    totals: { to_price: will_price.length, needs_attention: needs_price.length, already_right: unchanged.length }
  };
}

/**
 * apply(entity_id, chit_id, opts, actor) — plan it, then write it as amendments.
 *
 * ⚠️ RE-PLANNED SERVER-SIDE rather than trusting a client-sent list. The catalogue can change between the preview
 * and the tap, and a client that posted its own numbers could price a line at anything.
 */
async function apply(entity_id, chit_id, opts = {}, actor = {}) {
  const preview = await plan(entity_id, chit_id, opts);
  if (!preview.will_price.length) return { ...preview, applied: 0 };

  const rows = await amend.readLines(entity_id, chit_id);
  const byId = new Map((rows || []).map((item) => [item.line_id, item]));

  const edits = preview.will_price.map((item) => {
    const old = byId.get(item.line_id) || {};
    /* The whole line is resent because an amendment REPLACES a line — that is the b138 model. Everything except
       the price is carried through untouched. */
    return {
      line_index: 0,
      line_id: item.line_id,
      line: { particulars: old.particulars, quantity: old.quantity, unit: old.unit, unit_size: old.unit_size, price: item.to, comment: old.comment },
      /* ⚠️ 'other' + an explicit reason, NOT 'rate_agreed'. Nobody agreed anything — we filled in our own shelf
         price. Borrowing a code that means "the two of us settled on this" would corrupt the one statistic those
         codes exist for. A dedicated code would need a CHECK-constraint migration; the sentence is honest now. */
      reason_code: 'other',
      reason: 'priced from catalogue: ' + item.matched + ' @ ' + item.to + (item.replaces_stated_price ? ' (replaced ' + item.price + ')' : '')
    };
  });

  const out = await amend.record(entity_id, chit_id, edits, actor);
  return { ...preview, applied: out.amendments.length };
}

module.exports = { plan, apply };
