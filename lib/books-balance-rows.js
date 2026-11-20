/**
 * books-balance-rows.js — the monthly balance rows a journal entry's lines make (moved out of books.js, whose size row may not grow; the code is moved, not changed).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      balanceRows(lines, fiscalYear, period) → one row per account, and one per account+party when a line names a party
 * CALLED BY lib/books.js (re-exported: every caller still asks books.balanceRows) · tests/books-post.test.cjs
 * FLOW      journal lines ──▶ grouped by account|party|currency ──▶ rows { dr_minor, cr_minor, line_count } for S.addBalances
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * ⚠️ Pure: no database, no writes; the ONE journal writer stays lib/books-store.js.
 */
'use strict';
const { ZERO } = require('./books-store');
/**
 * lines → the monthly balance rows: every line on its account, and again on account+party when it names a party —
 * exactly CBLedger.accumulate's two grains (tests/books-post.test.cjs holds them equal).
 */
function balanceRows(lines, fiscalYear, period) {
  const lookup = new Map();
  const addToBalance = (account_id, party_key, line) => {
    const balanceKey = account_id + '|' + (party_key || ZERO) + '|' + line.currency;
    const balanceRow = lookup.get(balanceKey) || {
      account_id,
      party_key: party_key || ZERO,
      currency: line.currency,
      fiscal_year: fiscalYear,
      period,
      dr_minor: 0,
      cr_minor: 0,
      line_count: 0
    };
    balanceRow.dr_minor += line.dr_minor;
    balanceRow.cr_minor += line.cr_minor;
    balanceRow.line_count += 1;
    lookup.set(balanceKey, balanceRow);
  };
  for (const l of lines) {
    addToBalance(l.account_id, null, l);
    if (l.party_id) addToBalance(l.account_id, l.party_id, l);
  }
  return Array.from(lookup.values());
}
module.exports = { balanceRows };
