/* ADOPTED from chitbridge-engines v1.98.0 · bank-brs · sha256 35902a1ab8920e1e392c7c95202a4d8729eea6d020ab38d293ac61df1fa409e5 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · bank-brs. Edited ONLY in chitbridge-engines/src/bank-brs.js; every platform adopts a released version of it. */
/*
 * OWNS      the Bank Reconciliation Statement: the book balance, cheques issued but not presented, cheques deposited but not credited, bank credits and debits not in the books, the bank balance they work out to and the difference from the bank's own figure (named, never hidden), as table rows and a plain-words note. PURE: no I/O, no clock.
 * CALLED BY bank-recon.js (brs: it hands in h = { bankOf, decimalsOf, rulesFor, hasWord, dateOf }, the pack's bank rules and the readers it already owns, so each is written once). Moved out of bank-recon.js unchanged (v1.98.0 file-size ceiling).
 * FLOW      { asOf, bookBalance_minor, bankBalance_minor, unmatched_ledger, unmatched_stmt } ──▶ statement(x, h) ──▶ { ok, rows, totals, difference_minor, tied, note }. All figures are minor units.
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 */
(function (root) {
  'use strict';
  // @stage tested
  // @stage-note The BRS half of bank-recon.js, moved out with no change of behaviour. Pure.
  /**
   * ⭐ brs({ asOf, bookBalance_minor, bankBalance_minor, unmatched_ledger, unmatched_stmt }) → the Bank Reconciliation Statement
   *   Balance as per books (Dr positive)
   *   + cheques issued but not presented      (a ledger Cr the bank has not paid)
   *   − cheques deposited but not credited    (a ledger Dr the bank has not credited)
   *   + bank credits not in the books         (interest, direct credits)
   *   − bank debits not in the books          (charges, ATM, direct debits)
   *   = balance as per bank, and the difference to the bank's own figure — 0 when everything is accounted, otherwise NAMED.
   * Items dated after asOf are left out (they belong to the next statement). All figures are minor units.
   */
  function reconciliationStatement(x, h) {
    x = x || {};
    var refusal = brsInputRefusal_(x, h);
    if (refusal) return refusal;
    var bankRules = h.bankOf(x);
    if (!bankRules) return { ok: false, why: 'The regulation pack has no bank-statement rules (pack.bank), so the statement cannot be read.' };
    var decimals = h.decimalsOf(x.currency || bankRules.pack.currency);
    var rules = h.rulesFor({}, bankRules.bank.keywords);
    return brsStatement_(x, brsItems_(x, rules, h), decimals);
  }
  /** the refusal when the BRS has no asOf date or its two balances are not whole minor units; null when the input is usable */
  function brsInputRefusal_(x, h) {
    if (!h.dateOf(x.asOf)) return { ok: false, why: 'The BRS needs asOf as YYYY-MM-DD.' };
    if (!Number.isInteger(x.bookBalance_minor) || !Number.isInteger(x.bankBalance_minor))
      return {
        ok: false,
        why: 'The BRS needs bookBalance_minor and bankBalance_minor in whole ' + ((h.bankOf(x) || { bank: {} }).bank.minorUnit || 'minor units') + '.'
      };
    return null;
  }
  /** the four lists of the BRS from the unmatched lines dated on or before asOf: cheques issued, cheques deposited, bank credits and bank debits not in the books */
  function brsItems_(x, rules, h) {
    var asOf = x.asOf,
      within = function (ledgerLine) {
        return !ledgerLine.date || ledgerLine.date <= asOf;
      },
      kindOf = function (text, interestWords) {
        var upper = String(text || '').toUpperCase();
        return h.hasWord(upper, rules.charges) ? 'charges' : interestWords && h.hasWord(upper, rules.interest) ? 'interest' : 'other';
      };
    var list = (x.unmatched_ledger || []).filter(within),
      unmatchedStmt = (x.unmatched_stmt || []).filter(within);
    var item = function (row, minor, name, extra) {
      return Object.assign({ date: row.date || null, ref: row.ref || row.cheque_no || null, name: name, amount_minor: minor }, extra || {});
    };
    var issued = [],
      deposited = [],
      bankCr = [],
      bankDr = [];
    list.forEach(function (ledgerLine) {
      var debit = +ledgerLine.dr_minor || 0,
        credit = +ledgerLine.cr_minor || 0,
        netMinor = debit - credit;
      if (netMinor < 0) issued.push(item(ledgerLine, -netMinor, ledgerLine.narration || ledgerLine.entry_no || 'ledger line', { id: ledgerLine.id, entry_no: ledgerLine.entry_no }));
      else if (netMinor > 0) deposited.push(item(ledgerLine, netMinor, ledgerLine.narration || ledgerLine.entry_no || 'ledger line', { id: ledgerLine.id, entry_no: ledgerLine.entry_no }));
    });
    unmatchedStmt.forEach(function (statementLine) {
      var debit = +statementLine.debit_minor || 0,
        credit = +statementLine.credit_minor || 0;
      if (credit > debit) bankCr.push(item(statementLine, credit - debit, statementLine.narration || 'bank credit', { kind: kindOf(statementLine.narration, true) }));
      else if (debit > credit) bankDr.push(item(statementLine, debit - credit, statementLine.narration || 'bank debit', { kind: kindOf(statementLine.narration, false) }));
    });
    return { issued: issued, deposited: deposited, bankCr: bankCr, bankDr: bankDr };
  }
  /** the Bank Reconciliation Statement: the lists, their totals, the bank balance they work out to and its difference from the bank's own figure, as table rows and a plain-words note */
  function brsStatement_(x, items, decimals) {
    var issued = items.issued,
      deposited = items.deposited,
      bankCr = items.bankCr,
      bankDr = items.bankDr;
    var sum = function (rows) {
      return rows.reduce(function (total, y) {
        return total + y.amount_minor;
      }, 0);
    };
    var computed = x.bookBalance_minor + sum(issued) - sum(deposited) + sum(bankCr) - sum(bankDr);
    var diff = x.bankBalance_minor - computed;
    var res = {
      ok: true,
      asOf: x.asOf,
      book_balance_minor: x.bookBalance_minor,
      issued_not_presented: issued,
      deposited_not_credited: deposited,
      bank_credits_not_in_books: bankCr,
      bank_debits_not_in_books: bankDr,
      totals: {
        issued_not_presented_minor: sum(issued),
        deposited_not_credited_minor: sum(deposited),
        bank_credits_not_in_books_minor: sum(bankCr),
        bank_debits_not_in_books_minor: sum(bankDr)
      },
      computed_bank_minor: computed,
      bank_balance_minor: x.bankBalance_minor,
      difference_minor: diff,
      tied: diff === 0
    };
    res.rows = brsRows_(res);
    res.note = brsNote_(res, decimals);
    return res;
  }
  /** the BRS as a table: the book balance, the four adjustments with their signs, the worked bank balance, the bank's own and the difference */
  function brsRows_(res) {
    return [
      { label: 'Balance as per books', minor: res.book_balance_minor, sign: '' },
      { label: 'Add: cheques issued but not presented', minor: res.totals.issued_not_presented_minor, sign: '+' },
      { label: 'Less: cheques deposited but not credited', minor: -res.totals.deposited_not_credited_minor, sign: '-' },
      { label: 'Add: credits by the bank not yet in the books', minor: res.totals.bank_credits_not_in_books_minor, sign: '+' },
      { label: 'Less: debits by the bank not yet in the books', minor: -res.totals.bank_debits_not_in_books_minor, sign: '-' },
      { label: 'Balance as per bank (worked)', minor: res.computed_bank_minor, sign: '=' },
      { label: 'Balance as per bank statement', minor: res.bank_balance_minor, sign: '' },
      { label: 'Difference', minor: res.difference_minor, sign: '' }
    ];
  }
  /** the BRS in one sentence: reconciled, or the unexplained difference and which way it points */
  function brsNote_(res, decimals) {
    var diff = res.difference_minor;
    return diff === 0
      ? 'The books reconcile to the bank: every difference is a named item.'
      : 'Unexplained difference of ' +
          (Math.abs(diff) / Math.pow(10, decimals)).toFixed(decimals) +
          ' (' +
          (diff > 0 ? 'the bank shows more than the books and the listed items explain' : 'the bank shows less than the books and the listed items explain') +
          ') — a line is missing from one side, or a balance is not as at ' +
          res.asOf +
          '.';
  }

  var EXPORTS = { statement: reconciliationStatement };
  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page takes window.CBBankBrs. */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined') root.window.CBBankBrs = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
