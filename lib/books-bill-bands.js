/**
 * books-bill-bands.js — THE ONE AGEING, PER BILL (W15-94): each open bill's follow-up band and its days past due (split out of books-engines.js, whose size row may not grow).
 * OWNER     cb-finance
 * RISK      money
 * OWNS      billBands(docs, asOf, creditDaysOf, side) → { ref → { band, days_late, age_days, overdue, no_terms } }
 * CALLED BY books-engines.billBands (the one door: lib/books-party-bills · routes/books.js GET /party/:id/bills · /dues)
 * FLOW      the netted documents → books-engines.followDocs (the credit-days resolver) → the engine's follow-up ageing, by bill → the band and the days late
 * CARD      16-finance/receivables-and-payables
 */
'use strict';
const Engines = require('./books-engines');

/**
 * THE ONE AGEING, PER BILL: each open document's follow-up band (a key of the follow-up set) and its days past due — the same netted documents, the same credit-days
 * resolver and the same engine set as `follow` (followUp), so a bill's row, its party's chips and the page total cannot differ. A bill not yet due has days_late null.
 * → { ref → { band, days_late, age_days, overdue, no_terms } }
 * ACC-412: `overdue` is THE flag (past a real due date; false for a no-terms bill); `days_late` is null for it; `age_days` = days since the due-or-bill date, for the band only.
 */
function billBands(docs, asOf, creditDaysOf, side) {
  const list = Engines.followDocs(docs, creditDaysOf).filter((doc) => doc.outstanding_minor > 0),
    dayNumber = (text) => Date.parse(String(text) + 'T00:00:00Z') / 86400000,
    out = Object.create(null);
  const by = Engines.ledger().ageing(list.map((doc) => Object.assign({}, doc, { party: doc.ref })), asOf, side === 'payable' ? 'payable' : 'receivable', { set: 'followup' }).by_party;
  list.forEach((doc) => {
    const aged = by[doc.ref];
    if (!aged) return;
    const band = Engines.followKeys().find((key) => aged.undisputed[key] || aged.disputed[key]) || null,
      late = dayNumber(asOf) - dayNumber(doc.due_date || doc.date); /* whole days: both are UTC midnights */
    const noTerms = !!doc.no_terms,
      age = late >= 0 ? late : null;
    /* ACC-412: overdue = past a REAL due date. A bill with no terms has none: it is "not due" (days_late null, overdue false); only its AGE (from the bill date) feeds the band. */
    out[doc.ref] = { band, days_late: noTerms ? null : age, age_days: age, overdue: !noTerms && age > 0, no_terms: noTerms };
  });
  return out;
}

module.exports = { billBands };
