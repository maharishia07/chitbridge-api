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

/**
 * keyOf(name, variant) — the identity a pick is sent back as.
 *
 * ⚠️ EXTRACTED BECAUSE THE SECOND COPY GOT IT WRONG (found 2026-08-13 by the shortlist proof). loadCatalogue built
 * this inline and the test fixture rebuilt it from the name alone, so `Tomato·Native` and `Tomato·Hybrid` both
 * keyed to `tomato|`. Two candidates sharing a key is not a cosmetic defect once a person is picking between them:
 * choosing Hybrid would resolve to Native, at Native's price, and the chit would look correctly resolved.
 * One definition, used by the loader and by anything that has to agree with it.
 */
const keyOf = (name, variant) => norm(name) + '|' + norm(variant || '');

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

  /**
   * ⚠️ RETIRED AND REDUNDANT ITEMS ARE NOT LOADED AT ALL — a new reading must not resolve to something you have
   * stopped selling. Old chits are unaffected: a chit carries its OWN copy of every line, so history keeps
   * working while new orders stop landing on a discontinued product.
   *
   * ⭐ UNAVAILABLE ITEMS *ARE* LOADED, deliberately. Out of stock today is not "we have never heard of this": the
   * order must still record what the customer asked for, at the usual price, carrying a flag that it cannot ship.
   * Dropping it here would return "no catalogue match" — indistinguishable from a product nobody sells — and the
   * request would silently lose its item.
   */
  const itemstatus = require('./itemstatus');
  const items = rows.filter((d) => itemstatus.isMatchable(d)).map((d) => ({
    name: String(d.name),
    variant: String(d.variant || d.grade || '').trim(),
    unit: String(d.unit || '').trim(),
    price: d.price,
    unit_size: d.unit_size || null,
    conversions: (d.conversions && typeof d.conversions === 'object') ? d.conversions : {},
    synonyms: Array.isArray(d.synonyms) ? d.synonyms.map(norm).filter(Boolean) : [],
    /* Carried onto every match so a line can say "back on Saturday" without a second lookup.
       ⚠️ `status_text` is COMPUTED; `status_note` is the human sentence someone typed when they set the flag.
       Naming both the same would have overwritten the person's words with a generated one — the same class of
       collision as reading a key that does not exist, just in the other direction. */
    status: itemstatus.statusOf(d),
    status_text: itemstatus.explain(d),
    status_note: d.status_note || null,
    key: keyOf(d.name, d.variant || d.grade),
  }));

  const variantsOf = {};
  items.forEach((it) => { (variantsOf[norm(it.name)] = variantsOf[norm(it.name)] || new Set()).add(it.variant); });
  return { items, variantsOf };
}

/**
 * candidate(it) — one option a person can actually choose between.
 *
 * ⚠️ THE REFUSAL USED TO THROW AWAY ITS OWN EVIDENCE (Athi, 2026-08-13: *"we need provision to pick up the right
 * price from the two or three similar items which are ambiguous"*). `match()` returned `{ambiguous, matches: 2}` —
 * a COUNT. It knew exactly which two items answered to the name, then discarded them, so the screen could only say
 * "matches 2 catalogue lines" and there was nothing for anyone to pick from. Refusing to guess was right; refusing
 * and then destroying the shortlist made the refusal unresolvable.
 *
 * ⚠️ `key` IS WHAT THE PICK IS SENT BACK AS. Sending the price back from the browser would let a stale or edited
 * candidate set the money on the chit; sending the key means the server re-reads the catalogue and stamps it.
 */
const candidate = (it) => ({
  key: it.key, name: it.name, variant: it.variant || '', unit: it.unit || '',
  price: it.price == null ? null : it.price,
  /* Absent means available — the same rule statusOf() applies, so a candidate from any source reads the same. */
  status: it.status || 'available', status_text: it.status_text || null,
});

/**
 * match(phrase, comment, cat) — resolve a shop's words.
 *
 * Returns one of:
 *   { item }                                  a clean resolution
 *   { item, variant_unspecified, variants, candidates }  the catalogue has variants and the message named none —
 *                                             FLAG, never pick; the shortlist travels so a person can
 *   { ambiguous, matches, candidates }        several items answer to this name — a price would be a coin toss,
 *                                             so the shortlist travels and a PERSON picks (see candidate())
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
       inventing the order, and it would look completely correct on the chit.
       `candidates` carries the ACTUAL items so a person can be shown prices and pick; `variants` stays a list of
       names because existing readers (cap-folders, consolidate) print it. */
    return Object.assign({ item: fallback, variant_unspecified: true, variants,
      candidates: items.filter((x) => norm(x.name) === base && x.variant).map(candidate) }, extra);
  };

  // 1 · exact name or declared SYNONYM
  /**
   * ⚠️ FIRST-WINS WAS AN AUTO-PICK IN DISGUISE (found 2026-08-13, adding synonyms to a real catalogue).
   *
   * This loop used to `return` on the first item whose name or synonym matched. Two DIFFERENT products sharing a
   * synonym — `thakkali` on both "Tomato Native" and "Tomato Hybrid", which is exactly how a flat catalogue is
   * written — meant whichever row came back from the database first silently won, and priced the order. That is
   * the same failure the variant rule exists to prevent, one level up: variants were protected, separate NAMES
   * were not.
   *
   * A synonym spanning several names now refuses, like any other ambiguity. Within ONE name it still resolves,
   * because that is a variant question and decideVariant already answers it properly.
   */
  const named = items.filter((it) => norm(it.name) === p || it.synonyms.includes(p));
  const namesHit = new Set(named.map((it) => norm(it.name)));
  if (namesHit.size > 1) return { ambiguous: true, matches: namesHit.size, candidates: named.map(candidate) };
  for (const it of named) {
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
  if (nearNames.size > 1) return { ambiguous: true, matches: nearNames.size, candidates: near.map(candidate) };
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

module.exports = { loadCatalogue, match, norm, lev, candidate, keyOf };
