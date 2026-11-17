/* tb-change.js — F3 (Fable RC walk 17 Nov): the trial balance's Change and % on the account's OWN side, drawn by ONE function for all three seats.
 * OWNS      CBTbChange.read(row) → { change_minor, change_bp, side } : the same two server figures, turned to read on the side the account's balance sits on
 * CALLED BY books-grant-view.js (auditor, adviser: Change · %) · cap-books.js bkTB (owner: Change · %)
 * WHY       the api's change on a trial balance row is DEBIT-positive (net_minor = debit − credit, change = now − last year). A credit account's balance that GREW therefore read "−", and Sales read +7.8% on the
 *           trial balance and −7.8% on the P&L for the same fall. A rise in the balance an account carries must read "+" wherever it is shown, with Dr or Cr said, as the Last year column already says it.
 * RULE      the account's own side = where its balance sits now (a credit balance → Cr), a nil balance → where it sat last year (prior_net_minor below zero → Cr). On Cr the sign of the amount and of the % is turned;
 *           on Dr it is as the server sent it. The percent's base is |last year| either way, so only the sign moves. NOTHING is summed or recomputed here; no api number, no threshold, no flag changes (change_over stays the server's).
 * CARD      14-accounting/README (trial balance, leader-compare #2) */
(function (root) {
  'use strict';
  /** turn a carried integer's sign for reading; null stays null, zero stays zero (never "-0") */
  function turn(v) {
    if (v == null || v === '') return v;
    var n = Number(v);
    return n ? String(-n) : '0';
  }
  /** which side the account's balance sits on: 'Cr' | 'Dr' | '' (nothing now and nothing last year) */
  function sideOf(row) {
    var dr = Number(row.dr_minor || 0), cr = Number(row.cr_minor || 0);
    if (cr > dr) return 'Cr';
    if (dr > cr) return 'Dr';
    var was = Number(row.prior_net_minor || 0);
    return was < 0 ? 'Cr' : was > 0 ? 'Dr' : '';
  }
  function read(row) {
    var side = sideOf(row), credit = side === 'Cr';
    return {
      change_minor: credit ? turn(row.change_minor) : row.change_minor,
      change_bp: credit ? turn(row.change_bp) : row.change_bp,
      side: row.change_minor == null || Number(row.change_minor) === 0 ? '' : side /* a nil change carries no side */
    };
  }
  root.CBTbChange = { read: read };
})(typeof window !== 'undefined' ? window : this);
