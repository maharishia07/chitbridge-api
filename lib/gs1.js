// @stage tested
// @stage-note Closes a gap CBCatalogue.STANDARDS itself declared — GTIN was an upsert key with no check-digit validation. 21 assertions. No caller yet: wiring it to the catalogue write path is a behaviour change and belongs after Saturday, not before.
'use strict';
/**
 * gs1.js — GS1 identification keys, actually checked.
 *
 * `CBCatalogue.STANDARDS` claims GS1 GTIN/SKU is "in code", and it is — as an upsert key. But the same entry admits,
 * honestly, *"SKU/GTIN taken as-is — no check-digit validation yet."* So a typo'd GTIN was accepted, stored, and
 * became the stable key that a re-import matched on. This closes that gap: the claim and the code now agree.
 *
 * ── ZERO DEPENDENCIES · TIER A ─────────────────────────────────────────────────────────────────────────────────
 * Deliberately importable on its own, like order-input / form-handshake / money. See ENGINE-CORE.md.
 *
 * ── WHAT THIS IS NOT ──────────────────────────────────────────────────────────────────────────────────────────
 * A valid check digit proves the number is WELL-FORMED. It does not prove the product exists, that the company
 * prefix was ever licensed to anyone, or that this business may use it. Those need GS1's registry, which is a paid
 * lookup and a separate rung on the trust ladder. Do not let a green tick here be reported as "GS1 verified" —
 * that is the same overclaim the attestation layer exists to prevent.
 */

/** The GS1 lengths that carry a check digit. GTIN-13 is the common retail case; 14 is the trade-unit form. */
const GTIN_LENGTHS = [8, 12, 13, 14];

/**
 * The GS1 check-digit algorithm, shared by GTIN-8/12/13/14, GLN, SSCC.
 *
 * Multiply each digit of the payload by 3 or 1, ALTERNATING FROM THE RIGHT (rightmost payload digit weighs 3), sum,
 * then the check digit is whatever takes that sum to the next multiple of ten.
 *
 * Weighting from the right — not the left — is the part implementations get wrong, because it means the weights
 * shift when the length changes. Worked through for GTIN-13 `4006381333931`:
 *   payload 400638133393 reversed → 3·3 9·1 3·3 3·1 3·3 1·1 8·3 3·1 6·3 0·1 0·3 4·1 = 89
 *   (10 − 89 mod 10) mod 10 = 1 ✓
 */
function checkDigit(payload) {
  const s = String(payload || '');
  if (!/^\d+$/.test(s)) return null;
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    const digit = Number(s[s.length - 1 - i]);   // walk from the right
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * isValidGTIN(code) → boolean. Length must be a real GTIN length AND the check digit must agree.
 *
 * Leading/trailing whitespace is tolerated because barcode scanners and spreadsheets both add it. Nothing else is:
 * hyphens and spaces inside the number are NOT stripped, because "4006-3813-3393-1" is a formatted display value
 * and silently accepting it would let two spellings of one product become two keys.
 */
function isValidGTIN(code) {
  const s = String(code == null ? '' : code).trim();
  if (!GTIN_LENGTHS.includes(s.length)) return false;
  if (!/^\d+$/.test(s)) return false;
  return checkDigit(s.slice(0, -1)) === Number(s[s.length - 1]);
}

/** The GTIN-14 form, zero-padded. Useful as a canonical key so a GTIN-13 and its GTIN-14 form do not become two items. */
function toGTIN14(code) {
  const s = String(code == null ? '' : code).trim();
  return isValidGTIN(s) ? s.padStart(14, '0') : null;
}

/**
 * describe(code) → a verdict a HUMAN can act on, not just true/false.
 *
 * A bare `false` on an import of 4,000 rows is useless. Naming the reason — wrong length, non-numeric, or a check
 * digit that should have been 7 — is the difference between a fixable report and a wall.
 */
function describe(code) {
  const raw = String(code == null ? '' : code);
  const s = raw.trim();
  if (!s)                     return { valid: false, reason: 'empty', message: 'No code given.' };
  if (!/^\d+$/.test(s))       return { valid: false, reason: 'not-numeric',
    message: `"${s}" contains non-digits. A GTIN is digits only — strip any hyphens or spaces before storing it.` };
  if (!GTIN_LENGTHS.includes(s.length)) return { valid: false, reason: 'bad-length',
    message: `${s.length} digits is not a GTIN length (${GTIN_LENGTHS.join(', ')}). This may be an internal SKU rather than a GTIN.` };
  const want = checkDigit(s.slice(0, -1));
  const got = Number(s[s.length - 1]);
  if (want !== got)           return { valid: false, reason: 'check-digit', expected: want, found: got,
    message: `Check digit is ${got}; for ${s.slice(0, -1)} it should be ${want}. Usually a mistyped or transposed digit.` };
  return { valid: true, reason: 'ok', gtin14: s.padStart(14, '0'),
    message: `Valid GTIN-${s.length}.` };
}

/**
 * classify(code) → what KIND of identifier this is, without rejecting anything.
 *
 * Most catalogue codes in the wild are internal SKUs, not GTINs, and that is entirely legitimate. The mistake would
 * be to reject them — so this reports `sku` rather than `invalid`, and reserves `gtin-invalid` for something that
 * LOOKS like a GTIN (right length, all digits) and fails its own check digit. That is the only case worth warning
 * about, because it is the one that is probably a typo rather than a choice.
 */
function classify(code) {
  const s = String(code == null ? '' : code).trim();
  if (!s) return 'empty';
  if (!/^\d+$/.test(s)) return 'sku';
  if (!GTIN_LENGTHS.includes(s.length)) return 'sku';
  return isValidGTIN(s) ? `gtin-${s.length}` : 'gtin-invalid';
}

module.exports = { checkDigit, isValidGTIN, toGTIN14, describe, classify, GTIN_LENGTHS };
