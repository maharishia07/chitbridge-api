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

/**
 * ══ ⭐ THE INSTANCE — batch, expiry, serial ══════════════════════════════════════════════════════════════════════
 *
 * Athi, 2026-08-13: *"what about batch number, exp date — where does it count? Also the same product price
 * movement, how do we manage two or three of the same SKU?"*
 *
 * ── ⚠️ THE DISTINCTION GS1 ALREADY MAKES, AND WE DID NOT ────────────────────────────────────────────────────────
 * A GTIN identifies a product CLASS. A batch or a serial identifies an INSTANCE of it. One barcode carries both:
 *
 *   (01) GTIN            which product this is          — the class
 *   (10) BATCH/LOT       which consignment              — the instance   X..20
 *   (17) USE BY/EXPIRY   when this consignment dies     — the instance   YYMMDD
 *   (21) SERIAL          which individual unit          — the instance   X..20
 *   (11) PROD DATE       when it was made               — the instance   YYMMDD
 *
 * "Two or three of the same SKU" is therefore not two or three products. It is ONE product with three lots, and
 * the thing that tells them apart is (10), not a second catalogue row.
 *
 * ── ⚠️ WHY THIS DOES NOT LIVE ON THE CATALOGUE ITEM ─────────────────────────────────────────────────────────────
 * It very nearly did: `starter-fields.js` put `batch_no` and `expiry` on the pharma ITEM, and the CSV importer
 * lets `batch_no` be the identity key. Follow that through and every new lot becomes a NEW CATALOGUE ITEM —
 * a thousand lots a year is a thousand products a year, each with its own version history. The catalogue quietly
 * becomes a lot ledger, which is precisely the unbounded growth b146 exists to prevent.
 *
 * Odoo gets this right and is worth copying exactly: a lot is NOT a product. It is a separate record linked to
 * one product, and the product merely declares whether it is lot-tracked at all.
 *
 * ── ⚠️ AND IT DOES NOT LIVE IN A STOCK LEDGER EITHER, BECAUSE WE DO NOT OWN THE WAREHOUSE ───────────────────────
 * Odoo and SAP hold lot records with on-hand quantities because they run the building. CB transacts across a
 * boundary instead, so what we carry is the lot identity ON THE MOVEMENT — the chit line — where it is co-held
 * and verifiable by the counterparty. That is the part an ERP structurally cannot do: it only ever sees its own
 * side of the handover.
 *
 * ⚠️ STORED ISO, MAPPED TO GS1 ON THE WAY OUT. GS1 dates are YYMMDD, which is unreadable in a database, ambiguous
 * past 2049, and does not sort against anything else we hold. We store YYYY-MM-DD and convert at the barcode
 * boundary — the standard governs the wire format, not our storage.
 */
const AI = Object.freeze({
  GTIN: '01', BATCH: '10', PROD_DATE: '11', BEST_BEFORE: '15', EXPIRY: '17', SERIAL: '21',
});

/* GS1 permits any printable character in (10)/(21), up to 20. We refuse the separator and control characters:
   they are what an FNC1-delimited barcode uses to end the field, so a batch containing one cannot round-trip. */
const LOT_TEXT = /^[\x20-\x7E]{1,20}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * lotOf(src) — normalise whatever a caller offers into the instance identity, or null if it says nothing.
 *
 * ⚠️ RETURNS null RATHER THAN AN EMPTY OBJECT when there is no lot information. An empty `{}` on a line reads as
 * "this was lot-tracked and the lot is unknown", which is a different and much more alarming claim than "this
 * product is not lot-tracked".
 *
 * ⚠️ AN UNPARSEABLE DATE IS DROPPED, NOT GUESSED. "12/03/25" is March or December depending on who typed it, and
 * an expiry that is wrong by nine months is worse than one that is absent — absent gets asked about.
 */
function lotOf(src) {
  if (!src || typeof src !== 'object') return null;
  const txt = (v) => { const s = String(v == null ? '' : v).trim(); return (s && LOT_TEXT.test(s)) ? s : null; };
  const day = (v) => { const s = String(v == null ? '' : v).trim(); return ISO_DATE.test(s) ? s : null; };
  const out = {};
  const batch = txt(src.batch != null ? src.batch : src.batch_no);
  const serial = txt(src.serial);
  const expiry = day(src.expiry != null ? src.expiry : src.expiry_date);
  const made = day(src.production_date);
  const best = day(src.best_before);
  if (batch) out.batch = batch;
  if (serial) out.serial = serial;
  if (expiry) out.expiry = expiry;
  if (made) out.production_date = made;
  if (best) out.best_before = best;
  return Object.keys(out).length ? out : null;
}

/**
 * lotKey(ref, lot) — the identity of THIS consignment, for correlation across parties.
 *
 * ⚠️ A BATCH NUMBER IS ONLY UNIQUE WITHIN A PRODUCT. "24B" from two manufacturers is two unrelated consignments,
 * and a recall that matched on the batch alone would sweep in a stranger's stock. The key is the pair.
 */
function lotKey(ref, lot) {
  const l = lotOf(lot);
  if (!l || (!l.batch && !l.serial)) return null;
  const product = (ref && (ref.sku || ref.gtin || ref.item_id)) || null;
  if (!product) return null;
  return String(product).toLowerCase() + '|' + String(l.serial || l.batch).toLowerCase();
}

/** GS1 element string for a barcode/label, from our ISO storage. Nothing is invented — absent fields are absent. */
function toElementString(gtin, lot) {
  const l = lotOf(lot) || {};
  const yymmdd = (d) => d.slice(2, 4) + d.slice(5, 7) + d.slice(8, 10);
  let s = '';
  if (gtin && isValidGTIN(String(gtin))) s += '(' + AI.GTIN + ')' + toGTIN14(String(gtin));
  if (l.batch) s += '(' + AI.BATCH + ')' + l.batch;
  if (l.production_date) s += '(' + AI.PROD_DATE + ')' + yymmdd(l.production_date);
  if (l.expiry) s += '(' + AI.EXPIRY + ')' + yymmdd(l.expiry);
  if (l.serial) s += '(' + AI.SERIAL + ')' + l.serial;
  return s || null;
}

/**
 * expiryState(lot, asOf) — expired · expiring · fine · unknown.
 *
 * ⚠️ THIS IS WHY FEFO EXISTS AND FIFO IS NOT ENOUGH. With expiry, the right stock to ship is the one that dies
 * soonest, which is not always the one that arrived first — a later delivery of an older-dated lot jumps the
 * queue. Odoo names this removal strategy FEFO, first-expiry-first-out, and it is the one perishables need.
 */
function expiryState(lot, asOf) {
  const l = lotOf(lot);
  if (!l || !l.expiry) return 'unknown';
  const when = new Date(l.expiry + 'T00:00:00Z');
  const now = asOf ? new Date(asOf) : new Date();
  if (when < now) return 'expired';
  return (when - now) <= 30 * 86400000 ? 'expiring' : 'fine';
}

module.exports = { checkDigit, isValidGTIN, toGTIN14, describe, classify, GTIN_LENGTHS,
                   AI, lotOf, lotKey, toElementString, expiryState };
