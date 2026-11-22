'use strict';
// lib/books-side-items.js — which party items a control account's reader loads
// OWNER     cb-speed
// RISK      money (a wrong choice reads wrong balances: the open-documents rule is proved equal to every row by tests/open-items.test.cjs)
// OWNS      SPEED (1129): ONE choice of which party items a control account's reader loads: from today on the OPEN documents (a settled history is not read), a past day every row
// CALLED BY lib/books-dues.js (sideItems: Receivables / Payables, cut off at the day) · lib/books-cashflow.js (the cash view: no cut-off, a bill dated ahead is still read)
// FLOW      control account · day · the shop clock -> store.openItems (the one definition, lib/books-open-items) | store.items -> party_item rows, same columns, same order
// CARD      16-finance/collections-and-dues
const CLOCK = require('./shop-clock');

/** from today on: the open documents (day-cut when `bounded`, else every date); a past day: every row, as a bill paid since was open then. The rows are what the engine reads, with the same answers (tests/open-items.test.cjs). */
async function read(db, entity, settings, asOf, accountId, bounded) {
  const store = require('./books-store');
  return asOf >= CLOCK.today(settings) ? store.openItems(db, entity, accountId, bounded ? asOf : null) : store.items(db, entity, null, accountId);
}

module.exports = { read };
