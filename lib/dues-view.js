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
 * ⭐ R3b (FIN-72) a both-sides row's `follow_up` (the days-past-due split of what the customer half owes) goes null with it, and the page's `follow_up_total` goes null with total_minor.
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
 * ⭐ R8 (RAIL-146h) THE PARTY TIMELINE (GET /api/crm/parties/:id/timeline): a ledger entry's amount_minor is null + cost_hidden unless the party is a customer only
 *   (blindLedgerEntry); a chit entry's `value` follows lib/cost-view hideTimelineChit (per chit, costSideOf). The key stays; the date, ref and kind stand.
 *
 * ⭐ R9 (RAIL-146n) THE BOOKS' READ DOORS (routes/books.js forBooksDoor): GET /party/:id/statement · GET /ledger/:account · GET /cheques — blindBooks (one helper, three kinds); the 409 of a chit's
 *   Mark-paid (routes/chits payFailure) follows R7 by the direction the books' error carries (lib/books.js / lib/books-hooks.js ALREADY_PAID).
 *
 * owns: the rule above, for the party list / record (lib/crm), the books' dues page (GET /dues), the payment answers (R7) and the timeline's ledger entries (R8)
 * called by: routes/crm.js GET /parties/:id/timeline — blindLedgerEntry · lib/crm.js list() · one() — hideParties · routes/books.js GET /dues — blindDuesAnswer · routes/books.js forPayer / alreadyPaid —
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
  if (row.balance_words !== undefined) out.balance_words = null; /* FIN-60: the standing in words carries the same money */
  if (row.follow_up !== undefined) out.follow_up = null; /* FIN-72: a both-sides row's follow-up money goes whole; a supplier row never had one */
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
  const hiddenAnswer = { parties: priced.concat(hidden.sort(byName)), total_minor: null, cost_hidden: true };
  if (answer.follow_up_total !== undefined) hiddenAnswer.follow_up_total = null; /* FIN-72: the page's follow-up total follows total_minor */
  return Object.assign({}, answer, hiddenAnswer);
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

/* ── R8 · the party timeline (RAIL-146h) ───────────────────────────────────────────────────────────────────────────────────── */
/**
 * a timeline LEDGER entry for a blind reader (R8): the figure stays only where the party is a customer and NOT a supplier (R1). A supplier, a both-sides party
 * (R3: one row cannot say which half it is) and a party on neither list (fail closed) answer amount_minor null + cost_hidden:true; every other key stands.
 * `roles` = the party record's { customer, supplier }. A kept entry comes back as it is (same reference).
 */
function blindLedgerEntry(entry, roles) {
  const sales = !!(roles && roles.customer && !roles.supplier);
  return sales || !entry || entry.amount_minor === undefined ? entry : Object.assign({}, entry, { amount_minor: null, cost_hidden: true });
}

/* ── R9 · the books' read doors (RAIL-146n) ───────────────────────────────────────────────────────────────────────────────────── */
/** the money keys of a statement / ledger line; the date, the words, the ids and the source stay */
const LINE_MONEY = ['dr_minor', 'cr_minor', 'running_minor', 'unapplied_minor'];
const nullKeys = (row, keys) => Object.assign({}, row, Object.fromEntries(keys.filter((key) => row && row[key] !== undefined).map((key) => [key, null])));
/** an account on the SALES side (what customers owe, what the shop earned) stays plain to a blind reader; every other account carries purchase, stock, cash-out or payables money */
const salesAccount = (account) => !!account && (account.role === 'debtors' || account.nature === 'income');
/**
 * ⭐ R9 (RAIL-146n) blindBooks(kind, answer, opt) → the answer a cost-blind reader gets from GET /party/:id/statement · GET /ledger/:account · GET /cheques.
 * The SHAPE stays (every key, every line); the money goes null and the root says `cost_hidden: true`. The caller reads cost.isCostBlind ONCE and calls only
 * when it is true (R6). Fail closed: a kind with no rule throws.
 *   statement  opt.roles = the party's { customer, supplier }: a customer only stands (R1); a supplier, both sides or neither: opening, closing and each line's money null.
 *   ledger     opt.account = the account row: a sales-side account stands; any other: opening, closing, page figures, totals and each line's money null.
 *   cheques    a cheque the shop PAYS (direction 'out') answers amount_minor null; a cheque it receives stands (the post-dated reminders are all receipts).
 */
const nullLines = (list) => (Array.isArray(list) ? list.map((line) => nullKeys(line, LINE_MONEY)) : list);
function blindStatement(answer, roles) {
  if (roles && roles.customer && !roles.supplier) return answer;
  return Object.assign({}, nullKeys(answer, ['opening_minor', 'closing_minor']), { lines: nullLines(answer.lines), cost_hidden: true });
}
function blindLedger(answer, account) {
  if (salesAccount(account)) return answer;
  const totals = answer.totals ? nullKeys(answer.totals, ['dr_minor', 'cr_minor']) : answer.totals;
  return Object.assign({}, nullKeys(answer, ['opening_minor', 'closing_minor', 'page_opening_minor']), { lines: nullLines(answer.lines), totals, cost_hidden: true });
}
function blindCheques(answer) {
  if (!(answer.cheques || []).some((cheque) => cheque.direction === 'out')) return answer;
  const hide = (cheque) => (cheque.direction === 'out' ? Object.assign({}, cheque, { amount_minor: null, cost_hidden: true }) : cheque);
  return Object.assign({}, answer, { cheques: answer.cheques.map(hide), cost_hidden: true });
}
function blindBooks(kind, answer, opt) {
  if (!answer || typeof answer !== 'object') return answer;
  if (kind === 'statement') return blindStatement(answer, opt && opt.roles);
  if (kind === 'ledger') return blindLedger(answer, opt && opt.account);
  if (kind === 'cheques') return blindCheques(answer);
  throw new Error('dues-view.blindBooks: no rule for ' + kind);
}

module.exports = { blindBooks, blindLedgerEntry, blindDues, blindTerms, hideParty, hideParties, blindDuesRow, blindDuesAnswer, purchaseSide, paymentSide, blindPayment, PAYMENT_KEEP };
