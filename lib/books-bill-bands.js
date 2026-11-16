/**
 * books-bill-bands.js — THE ONE AGEING, PER BILL (W15-94): each open bill's follow-up band and its days past due (split out of books-engines.js, whose size row may not grow).
 * OWNER     cb-finance
 * RISK      money
 * OWNS      billBands(docs, asOf, creditDaysOf, side) → { ref → { band, days_late, no_terms } }
 * CALLED BY books-engines.billBands (the one door: lib/books-party-bills · routes/books.js GET /party/:id/bills · /dues)
 * FLOW      the netted documents → books-engines.followDocs (the credit-days resolver) → the engine's follow-up ageing, by bill → the band and the days late
 * CARD      16-finance/receivables-and-payables
 */
'use strict';
const E = require('./books-engines');

/**
 * THE ONE AGEING, PER BILL: each open document's follow-up band (a key of the follow-up set) and its days past due — the same netted documents, the same credit-days
 * resolver and the same engine set as `follow` (followUp), so a bill's row, its party's chips and the page total cannot differ. A bill not yet due has days_late null.
 * → { ref → { band, days_late, no_terms } }
 */
function billBands(docs, asOf, creditDaysOf, side) {
  const list = E.followDocs(docs, creditDaysOf).filter((doc) => doc.outstanding_minor > 0),
    day = (text) => Date.parse(String(text) + 'T00:00:00Z') / 86400000,
    out = Object.create(null);
  const by = E.ledger().ageing(list.map((doc) => Object.assign({}, doc, { party: doc.ref })), asOf, side === 'payable' ? 'payable' : 'receivable', { set: 'followup' }).by_party;
  list.forEach((doc) => {
    const aged = by[doc.ref];
    if (!aged) return;
    const band = E.followKeys().find((key) => aged.undisputed[key] || aged.disputed[key]) || null,
      late = day(asOf) - day(doc.due_date || doc.date); /* whole days: both are UTC midnights */
    out[doc.ref] = { band, days_late: late >= 0 ? late : null, no_terms: !!doc.no_terms };
  });
  return out;
}

module.exports = { billBands };
