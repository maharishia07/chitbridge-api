'use strict';
/**
 * lib/books-pay-side.js — B6-12: which control account a payment touches is decided by the PARTY's role in the document, not by the direction alone.
 * OWNS      sideOf(on, direction) → 'customer' | 'supplier' · partySide(S, handle, entity, party, direction) · isRefund(side, direction) · refundEvent(payment, row, modeRole, options) (money paid BACK to a customer, or refunded by a supplier)
 * CALLED BY lib/books.js proposeFor · settleBills (allocation side) · writeChequeStep · askDuplicateRule · postPaymentEntry (the ONE reader of that choice)
 * CARD      14-accounting/README
 * FLOW      direction in  ──▶ the customer's Debtors (a supplier-only party refunding us: Creditors)
 *           direction out ──▶ the supplier's Creditors (a customer-only party we refund: Debtors). The two refunds (out to a customer, in from a supplier) post as the engine's `manual` event, since no engine event does
 * A party on BOTH lists keeps the direction's usual side (in → customer, out → supplier). Nothing is calculated here; the amount is the payment's own minor figure.
 * ⚠️ Law is not a switch: this picks a ledger the document already names, it changes no rule.
 */
/** the side from the party's list flags `on` = { customer, supplier } and the direction */
function sideOf(on, direction) {
  const flags = on || {};
  if (direction === 'in') return flags.customer || !flags.supplier ? 'customer' : 'supplier';
  return flags.supplier || !flags.customer ? 'supplier' : 'customer';
}
/** the side for one party, read from the shop's party list (S.partyOn) */
async function partySide(S, handle, entity, party, direction) {
  return sideOf(party ? await S.partyOn(handle, entity, party) : null, direction);
}
/** a refund, not the usual payment: money paid OUT to a customer, or money IN from a supplier (the engine's payment events post only the usual two) */
const isRefund = (side, direction) => (direction === 'out') === (side === 'customer');
/** money paid back to a customer (Dr Debtors · Cr the mode) or refunded by a supplier (Dr the mode · Cr Creditors), as the manual journal, in the payment's own refs so the party rows and allocation read it as the payment */
function refundEvent(payment, row, modeRole, options) {
  const Money = require('./books-cashflow');
  const amount = Money.fromMinor(payment.amount_minor, payment.currency);
  return Object.assign({
    type: 'manual',
    owner: true,
    narration: payment.direction === 'out' ? 'Refund to customer' : 'Refund from supplier',
    party: payment.party_id,
    currency: payment.currency,
    date: options.date,
    lines: payment.direction === 'out' ? [{ account: 'debtors', dr: amount, cr: 0, party: payment.party_id }, { account: modeRole, dr: 0, cr: amount }] : [{ account: modeRole, dr: amount, cr: 0 }, { account: 'creditors', dr: 0, cr: amount, party: payment.party_id }],
    ref: 'pay:' + row.payment_id,
    source_ref: 'pay:' + row.payment_id,
    doc_ref: 'pay:' + row.payment_id,
    payment_id: row.payment_id,
    by: options.by
  });
}
module.exports = { sideOf, partySide, isRefund, refundEvent };
