// @stage built
// @stage-note RAIL-216: has money been applied to this invoice? The ONE fact the sender's withdraw (void / own cancel) asks before it may reverse a sale.
// CARD 01-rail-core-the-chit/status-the-one-status-writer
// owns: the "paid" fact of the invoice I sent (tender on my copy · a receipt allocated in my books · the buyer's payment notice in my own timeline); the notice's two words.
// called by: lib/rail-status.js (paidRefusal) · routes/chits.js POST/DELETE /:chit_id/payment (tellPaid) · tests/rail-216-void-paid.test.cjs.
// FLOW  seller withdraws → statusGate → paidRefusal → paidFactsOf (3 reads on MY handle, nothing crosses) → 409 paid → credit note.
'use strict';
/**
 * lib/chit-paid.js — ⭐ RAIL-216 (P1, 2026-11-09): THE SELLER CANNOT VOID AN INVOICE THAT HAS A PAYMENT ON IT.
 *
 * THE RULE (Athi's own wording on the backlog line, the general counter-document principle of the books): a payment is an event on the record;
 * what it settled is undone by a visible credit note, never by making the sale disappear. Any applied amount above 0 counts (a half-paid
 * invoice is not withdrawable). A receipt the seller reversed in the seller's own books no longer counts; the buyer's notice and the till's tender never un-say (refund = credit note).
 *
 * THREE READS, EACH ON THE CALLER'S OWN HANDLE (core principle: never a shared row, never another party's row):
 *   tender   my copy carries business_json.payment (a counter bill's tender parts, or a mark on my copy)
 *   books    my books hold a PAYMENT allocated to the bill (party_item rows through the receivables engine's own view — not a second calculation;
 *            a reversed receipt nets out inside the engine)
 *   notice   the buyer's Mark-paid DELIVERED a timeline row into my copy (SECURITY DEFINER chit_log_targets — the rail's own delivery of an event into
 *            another party's copy, as the cancel message does); payment_marked, once delivered, stays (monotonic)
 */
const NOTICE = Object.freeze({ marked: 'payment_marked' });

/** the words a refusal says (a screen branches on `why`, never on this sentence) */
const PAID_SAID = Object.freeze({
  error: 'Cannot withdraw',
  message: 'This invoice has a payment on it, so it cannot be withdrawn. Issue a credit note for the amount instead.',
  why: 'paid'
});

/** tender: my copy of the invoice says money came — a counter bill's parts other than credit (a credit part is a promise) and UPI still waiting (books-hooks modesOf holds them back), or a mark on my copy */
async function tenderOn(db, entity_id, chit_id) {
  const read = await db.query(`SELECT business_json->'payment' AS payment FROM chit_header WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id]);
  const payment = read.rows[0] && read.rows[0].payment;
  if (!(payment && typeof payment === 'object' && Object.keys(payment).length)) return false;
  if (!Array.isArray(payment.parts)) return true; /* a mark: method · amount · when */
  const { modes } = require('./books-hooks').modesOf(payment.parts, true);
  return Object.keys(modes).some((mode) => mode !== 'credit' && modes[mode] > 0);
}

/** books: a payment still allocated to this bill in my ledger (read through the engine's own view of the party's rows) */
async function receiptInBooks(db, entity_id, chit_id) {
  const booksStore = require('./books-store');
  const owners = await booksStore.billParties(db, entity_id, chit_id);
  const booksEngines = require('./books-engines');
  for (const party of owners) {
    const rows = (await booksStore.items(db, entity_id, party, null)).map(booksEngines.itemOf);
    const view = booksEngines.receivables().fromItems(rows);
    if (view.allocations.some((alloc) => String(alloc.debit) === String(chit_id) && Number(alloc.amount) > 0)) return true;
  }
  return false;
}

/** notice: the buyer's payment mark was DELIVERED into my timeline. MONOTONIC — nothing un-says it: clearing the mark on the buyer's copy leaves the buyer's books holding the payment (drift D1), so a refund is a credit note, not a void. Level-independent (Athi, DECISIONS c58aa8a8 (3)): a buyer who restricted R-1400 still counts. */
async function noticeOn(db, entity_id, chit_id) {
  const read = await db.query(`SELECT 1 FROM state_log WHERE chit_id = $1 AND entity_id = $2 AND action = '${NOTICE.marked}' LIMIT 1`, [chit_id, entity_id]);
  return read.rows.length > 0;
}

/**
 * is this copy an invoice I ISSUED? Two shapes, both mine as sender: a counter bill / named counter bill (folder-inventory docOf 'bill_issued' — purpose order·offer·subscription
 * + bill_no + till) and a B2B invoice sent over the rail (purpose 'invoice', sender me — docOf has no word for it, so it is asked by its own two columns). Credit and debit notes,
 * and an order that is no counter bill, are neither.
 */
async function isMyInvoice(db, entity_id, chit_id) {
  const read = await db.query(`SELECT purpose, sender_entity_id, business_json FROM chit_header WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id]);
  const row = read.rows[0];
  if (!row) return false;
  if (require('./folder-inventory').docOf(row, entity_id) === 'bill_issued') return true;
  return row.purpose === 'invoice' && String(row.sender_entity_id || '') === String(entity_id);
}

/** → true when money has been applied to the invoice I sent (any amount above 0), false for anything else (an order, a note, an unpaid invoice) */
async function paidFactsOf(db, entity_id, chit_id) {
  if (!(await isMyInvoice(db, entity_id, chit_id))) return false;
  return (await tenderOn(db, entity_id, chit_id)) || (await noticeOn(db, entity_id, chit_id)) || (await receiptInBooks(db, entity_id, chit_id));
}

/**
 * the buyer pressed Mark paid on THEIR copy: tell the sender's copy, in the same transaction (their own timeline row, no shared row; hidden from readers as another shop's internal step).
 * NO actor on the row (action_by_identity_id NULL): the bell's feed and badge count only rows done by someone else (`action_by_identity_id <> me`), and NULL is neither — the marker is a fact for the withdraw check, never news. `db` = the buyer's handle. Another installation's sender is not reached here (RAIL-216 phase B: the CTP return leg). A failure throws: the mark is not saved without the notice.
 */
async function tellPaid(db, buyer_id, chit_id) {
  const word = NOTICE.marked;
  const sent = await db.query(`SELECT sender_entity_id FROM chit_header WHERE chit_id = $1 AND entity_id = $2`, [chit_id, buyer_id]);
  const sender = sent.rows[0] && sent.rows[0].sender_entity_id;
  if (!sender || sender === buyer_id) return false;
  await db.query(`SELECT chit_log_targets($1::uuid, ARRAY[$2]::uuid[], $3, $4::uuid, $5, $6)`, [chit_id, sender, word, null, null, 'The buyer marked this paid']);
  return true;
}

module.exports = { paidFactsOf, tellPaid, NOTICE, PAID_SAID };
