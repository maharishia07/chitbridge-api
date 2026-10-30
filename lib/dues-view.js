// @stage tested
// @stage-note [CB FINANCE] What a cost-blind co-assist may see of a party's dues (RAIL-146i). Pure: an answer in, the same answer out with the
// @stage-note purchase-side money gone. Nothing here reads the books or computes a figure — the callers hand it what the books said.
'use strict';
/**
 * lib/dues-view.js — THE ONE RULE FOR A PARTY BALANCE SHOWN TO AN ACTOR WITHOUT can_see_costs (RAIL-146i; design
 * C:/dev/docs/16-finance/DESIGN-RAIL-146i-dues-cost-blind.md; critic docs/critique/RAIL-146i.md).
 *
 * ⭐ R1 a balance a CUSTOMER owes the shop is sell-side money: a cost-blind co-assist may see it (it is what they collect at the counter).
 * ⭐ R2 a balance the shop owes a SUPPLIER (or paid ahead) is purchase-side money: `balance_minor: null`, `cost_hidden: true` (the RAIL-146 shape).
 * ⭐ R3 a party on BOTH lists nets the two; the customer half alone is a plausible wrong number (the web paints ONE figure with a direction word
 *   from its sign, and the owner's figure is the net), so `side: 'both'` hides too — as RAIL-146b/146e null a partial sum (rollupGroup keeps a
 *   partial sum; that is the OTHER precedent, and dues follows 146e on purpose).
 * ⭐ R4 what is not money stays: `side`, `oldest_due` (a date), `open_side` (a yes/no), `overdue` and the list's count — RAIL-146 §3, counts stand.
 *   The caller computes `overdue` from the real figure first (crm.markLate), then hides.
 * ⭐ R5 supplier TERMS are purchase terms (lib/cost COST_KEYS names supplier_terms): `terms.supplier.credit_limit_minor: null`, `cost_hidden: true`;
 *   `credit_days` stays. Customer terms are untouched.
 * ⭐ R6 the owner and an actor WITH can_see_costs never reach this file: the caller reads cost.isCostBlind ONCE and calls only when it is true.
 * ⚠️ a ledger-off party has `dues: null` and no `terms.supplier`: null stays null, absent stays absent (the critic's probe).
 *
 * owns: the rule above, for the party list / record (lib/crm) and the books' dues page (GET /dues)
 * called by: lib/crm.js list() · one() — hideParty · routes/books.js GET /dues — blindDuesAnswer
 * FLOW  blind (the caller's one read) ──▶ hideParty(party) | blindDuesAnswer(answer) ──▶ the same shape, purchase money null, cost_hidden:true
 * // CARD 16-finance/collections
 */
const HIDDEN = { balance_minor: null, cost_hidden: true };
/** the sides whose figure carries what the shop owes: the supplier list, or a both-sides net (R2, R3) */
const purchaseSide = (side) => side === 'supplier' || side === 'both';
/** every key kept, every value null — a bucket object keeps its shape with no figure in it */
const nullValues = (o) => Object.fromEntries(Object.keys(o || {}).map((k) => [k, null]));
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || '')) || String(a.party_id).localeCompare(String(b.party_id));

/** a party's dues object (lib/crm net) for a blind reader: a customer-side figure stands; a supplier or both-sides figure goes */
function blindDues(dues) {
  if (!dues || typeof dues !== 'object' || !purchaseSide(dues.side)) return dues;
  return Object.assign({}, dues, HIDDEN);
}

/** a party's terms for a blind reader: the supplier's credit limit goes (R5); customer terms and credit_days stay */
function blindTerms(terms) {
  if (!terms || !terms.supplier) return terms;
  return Object.assign({}, terms, { supplier: Object.assign({}, terms.supplier, { credit_limit_minor: null, cost_hidden: true }) });
}

/** one party row of the CRM list or record, in place (the caller already ran markLate on the real figure) */
function hideParty(party) {
  if (!party || typeof party !== 'object') return party;
  if (party.dues !== undefined) party.dues = blindDues(party.dues);
  if (party.terms) party.terms = blindTerms(party.terms);
  return party;
}

/** one /dues row for a blind reader: the supplier or both-sides money goes at every key that carries it (balance, disputed, buckets, foreign) */
function blindDuesRow(row) {
  if (!row || !purchaseSide(row.side)) return row;
  const out = Object.assign({}, row, HIDDEN, { disputed_minor: null, buckets: nullValues(row.buckets) });
  if (Array.isArray(row.foreign)) out.foreign = row.foreign.map((f) => Object.assign({}, f, { balance_minor: null, carried_minor: null }));
  return out;
}

/**
 * the whole GET /dues answer for a blind reader: priced rows keep the route's order; hidden rows follow, by name (their rank by amount must not show);
 * the page total is null + cost_hidden when any row hid. A page with no purchase side (?side=customer) comes back as it was.
 */
function blindDuesAnswer(answer) {
  const rows = ((answer && answer.parties) || []).map(blindDuesRow);
  const hidden = rows.filter((r) => r.cost_hidden);
  if (!hidden.length) return answer;
  const priced = rows.filter((r) => !r.cost_hidden);
  return Object.assign({}, answer, { parties: priced.concat(hidden.sort(byName)), total_minor: null, cost_hidden: true });
}

module.exports = { blindDues, blindTerms, hideParty, blindDuesRow, blindDuesAnswer, purchaseSide };
