/* ADOPTED from chitbridge-engines v1.110.0 · reg-in-movein · sha256 9152fdb8e3248df22e0eb57392ed488b3d025df5cd26e9e5a59574603dbc65a6 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · reg-in-movein. Edited ONLY in chitbridge-engines/src/reg-in-movein.js; every platform adopts a released version of it. */
/*
 * OWNS      India's move-in map for the regulation pack, TAX CODES ONLY: which of a Tally or Zoho tax name is which GST rate (0 · 5 · 12 · 18 · 28) or which supply kind (exempt · nil-rated · non-GST). DATA and small readers; guesses nothing.
 * CALLED BY reg-in.js (pack.moveIn: read by the api's move-in importer, lib/move-in, through the same readers the Australian map has: supplyKindFor · groupFor · roleFor)
 * FLOW      reg-in.js requires this file ──▶ moveIn(TAX_IN.supplyKinds) ──▶ pack.moveIn
 * CARD      15-tax-and-country-packs/country-packs-jurisdiction
 */
(function (root) {
  'use strict';
  // @stage tested
  // @stage-note AL-F-02 (walk AL, 21 Nov 2026): India's Tally / Zoho tax-code map for the move-in registry, tax codes only; the chart's account groups are not mapped yet (groupFor and roleFor answer null: the row is skipped and said, never guessed).
  /**
   * ⭐ MOVE IN FROM TALLY / ZOHO BOOKS (AL-F-02) — THE TAX-CODE TABLE, AS DATA. A GST rate here is a RATE, not a supply kind (India's rate comes from the HSN slab), so a rate code answers a row
   * { id: 'gst18', name: 'GST', rate: 18 } and the three lines with no GST answer the pack's own supply kind (nil · exempt · non_gst, handed in). A code this table does not know answers undefined
   * (the person picks; the importer HOLDS the item, never 0%). A half-rate head (CGST 9% on its own) is NOT mapped: it is one head of a rate, not the rate.
   * ⚠️ The code NAMES a Tally or Zoho export writes (GST 18% · GST@18% · IGST18 · Exempt · Nil Rated · Non-GST Supply) are matched case-, space- and punctuation-insensitively from the shape of the name;
   *    they are NOT yet checked against a real Tally or Zoho export (a file from the first auditor client settles that): the table has no source URL, and none is claimed.
   *   supplyKindFor(source, code) → { id, name, rate } · the pack's supply kind · or undefined when the code is not one this table knows
   *   groupFor / roleFor           → null (the chart is not mapped for India yet)
   */
  var RATES = [0, 5, 12, 18, 28];
  var KIND_BY_NAME = {
    EXEMPT: 'exempt',
    EXEMPTED: 'exempt',
    EXEMPTSUPPLY: 'exempt',
    NIL: 'nil',
    NILRATED: 'nil',
    NILRATEDSUPPLY: 'nil',
    NONGST: 'non_gst',
    NONGSTSUPPLY: 'non_gst'
  };
  var SOURCES = ['tally', 'zoho'];
  /** "GST @ 18 %" · "IGST18" · "Non-GST Supply" → letters and digits only, upper case */
  function key_(s) {
    return String(s == null ? '' : s)
      .toUpperCase()
      .replace(/[^A-Z0-9.]+/g, '');
  }
  function supplyKindFor(source, code, supplyKinds) {
    if (SOURCES.indexOf(String(source == null ? '' : source).trim().toLowerCase()) < 0) return undefined;
    var k = key_(code);
    if (Object.prototype.hasOwnProperty.call(KIND_BY_NAME, k)) return supplyKinds[KIND_BY_NAME[k]];
    var m = /^(?:I?GST)?(\d+(?:\.\d+)?)$/.exec(k);
    var rate = m ? Number(m[1]) : NaN;
    return RATES.indexOf(rate) >= 0 ? { id: 'gst' + rate, name: 'GST', rate: rate } : undefined;
  }
  /** the move-in map as the pack carries it (`moveIn`): the readers, with the pack's supply kinds the three no-GST names resolve to */
  function moveIn(supplyKinds) {
    return {
      sources: SOURCES.slice(),
      groupFor: function () {
        return null;
      },
      roleFor: function () {
        return null;
      },
      supplyKindFor: function (source, code) {
        return supplyKindFor(source, code, supplyKinds);
      },
      cite: 'none yet: the code names are the shape of a Tally / Zoho export, to be confirmed against a real file'
    };
  }
  var EXPORTS = { moveIn: moveIn };
  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page takes window.CBRegINMoveIn (loaded before the pack that reads it). */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined') root.window.CBRegINMoveIn = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
