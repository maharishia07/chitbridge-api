/* ADOPTED from chitbridge-engines v1.110.12 · posting-bad-debt · sha256 b1a8a35f1e6b94561a9977e28e1afe1c9804a77a32e3c088a1142dd313590d62 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · posting-bad-debt. Edited ONLY in chitbridge-engines/src/posting-bad-debt.js; every platform adopts a released version of it. */
/*
 * OWNS      the two posting rules of a bad debt: write_off (Dr bad debts · Cr the party) and write_off_recovery (Dr where it came in · Cr bad debts), each reading the TAX inside the debt from the pack's tax.badDebt row and the invoice's own tax lines
 * CALLED BY posting.js (rules.write_off, rules.write_off_recovery; it hands in its own line builder, amount reader, mode lookup, owner check and refusal). Kept out of posting.js so that file does not grow past its size baseline (MNT-58).
 * FLOW      event {amount, party, reason, invoice?, basis?} ──▶ badDebtTax ──▶ lines (the tax line only when the pack names the row and a usable invoice is carried)
 * CARD      14-accounting/README
 */
(function (root) {
  'use strict';
  // @stage tested
  // @stage-note ACC-418 (AU GST Act s.21-5, s.21-10, cited on the pack's row; no country is named here). Pure.
  /**
   * badDebtTax(e, minor, ctx) → { tax: minor, ledger: the output-tax ledger code | null }. The pack's tax.badDebt row names the tax head; the event carries `invoice` {gross_minor, tax_minor}, the invoice's OWN tax lines (net of its credit notes), read by the host
   * from the posted entry, never a flat fraction. tax = amount x tax_minor / gross_minor, ONE rounding (half-up, as every tax here, exact past 2^53), never above tax_minor.
   * Nothing is split (tax 0) when the pack has no row (IN, AE, AU 1.0.0), the event names basis 'cash' (no adjustment on that basis), or no usable invoice is carried: no guess.
   */
  function badDebtTax(e, minor, ctx) {
    var none = { tax: 0, ledger: null },
      rule = ctx && ctx.pack && ctx.pack.tax && ctx.pack.tax.badDebt,
      ledger = rule && ctx.pack.taxLedgers && ctx.pack.taxLedgers[rule.head] && ctx.pack.taxLedgers[rule.head].output,
      inv = e.invoice;
    if (!rule || !ledger || e.basis === 'cash' || !inv) return none;
    var gross = inv.gross_minor,
      taxOn = inv.tax_minor;
    if (!(Number.isSafeInteger(gross) && Number.isSafeInteger(taxOn) && gross > 0 && taxOn > 0 && minor > 0)) return none;
    var whole = BigInt(gross),
      share = Number((BigInt(minor) * BigInt(taxOn) * BigInt(2) + whole) / (whole * BigInt(2)));
    return { tax: Math.min(share, taxOn, minor), ledger: ledger };
  }
  /**
   * rules(h) → { write_off, write_off_recovery }: h = { makeLine, toMinor, mode, owner, refuse } from posting.js.
   *  write_off: Dr bad debts (amount − tax) · Dr the output-tax ledger (tax; a return reads it at the decreasing label by the entry's event type) · Cr the party.
   *  write_off_recovery (a written-off debt paid later): Dr where it came in · Cr bad debts (amount − tax) · Cr the output-tax ledger (tax): the INCREASING adjustment that gives the write-off's tax back.
   */
  function rules(h) {
    return {
      write_off: function (e, currency, ctx) {
        h.owner(e);
        if (!String(e.reason || '').trim()) throw h.refuse('A write-off needs a reason.');
        var minor = h.toMinor(e.amount, currency),
          split = badDebtTax(e, minor, ctx);
        if (!split.tax) return [h.makeLine('bad_debts', minor, 0), h.makeLine('debtors', 0, minor, { party: e.party })];
        return [h.makeLine('bad_debts', minor - split.tax, 0), h.makeLine(split.ledger, split.tax, 0), h.makeLine('debtors', 0, minor, { party: e.party })];
      },
      write_off_recovery: function (e, currency, ctx) {
        h.owner(e);
        if (!String(e.reason || '').trim()) throw h.refuse('A recovery of a written-off debt needs a reason.');
        var minor = h.toMinor(e.amount, currency),
          into = h.mode(e.into || 'cash', ctx),
          split = badDebtTax(e, minor, ctx);
        if (!into) throw h.refuse('Unknown account "' + e.into + '".');
        return [h.makeLine(into, minor, 0), h.makeLine('bad_debts', 0, minor - split.tax)].concat(split.tax ? [h.makeLine(split.ledger, 0, split.tax)] : []);
      }
    };
  }

  var EXPORTS = { badDebtTax: badDebtTax, rules: rules };
  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page takes window.CBPostingBadDebt (loaded before posting.js). */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined') root.window.CBPostingBadDebt = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
