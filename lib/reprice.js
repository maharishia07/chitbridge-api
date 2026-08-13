'use strict';
// lib/reprice.js — pull prices from the catalogue onto a chit that arrived without them (case 5).
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
const itemmatch = require('./itemmatch');
const money = require('./money');
const amend = require('./amend');

const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

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
  if (!rows) { const e = new Error('This chit has no line rows yet (b142).'); e.status = 503; throw e; }

  const want = opts.line_ids && opts.line_ids.length ? new Set(opts.line_ids) : null;
  const cat = await itemmatch.loadCatalogue(entity_id);
  const has_catalogue = cat.items.length > 0;

  const will_price = [], needs_price = [], unchanged = [];
  for (const l of rows) {
    if (l.removed) continue;                                   // a struck line is not priced; it is not happening
    if (want && !want.has(l.line_id)) continue;
    const cur = (l.price === null || l.price === undefined) ? null : Number(l.price);
    const entry = { line_id: l.line_id, particulars: l.particulars, quantity: l.quantity, unit: l.unit, price: cur };

    if (!has_catalogue) { needs_price.push({ ...entry, reason: 'no catalogue on this entity' }); continue; }
    if (opts.only_unpriced && cur) { unchanged.push(entry); continue; }

    /* ⚠️ THE SAME MATCHER THE READER USED. A price arrived at by a different resolution than the name on the line
       would attach somebody else's figure to this item, and it would look completely normal. */
    const m = itemmatch.match(l.asked_as || l.particulars, l.comment, cat);
    if (m.ambiguous) { needs_price.push({ ...entry, reason: m.matches + ' catalogue items answer to this name' }); continue; }
    if (m.variant_unspecified) { needs_price.push({ ...entry, reason: 'grade not named (' + (m.variants || []).join(' / ') + ')' }); continue; }
    if (!m.item) { needs_price.push({ ...entry, reason: m.reason || 'no catalogue match' }); continue; }

    const ours = money.amountOf(m.item.price);
    if (ours === null) { needs_price.push({ ...entry, reason: 'the catalogue item has no price' }); continue; }
    if (cur !== null && r2(cur) === r2(ours)) { unchanged.push({ ...entry, matched: m.item.name }); continue; }

    will_price.push({ ...entry, to: r2(ours), matched: m.item.name + (m.item.variant ? ' · ' + m.item.variant : ''),
      currency: money.currencyOf(m.item.price) || null,
      ...(m.fuzzy ? { matched_by_spelling: true } : {}),
      /* Shown because it is a decision, not a formality: replacing a figure the customer stated is different from
         filling an empty one, and only a person can say which is right. */
      replaces_stated_price: cur !== null });
  }

  return { has_catalogue, will_price, needs_price, unchanged,
           totals: { to_price: will_price.length, needs_attention: needs_price.length, already_right: unchanged.length } };
}

/**
 * apply(entity_id, chit_id, opts, who) — plan it, then write it as amendments.
 *
 * ⚠️ RE-PLANNED SERVER-SIDE rather than trusting a client-sent list. The catalogue can change between the preview
 * and the tap, and a client that posted its own numbers could price a line at anything.
 */
async function apply(entity_id, chit_id, opts = {}, who = {}) {
  const p = await plan(entity_id, chit_id, opts);
  if (!p.will_price.length) return { ...p, applied: 0 };

  const rows = await amend.readLines(entity_id, chit_id);
  const byId = new Map((rows || []).map((l) => [l.line_id, l]));

  const edits = p.will_price.map((w) => {
    const l = byId.get(w.line_id) || {};
    /* The whole line is resent because an amendment REPLACES a line — that is the b138 model. Everything except
       the price is carried through untouched. */
    return { line_index: 0, line_id: w.line_id,
      line: { particulars: l.particulars, quantity: l.quantity, unit: l.unit, unit_size: l.unit_size,
              price: w.to, comment: l.comment },
      /* ⚠️ 'other' + an explicit reason, NOT 'rate_agreed'. Nobody agreed anything — we filled in our own shelf
         price. Borrowing a code that means "the two of us settled on this" would corrupt the one statistic those
         codes exist for. A dedicated code would need a CHECK-constraint migration; the sentence is honest now. */
      reason_code: 'other',
      reason: 'priced from catalogue: ' + w.matched + ' @ ' + w.to + (w.replaces_stated_price ? ' (replaced ' + w.price + ')' : '') };
  });

  const out = await amend.record(entity_id, chit_id, edits, who);
  return { ...p, applied: out.amendments.length };
}

module.exports = { plan, apply };
