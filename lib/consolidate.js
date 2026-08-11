'use strict';
// lib/consolidate.js — WHOLESALER CONSOLIDATION. Many shops' messy requests → what he must source, and who asked.
//
// Directive: CB-CLI-DIRECTIVE-wholesaler-consolidation.md (2026-08-10). Read in, records out. It does NOT broadcast,
// reply, use buttons/flows/catalogue-messages, price, settle, or touch the 24-hour window. Two outputs only:
// the consolidated requirement, and the attribution.
//
// ── ⚠️ THE FOUR RULES THAT MUST NOT BEND ────────────────────────────────────────────────────────────────────────
//  1. SYNONYMS COLLAPSE — thakkali / tomato / tomator / tommotto are ONE item. A shop's spelling must never
//     fragment the total, because a fragmented total means he under-sources and someone goes without.
//  2. VARIANTS DO NOT — "orange grade 1" and "orange grade 2" are sourced and priced separately, and merging them
//     is the same error wearing the opposite sign. Catalogue has variants and the message names none → FLAG
//     variant-unspecified. Never auto-pick: picking one silently is a decision nobody made.
//  3. NO INVENTED CONVERSION — total only within one canonical unit. Convert ONLY where the catalogue defines it,
//     and RECORD that it happened. Undefined → report split ("5 crates + 25 kg") and flag. This is the money
//     error: a silently-wrong conversion sources the wrong quantity.
//  4. NO GUESSED MATCH — an item phrase that does not resolve is FLAGGED and EXCLUDED, never folded into a total.
//
// Flagged lines are shown separately and visibly. A total that quietly contains something uncertain is worse than
// a total with a gap beside it, because only one of them gets checked.
const { withEntity } = require('../db');

/* ⚠️ ONE MATCHER (lib/itemmatch.js). This file used to own its own — synonyms, variants, fuzz — while the
   RAISE path in lib/capture.js had a weaker one with no synonyms at all. So "thakkali" resolved to Tomato here and
   not there, and the chit a person actually reads got the worse of the two. Extracted rather than copied: two
   matchers with different capabilities do not stay merely different, they produce different records. */
const itemmatch = require('./itemmatch');
const norm = itemmatch.norm;
const loadCatalogue = itemmatch.loadCatalogue;
const matchItem = (phrase, comment, cat) => itemmatch.match(phrase, comment, cat);

/**
 * consolidate(requests, cat) — the two outputs.
 *
 * `requests` = [{ store_id, store_name, chit_id, fulfil_date, lines:[{particulars, comment, qty, unit}] }]
 *
 * ⚠️ TOTALLED PER FULFILMENT DATE. Friday's tomato is never added to Monday's — he sources per delivery day, and
 * a total that spans days tells him to buy the right amount on the wrong morning.
 */
function consolidate(requests, cat) {
  const buckets = new Map();     // date|itemKey → bucket
  const flags = { unmatched: [], variant_unspecified: [], date_unspecified: [], unit_split: [] };

  for (const req of (requests || [])) {
    const date = req.fulfil_date || null;
    for (const ln of (req.lines || [])) {
      const qty = Number(ln.qty) || 0;
      const m = matchItem(ln.particulars, ln.comment, cat);
      const who = { store_id: req.store_id, store_name: req.store_name, chit_id: req.chit_id, qty, unit: ln.unit || '', phrase: ln.particulars };

      /* ⚠️ AN UNMATCHED PHRASE IS EXCLUDED FROM EVERY TOTAL — flagged, never guessed in. */
      if (m.unmatched || m.ambiguous) { flags.unmatched.push({ ...who, date, reason: m.reason || (m.ambiguous ? (m.matches + " catalogue items answer to this name") : "no match") }); continue; }
      if (!date) { flags.date_unspecified.push({ ...who, item: m.item.name, variant: m.item.variant }); continue; }
      if (m.variant_unspecified) {
        flags.variant_unspecified.push({ ...who, date, item: m.item.name, variants: m.variants });
        continue;   // it is NOT totalled — assigning it to a variant would be inventing the order
      }

      const key = date + '|' + m.item.key;
      if (!buckets.has(key)) buckets.set(key, { date, item: m.item.name, variant: m.item.variant || null,
        canonical_unit: m.item.unit || '', by_unit: {}, stores: [], conversions: [] });
      const b = buckets.get(key);
      const u = norm(ln.unit || m.item.unit || '');
      b.by_unit[u] = (b.by_unit[u] || 0) + qty;
      b.stores.push(who);
      if (m.fuzzy) b.fuzzy = true;
    }
  }

  /* ── unit resolution, the money-error rule ───────────────────────────────────────────────────────────────── */
  const lines = [...buckets.values()].map((b) => {
    const units = Object.keys(b.by_unit).filter((u) => b.by_unit[u] !== 0);
    const canon = norm(b.canonical_unit);
    const item = cat.items.find((x) => x.key === norm(b.item) + '|' + norm(b.variant || ''));
    const conv = (item && item.conversions) || {};

    let total = 0, converted = [], unresolved = [];
    for (const u of units) {
      if (!canon || u === canon) { total += b.by_unit[u]; continue; }
      const factor = Number(conv[u]);
      if (Number.isFinite(factor) && factor > 0) {
        total += b.by_unit[u] * factor;
        converted.push({ from_unit: u, qty: b.by_unit[u], factor, to_unit: canon, became: b.by_unit[u] * factor });
      } else {
        /* ⚠️ NO DEFINED CONVERSION → DO NOT INVENT ONE. Report the total split by unit and flag it. Guessing that
           a crate is 20kg because it usually is would source the wrong quantity and look completely normal. */
        unresolved.push({ unit: u, qty: b.by_unit[u] });
      }
    }
    const out = { date: b.date, item: b.item, variant: b.variant, canonical_unit: b.canonical_unit,
      total: Math.round(total * 1000) / 1000, stores: b.stores.length, breakdown: b.stores,
      ...(converted.length ? { conversions_applied: converted } : {}),
      ...(b.fuzzy ? { matched_by_spelling: true } : {}) };
    if (unresolved.length) {
      out.unit_split = [{ unit: canon || '(canonical)', qty: out.total }, ...unresolved];
      out.flagged = 'unit-split — no conversion defined; totals are NOT comparable';
      flags.unit_split.push({ date: b.date, item: b.item, variant: b.variant, split: out.unit_split });
    }
    return out;
  });

  return { lines: lines.sort((a, b2) => (a.date === b2.date ? String(a.item).localeCompare(b2.item) : String(a.date).localeCompare(b2.date))), flags };
}

module.exports = { loadCatalogue, consolidate, matchItem, norm, lev: itemmatch.lev };
