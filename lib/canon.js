// @stage tested
// @stage-note ONE canonical serialisation, so two things that are the same hash the same. Pure: no DB, no
// network, no state. Byte-identical to the three hand-rolled copies it replaces — proven, not asserted.
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
function canon(v, depth = 0) {
  if (depth > MAX_DEPTH) throw new Error('nesting exceeds ' + MAX_DEPTH + ' levels');
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map((x) => canon(x, depth + 1)).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k], depth + 1)).join(',') + '}';
}

/** sha256 of the canonical string, hex. */
function hash(v) {
  return crypto.createHash('sha256').update(canon(v)).digest('hex');
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
  const picked = {};
  names.forEach((k) => { picked[k] = obj[k] === undefined ? null : obj[k]; });
  return {
    v: version,
    fields: names,
    hash: hash({ v: version, fields: names, data: picked }),
  };
}

/**
 * Re-seal a value under a seal's OWN declared rules and compare.
 * ⭐ Returns WHY, not just false: a verifier that only says "no" cannot tell a tampered copy from one sealed
 * by an older version of the rules, and those need completely different responses.
 */
function verify(sealed, obj) {
  if (!sealed || typeof sealed !== 'object') return { ok: false, why: 'no seal on this copy' };
  if (!Array.isArray(sealed.fields)) return { ok: false, why: 'the seal does not say what it covered' };
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
    note: 'a seal proves THAT this copy differs, never WHICH field — that needs both copies side by side',
  };
}

module.exports = { canon, hash, seal, verify, MAX_DEPTH };
