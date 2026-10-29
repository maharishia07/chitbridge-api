// @stage tested
// @stage-note ONE canonical serialisation, so two things that are the same hash the same. Pure: no DB, no
// network, no state. Byte-identical to the three hand-rolled copies it replaces — proven, not asserted.
// OWNS      the one canonical form (canon), its sha256 (hash), and a field-listed seal (seal / verify).
// CALLED BY lib/ctpenvelope.js · lib/ctpquery.js · routes/connectors.js · middleware/idempotency.js (seal / verify: none yet, RAIL-131).
// FLOW      value ──▶ canon (keys sorted, depth ≤ 256) ──▶ hash · seal(fields, obj) ──▶ {v, fields, hash} ──▶ verify(sealed, obj, requiredFields?)
// CARD      05-ctp-and-cross-installation/seal-rail
'use strict';
/**
 * lib/canon.js — the same value, always the same bytes.
 *
 * ── ⭐⭐⭐ WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-12: *"let us do the seal, start with the canonical serialisation."*
 *
 * A seal answers one question: **is this copy byte-identical to what was sent?** Everything else in a hashing
 * scheme is arithmetic; the hard part is deciding what "the same" MEANS. `{a:1,b:2}` and `{b:2,a:1}` are the
 * same value and different strings, and a hash cannot tell you that — so a canonical form has to, first.
 *
 * ⭐ THIS IS NOT NEW WORK. The platform already had THREE copies of this function before the seal was asked
 * for, which is the clearest possible sign it should have been one:
 *
 *     routes/connectors.js     stableStringify — hashes a connector receipt payload
 *     middleware/idempotency.js  stable        — builds the idempotency key for a replayed mutation
 *     tests/canon-depth.test.js  a third copy, written to guard the other two
 *
 * Each carried its own `CANON_MAX_DEPTH = 256`. Writing a fourth for the seal would have been the moment this
 * stopped being a convention and became folklore.
 *
 * ── ⚠️⚠️ BYTE-IDENTICAL IS A HARD REQUIREMENT, NOT A NICETY ─────────────────────────────────────────────────
 *
 * Both callers are LIVE and both persist their output. An idempotency key that changes shape stops matching
 * the replay it was meant to catch — so the same mutation executes twice. A connector receipt hash that
 * changes stops matching the receipt already written on the other side of the wire.
 *
 * ⭐ So this reproduces their output exactly, and tests/canon.test.js proves it against both originals over a
 * corpus rather than trusting that it looks the same. A characterisation, and it says so.
 *
 * ── WHAT CANONICAL MEANS HERE ──────────────────────────────────────────────────────────────────────────────
 *
 *   · object keys sorted, so insertion order cannot change the bytes
 *   · arrays keep their order — ⚠️ an array IS ordered; sorting one would make two different values identical
 *   · JSON.stringify for every leaf, so escaping and number formatting are the platform's, not mine
 *   · depth bounded at 256 — a hostile or accidental deep nest must not overflow the stack
 *
 * ⚠️ WHAT IT DELIBERATELY DOES NOT DO. It does not drop undefined keys differently from JSON.stringify, does
 * not normalise numbers (1.0 and 1 are already one value in JS), and does not touch strings. Each of those
 * would be a JUDGEMENT about equality, and every judgement is a place two implementations can disagree later.
 */

const crypto = require('crypto');

/** ⚠️ bound recursion: a deeply-nested (possibly hostile) value must not overflow the stack */
const MAX_DEPTH = 256;

/**
 * The canonical string for a value.
 * @throws if nesting exceeds MAX_DEPTH — the caller decides whether that is a 400 or a self-heal.
 */
function canon(list, depth = 0) {
  if (depth > MAX_DEPTH) throw new Error('nesting exceeds ' + MAX_DEPTH + ' levels');
  if (list === null || typeof list !== 'object') return JSON.stringify(list);
  if (Array.isArray(list)) return '[' + list.map((x) => canon(x, depth + 1)).join(',') + ']';
  return (
    '{' +
    Object.keys(list)
      .sort()
      .map((item) => JSON.stringify(item) + ':' + canon(list[item], depth + 1))
      .join(',') +
    '}'
  );
}

/* RAIL-141 (e): a Map or Set has no JSON form — JSON.stringify writes {} — so two of them would hash the same */
function noMapOrSet(key, value) {
  if (value instanceof Map || value instanceof Set) throw new TypeError('a Map or Set cannot be hashed — convert it to an object or array first');
  return value;
}

/**
 * The value as JSON would carry it: a Date becomes its ISO text, NaN null, -0 0, undefined in an object is dropped
 * and in an array null. RAIL-141 (e): canon() alone is right only for JSON-native values (two Dates were {} and
 * one hash), and the envelope and question did this round trip themselves; now hash and seal do it for everyone.
 * ⚠️ canon() itself is NOT changed: idempotency keys and connector receipts persist its bytes as they are.
 */
function asJson(value) {
  const text = JSON.stringify(value === undefined ? null : value, noMapOrSet);
  return JSON.parse(text);
}

/** sha256 of the canonical string of the value as JSON carries it, hex. */
function hash(v) {
  return crypto.createHash('sha256').update(canon(asJson(v))).digest('hex');
}

/**
 * ⭐⭐ A SEAL IS A HASH THAT SAYS WHAT IT COVERED.
 *
 * A bare hex string is unauditable: two copies disagree and nobody can tell whether they disagree about the
 * CONTENT or about which fields were hashed. So a seal carries its version and the exact field list, and the
 * verifier re-reads that list rather than assuming today's.
 *
 * ⚠️ THE FIELD LIST IS PART OF THE SEALED VALUE. Without that, adding a field later would silently change what
 * an old seal meant; with it, an old seal stays verifiable under the rules it was made with.
 */
function seal(fields, obj, version = 1) {
  const names = fields.slice().sort();
  /* RAIL-141 (f): no prototype, so a field named __proto__ is a field like any other (it set the prototype and
     dropped out of the hash). A missing field and a null one seal the same — decided, pinned in tests/canon. */
  const picked = Object.create(null);
  names.forEach((item) => {
    picked[item] = obj[item] === undefined ? null : obj[item];
  });
  return {
    v: version,
    fields: names,
    hash: hash({ v: version, fields: names, data: picked })
  };
}

/**
 * Re-seal a value under a seal's OWN declared rules and compare.
 * ⭐ Returns WHY, not just false: a verifier that only says "no" cannot tell a tampered copy from one sealed
 * by an older version of the rules, and those need completely different responses.
 */
function verify(sealed, obj, requiredFields) {
  const refusal = coverRefusal(sealed, obj, requiredFields);
  if (refusal) return refusal;
  const again = seal(sealed.fields, obj, sealed.v || 1);
  if (again.hash === sealed.hash) return { ok: true, why: 'matches the seal it was sent with' };

  /**
   * ⚠️⚠️ A HASH CANNOT TELL YOU WHICH FIELD CHANGED, AND I NEARLY SHIPPED ONE THAT PRETENDED TO. My first
   * version returned a `differs` list built by comparing each field to ITSELF — always empty, always present,
   * and it would have read in a dispute as "nothing differs" on a copy that failed to verify.
   *
   * ⭐ WHAT IT HONESTLY RETURNS is the field list the seal covered, so a person can diff the two copies
   * themselves. Naming which field moved needs BOTH copies, which is a comparison between parties, not
   * something one side can compute alone. That is a real limitation of a seal and it belongs in the answer.
   */
  return {
    ok: false,
    why: 'content does not match the seal',
    covered: sealed.fields,
    note: 'a seal proves THAT this copy differs, never WHICH field — that needs both copies side by side'
  };
}

/**
 * RAIL-141 (f): what verify refuses before it hashes. The seal names its own field list, so on its own it can
 * be made to cover nothing: seal([], x) verified ANY object. A caller that knows which fields must be sealed
 * passes them as requiredFields, and a seal that leaves one out is refused. No copy is a reason, not a TypeError.
 */
function coverRefusal(sealed, obj, requiredFields) {
  if (!sealed || typeof sealed !== 'object') return { ok: false, why: 'no seal on this copy' };
  if (!Array.isArray(sealed.fields)) return { ok: false, why: 'the seal does not say what it covered' };
  if (!sealed.fields.length) return { ok: false, why: 'the seal covers no fields' };
  if (!obj || typeof obj !== 'object') return { ok: false, why: 'no copy to check against the seal' };
  const uncovered = (requiredFields || []).filter((name) => !sealed.fields.includes(name));
  if (uncovered.length) return { ok: false, why: 'the seal does not cover every field it must', uncovered };
  return null;
}

module.exports = { canon, hash, seal, verify, MAX_DEPTH };
