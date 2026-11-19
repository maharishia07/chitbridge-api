/* ADOPTED from chitbridge-engines v1.99.0 · tax-export · sha256 3cd43057b1e1a9b0bc7604e8f4ba27d32f4ed8e72496395a91a0a0bd583c76f9 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · tax-export. Edited ONLY in chitbridge-engines/src/tax-export.js; every platform adopts a released version of it. */
/*
 * OWNS      R6-01, the export rule of a border pack (AU, AE): a sale to a buyer in another country is zero-rated only when the sale STATES it is an export; the answer's `_cb.export` code.
 * CALLED BY tax.js determine (the VAT-type branch), through the one function exportRule_. Moved out of tax.js unchanged (v1.98.0 file-size ceiling; a tax RULE awaiting Athi's yes, CTRY-144/145).
 * FLOW      input (isExport) + pack (export.must_state) + the two countries ──▶ decide ──▶ 'cross' | 'domestic' (the note says why) ; stateOf ──▶ 'stated' | 'denied' | 'asked' | null
 * CARD      15-tax-and-country-packs/tax-compute-rate-invoice-tax
 */
(function (root) {
  'use strict';
  // @stage tested
  // @stage-note The export rule moved out of tax.js with no change of behaviour. Pure — no I/O, no rate table.
  /**
   * ⭐ R6-01 (Fable country review, 14 Nov): THE BUYER'S COUNTRY ALONE NEVER REMOVES THE TAX. Zero-rating is the law's answer for an EXPORT (AU GST Act s.38-185 · AE VAT DL Art. 45
   * with ER Arts. 30-41: the pack's own cites, text unread), not for a buyer with a foreign address (a tourist, an expatriate, an overseas company collecting locally). So a border pack
   * reads the sale as cross-border only when the caller STATES the export (`inp.isExport === true`, an explicit answer, never defaulted); otherwise the supply is domestic, at the pack's
   * rate, and the note says why. `stateOf` is the CODE the caller branches on (never the sentence): 'stated' · 'denied' (isExport === false) · 'asked' (not answered: ask at issue).
   */
  /** a pack opts in with `export.must_state` (AU, AE: R6-01); every other border pack keeps reading the buyer's country as before until its own review */
  function mustState_(pack) {
    return !!(pack && pack.export && pack.export.must_state === true);
  }
  /** the code for a border pack and a buyer abroad; null for a pack that has not opted in (its answer carries no `export`) */
  function stateOf(inp, pack) {
    if (!mustState_(pack)) return null;
    return inp.isExport === true ? 'stated' : inp.isExport === false ? 'denied' : 'asked';
  }
  function decide(inp, pack, scheme, sc, bc, notes) {
    const proof = mustState_(pack) ? pack.export : null;
    if (!proof) {
      notes.push(
        'Cross-border supply: no ' + scheme + ' is charged. The buyer accounts for it in their own country (reverse charge / import). The rate is stated for the record.'
      );
      return 'cross';
    }
    if (inp.isExport === true) {
      notes.push(
        'Cross-border supply stated as an export: no ' + scheme + ' is charged' + (proof && proof.cite ? ' (' + proof.cite + ')' : '') + '. The buyer accounts for it in their own country (reverse charge / import). The rate is stated for the record.' +
          (proof && proof.evidence ? ' Keep the evidence: ' + proof.evidence : '')
      );
      return 'cross';
    }
    notes.push(
      'The buyer is in ' + bc + ', the seller in ' + sc + ', but this sale is not stated to be an export, so ' + scheme + ' is charged as on a domestic supply. ' +
        (inp.isExport === false ? 'The seller said it is not an export.' : 'Say whether the goods or services leave the country (an export, with its evidence) to change this.')
    );
    return 'domestic';
  }

  var EXPORTS = { decide: decide, stateOf: stateOf };
  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page takes window.CBTaxExport. */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined') root.window.CBTaxExport = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
