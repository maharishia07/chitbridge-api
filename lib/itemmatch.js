'use strict';
// lib/itemmatch.js — THE catalogue matcher. A shop's words → a catalogue item.
//
// ── ⚠️ WHY THIS FILE EXISTS: THERE WERE TWO MATCHERS AND THEY DISAGREED ──────────────────────────────────────────
// Athi, 2026-08-11: *"fix the matcher, use synonyms in raise too."*
//
// `lib/consolidate.js` matched on synonyms, variants and misspellings. `lib/capture.js` (the raise path) matched on
// exact name or substring only. So "thakkali" resolved to Tomato when the wholesaler ran his consolidation, and did
// NOT resolve when the same message became a chit minutes earlier — no canonical name, no catalogue price, on the
// record that people actually read.
//
// That is the duplication rule again, and this codebase has already paid for it twice: a CSPRNG fix that reached
// one of six bridge-id generators, and one of three OTP generators. Two matchers with different capabilities do not
// stay merely different; the weaker one silently produces worse records.
//
// ── ⚠️ FUZZY MATCHING IS A LOADED GUN HERE ──────────────────────────────────────────────────────────────────────
// It must fix TYPING and never merge two real things. "orange grade 1" and "orange grade 2" are one character
// apart and must NEVER match each other. So fuzz runs on the item phrase only, never across variants, and within a
// distance proportional to length.
const { withEntity } = require('../db');

/**
 * norm(s) — fold a phrase for comparison, IN ANY SCRIPT.
 *
 * ⚠️ THIS WAS `[^a-z0-9 ]` AND IT INVENTED MONEY (found 2026-08-12 on a real Tamil order).
 * Every non-Latin script collapsed to a single space: norm("தக்காளி") === " ". A bare space then substring-matched
 * the first catalogue item — because "example product".includes(" ") is TRUE — so all seven lines of a Tamil order
 * resolved to a junk row called "Example product" and took its ₹100 price. The chit showed a confident ₹6,800
 * total that was pure fiction, and nothing flagged it, because as far as the matcher knew every line had matched.
 * It would have done the same for Hindi, Telugu, Kannada, Arabic — every script but ours.
 *
 * ⚠️ \p{M} IS NOT OPTIONAL. Tamil vowel signs (ா ெ ூ …) are Marks, not Letters. Keeping only \p{L}\p{N} would
 * strip them and mangle every Tamil word into a different word — a subtler version of the same bug.
 *
 * ⚠️ AND IT RETURNS '' RATHER THAN ' ' when nothing survives. The old version trimmed BEFORE replacing, so a
 * stripped phrase came back as a single space — truthy, so match()'s `if (!p) unmatched` guard never fired.
 */
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim();

/* Substring matching needs a floor. "a" is inside "banana"; a one- or two-character phrase or catalogue name
   will match something eventually, and the match will look exactly as confident as a real one. */
const MIN_SUBSTR = 3;

/** Levenshtein, capped — cheap early exit, because a length gap of 4 is never a typo. */
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
 * loadCatalogue(entity_id) — the AUTHORITY, read once.
 *
 * An item may declare `synonyms: ["thakkali","tomatto"]`, a `variant` (or `grade`), a `unit`, and `conversions`.
 * Items sharing a name but differing in variant are DIFFERENT items that must never be summed together.
 */
async function loadCatalogue(entity_id) {
  let rows = [];
  try {
    const r = await withEntity(entity_id, (c) => c.query(
      `SELECT item_data FROM catalogue_items WHERE entity_id = $1 AND is_active = true`, [entity_id]));
    rows = r.rows.map((x) => x.item_data || {}).filter((d) => d && d.name);
  } catch (_) { rows = []; }          // no catalogue is not an error — it means nothing gets normalised or priced

  const items = rows.map((d) => ({
    name: String(d.name),
    variant: String(d.variant || d.grade || '').trim(),
    unit: String(d.unit || '').trim(),
    price: d.price,
    unit_size: d.unit_size || null,
    conversions: (d.conversions && typeof d.conversions === 'object') ? d.conversions : {},
    synonyms: Array.isArray(d.synonyms) ? d.synonyms.map(norm).filter(Boolean) : [],
    key: norm(d.name) + '|' + norm(d.variant || d.grade || ''),
  }));

  const variantsOf = {};
  items.forEach((it) => { (variantsOf[norm(it.name)] = variantsOf[norm(it.name)] || new Set()).add(it.variant); });
  return { items, variantsOf };
}

/**
 * match(phrase, comment, cat) — resolve a shop's words.
 *
 * Returns one of:
 *   { item }                                  a clean resolution
 *   { item, variant_unspecified, variants }   the catalogue has variants and the message named none — FLAG, never pick
 *   { ambiguous, matches }                    several items answer to this name — a price would be a coin toss
 *   { unmatched, reason }                     nothing in the catalogue answers to it
 *
 * ⚠️ THE COMMENT IS SEARCHED TOO, and that is deliberate: a shop writes "orange, grade 1 please" and the grade
 * lands in the qualifier rather than the item phrase. Ignoring the comment would flag a variant the sender did
 * actually state.
 */
function match(phrase, comment, cat) {
  const p = norm(phrase);
  if (!p) return { unmatched: true, reason: 'no item phrase' };
  const text = norm(phrase + ' ' + (comment || ''));
  const items = (cat && cat.items) || [];
  const variantsOf = (cat && cat.variantsOf) || {};
  if (!items.length) return { unmatched: true, reason: 'no catalogue' };

  const decideVariant = (base, fallback, extra) => {
    const variants = [...(variantsOf[base] || new Set())].filter(Boolean);
    if (!variants.length) return Object.assign({ item: fallback }, extra);
    const named = items.find((x) => norm(x.name) === base && x.variant && text.includes(norm(x.variant)));
    if (named) return Object.assign({ item: named }, extra);
    /* ⚠️ NEVER AUTO-PICK. Catalogue has grade 1 and grade 2, message says only "orange" — choosing either is
       inventing the order, and it would look completely correct on the chit. */
    return Object.assign({ item: fallback, variant_unspecified: true, variants }, extra);
  };

  // 1 · exact name or declared SYNONYM
  for (const it of items) {
    if (norm(it.name) !== p && !it.synonyms.includes(p)) continue;
    /**
     * ⚠️ A SYNONYM UNIQUE TO ONE VARIANT *IS* NAMING THE VARIANT (found 2026-08-13 seeding a real catalogue).
     *
     * decideVariant asks whether the text contains the variant WORD — but variants are recorded in English
     * (`big`, `small`, `nattu`) while customers name them in their own language (`periya`, `chinna`,
     * `நாட்டு`). So "periya vengayam" — which says BIG about as plainly as it can be said — was coming back
     * as "grade not named" and refusing to price. On a Tamil catalogue that is every variant line.
     *
     * If the phrase matched a synonym carried by exactly ONE item in this name-group, the customer has named
     * that variant and there is nothing left to be uncertain about. A synonym on SEVERAL variants (plain
     * `vengayam`, on both big and small) still flags, which is the case the rule exists for.
     */
    if (it.variant && it.synonyms.includes(p)) {
      const base = norm(it.name);
      const carriers = items.filter((x) => norm(x.name) === base && x.synonyms.includes(p));
      if (carriers.length === 1) return { item: it };
    }
    return decideVariant(norm(it.name), it);
  }
  // 2 · the phrase carries the variant inline: "orange grade 1"
  for (const it of items) {
    if (!it.variant) continue;
    if (p === norm(it.name + ' ' + it.variant) || (p.startsWith(norm(it.name)) && p.includes(norm(it.variant)))) return { item: it };
  }
  // 3 · substring either way — "tomato" vs "fresh tomato". AMBIGUOUS when more than one answers.
  /* ⚠️ BOTH SIDES MUST CLEAR MIN_SUBSTR. Only the exact/synonym pass above may match something shorter, because
     there the whole string had to agree. Here a two-letter phrase against a long catalogue name is not a match,
     it is a coincidence — and it arrives wearing the same confidence as a real one. */
  const near = (p.length < MIN_SUBSTR) ? [] : items.filter((d) => {
    const dn = norm(d.name);
    return dn && dn.length >= MIN_SUBSTR && (dn.includes(p) || p.includes(dn));
  });
  const nearNames = new Set(near.map((d) => norm(d.name)));
  if (nearNames.size === 1) return decideVariant([...nearNames][0], near[0]);
  if (nearNames.size > 1) return { ambiguous: true, matches: nearNames.size };
  // 4 · misspellings, on the item phrase only
  let best = null, bestD = 99;
  for (const it of items) {
    for (const cand of [norm(it.name), ...it.synonyms]) {
      if (!cand) continue;
      const d = lev(p, cand);
      const tol = cand.length <= 4 ? 1 : cand.length <= 7 ? 2 : 3;
      if (d <= tol && d < bestD) { bestD = d; best = it; }
    }
  }
  if (best) return decideVariant(norm(best.name), best, { fuzzy: bestD });

  return { unmatched: true, reason: 'no catalogue match' };
}

module.exports = { loadCatalogue, match, norm, lev };
