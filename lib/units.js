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
/**
 * The languages a spelling can be written in — the full OFFERABLE list, not just the ones we already hold
 * spellings for. An entity picks two or three (English plus its own), and the units screen shows those.
 *
 * ⚠️ A LANGUAGE WITH NO SPELLINGS YET IS NORMAL, NOT BROKEN. `ALIASES` grows from what actually arrives on
 * captures, so Malayalam can be selected today and simply have nothing listed until a Malayalam message brings a
 * word in. Offering only the languages we already have would be circular — nobody could ever select the one
 * they need first.
 * ⚠️ ISO 639-1 codes, so this list can meet any other language-aware thing without a translation table.
 */
const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'ta', label: 'தமிழ் · Tamil' },
  { code: 'hi', label: 'हिन्दी · Hindi' },
  { code: 'ml', label: 'മലയാളം · Malayalam' },
  { code: 'te', label: 'తెలుగు · Telugu' },
  { code: 'kn', label: 'ಕನ್ನಡ · Kannada' },
  { code: 'mr', label: 'मराठी · Marathi' },
  { code: 'gu', label: 'ગુજરાતી · Gujarati' },
  { code: 'bn', label: 'বাংলা · Bengali' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ · Punjabi' },
  { code: 'or', label: 'ଓଡ଼ିଆ · Odia' },
  { code: 'ur', label: 'اردو · Urdu' },
];

/**
 * canonical → language → the spellings that mean it.
 *
 * ⚠️⚠️ THE LANGUAGE TAG IS FOR READING, NEVER FOR MATCHING. `normUnit` folds across EVERY language at once, and
 * must keep doing so: a Tamil message has to resolve whether or not anyone has ever looked at the Tamil list,
 * and a UI that filters the DISPLAY by language must never narrow what the system ACCEPTS. If those two ever
 * became the same switch, setting the screen to Hindi would silently stop `கிலோ` folding — a message would
 * arrive, look fine, and quietly fail to total.
 *
 * ⚠️ STILL OBSERVED, NOT INVENTED for the languages already in production use. The Hindi set was added on
 * request (Athi, 2026-08-17) and is limited to words that map EXACTLY: `पेटी` (peti) is deliberately absent
 * because it commonly means a CRATE rather than a box, and a crate holds a different quantity — folding it onto
 * `box` would be inventing a conversion rather than recording a rename.
 */
const ALIASES = {
  kg:     { ta: ['கிலோ', 'கிலோகிராம்'], hi: ['किलो', 'किलोग्राम'], en: ['kilo', 'kilos', 'kilogram', 'kilograms', 'kgs', 'kilogramme'] },
  gram:   { ta: ['கிராம்'],              hi: ['ग्राम'],              en: ['grams', 'gm', 'gms', 'gramme'] },
  litre:  { ta: ['லிட்டர்'],             hi: ['लीटर'],               en: ['liter', 'liters', 'litres', 'ltr', 'ltrs'] },
  ml:     { ta: ['மில்லி'],              hi: ['मिलीलीटर'],           en: ['millilitre', 'millilitres', 'milliliter', 'mls'] },
  piece:  { ta: ['பீஸ்'],                hi: ['पीस', 'नग'],          en: ['pieces', 'pcs', 'pc', 'nos', 'no'] },
  bunch:  { ta: ['கட்டு', 'kattu'],      hi: ['गड्डी', 'गुच्छा'],     en: ['bunches'] },
  pack:   { ta: ['பேக்'],                hi: ['पैकेट'],              en: ['packet', 'packets', 'pkt', 'pkts', 'packs'] },
  box:    { ta: ['பாக்ஸ்'],              hi: ['डिब्बा', 'बॉक्स'],     en: ['boxes', 'carton', 'cartons'] },
  dozen:  { ta: ['டஜன்'],                hi: ['दर्जन'],              en: ['dozens', 'dzn'] },
  tonne:  { ta: ['டன்'],                 hi: ['टन'],                 en: ['ton', 'tons', 'tonnes', 'mt'] },
  metre:  { ta: ['மீட்டர்'],             hi: ['मीटर'],               en: ['meter', 'meters', 'metres', 'mtr'] },
  count:  { ta: ['எண்ணிக்கை'],           hi: [],                     en: ['counts'] },
  unit:   { ta: ['யூனிட்'],              hi: ['यूनिट'],              en: ['units'] },
};

/* ⚠️ Folded the SAME WAY the lookup folds, so the table cannot disagree with itself: an entry written with a
   stray capital or a trailing space would otherwise never match and would look present while being dead. */
const fold = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim();

/* ⚠️ EVERY LANGUAGE, FLATTENED INTO ONE LOOKUP. The tags exist so a screen can show one language at a time;
   matching ignores them entirely, so what the system accepts never depends on what anyone is looking at. */
const LOOKUP = new Map();
for (const canon of Object.keys(ALIASES)) {
  LOOKUP.set(fold(canon), canon);                       // a canonical name maps to itself
  for (const lang of Object.keys(ALIASES[canon])) {
    for (const a of ALIASES[canon][lang]) LOOKUP.set(fold(a), canon);
  }
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
/**
 * Every spelling of a unit, across all languages — the flat list callers had before the language tags existed,
 * so nothing that only wants "what else means kg" has to know the shape changed.
 */
function aliasesOf(canon) {
  const by = ALIASES[canon] || {};
  return Object.keys(by).reduce((a, lang) => a.concat(by[lang]), []);
}
/** The spellings in ONE language — for a screen that shows a language at a time. Never used for matching. */
function aliasesIn(canon, lang) { return ((ALIASES[canon] || {})[lang] || []).slice(); }

module.exports = { normUnit, sameUnit, aliasesOf, aliasesIn, ALIASES, LANGS };
