'use strict';
/**
 * lib/lotfields.js — WHAT A VERTICAL MUST CAPTURE ABOUT A CONSIGNMENT (2026-09-08).
 *
 * Athi: *"say pharma may require batch number, production date, exp date etc"* — and then, on the next level:
 * *"we have already vertical in our governance, so it can nicely tide upon."* So it does: the shop's SECTOR, declared once in the
 * profile that governance already reads for trade readiness, decides what the goods-in screen asks for.
 *
 * ── ⚠️ THIS IS ABOUT THE CONSIGNMENT, NOT THE PRODUCT ─────────────────────────────────────────────────────────
 * A batch number is not an attribute of "Aachi masala 100 g". It is an attribute of the two hundred packets that arrived on Tuesday.
 * One product has many batches, each with its own expiry and often its own MRP, and confusing the two is the single most common way
 * a small ERP paints itself into a corner: it puts `expiry` on the product, and then cannot answer "which of these do I sell first".
 * That is why every movement the counter writes carries a `lot`, empty in general trade and filled here.
 *
 * ── ⚠️ AND IT IS A FLOOR, NOT A CEILING ───────────────────────────────────────────────────────────────────────
 * `required` is what the law or the trade will not do without — an expiry on medicine, a serial on a warranty item. A shop may
 * always capture more; nothing here forbids a field. What it does is refuse to let a required one be skipped, because a pharmacy
 * that received stock without an expiry date has a problem it will not discover until an inspection.
 */

/** every field this layer knows, with the words a shopkeeper would use and what it means on a barcode */
const FIELDS = {
  batch:           { label: 'Batch',        type: 'text', gs1: '10', hint: 'the batch or lot printed on the pack' },
  expiry:          { label: 'Expiry',       type: 'date', gs1: '17', hint: 'the date it must not be sold after' },
  best_before:     { label: 'Best before',  type: 'date', gs1: '15', hint: 'the date it is best used by' },
  production_date: { label: 'Made on',      type: 'date', gs1: '11', hint: 'the manufacturing date' },
  serial:          { label: 'Serial',       type: 'text', gs1: '21', hint: 'the unit\'s own number — one per piece' },
  mrp:             { label: 'MRP',          type: 'money', gs1: null, hint: 'the printed maximum retail price of THIS batch' },
  grade:           { label: 'Grade',        type: 'text', gs1: null, hint: 'the quality grade this lot was accepted at' },
};

/**
 * ⭐ THE PACKS. Sector keys are the ones already used in the profile (lib/profile.js `sectors`), lower-cased and matched loosely,
 * because a shop that typed "Pharmaceuticals" means the same thing as one that picked "pharma".
 * ⚠️ NOTHING IS REQUIRED BY DEFAULT. General trade — the shop we built the counter for — asks for nothing at all, and must not be
 * given a form to fill because somebody else sells medicine.
 */
const PACKS = [
  { match: /pharma|medicine|drug|ayurved|surgical/, key: 'pharma',
    required: ['batch', 'expiry'], optional: ['mrp', 'production_date'],
    why: 'Medicine is sold by batch and must not be sold past its expiry — the Drugs Rules require both on the record.' },
  { match: /food|fmcg|grocer|kirana|dairy|bakery|beverage|agri/, key: 'food',
    required: ['batch'], optional: ['best_before', 'mrp'],
    why: 'Food is recalled by batch, and what leaves first should be what expires first.' },
  { match: /electronic|appliance|mobile|hardware.?tech|computer/, key: 'serialised',
    required: ['serial'], optional: ['batch'],
    why: 'A warranty follows the individual unit, so the serial is what a claim is settled against.' },
  { match: /chemical|paint|lubricant|fertilis|fertiliz|pesticide/, key: 'chemical',
    required: ['batch'], optional: ['production_date', 'grade', 'expiry'],
    why: 'A chemical is traced and certified by batch — the test certificate is issued against it.' },
  { match: /textile|apparel|garment|leather/, key: 'lot',
    required: [], optional: ['batch', 'grade'],
    why: 'A dye lot decides whether two pieces match; it is worth recording but nothing stops without it.' },
];

/** the pack for a set of sectors — the first that matches, because a shop is one trade first and a second trade after */
function packFor(sectors) {
  const list = (Array.isArray(sectors) ? sectors : (sectors ? [sectors] : [])).map((s) => String(s || '').toLowerCase());
  for (const s of list) {
    const hit = PACKS.find((p) => p.match.test(s));
    if (hit) return hit;
  }
  return null;
}

/**
 * forEntity(sectors) → what the goods-in screen should ask for.
 *
 *   { vertical, required[], optional[], fields{}, why }
 *
 * ⚠️ It always answers. A shop with no sector declared gets an empty pack — never a guess, and never a form.
 */
function forEntity(sectors) {
  const p = packFor(sectors);
  const names = p ? p.required.concat(p.optional) : [];
  const fields = {};
  for (const n of names) if (FIELDS[n]) fields[n] = Object.assign({ key: n }, FIELDS[n]);
  return { vertical: p ? p.key : null, required: p ? p.required.slice() : [], optional: p ? p.optional.slice() : [],
           fields, why: p ? p.why : null };
}

/**
 * check(lot, pack, asOf) → what is wrong with this consignment, in the words to show the person at the door.
 *
 * ⚠️ AN EXPIRED CONSIGNMENT IS REFUSED, not warned about. Accepting stock that is already past its date is a decision nobody should
 * be allowed to make by pressing on through a warning — it is the shop's licence, not a preference. Everything else is a MISSING
 * FIELD, which the screen asks for rather than refusing.
 */
function check(lot, pack, asOf) {
  const out = { missing: [], refuse: null };
  const p = pack || { required: [] };
  const l = lot || {};
  for (const n of (p.required || [])) {
    const v = l[n];
    if (v == null || String(v).trim() === '') out.missing.push(n);
  }
  const exp = l.expiry || l.best_before;
  if (exp && /^\d{4}-\d{2}-\d{2}$/.test(exp)) {
    const when = new Date(exp + 'T00:00:00Z'), now = asOf ? new Date(asOf) : new Date();
    if (when < now) out.refuse = (l.expiry ? 'This has already expired (' + exp + '). It cannot be received.'
                                           : 'This is past its best-before date (' + exp + '). It cannot be received.');
  }
  return out;
}

module.exports = { forEntity, packFor, check, FIELDS, PACKS };
