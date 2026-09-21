/* GENERATED — DO NOT EDIT. Written by chitbridge-api/scripts/vendor-till.cjs. Edit the master and re-run. */
// @stage tested
// @stage-note a byte-for-byte copy of the master, which is the thing the tests cover (scripts/vendor-till.cjs).
(function(){
'use strict';
// @stage tested
// @stage-note [TILL-186] Magnitude, as opposed to vocabulary. The COUNTER calls it through window.CBQty for
// @stage-note every typed "500 gm" and every scale label; tests/qty.test.js runs it with no browser. No server
// @stage-note route reaches it yet — a quantity is resolved where it is typed, and travels on the line.
/**
 * lib/qty.js — 500 GRAMS OF SOMETHING SOLD BY THE KILO IS 0.5.
 *
 * ── ⚠️⚠️⚠️ WHY THIS IS NOT IN lib/units.js, AND NOT IN THE PAGE ────────────────────────────────────────────
 *
 * Athi: *"no data should be tied tightly to the front end."*
 *
 * The factors lived in till.html as `QTY_UNITS`, and the page's own note admitted the compromise: *"THE UNIT
 * NAMES ARE THE PLATFORM'S (lib/units.js keeps that vocabulary); only the arithmetic is here."* Only the
 * arithmetic — and the table of magnitudes with it, which is data, in the rendering file, where the server
 * cannot read it and a second screen would copy it.
 *
 * ⭐ AND IT IS NOT units.js EITHER, deliberately. That file says of itself: *"never a conversion, only a
 * rename… neither can change what a quantity MEANS — the one risk this file's header is written around."* A
 * conversion changes the number. Putting it there would quietly overturn a decision somebody made on purpose,
 * so magnitude gets its own file that STANDS ON the vocabulary rather than editing it.
 * [[feedback-stay-in-the-construct]] [[feedback-ui-replaceable-logic-in-engines]]
 *
 * ── ⚠️ ONLY WHERE A CONVERSION IS UNAMBIGUOUS ───────────────────────────────────────────────────────────────
 *
 * Weight and volume, and nothing else. A "box" is not a fixed number of anything and a "bundle" is whatever
 * the shop ties together; guessing would put an invented quantity on a bill somebody pays. Asking for 500 gm
 * of something sold by the PIECE is not a conversion — the number is taken at face value and the caller is
 * told it was not converted, so the screen can say which unit it used.
 */

/**
 * ⭐ THE SMALLEST UNIT OF EACH FAMILY IS 1. Everything else is how many of those it is worth, so a conversion
 * is one multiply and one divide and there is no chain to get wrong.
 *
 * ⚠️ THE SPELLINGS ARE NOT REPEATED HERE. lib/units.js owns every alias in English, Tamil and Hindi with its
 * UN/ECE and GST codes; this keys on the CANONICAL name that file resolves to, plus the handful of bare
 * spellings a counter is typed with. One vocabulary, not two. [[feedback-no-duplicate-functions]]
 */
const FAMILY = {
  /* weight — the gram is 1 */
  gram: ['w', 1], g: ['w', 1], gm: ['w', 1], gms: ['w', 1], grams: ['w', 1],
  kg: ['w', 1000], kgs: ['w', 1000], kilo: ['w', 1000], kilos: ['w', 1000], kilogram: ['w', 1000],
  mg: ['w', 0.001],
  quintal: ['w', 100000], tonne: ['w', 1000000], ton: ['w', 1000000],
  /* volume — the millilitre is 1 */
  ml: ['v', 1], millilitre: ['v', 1], millilitres: ['v', 1],
  l: ['v', 1000], lt: ['v', 1000], ltr: ['v', 1000], litre: ['v', 1000], litres: ['v', 1000], liter: ['v', 1000],
};

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * what one unit is worth, in the smallest unit of its family — or null when it is not a measured magnitude.
 * ⚠️ `units` IS PASSED IN, not required. The browser has no `require`, and the counter already holds CBUnits;
 * handing it over keeps this file free of a dependency that would have to be vendored in a fixed order.
 */
function base(u, units) {
  const raw = String(u == null ? '' : u).toLowerCase().trim();
  if (!raw) return null;
  if (FAMILY[raw]) return FAMILY[raw];
  /* ⭐ ask the platform's vocabulary to canonicalise it — 'கிலோ' and 'kilogramme' both land on kg */
  try {
    if (units && units.unitOf) {
      const c = String(units.unitOf(raw) || '').toLowerCase();
      if (c && FAMILY[c]) return FAMILY[c];
    }
  } catch (_) {}
  return null;
}

/**
 * ⭐⭐ THE ONE CONVERSION. Same family only, and it SAYS whether it converted — a caller that could not tell
 * the difference between "0.5 kg" and "500 of something we could not convert" would put the second on a bill.
 */
function convert(qty, from, to, units) {
  const n = Number(qty) || 0;
  const a = base(from, units), b = base(to, units);
  if (!a || !b || a[0] !== b[0]) return { qty: n, converted: false, why: 'not the same kind of measure' };
  if (a[1] === b[1]) return { qty: n, converted: true, why: 'the same unit' };
  return { qty: r2(n * a[1] / b[1]), converted: true, why: from + ' → ' + to };
}

/** ⭐ is this a thing that can be measured at all, or is it counted? A plate is a thing; a kilo is a magnitude. */
function measured(u, units) { return !!base(u, units); }

/** the family two units share, or null — used to decide whether asking is even sensible */
function family(u, units) { const b = base(u, units); return b ? b[0] : null; }

var EXPORTS = { FAMILY, base, convert, measured, family };

window.CBQty = EXPORTS;
})();
