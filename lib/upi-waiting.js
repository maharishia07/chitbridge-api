'use strict';
/**
 * OWNS      FIN-58 · the shop's ONE system party "UPI waiting" (a UPI part not yet seen to arrive is a receivable from it), its stranger-rule and dues
 *           hooks, and the flip ("it arrived") that settles it through the ONE payment path.
 * CALLED BY lib/books-hooks (the verdict names the party), lib/books-store partyOn (the stranger rule), routes/books GET /dues (quietRows), a route/press later (CTR-156).
 * FLOW      bill with parts[i].confirmed === false ──▶ sale_bill to partyIdOf(shop), paid = confirmed parts ──▶ confirmArrived ──▶ books.recordPayment
 *           (Dr UPI / Cr Debtors[UPI waiting], on the flip's date) + parts[i].confirmed = true.
 * CARD      16-finance/collections
 *
 * Why a party and not a queue or a bare account (plan C:/dev/PM/FIN-58-PLAN-2026-11-07.md): the sale is real on the bill's day (Day report, GST, ageing), and
 * recordPayment / allocation / dues are all party-keyed — a party reuses them unchanged. The party has NO identity row and NO customer_list row, so it is never
 * on the CRM list, search or export (lib/crm joins customer_list → identities); its id is DERIVED from the shop, so "ensured once per shop" needs no write and no
 * migration (party_item.party_id / journal_line.party_id carry no foreign key). Its name and flag come from here, not from a row.
 */
const crypto = require('crypto');

const KIND = 'upi_waiting';
const NAME = 'UPI waiting';

/** the shop's system party id: a name-based (v5-shaped) uuid of the shop, stable and different for every shop */
function partyIdOf(entity) {
  const bytes = crypto.createHash('sha1').update(KIND + ':' + String(entity)).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const digits = bytes.toString('hex');
  return [digits.slice(0, 8), digits.slice(8, 12), digits.slice(12, 16), digits.slice(16, 20), digits.slice(20, 32)].join('-');
}
const isWaitingParty = (entity, party_id) => !!party_id && String(party_id).toLowerCase() === partyIdOf(entity);

/** the part is a UPI tender the shop has been told is NOT yet confirmed (confirmed === false exactly: absent or true = as ever) */
const isWaitingPart = (part, modeOf) => !!part && part.confirmed === false && modeOf(part.how) === 'upi';

/**
 * the /dues rows with the system party made quiet, in place: named, flagged, and — on the ?finance=1 read (`collections`) — no reminder row, no interest, no limit,
 * no early-pay offer. It stays in the ageing (buckets · balance · oldest_due are the books' own). Other rows are untouched.
 */
function quietRows(rows, entity, collections) {
  for (const row of rows) {
    if (!isWaitingParty(entity, row.party_id)) continue;
    Object.assign(row, { name: NAME, system: KIND });
    if (collections) Object.assign(row, { follow_up: null, interest_minor: null, interest_state: 'off', early: null, credit_limit_minor: null, credit_limit_from: null, over_limit: false });
  }
  return rows;
}

const refuse = (words) => require('./books').refuse(words);

/** the bill's part, read with the facts the flip needs; refuses in words when this is not a UPI part of a bill of mine that WAS waiting */
async function waitingPartOf(db, entity, chit_id, index) {
  const copy = await require('./books-store').chitForFlip(db, entity, chit_id);
  if (!copy) throw refuse('That bill is not in your books.');
  const part = copy.business_json && copy.business_json.payment && copy.business_json.payment.parts && copy.business_json.payment.parts[index];
  if (!part) throw refuse('That bill has no such payment part.');
  if (require('./books-hooks').modeOf(part.how) !== 'upi') throw refuse('Only a UPI part can be marked as arrived.');
  if (part.confirmed !== true && part.confirmed !== false) throw refuse('That UPI part was never waiting — it was taken as received at the counter.');
  return { copy, part };
}

/** the recordPayment call for the flip: the UPI part's money, from whoever the bill names (else the system party), allocated to the bill, dated the flip's day */
function flipPayment(entity, found, args, key) {
  const hooks = require('./books-hooks');
  const currency = found.copy.currency_code || null;
  const amount_minor = hooks.toMinor(found.part.amount, currency);
  const named = hooks.partyFromCustomer(found.copy.business_json && found.copy.business_json.customer);
  return {
    party_id: named || partyIdOf(entity),
    direction: 'in',
    amount_minor,
    currency,
    mode: 'upi',
    received_at: args.received_at,
    client_ref: key,
    source_chit_id: args.chit_id,
    allocations: [{ against_ref: String(args.chit_id), amount_minor }],
    by: args.by
  };
}

/**
 * confirmArrived(db, entity, { chit_id, part, client_ref, received_at, by }) — "Yes, arrived". ONE payment through books.recordPayment, key chitpay:<chit>:<ref>,
 * mode upi, dated the FLIP's day, allocated to the bill; then parts[part].confirmed = true (+ confirmed_at) on the chit copy. A replay with the same ref answers the
 * first payment; a different ref on a part already confirmed is refused (no second receipt). → recordPayment's answer, + { confirmed: true }.
 */
async function confirmArrived(db, entity, args) {
  const store = require('./books-store');
  const found = await waitingPartOf(db, entity, args.chit_id, args.part);
  const key = require('./books-hooks').chitPaymentKey(args.chit_id, args.client_ref);
  if (found.part.confirmed === true && !(await store.paymentByRef(db, entity, key))) throw refuse('That UPI payment is already marked as arrived.');
  if (!(await store.entryBySource(db, entity, 'chit:' + args.chit_id))) throw refuse('That bill is not in the books yet — it posts first, then the UPI can be marked as arrived.');
  const recorded = await require('./books').recordPayment(db, entity, flipPayment(entity, found, args, key));
  await store.stampConfirmed(db, entity, args.chit_id, args.part, (args.now || new Date()).toISOString());
  return Object.assign({ confirmed: true }, recorded);
}

module.exports = { KIND, NAME, partyIdOf, isWaitingParty, isWaitingPart, quietRows, confirmArrived };
