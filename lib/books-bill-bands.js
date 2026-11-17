/**
 * books-bill-bands.js — THE ONE AGEING, PER BILL (W15-94): each open bill's follow-up band and its days past due (split out of books-engines.js, whose size row may not grow), and what a bill's allocations have settled.
 * OWNER     cb-finance
 * RISK      money
 * OWNS      billBands(docs, asOf, creditDaysOf, side) → { ref → { band, days_late, no_terms } } · settledOf(items) → { ref → settled_minor }
 * CALLED BY books-engines.billBands · books-engines.settledOf (the one door: lib/books-party-bills · routes/books.js GET /party/:id/bills · /dues)
 * FLOW      the netted documents → books-engines.followDocs (the credit-days resolver) → the engine's follow-up ageing, by bill → the band and the days late
 * CARD      16-finance/receivables-and-payables
 */
'use strict';
const Engines = require('./books-engines');

/**
 * THE ONE AGEING, PER BILL: each open document's follow-up band (a key of the follow-up set) and its days past due — the same netted documents, the same credit-days
 * resolver and the same engine set as `follow` (followUp), so a bill's row, its party's chips and the page total cannot differ. A bill not yet due has days_late null.
 * → { ref → { band, days_late, no_terms } }
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
    out[doc.ref] = { band, days_late: late >= 0 ? late : null, no_terms: !!doc.no_terms };
  });
  return out;
}


/**
 * settledOf(items) → { ref: settled_minor } — the part of each bill that its ALLOCATIONS have already settled (the engine's allocation rows, net of their reversals; a receipt on account is not an allocation, so it is not counted).
 * Only bills with something settled appear. The opening replace asks this before it reverses a bill (FIN-64: a reversal releases the allocation).
 */
function settledOf(items) {
  const out = Object.create(null);
  (items || []).filter(Boolean).forEach((item) => {
    /* the bill's half of an allocation is negative against the bill; the reversal of an allocation puts it back (engine rows, receivables.js trackAllocation_) */
    if (item.ref_kind === 'allocation' || (item.ref_kind === 'reversal' && item.reverses_kind === 'allocation')) out[item.against_ref] = (out[item.against_ref] || 0) - Number(item.amount_minor || 0);
  });
  Object.keys(out).forEach((ref) => { if (!(out[ref] > 0)) delete out[ref]; });
  return out;
}

module.exports = { billBands, settledOf };
