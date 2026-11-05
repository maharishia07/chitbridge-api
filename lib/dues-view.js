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
 * ⭐ R7 (RAIL-146m) A PAYMENT TO A SUPPLIER is purchase money in every answer about it: POST /payments/preview · POST /payments (the outcome,
 *   the allocation, the advice, the 409's words) · POST /payments/:id/propose · GET /payments/:id/advice. A payment FROM a customer is R1 (stands).
 *   The answer keeps its SHAPE: every key stays; what is not named in the allowlist below answers null (the rail's lesson — money lives in VALUES,
 *   so a sentence goes whole: words, balance_words, over_words, a note); the root says `cost_hidden: true`. What stays: ids, bill numbers, due
 *   dates, the disputed flag, the warning codes and entry numbers, the counts, the party's name — and nothing the reader typed is re-said
 *   (the amount they paid is in their own request, never echoed in a sentence that also carries the bill's figure).
 *   The advice to the supplier names the bills' figures, so a blind payer may not send or share it (`may.*.ok: false`, why 'cost_blind').
 *
 * owns: the rule above, for the party list / record (lib/crm), the books' dues page (GET /dues) and the payment answers (R7)
 * called by: lib/crm.js list() · one() — hideParties · routes/books.js GET /dues — blindDuesAnswer · routes/books.js forPayer / alreadyPaid —
 *   blindPayment (the four payment doors, RAIL-146m)
 * FLOW  blind (the caller's one read) ──▶ hideParties(parties, opt) | blindDuesAnswer(answer) ──▶ the same shape, purchase money null, cost_hidden:true
 * // CARD 16-finance/collections
 */
const HIDDEN = { balance_minor: null, cost_hidden: true };
/** the sides whose figure carries what the shop owes: the supplier list, or a both-sides net (R2, R3) */
const purchaseSide = (side) => side === 'supplier' || side === 'both';
/** every key kept, every value null — a bucket object keeps its shape with no figure in it */
const nullValues = (figures) => Object.fromEntries(Object.keys(figures || {}).map((key) => [key, null]));
const byName = (first, second) =>
  String(first.name || '').localeCompare(String(second.name || '')) || String(first.party_id).localeCompare(String(second.party_id));

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

/** the CRM's page or record rows, in place, when the caller's options say `blind` (lib/crm list · one hand their own options through; no branch there) */
function hideParties(parties, opt) {
  if (opt && opt.blind) (parties || []).forEach(hideParty);
  return parties;
}

/** one /dues row for a blind reader: the supplier or both-sides money goes at every key that carries it (balance, disputed, buckets, foreign) */
function blindDuesRow(row) {
  if (!row || !purchaseSide(row.side)) return row;
  const out = Object.assign({}, row, HIDDEN, { disputed_minor: null, buckets: nullValues(row.buckets) });
  if (Array.isArray(row.foreign)) out.foreign = row.foreign.map((line) => Object.assign({}, line, { balance_minor: null, carried_minor: null }));
  return out;
}

/**
 * the whole GET /dues answer for a blind reader: priced rows keep the route's order; hidden rows follow, by name (their rank by amount must not show);
 * the page total is null + cost_hidden when any row hid. A page with no purchase side (?side=customer) comes back as it was.
 */
function blindDuesAnswer(answer) {
  const rows = ((answer && answer.parties) || []).map(blindDuesRow);
  const hidden = rows.filter((party) => party.cost_hidden);
  if (!hidden.length) return answer;
  const priced = rows.filter((party) => !party.cost_hidden);
  return Object.assign({}, answer, { parties: priced.concat(hidden.sort(byName)), total_minor: null, cost_hidden: true });
}

/* ── R7 · a payment to a supplier (RAIL-146m) ─────────────────────────────────────────────────────────────────────────────────── */
/** the side a payment's money is on (books.proposeFor: in → the customer control, out → the supplier control) */
const paymentSide = (direction) => (direction === 'out' ? 'supplier' : 'customer');
/** an allowlist node: KEEP (a primitive passes; an object or a list under it does not — no pass-through leaf), or a nested spec; built without a prototype */
const KEEP = 'keep';
const spec = (keys, nested) => Object.freeze(Object.assign(Object.create(null), Object.fromEntries(keys.map((key) => [key, KEEP])), nested || {}));
const BILL_ROW = spec(['against_ref', 'bill_no', 'due_date', 'disputed']);
const WARNING = spec(['code', 'entry_no', 'payment_id']);
const VERDICT = spec(['ok']);
const ADVICE = spec(['payment_id'], { party: spec(['party_id', 'name', 'on_rail']), advice: spec(['chit_id', 'state', 'shared_at']), may: spec([], { send_advice: VERDICT, share_advice: VERDICT }) });
const PAYMENT_KEEP = Object.freeze({
  preview: spec(['currency'], { party: ADVICE.party, proposal: BILL_ROW, skipped: spec(['against_ref', 'why']), warnings: WARNING }),
  propose: spec(['payment_id'], { proposal: BILL_ROW, skipped: spec(['against_ref', 'why']) }),
  record: spec(['ok'], {
    payment: spec(['payment_id', 'status', 'duplicate']),
    posted: spec(['ok', 'entry_id', 'entry_no', 'posting_date', 'doc_date', 'moved', 'lines', 'items']),
    allocation: spec(['ok', 'items'], { settled: spec(['against_ref']) }),
    outcome: spec([], { settled: spec(['against_ref', 'bill_no']) }),
    advice: ADVICE
  }),
  advice: spec(['currency'], ADVICE),
  refusal: spec([], { warnings: WARNING })
});
const isPrimitive = (value) => value === null || ['string', 'number', 'boolean'].includes(typeof value);
/** the same keys, at every depth; a value survives only where its spec says KEEP and it is a primitive (a list maps each member through its spec) */
function keepShape(value, node) {
  if (Array.isArray(value)) return value.map((member) => keepShape(member, node));
  if (node === KEEP) return isPrimitive(value) ? value : null;
  if (!node || !value || typeof value !== 'object') return value === undefined ? undefined : null;
  return Object.fromEntries(Object.keys(value).map((key) => [key, keepShape(value[key], Object.hasOwn(node, key) ? node[key] : null)]));
}
const ADVICE_REFUSED = Object.freeze({ ok: false, why: 'cost_blind', say: 'This advice names what the bills cost — the account owner sends it.' });
/** the advice's two verdicts for a blind payer: neither send nor share (the words, body and share link are gone) */
const refuseAdvice = (advice) => (advice && advice.may ? Object.assign(advice, { may: { send_advice: ADVICE_REFUSED, share_advice: ADVICE_REFUSED } }) : advice);
/**
 * ⭐ blindPayment(kind, answer, direction) → the payment answer a cost-blind reader gets (R7). kind: preview · propose · record · advice · refusal.
 * A customer's payment (direction 'in'), a null answer or a kind with no allowlist comes back as it is (same reference) — R1 and fail-closed for
 * an unknown kind is the CALLER's test: it names its kind. The owner's object is never mutated.
 */
function blindPayment(kind, answer, direction) {
  if (!answer || typeof answer !== 'object' || !purchaseSide(paymentSide(direction))) return answer;
  if (!Object.hasOwn(PAYMENT_KEEP, kind)) throw new Error('dues-view.blindPayment: no allowlist for ' + kind);
  const out = keepShape(answer, PAYMENT_KEEP[kind]);
  if (kind === 'record') refuseAdvice(out.advice);
  if (kind === 'advice') refuseAdvice(out);
  return Object.assign(out, { cost_hidden: true });
}

module.exports = { blindDues, blindTerms, hideParty, hideParties, blindDuesRow, blindDuesAnswer, purchaseSide, paymentSide, blindPayment, PAYMENT_KEEP };
