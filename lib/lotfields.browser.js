/* GENERATED — DO NOT EDIT. Written by chitbridge-api/scripts/vendor-till.cjs. Edit the master and re-run. */
// @stage tested
// @stage-note a byte-for-byte copy of the master, which is the thing the tests cover (scripts/vendor-till.cjs).
(function(){
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
 * ── ⭐⭐⭐ DOES THIS PRODUCT KEEP ITS STOCK PER BATCH? ─────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-10: *"batch tracking as a per-product flag, resolved from the vertical."*
 *
 * ⚠️⚠️ IT IS A FORK, NOT A SETTING, and that is why it deserves a resolver of its own rather than a column read.
 * Batch-tracked stock keeps a SEPARATE balance per batch, which is what makes a recall answerable and FEFO
 * possible — and it also means somebody, or something, has to decide which batch each sale came out of. A shop
 * selling soap should never be asked that question; a pharmacy must never be allowed to skip it.
 *
 * ⭐ SO THE VERTICAL ANSWERS FIRST AND THE PRODUCT MAY OVERRIDE.
 *   · the sector's pack requires a batch (pharma, food/FMCG, chemical) → tracked
 *   · the sector's pack requires a serial (electronics)                → tracked, one lot per unit
 *   · a product says `batch_tracked: true|false` in its own item_data → that WINS, in both directions
 * The override matters in both directions and each has a real shop behind it: a kirana that sells loose rice by
 * weight out of one sack does not want a batch on it even though FMCG requires one; and a general store that
 * happens to stock one shelf of medicines needs that shelf tracked even though its sector asks for nothing.
 *
 * ⚠️ A DEFAULT IS NOT AN ANSWER TO A QUESTION NOBODY ASKED. A shop with no sector declared tracks nothing —
 * turning it on by guess would put a batch box in front of a shopkeeper who sells vegetables.
 */
function tracksBatch(o) {
  const opt = o || {};
  const item = opt.item || {};
  const data = item.item_data || item;
  /* the product's own word, when it has one — three states, and undefined is genuinely different from false */
  if (data.batch_tracked === true || data.batch_tracked === false) {
    return { tracked: data.batch_tracked, source: 'product',
             why: 'this product says so' + (data.batch_tracked ? '' : ' — it is kept as one pool') };
  }
  const p = packFor(opt.sectors);
  if (!p) return { tracked: false, source: 'none',
                   why: 'this shop has not declared a sector, so nothing is tracked by batch' };
  const need = p.required.indexOf('batch') >= 0 || p.required.indexOf('serial') >= 0;
  return { tracked: need, source: 'vertical', vertical: p.key,
           why: need ? p.key + ' stock is kept per batch, because a recall and an expiry are per batch'
                     : p.key + ' does not require a batch, so stock is kept as one pool' };
}

/**
 * ⭐ THE KEY A BALANCE IS HELD UNDER. Empty string, never NULL — a NULL in a primary key does not compare equal
 * to itself, so two untracked balances for one product would be two rows that could never be found or merged.
 * ⚠️ Normalised (trimmed, upper-cased) because "A-4471" and "a-4471 " are the same batch to everyone except a
 * database, and a recall that misses half its stock on a spacing difference is the worst possible bug here.
 */
function lotKey(lot) {
  return String(lot == null ? '' : lot).trim().toUpperCase().slice(0, 64);
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

/**
 * ⭐⭐ HOW MUCH DIFFERENCE IS NOT A DISPUTE (2026-09-08).
 *
 * A lorry of rice does not arrive to the gram — moisture, dust and the weighbridge move it by a few kilos, and a counter that called
 * every one of those a shortage would teach the shop to ignore the word. So a trade sets what it absorbs, once, and everything
 * outside it is NAMED.
 *
 * ⚠️ WEIGHED AND COUNTED ARE DIFFERENT KINDS OF THING. A percentage on a bag of rice is sense; a percentage on a packet is not — you
 * cannot receive 119.4 packets. So the unit decides which rule applies, and packed goods default to no tolerance at all.
 * ⚠️ IT IS ABSORBED, NEVER HIDDEN. Inside tolerance the screen stops ASKING for a reason; the ordered and counted figures both stay
 * exactly as they were, and the match still shows them. Tolerance decides what is worth a conversation, not what is true.
 *
 * @param diff     counted − ordered (negative is short)
 * @param ordered  what was asked for
 * @param unit     the line's unit — 'kg', 'litre', 'ton' … are weighed; everything else is counted
 * @param tol      { weight_bp, count_units } — basis points and whole units, as the policy flags store them
 */
const WEIGHED = /^(kg|kgs|kilogram|g|gram|gms|q|quintal|ton|tonne|mt|l|lt|ltr|litre|liter|ml)$/i;
function weighed(unit) { return WEIGHED.test(String(unit || '').trim()); }
function withinTolerance(diff, ordered, unit, tol) {
  const d = Math.abs(Number(diff) || 0);
  if (d === 0) return true;
  const t = tol || {};
  if (weighed(unit)) {
    const bp = Math.max(0, Number(t.weight_bp) || 0);
    if (!bp) return false;
    const allowed = Math.abs(Number(ordered) || 0) * bp / 10000;
    return d <= allowed + 1e-9;
  }
  return d <= Math.max(0, Number(t.count_units) || 0);
}
/** the words for what tolerance decided — a screen that absorbs a difference silently is a screen nobody trusts twice */
function toleranceNote(diff, ordered, unit, tol) {
  if (!Number(diff)) return null;
  if (!withinTolerance(diff, ordered, unit, tol)) return null;
  const d = Number(diff);
  return (d < 0 ? 'short ' + Math.abs(d) : 'excess ' + d) + ' ' + (unit || '') + ' — within what this trade absorbs';
}

var EXPORTS = { forEntity, packFor, check, FIELDS, PACKS, withinTolerance, toleranceNote, weighed,
                   tracksBatch, lotKey };

window.CBLots = EXPORTS;
})();
