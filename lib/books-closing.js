'use strict';
/**
 * lib/books-closing.js — ONE-FIGURE RC5 (Athi 28 Nov 2026, batch 1141): an account's CLOSING on a range, read ONE way.
 * OWNER    cb-accounting
 * RISK     money
 * FLOW     entries (journal_line sums + the carried opening) -> closingOf -> the Ledger page's closing_minor · closingAsAt -> the bank sign-off's books figure (a figure that differs is refused)
 * OWNS     closingOf (opening + Σ Dr - Σ Cr of the range, period 0 inside the opening) · closingAsAt (the same on a day, from its fiscal year's first day)
 * CALLED BY routes/books.js GET /ledger/:account (closing_minor, paged or not) · lib/bank-rec-log.js booksBalanceAt (what a bank sign-off is checked against)
 * CARD     14-accounting/ledger-accounts-day-book-entries-reverse
 * Before this the Bank page read the Ledger route's closing while the server checked the sign-off against the trial-balance path (two readers: WX-R2R and ACC-new-1 were double counts at that seam).
 */
const store = require('./books-store');
const booksModule = () => require('./books'); /* lazy: books.js is the reader of the opening; this module is loaded by routes and by bank-rec-log */

/**
 * closingOf(handle, entity, account, party, from, to, held) → the closing in minor units.
 * `held` = { lo (a ledgerOf already read), sums (a pageSums already read for the whole range) } so the route pays no second read.
 */
async function closingOf(handle, entity, account, party, from, to, held) {
  const have = held || {};
  const lo = have.lo || (await booksModule().ledgerOf(handle, entity, account, party, from, to));
  const sums = have.sums || (await store.pageSums(handle, entity, from, to, account.account_id, party, null, !!lo.period0));
  return lo.opening_minor + sums.dr - sums.cr;
}
/** closingAsAt(handle, entity, account, day) → the account's closing on a day, read from the first day of its fiscal year (the trial balance's figure for the account) */
async function closingAsAt(handle, entity, account, day) {
  const books = booksModule(),
    ledgerContext = await books.ledgerCtx(handle, entity),
    packs = require('./books-engines').packs();
  return closingOf(handle, entity, account, null, packs.fyRange(packs.fiscalYearOf(day, ledgerContext.pack), ledgerContext.pack).start, day);
}
module.exports = { closingOf, closingAsAt };
