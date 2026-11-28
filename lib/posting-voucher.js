/* ADOPTED from chitbridge-engines v1.110.99 · posting-voucher · sha256 dc3baca04bf62c23dbd4d124f0b6d7a510b5b5489ffdca2801721b5a04e3f9dc — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · posting-voucher. Edited ONLY in chitbridge-engines/src/posting-voucher.js; every platform adopts a released version of it. */
/*
 * OWNS      the voucher type of an event: the one table (event type → Sales · Purchase · Receipt · Payment · Contra · Credit note · Debit note · Journal), the table with the default pack's event aliases beside it, and voucherTypeOf (type, number series, manual). PURE: no I/O, no clock.
 * CALLED BY posting.js (VOUCHER_TYPE_OF, voucherTypeOf and the voucher stamped on every posted entry; it hands in the regulation lookup and the rule resolver it already owns). Moved out of posting.js unchanged (v1.98.0 file-size ceiling).
 * FLOW      event ──▶ voucherTypeOf(event, opts, h) ──▶ { type, series, manual } or null for a type with no rule.
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 */
(function (root) {
  'use strict';
  // @stage tested
  // @stage-note The voucher-type table of posting.js, moved out with no change of behaviour. Pure.
  /**
   * ⭐ VOUCHER_TYPE_OF — event type → voucher type (v1.16.0; Athi, 2026-10-02: "Follow the standard"). Each choice, and why:
   *   Sales          sale_bill, walkin_day, the day's takings                                  — a sale is a Sales voucher
   *   Purchase       purchase_bill                                                              — a Purchase voucher
   *   Receipt        payment_received · other_income · loan_taken                               — money IN: interest/commission received and a loan received go through Receipt
   *   Payment        payment_made · credit_given · loan_repaid · tax_payment · cheque_dishonoured
   *                  — money OUT of cash/bank: a supplier paid, credit handed over, an EMI from the bank, and the statutory tax payment
   *                  (a Payment voucher); a bounced cleared cheque takes the money back OUT of the bank to the party
   *   Expense        expense → Payment when paid at once; Purchase when a supplier's bill is booked on credit (the supplier field)
   *   Contra         contra                                                                     — between cash and bank-type accounts, no party
   *   Credit note    credit_note · return                                                       — a sales return
   *   Debit note     purchase_return · debit_note                                               — goods back to a supplier · a price raised after issue (ACC-192)
   *   Journal        closing_stock · accrual · depreciation · tax_setoff · tax_advance · write_off · asset_disposal · opening · manual
   *                  — no cash or bank moves: an adjustment between ledgers (set-off is credit against credit; a disposal is a many-legged
   *                  entry with a profit or loss; the opening is a Journal)
   * ⚠️ A PERSON'S OWN entry (type 'manual', source 'manual', or { manual: true }) takes the single series MJ whatever its type, and keeps
   * its voucher type beside it: voucher_type on the event (Payment · Receipt · Contra · Journal …), else the type this table gives it.
   */
  const KIND_OF = {
    walkin_day: 'Sales',
    sale_bill: 'Sales',
    purchase_bill: 'Purchase',
    payment_received: 'Receipt',
    other_income: 'Receipt',
    write_off_recovery: 'Receipt',
    loan_taken: 'Receipt',
    payment_made: 'Payment',
    credit_given: 'Payment',
    loan_repaid: 'Payment',
    tax_payment: 'Payment',
    cheque_dishonoured: 'Payment',
    expense: 'Payment',
    contra: 'Contra',
    credit_note: 'Credit note',
    debit_note: 'Debit note' /* ACC-192: the seller's extra-sale note; purchase_return (goods back) keeps its label */,
    return: 'Credit note',
    purchase_return: 'Debit note',
    fx_settlement: 'Receipt',
    fx_revalue: 'Journal' /* v1.45.0 — a payable settlement is a Payment (voucherTypeOf) */,
    closing_stock: 'Journal',
    accrual: 'Journal',
    depreciation: 'Journal',
    tax_setoff: 'Journal',
    tax_advance: 'Journal',
    write_off: 'Journal',
    asset_disposal: 'Journal',
    opening: 'Journal',
    manual: 'Journal'
  };
  /**
   * the table by event type: the neutral types, then each name the default pack's accountants still use (its eventAliases) beside them, so every caller written before still finds its type
   */
  function typeTable(aliases) {
    var table = Object.keys(KIND_OF).reduce(function (total, item) {
      total[item] = KIND_OF[item];
      return total;
    }, {});
    Object.keys(aliases).forEach(function (item) {
      if (Object.prototype.hasOwnProperty.call(KIND_OF, aliases[item])) table[item] = KIND_OF[aliases[item]];
    });
    return table;
  }
  /**
   * ⭐ voucherTypeOf(event, { manual? }) → { type: 'Sales', series: 'SV', manual: false } — the voucher type and number series of an event, or
   * null for a type with no rule. A manual entry is { type: <its kind>, series: 'MJ', manual: true }.
   */
  function voucherTypeOf(event, opts, h) {
    var e = event || {},
      given = opts || {},
      regulation = h.regulation(),
      pack = regulation ? regulation.resolve(given) : null,
      series = pack && pack.voucherSeries,
      kind = h.ruleOf(pack, e.type);
    if (!series || !Object.prototype.hasOwnProperty.call(KIND_OF, kind)) return null;
    var manual = given.manual === true || e.source === 'manual' || e.type === 'manual';
    var type = voucherKind_(e, kind, series, manual);
    return { type: type, series: manual ? pack.manualSeries : series[type], manual: manual };
  }
  /** the voucher type of an event's rule kind: the table's, bent by a supplier on an expense, a payable settlement, or a person's own voucher_type */
  function voucherKind_(e, kind, series, manual) {
    var type = KIND_OF[kind];
    if (e.type === 'expense' && e.supplier) type = 'Purchase';
    if (kind === 'fx_settlement' && e.side === 'payable') type = 'Payment';
    if (manual && e.voucher_type != null && Object.prototype.hasOwnProperty.call(series, e.voucher_type)) type = e.voucher_type;
    return type;
  }

  var EXPORTS = { KIND_OF: KIND_OF, typeTable: typeTable, voucherTypeOf: voucherTypeOf };
  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page takes window.CBPostingVoucher. */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined') root.window.CBPostingVoucher = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
