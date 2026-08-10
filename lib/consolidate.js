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

/* ── normalisation ──────────────────────────────────────────────────────────────────────────────────────────── */
const norm = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ');

/**
 * Levenshtein, capped — for misspellings only ("tomator" → "tomato").
 *
 * ⚠️ FUZZY MATCHING IS A LOADED GUN HERE. It must fix typing, never merge two real things: "orange grade 1" and
 * "orange grade 2" are one character apart and must NEVER match each other. So fuzz is applied ONLY to the item
 * phrase after variant tokens are removed, and only within a tight distance relative to length.
 */
function lev(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 3) return 99;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let k = 1; k <= n; k++) cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/**
 * Read the entity's catalogue into a matcher.
 *
 * ⚠️ THE CATALOGUE IS AUTHORITATIVE. The AI proposes a phrase; the catalogue supplies the canonical name, the
 * variant and the unit. Anything the catalogue does not know is not a match — it is a flag.
 *
 * A catalogue item may declare `synonyms: ["thakkali","tomatto"]` and `variant`. Items sharing a `name` but
 * differing in `variant` are DIFFERENT lines that must never be summed together.
 */
async function loadCatalogue(entity_id) {
  let rows = [];
  try {
    const r = await withEntity(entity_id, (c) => c.query(
      `SELECT item_id, item_data FROM catalogue_items WHERE entity_id = $1 AND is_active = true`, [entity_id]));
    rows = r.rows.map((x) => x.item_data || {}).filter((d) => d && d.name);
  } catch (_) { rows = []; }

  const items = rows.map((d) => ({
    name: String(d.name),
    variant: String(d.variant || d.grade || '').trim(),
    unit: String(d.unit || '').trim(),
    unit_size: d.unit_size || null,
    // conversions: { crate: 20 } meaning 1 crate = 20 <canonical unit>. Declared, never inferred.
    conversions: (d.conversions && typeof d.conversions === 'object') ? d.conversions : {},
    synonyms: Array.isArray(d.synonyms) ? d.synonyms.map(norm) : [],
    key: norm(d.name) + '|' + norm(d.variant || d.grade || ''),
  }));

  // Which base names have more than one variant — needed to know when "unspecified" is a real problem.
  const variantsOf = {};
  items.forEach((it) => { (variantsOf[norm(it.name)] = variantsOf[norm(it.name)] || new Set()).add(it.variant); });

  return { items, variantsOf };
}

/**
 * match(phrase, comment, cat) — resolve a shop's words to a catalogue item + variant.
 *
 * Returns { item, variant_unspecified } or { unmatched: reason }.
 */
function matchItem(phrase, comment, cat) {
  const text = norm(phrase + ' ' + (comment || ''));
  const p = norm(phrase);
  if (!p) return { unmatched: 'no item phrase' };

  // 1. exact / synonym on the FULL phrase, variant included
  for (const it of cat.items) {
    if (norm(it.name) === p || it.synonyms.includes(p)) {
      // base name matched. Now decide the variant.
      const base = norm(it.name);
      const variants = [...(cat.variantsOf[base] || new Set())].filter(Boolean);
      if (!variants.length) return { item: it };
      /* ⚠️ THE MESSAGE MUST NAME THE VARIANT. If the catalogue has grade 1 and grade 2 and the shop said only
         "orange", picking either is inventing an order. Flagged, never assigned. */
      const named = cat.items.find((x) => norm(x.name) === base && x.variant && text.includes(norm(x.variant)));
      if (named) return { item: named };
      return { item: it, variant_unspecified: true, variants };
    }
  }

  // 2. the phrase may carry the variant inline: "orange grade 1"
  for (const it of cat.items) {
    if (!it.variant) continue;
    if (p === norm(it.name + ' ' + it.variant) || (p.startsWith(norm(it.name)) && p.includes(norm(it.variant)))) return { item: it };
  }

  // 3. fuzzy — misspellings ONLY, and never across variants (see the warning on lev()).
  let best = null, bestD = 99;
  for (const it of cat.items) {
    for (const cand of [norm(it.name), ...it.synonyms]) {
      if (!cand) continue;
      const d = lev(p, cand);
      const tol = cand.length <= 4 ? 1 : cand.length <= 7 ? 2 : 3;
      if (d <= tol && d < bestD) { bestD = d; best = it; }
    }
  }
  if (best) {
    const base = norm(best.name);
    const variants = [...(cat.variantsOf[base] || new Set())].filter(Boolean);
    if (!variants.length) return { item: best, fuzzy: bestD };
    const named = cat.items.find((x) => norm(x.name) === base && x.variant && text.includes(norm(x.variant)));
    if (named) return { item: named, fuzzy: bestD };
    return { item: best, variant_unspecified: true, variants, fuzzy: bestD };
  }

  return { unmatched: 'no catalogue match' };
}

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
      if (m.unmatched) { flags.unmatched.push({ ...who, date, reason: m.unmatched }); continue; }
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

module.exports = { loadCatalogue, consolidate, matchItem, norm, lev };
