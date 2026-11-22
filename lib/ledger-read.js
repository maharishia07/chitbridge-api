/* ADOPTED from chitbridge-engines v1.107.0 · ledger-read · sha256 174730caf1016487c37d7194f7266ef5274c22281988ca6cb4f1d0ca3583099e — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · ledger-read. Edited ONLY in chitbridge-engines/src/ledger-read.js; every platform adopts a released version of it. */
/*
 * OWNS      how a stored ledger amount, line side and period stamp are READ: a safe whole minor-unit integer, a total that must not overflow, a line's one positive side, a period row's two sides, the fiscal year and period (0-12) of a line or row, and the refusal (status 422) each names. PURE: no I/O, no clock.
 * CALLED BY ledger.js (every function; it keeps its own names for them) and, through ledger.minor, bookpack.js. Moved out of ledger.js unchanged (v1.98.0 file-size ceiling).
 * FLOW      a stored line or row ──▶ sides_ / rowSides_ / period_ ──▶ [debit, credit] in minor units, or a refusal naming where it is wrong.
 * CARD      14-accounting/statements-tb-pandl-bs-party-statement
 */
(function (root) {
  'use strict';
  // @stage tested
  // @stage-note The stored-amount readers of ledger.js, moved out with no change of behaviour. Pure.
  function refuse_(reason, status) {
    var e = new Error(reason);
    e.status = status || 422;
    return e;
  }

  /** ⚠️ a stored amount is a SAFE INTEGER — a huge or non-numeric string is refused by name, never coerced */
  function int_(value, where) {
    var number = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d{1,16}$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(number)) throw refuse_('Not a whole minor-unit amount at ' + where + ': ' + String(value).slice(0, 40) + '.');
    return number;
  }
  function add_(left, right, where) {
    var total = left + right;
    if (!Number.isSafeInteger(total)) throw refuse_('A total overflowed at ' + where + '.');
    return total;
  }
  /** ⭐ minor(value, where) → the stored amount as a safe integer, or a refusal naming where — the one reader bookpack shares */
  function minor(value, where) {
    return int_(value, where || 'an amount');
  }
  /**
   * v1.8.1 (M3, L5) — a stored LINE's two sides: one positive debit OR one positive credit. Refused by name: neither
   * dr_minor nor cr_minor present (a v1.7.0 line carries dr/cr — it would read as nothing), a negative side, both sides, no side.
   */
  function sides_(line, where) {
    if (line.dr_minor == null && line.cr_minor == null)
      throw refuse_('No dr_minor or cr_minor at ' + where + ' — a ledger line carries minor units (a v1.7.0 dr/cr line is not one).');
    var debit = line.dr_minor == null ? 0 : int_(line.dr_minor, where),
      credit = line.cr_minor == null ? 0 : int_(line.cr_minor, where);
    refuseUnlessOneSide_(debit, credit, where);
    return [debit, credit];
  }
  /** a stored line is refused unless exactly one side is set and neither is negative (the three refusals, in this order) */
  function refuseUnlessOneSide_(debit, credit, where) {
    if (debit < 0 || credit < 0) throw refuse_('A negative amount at ' + where + ' — a line is one positive debit or credit.');
    if (debit && credit) throw refuse_('Both a debit and a credit at ' + where + ' — a line is one positive debit or credit.');
    if (!debit && !credit) throw refuse_('Neither a debit nor a credit at ' + where + ' — a line is one positive debit or credit.');
  }
  /** a period ROW's two sides: both may be set (a month has debits and credits), neither may be negative */
  function rowSides_(row, where) {
    var debit = row.dr_minor == null ? 0 : int_(row.dr_minor, where),
      credit = row.cr_minor == null ? 0 : int_(row.cr_minor, where);
    if (debit < 0 || credit < 0) throw refuse_('A negative amount at ' + where + ' — a row keeps debits and credits apart, both positive.');
    return [debit, credit];
  }
  /** fiscal year and period of a line or row: present and 0–12, or a refusal — an unstamped entry is in no balance (H2) */
  function period_(row, where) {
    var period = Number(row.period);
    if (row.fiscal_year == null || row.fiscal_year === '' || row.period == null || !Number.isInteger(period) || period < 0 || period > 12)
      throw refuse_('No fiscal year or period (0–12) at ' + where + ' — an unstamped entry would be in no balance.');
    return period;
  }

  var EXPORTS = { refuse: refuse_, int: int_, add: add_, minor: minor, sides: sides_, rowSides: rowSides_, period: period_ };
  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page takes window.CBLedgerRead. */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined') root.window.CBLedgerRead = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
