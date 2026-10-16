// lib/line-guard.js — the ONE quantity + negation guard over an AI reading of someone's words (T1-AI, 2026-10-14).
//
// ⚠️ WHY A FILE AND NOT A FUNCTION IN numerals.js: numerals.js is ADOPTED from chitbridge-engines (DO NOT EDIT there).
// This file only CALLS it. The raise (lib/capture.js) had this check inline; compose "fill line items" (lib/ai.js) is the
// second caller, so it was lifted here once and both point at it.
//
// ⚠️ IT NEVER SUBSTITUTES, AND IT NEVER DROPS A LINE. A rejected quantity becomes null + a reason; a line the words seem
// to refuse ("vengayam venam") is FLAGGED, not removed — a person decides. Same rule as verifyQuantity itself.
const numerals = require('./numerals');

/**
 * checkLine(line, msgNums) → { qty, missing?, rejected?, unverified?, refused?, unclear? }
 *   line     an AI-read line: { qty, raw_phrase? }
 *   msgNums  the numerals in the WHOLE message (numerals.numeralsIn(text).map(v => v.value)), for the weak check
 * STRONG (raw_phrase present): the phrase's own numerals decide; disagreement → qty null.
 * WEAK (no phrase): a number found nowhere in the message is flagged, kept.
 */
function checkLine(line, msgNums) {
  const l = line || {};
  const phrase = String(l.raw_phrase || '').trim().slice(0, 400);
  /* ⚠️ A QUANTITY THE READER LEFT OUT IS UNKNOWN, NOT 1 (PRICE-FIX F6): "pathu kilo thakkali" billed as 1 kg with no flag. */
  let qty = l.qty == null ? null : Number(l.qty) || 0;
  const out = {};
  if (l.qty == null) out.missing = true;
  if (phrase && l.qty != null) {
    const v = numerals.verifyQuantity(phrase, qty);
    if (v.ok === false) {
      out.rejected = { phrase, extracted: qty, reason: v.reason,
        ...(v.expected != null ? { phrase_says: v.expected } : {}), ...(v.among ? { phrase_has: v.among } : {}) };
      qty = null;                                   // ⚠️ rejected, NOT corrected
    }
  } else {
    /* a missing quantity is already `missing` above — there is no number to verify */
    out.unverified = (l.qty != null) && (msgNums || []).length > 0 && !msgNums.includes(qty);
  }
  if (phrase) {
    const n = numerals.negationIn(phrase);
    if (n.negated === true) out.refused = { phrase, words: n.tokens };
    else if (n.ambiguous) out.unclear = { phrase, words: n.tokens, reason: n.reason };
  }
  out.qty = qty;
  return out;
}

/**
 * checkRate(line, msgNums) → { unverified } — a rate/price the model read must appear in the words (the line's own phrase or the
 * whole message), the same numeral test the quantity gets. It is FLAGGED, never replaced: a person decides (PRICE-FIX F6).
 */
function checkRate(line, msgNums) {
  const l = line || {};
  const rate = Number(l.rate != null ? l.rate : l.price) || 0;
  if (!(rate > 0)) return { unverified: false };
  const own = numerals.numeralsIn(String(l.raw_phrase || '')).map((n) => n.value);
  return { unverified: !(msgNums || []).concat(own).includes(rate) };
}

/**
 * guessFlags(guard, rateIsGuess) → the row flags for a number nobody wrote (PRICE-FIX F6): a weak-checked quantity, a quantity the reading
 * left out (null, it used to be 1), a model rate the words never carried. Flagged, kept — a person decides.
 */
function guessFlags(guard, rateIsGuess) {
  return Object.assign({},
    guard.unverified ? { qty_unverified: true, needs_human: true } : {},
    guard.missing ? { qty_missing: true, needs_human: true } : {},
    rateIsGuess ? { rate_unverified: true, needs_human: true } : {});
}

/**
 * guardLines(lines, text) → { line_items, quantity_check } — for a caller that has no line loop of its own (compose fill).
 * Each line keeps every field it came with; a flagged line gains needs_human + the reason. `quantity_check.code` is what a
 * screen branches on ('QTY_OK' · 'QTY_NEEDS_CHECK'), never the sentences.
 */
function guardLines(lines, text) {
  const msgNums = numerals.numeralsIn(String(text || '')).map((n) => n.value);
  const check = { code: 'QTY_OK', needs_human: 0, quantity_rejected: [], quantity_unverified: [], quantity_missing: [], refused: [], unclear: [] };
  const line_items = (Array.isArray(lines) ? lines : []).map((l) => {
    const g = checkLine(l, msgNums);
    const name = String((l && (l.particulars || l.description)) || 'item').slice(0, 200);
    const flag = {};
    if (g.missing) { flag.qty = null; flag.qty_missing = true; check.quantity_missing.push({ name }); }
    if (g.rejected) { flag.qty = null; flag.qty_rejected = g.rejected.reason; if (g.rejected.phrase_says != null) flag.phrase_says = g.rejected.phrase_says; check.quantity_rejected.push({ name, ...g.rejected }); }
    if (g.unverified) { flag.qty_unverified = true; check.quantity_unverified.push({ name, extracted: g.qty, message_has: msgNums }); }
    if (g.refused) { flag.refused = true; check.refused.push({ name, ...g.refused }); }
    if (g.unclear) { flag.negation_unclear = g.unclear.reason; check.unclear.push({ name, ...g.unclear }); }
    if (Object.keys(flag).length) { flag.needs_human = true; check.needs_human++; }
    return Object.assign({}, l, flag);
  });
  if (check.needs_human) check.code = 'QTY_NEEDS_CHECK';
  return { line_items, quantity_check: check };
}

module.exports = { checkLine, checkRate, guessFlags, guardLines };
