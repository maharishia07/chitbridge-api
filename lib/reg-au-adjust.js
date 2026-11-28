/* ADOPTED from chitbridge-engines v1.110.12 · reg-au-adjust · sha256 99729060d91f66f8d842c132e47e6c5f86c61850e612ffcaa5f2886606936c01 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · reg-au-adjust. Edited ONLY in chitbridge-engines/src/reg-au-adjust.js; every platform adopts a released version of it. */
/*
 * OWNS      Australia's GST ADJUSTMENTS for the regulation pack: the members AU pack 1.0.1 adds to 1.0.0 (tax.badDebt, returns.adjustments, the adjustment-note wording) and the two readers bas() uses to put a tagged adjustment at its BAS label
 * CALLED BY reg-au.js (overlay → the 1.0.1 pack; tallyAdjustment · adjustedLabels inside bas()). Kept out of reg-au.js so that file does not grow past its size baseline (MNT-58).
 * FLOW      reg-au.js builds PACK_1_0 exactly as written ──▶ overlay(PACK_1_0) ──▶ the 1.0.1 members; bas() rows tagged adj:'adjustment' ──▶ tallyAdjustment ──▶ adjustedLabels ──▶ 1A / 1B
 * CARD      14-accounting/README
 */
(function (root) {
  'use strict';
  // @stage tested
  // @stage-note ACC-417 / ACC-418 / CTRY-151 (cb-country AU-RULES-UNSURE-2026-11-28 rules 1 and 2; Athi's yes, 28 Nov 2026). Pure.
  /**
   * overlay(pack10) → { tax, returns }: the members NEW in AU 1.0.1, over 1.0.0 which stays registered exactly as it was written (a book stamped 1.0.0 resolves and reads and posts as filed; the IN 1.1.0 way).
   *   tax.badDebt: a write-off of a taxable supply is a DECREASING adjustment (GST Act 1999 s.21-5(1)) of the GST actually charged on the invoice written off (its own tax lines, pro rata for a part), never a flat 1/11; its recovery an INCREASING one (s.21-10);
   *                never on cash basis (s.21-5(2)). The posting engine reads this row: no row, no tax line.
   *   returns.adjustments.events: the entry types whose tax is an ADJUSTMENT; a return reads a decreasing one at 1B and an increasing one at 1A (s.17-10; the ATO label page is a search excerpt, live page 403).
   *   tax.adjustmentNote.directions: wording only (a discount: the supplier decreases, the recipient increases).
   */
  function overlay(pack10) {
    var note = pack10.tax.adjustmentNote;
    return {
      tax: Object.freeze(
        Object.assign({}, pack10.tax, {
          badDebt: Object.freeze({
            head: 'gst',
            cite: 'GST Act 1999 s.21-5(1), (2) and s.21-10; GSTR 2000/2 (ATO search excerpt, page not read). The amount is the GST actually charged on the invoice (Athi, 28 Nov 2026), pro rata for a part; the Act text says 1/11 and Division 136 (mixed supplies) was not read',
            status: 'unconfirmed'
          }),
          adjustmentNote: Object.freeze(
            Object.assign({}, note, {
              directions: Object.freeze({
                increase: 'Price rise: the supplier has an increasing adjustment (s.29-20(1)); the recipient a decreasing adjustment, once it holds the note (s.29-20(3))',
                decrease: 'Price fall or discount: the supplier has a decreasing adjustment (s.29-20(3)); the recipient an increasing adjustment (s.29-20(1))'
              })
            })
          )
        })
      ),
      returns: Object.assign({}, pack10.returns, {
        adjustments: Object.freeze({
          events: Object.freeze(['return', 'credit_note', 'purchase_return', 'write_off', 'write_off_recovery']),
          cite: 'GST Act 1999 s.17-10, s.19-10, s.19-55, s.21-5, s.21-10; ato.gov.au › Making adjustments (search excerpt, live page 403)',
          status: 'unconfirmed'
        })
      })
    };
  }
  /** a row the host tagged adj:'adjustment' (the tax of a credit note, a purchase return, a write-off or its recovery) adds to `adjusted` by the side it moved the tax; int(v, where) is the pack's whole-minor reader.
   *  GROSS PER SIDE (AU BAS, 28 Nov 2026): only the DEBIT of output tax (a decreasing adjustment, 1B) and the CREDIT of input tax (an increasing adjustment, 1A) are read; the opposite side of the same row (a recovery, a later payment) already
   *  sits at its own label and is never netted against it (ATO: increasing at 1A, decreasing at 1B; page 403 to us, status unconfirmed). The host hands ONE tagged row per role summed over all adjustment events, so gross means per side, not per event. */
  function tallyAdjustment(adjusted, item, int) {
    if (item.adj !== 'adjustment') return;
    if (item.role === 'gst_collected') adjusted.decreasing += int(item.dr_minor, item.role);
    if (item.role === 'gst_paid') adjusted.increasing += int(item.cr_minor, item.role);
  }
  /** the tagged adjustments leave the plain sums and re-enter by direction: a net DEBIT on tagged output tax or a net CREDIT on tagged input tax is a decreasing adjustment (1B), the other way an increasing one (1A); a wrong-sign remainder goes the other way, never dropped. 1A minus 1B is what it was. → { oneA, labelB } */
  function adjustedLabels(adjusted, netCollected, oneB) {
    var decreasing = Math.max(adjusted.decreasing, 0) + Math.max(-adjusted.increasing, 0),
      increasing = Math.max(adjusted.increasing, 0) + Math.max(-adjusted.decreasing, 0);
    return { oneA: netCollected + adjusted.decreasing + increasing, labelB: oneB + adjusted.increasing + decreasing };
  }

  var EXPORTS = { overlay: overlay, tallyAdjustment: tallyAdjustment, adjustedLabels: adjustedLabels };
  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page takes window.CBRegAUAdjust (loaded before the pack that reads it). */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined') root.window.CBRegAUAdjust = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
