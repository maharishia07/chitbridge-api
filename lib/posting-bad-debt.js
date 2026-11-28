/* ADOPTED from chitbridge-engines v1.110.12 · posting-bad-debt · sha256 d5faecd56fdc6321080858fa59d8c4e32103a1b2e977a1a3dcc8347ea8e2e2a4 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* src/posting-bad-debt.js — the bad-debt posting rules (write-off and its recovery) with the tax inside the debt; edited ONLY here in chitbridge-engines, every platform adopts a released version */
/*
 * OWNER     cb-accounting
 * RISK      money
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
      ledger = rule && outputLedgerOf(ctx.pack, rule.head);
    if (!rule || !ledger || e.basis === 'cash' || !e.invoice) return none;
    var tax = invoiceShare(minor, e.invoice);
    return tax === null ? none : { tax: tax, ledger: ledger };
  }
  /** the output-tax ledger code the pack names for a tax head, or a falsy value when it names none */
  function outputLedgerOf(pack, head) {
    return pack.taxLedgers && pack.taxLedgers[head] && pack.taxLedgers[head].output;
  }
  /** the part of the invoice's tax that sits in `minor` (one half-up rounding, exact past 2^53, never above tax_minor or minor); null when the invoice or the amount is not usable */
  function invoiceShare(minor, invoice) {
    var gross = invoice.gross_minor,
      taxOn = invoice.tax_minor;
    if (!(Number.isSafeInteger(gross) && Number.isSafeInteger(taxOn) && gross > 0 && taxOn > 0 && minor > 0)) return null;
    var whole = BigInt(gross),
      share = Number((BigInt(minor) * BigInt(taxOn) * BigInt(2) + whole) / (whole * BigInt(2)));
    return Math.min(share, taxOn, minor);
  }
  /**
   * rules(host) → { write_off, write_off_recovery }: host = { makeLine, toMinor, mode, owner, refuse } from posting.js.
   *  write_off: Dr bad debts (amount − tax) · Dr the output-tax ledger (tax; a return reads it at the decreasing label by the entry's event type) · Cr the party.
   *  write_off_recovery (a written-off debt paid later): Dr where it came in · Cr bad debts (amount − tax) · Cr the output-tax ledger (tax): the INCREASING adjustment that gives the write-off's tax back.
   */
  function rules(host) {
    return {
      write_off: function (e, currency, ctx) {
        host.owner(e);
        if (!String(e.reason || '').trim()) throw host.refuse('A write-off needs a reason.');
        var minor = host.toMinor(e.amount, currency),
          split = badDebtTax(e, minor, ctx);
        if (!split.tax) return [host.makeLine('bad_debts', minor, 0), host.makeLine('debtors', 0, minor, { party: e.party })];
        return [host.makeLine('bad_debts', minor - split.tax, 0), host.makeLine(split.ledger, split.tax, 0), host.makeLine('debtors', 0, minor, { party: e.party })];
      },
      write_off_recovery: function (e, currency, ctx) {
        host.owner(e);
        if (!String(e.reason || '').trim()) throw host.refuse('A recovery of a written-off debt needs a reason.');
        var minor = host.toMinor(e.amount, currency),
          into = host.mode(e.into || 'cash', ctx),
          split = badDebtTax(e, minor, ctx);
        if (!into) throw host.refuse('Unknown account "' + e.into + '".');
        return [host.makeLine(into, minor, 0), host.makeLine('bad_debts', 0, minor - split.tax)].concat(split.tax ? [host.makeLine(split.ledger, 0, split.tax)] : []);
      }
    };
  }

  var EXPORTS = { badDebtTax: badDebtTax, rules: rules };
  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page takes window.CBPostingBadDebt (loaded before posting.js). */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined') root.window.CBPostingBadDebt = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
