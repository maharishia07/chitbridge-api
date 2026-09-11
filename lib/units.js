/**
 * lib/units.js — ONE UNIT, THREE NAMES: ours (kg · litre · bag …), the UN/ECE Recommendation 20 code the world uses
 * (KGM · LTR · BG …, what GS1, Peppol and INV-01 carry), and India's GST Unit Quantity Code (KGS · LTR · BAG …, what a tax
 * invoice and the GSTR must print). Athi, 2026-09-05, on Tally's UQC list: "do we need to map to ourselves?" — yes, and by
 * the CODE, so a unit spelt "bag" here, "BAG" in Tally and "BG" on a Peppol invoice is one unit.
 *
 * Vendored verbatim to the web (app/catalogue-model.js reads the same table) and used by the connector (a Tally BASEUNITS
 * symbol or UQC → our unit). Pure. Adopted lists, not invented: UN/ECE Rec 20 · CBIC's UQC master.
 */
'use strict';
const UNITS = {
  kg:     { rec20: 'KGM', uqc: 'KGS', names: ['kg', 'kgs', 'kilogram', 'kilograms', 'kilo', 'kilos', 'kilogramme', 'கிலோ', 'கிலோகிராம்', 'किलो', 'किलोग्राम'] },
  gram:   { rec20: 'GRM', uqc: 'GMS', names: ['gram', 'grams', 'gm', 'gms', 'gramme', 'கிராம்', 'ग्राम'] },
  tonne:  { rec20: 'TNE', uqc: 'MTS', names: ['tonne', 'tonnes', 'ton', 'tons', 'mt', 'metric ton', 'டன்', 'टन'] },
  litre:  { rec20: 'LTR', uqc: 'LTR', names: ['litre', 'litres', 'liter', 'liters', 'ltr', 'ltrs', 'l', 'லிட்டர்', 'लीटर'] },
  ml:     { rec20: 'MLT', uqc: 'MLT', names: ['ml', 'millilitre', 'millilitres', 'milliliter', 'mls', 'மில்லி', 'मिलीलीटर'] },
  piece:  { rec20: 'H87', uqc: 'PCS', names: ['piece', 'pieces', 'pcs', 'pc', 'பீஸ்', 'पीस', 'नग'] },
  count:  { rec20: 'H87', uqc: 'NOS', names: ['count', 'counts', 'nos', 'no', 'number', 'numbers', 'each', 'ea', 'எண்ணிக்கை'] },
  unit:   { rec20: 'C62', uqc: 'UNT', names: ['unit', 'units', 'unt', 'யூனிட்', 'यूनिट'] },
  pack:   { rec20: 'PK',  uqc: 'PAC', names: ['pack', 'packs', 'pac', 'packet', 'packets', 'pkt', 'பேக்', 'पैकेट', 'pkts'] },
  box:    { rec20: 'BX',  uqc: 'BOX', names: ['box', 'boxes', 'பாக்ஸ்', 'डिब्बा', 'बॉक्स'] },
  dozen:  { rec20: 'DZN', uqc: 'DOZ', names: ['dozen', 'dozens', 'doz', 'டஜன்', 'दर्जन', 'dzn'] },
  barrel: { rec20: 'BLL', uqc: 'DRM', names: ['barrel', 'barrels', 'drum', 'drums', 'drm'] },
  metre:  { rec20: 'MTR', uqc: 'MTR', names: ['metre', 'metres', 'meter', 'meters', 'mtr', 'm', 'மீட்டர்', 'मीटर'] },
  sqft:   { rec20: 'FTK', uqc: 'SQF', names: ['sqft', 'sq ft', 'square foot', 'square feet', 'sqf'] },
  roll:   { rec20: 'RO',  uqc: 'ROL', names: ['roll', 'rolls', 'rol'] },
  bag:    { rec20: 'BG',  uqc: 'BAG', names: ['bag', 'bags'] },
  carton: { rec20: 'CT',  uqc: 'CTN', names: ['carton', 'cartons', 'ctn'] },
  bottle: { rec20: 'BO',  uqc: 'BTL', names: ['bottle', 'bottles', 'btl'] },
  pair:   { rec20: 'PR',  uqc: 'PRS', names: ['pair', 'pairs', 'prs'] },
  set:    { rec20: 'SET', uqc: 'SET', names: ['set', 'sets'] },
  sqm:    { rec20: 'MTK', uqc: 'SQM', names: ['sqm', 'square metre', 'square meter', 'sq m'] },
  quintal:{ rec20: 'DTN', uqc: 'QTL', names: ['quintal', 'quintals', 'qtl'] },
  /**
   * ⚠️⚠️ `bunch` WAS DROPPED ENTIRELY by the 2026-09-05 rewrite and is restored here. It is not an exotic unit:
   * கட்டு is how greens are sold in every vegetable shop this product is aimed at, and without it a captured
   * "2 கட்டு கீரை" has no unit at all.
   * ⚠️ THE TWO CODES ARE MINE AND NOT YET VERIFIED — Rec 20 'BH' (bunch) and UQC 'BUN' (BUNCHES). They print on
   * a tax invoice, so they want checking against the CBIC UQC master before anyone files a return with one.
   * Every other row in this table came from an adopted list; this row is the only one that did not.
   */
  bunch:  { rec20: 'BH',  uqc: 'BUN', names: ['bunch', 'bunches', 'கட்டு', 'kattu', 'गड्डी', 'गुच्छा'] },
};
const INDEX = (() => { const m = new Map(); for (const [k, u] of Object.entries(UNITS)) { m.set(k, k); m.set(u.rec20.toLowerCase(), k); m.set(u.uqc.toLowerCase(), k); for (const n of u.names) m.set(n.toLowerCase(), k); } return m; })();
/** ours for any spelling, UQC or Rec 20 — null when unknown (never guess a unit) */
/**
 * ⭐ ours for any spelling, UQC or Rec 20 — null when unknown (never guess a unit)
 *
 * ⚠️⚠️ THE SECOND FALLBACK USED TO STRIP EVERY NON-LATIN CHARACTER, which silently deleted the whole of a
 * Tamil or Hindi spelling and then looked it up as an empty string. Restoring the language names without
 * this would have put them in the table and left them unreachable — present, and dead.
 */
function unitOf(any) {
  const k = String(any == null ? '' : any).trim().toLowerCase().replace(/\.$/, '');
  if (!k) return null;
  /* \p{L}\p{N}\p{M} keeps letters, digits and combining marks in EVERY script; only punctuation goes */
  const loose = k.replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim();
  return INDEX.get(k) || INDEX.get(loose) || null;
}
function uqcOf(unit) { const u = UNITS[unitOf(unit) || '']; return u ? u.uqc : null; }
function rec20Of(unit) { const u = UNITS[unitOf(unit) || '']; return u ? u.rec20 : null; }
/**
 * ── ⚠️⚠️ normUnit IS BACK, AND THE STORY IS THE ARGUMENT FOR THIS WHOLE TEST BOARD ──────────────────────────
 *
 * On 2026-08-17 this file gained `normUnit()` and a multilingual alias table, on Athi's approval, because
 * `கிலோ` and `kg` were two different units to every totalling path and SIX ITEMS ON THE LIVE SHOP were wrong.
 * Its own header recorded the fix: *"0 kg + 8 கிலோ now totals to 8."*
 *
 * On 2026-09-05 the file was rewritten around UN/ECE Rec 20 and GST UQC codes — a good change — and the
 * language table and `normUnit` went with it. Nothing was updated: `lib/consolidate.js` still calls
 * `uom.normUnit()` at three places, so wholesaler consolidation has been throwing a TypeError ever since, on
 * a path `routes/capture.js` reaches from every WhatsApp message.
 *
 * ⚠️ AND THE TEST THAT WOULD HAVE CAUGHT IT WAS BROKEN BY THE SAME COMMIT. `units-alias.test.js` and
 * `consolidate-units.test.js` both went red that day and stayed red among twenty-six other reds, where a
 * genuine regression is indistinguishable from stale tooling until somebody reads all of them.
 *
 * ⭐ `normUnit` is kept as the exported name because three live call sites and a comment use it, and because
 * it says what it does: FOLD a spelling onto the canonical unit. `unitOf` is the same function.
 */
/**
 * ⚠️⚠️ normUnit IS NOT unitOf, AND ALIASING THEM WOULD HAVE SHIPPED A WORSE BUG THAN THE ONE BEING FIXED.
 *
 * `unitOf` answers "which of our units is this?" and returns NULL when it does not know. `normUnit` answers
 * "fold this spelling onto its canonical form" and, when it does not know the word, RETURNS THE WORD.
 *
 * ⭐ That difference is the whole of the bucketing behaviour in `lib/consolidate.js`. With null, every unknown
 * unit in an order collapses into ONE bucket — two gunny bags and three petti would total together as a single
 * quantity of nothing. Surviving unchanged keeps them apart, which is the documented rule: *"an unknown unit
 * SURVIVES — it is never mapped to a guess or dropped."*
 *
 * ⚠️ WHAT IS STILL MISSING, SAID PLAINLY: the old `normUnit(word, entityMap)` took a second argument — a
 * per-entity taught vocabulary, so a shop could teach the system its own word for a unit without redefining
 * anybody else's. That feature went with the rewrite and is NOT restored here, because bringing back a
 * governance feature is Athi's call, not a regression fix. `tests/units-alias.test.js` still fails on those
 * cases and should, until it is decided.
 */
function normUnit(any) {
  const raw = String(any == null ? '' : any).trim();
  if (!raw) return raw;
  return unitOf(raw) || raw;
}

/**
 * ── ⭐ TWO HELPERS THE TESTS ALREADY DECLARED AND THE MODULE NEVER EXPORTED ──────────────────────────────────
 *
 * tests/units-alias.test.js opens with destructuring normUnit, sameUnit and aliasesOf off this module, so
 * eight of its twelve checks died on "sameUnit is not a function" before asserting anything. The suite was not
 * reporting a unit bug; it was reporting its own missing import, which is the least useful red there is.
 *
 * ⚠️ BOTH ARE DERIVED, AND THAT IS THE WHOLE POINT. sameUnit is normUnit applied twice; aliasesOf reads the
 * table that is already exported. Neither decides anything, so neither can change what a quantity MEANS — the
 * one risk this file's header is written around. This is exporting what the module already knows.
 *
 * ⚠️⚠️ WHAT IS STILL NOT RESTORED, deliberately: the per-entity taught vocabulary, `normUnit(word, entityMap)`.
 * Four checks in that suite still fail on it and SHOULD. The header above calls it Athi's decision rather than
 * a regression fix, and quietly reinstating a governance feature to turn a red green would be the worst reason
 * to ship one.
 */

/** two spellings of one unit — never a conversion, only a rename */
function sameUnit(a, b) {
  const x = normUnit(a), y = normUnit(b);
  return !!x && x === y;
}

/**
 * ⭐ THE SAME TABLE READ THE OTHER WAY UP: canonical name → its spellings. The rewrite folded the spellings
 * INTO each UNITS entry, which is the better shape, but four checks in units-alias.test.js still open with
 * destructuring ALIASES off this module and then `Object.keys(ALIASES)` — so they died on undefined
 * before reaching a single assertion about units.
 *
 * ⚠️ DERIVED, NEVER MAINTAINED SEPARATELY. A second hand-kept alias table is exactly how a rename becomes a
 * conversion: two lists, one edited, and every total downstream stays plausible and wrong. This is a view of
 * UNITS computed once at load, so it cannot disagree with it.
 */
const ALIASES = Object.keys(UNITS).reduce((m, k) => { m[k] = UNITS[k].names.slice(); return m; }, {});

/** every spelling this platform accepts for a canonical unit, in the order the table declares them */
function aliasesOf(canon) {
  const k = unitOf(canon);
  return k && UNITS[k] ? UNITS[k].names.slice() : [];
}

module.exports = { UNITS, ALIASES, unitOf, normUnit, sameUnit, aliasesOf, uqcOf, rec20Of };
