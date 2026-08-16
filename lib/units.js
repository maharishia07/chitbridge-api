// lib/units.js — UNIT ALIASES. One unit, many spellings; this maps them onto one canonical name.
//
// ⭐ WIRED 2026-08-17 on Athi's approval — lib/consolidate.js folds units through normUnit() at both the
// bucketing and the canonical-comparison step. `0 kg + 8 கிலோ` now totals to 8. This file carries no stage
// marker because a route reaches it: engine-boundary.test.js derives "live" and only demands a marker from
// modules nothing calls.
//
// ⭐ THE PRECEDENT IS THE CATALOGUE'S OWN: a product already knows "thakkali" is a tomato via `synonyms`. A unit
// knew nothing — so `கிலோ` and `kg` were two different units to every totalling path, and six items on the live
// account could not be summed at all. The machinery was right; the vocabulary was missing.
//
// ⚠️⚠️ AN ALIAS IS A RENAME. IT IS NEVER A CONVERSION. This is the whole safety property of this file:
//   `கிலோ → kg`    RENAME.      Same quantity, same unit, different script. Always safe, no number changes.
//   `crate → kg`   CONVERSION.  Entity-specific, and 20kg for one supplier is 25kg for another.
// Putting both in one table would quietly re-enable exactly what lib/consolidate.js was written to prevent —
// inventing a factor and producing a total that looks completely normal and is wrong. A conversion stays
// REFUSED unless the entity has declared it on the item. Nothing here may ever change a NUMBER.
//
// ⚠️ THE ALIASES ARE OBSERVED, NOT INVENTED. Every entry below was seen on live WhatsApp captures (the intake
// connector receives the Tamil terms as typed). Do not grow this from a dictionary — grow it from what actually
// arrives, or it becomes a list of guesses about what people might write.

// canonical → the spellings that mean it. Keys must exist in the catalogue's UNITS list.
const ALIASES = {
  kg:     ['கிலோ', 'கிலோகிராம்', 'kilo', 'kilos', 'kilogram', 'kilograms', 'kgs', 'kilogramme'],
  gram:   ['கிராம்', 'grams', 'gm', 'gms', 'gramme'],
  litre:  ['லிட்டர்', 'liter', 'liters', 'litres', 'ltr', 'ltrs'],
  ml:     ['மில்லி', 'millilitre', 'millilitres', 'milliliter', 'mls'],
  piece:  ['பீஸ்', 'pieces', 'pcs', 'pc', 'nos', 'no'],
  bunch:  ['கட்டு', 'kattu', 'bunches'],
  pack:   ['பேக்', 'packet', 'packets', 'pkt', 'pkts', 'packs'],
  box:    ['பாக்ஸ்', 'boxes', 'carton', 'cartons'],
  dozen:  ['டஜன்', 'dozens', 'dzn'],
  tonne:  ['டன்', 'ton', 'tons', 'tonnes', 'mt'],
  metre:  ['மீட்டர்', 'meter', 'meters', 'metres', 'mtr'],
  count:  ['எண்ணிக்கை', 'counts'],
  unit:   ['யூனிட்', 'units'],
};

/* ⚠️ Folded the SAME WAY the lookup folds, so the table cannot disagree with itself: an entry written with a
   stray capital or a trailing space would otherwise never match and would look present while being dead. */
const fold = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim();

const LOOKUP = new Map();
for (const canon of Object.keys(ALIASES)) {
  LOOKUP.set(fold(canon), canon);                       // a canonical name maps to itself
  for (const a of ALIASES[canon]) LOOKUP.set(fold(a), canon);
}

/**
 * Fold a written unit onto its canonical name. Unknown units are returned folded but OTHERWISE UNTOUCHED.
 * ⚠️ AN UNKNOWN UNIT MUST SURVIVE, not vanish or become a default. If someone writes a unit we have never seen,
 * the honest outcome is that it stays itself and the totalling path flags it as un-summable — which is the
 * existing, correct behaviour. Mapping it to a guess would be the money error this whole file exists to avoid.
 */
function normUnit(u) {
  const f = fold(u);
  return LOOKUP.get(f) || f;
}

/** True when two written units are the same unit. Convenience for call sites that only need the comparison. */
function sameUnit(a, b) { return normUnit(a) === normUnit(b); }

/** Every spelling we recognise for a canonical unit — for showing the alias list in Catalogue setup. */
function aliasesOf(canon) { return (ALIASES[canon] || []).slice(); }

module.exports = { normUnit, sameUnit, aliasesOf, ALIASES };
