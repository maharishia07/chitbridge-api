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
 * invoice is not withdrawable). A payment that was cleared or its receipt reversed no longer counts.
 *
 * THREE READS, EACH ON THE CALLER'S OWN HANDLE (core principle: never a shared row, never another party's row):
 *   tender   my copy carries business_json.payment (a counter bill's tender parts, or a mark on my copy)
 *   books    my books hold a PAYMENT allocated to the bill (party_item rows through the receivables engine's own view — not a second calculation;
 *            a reversed receipt nets out inside the engine)
 *   notice   the buyer's Mark-paid DELIVERED a timeline row into my copy (SECURITY DEFINER chit_log_targets — the rail's own delivery of an event into
 *            another party's copy, as the cancel message does); the latest of payment_marked / payment_cleared decides
 */
const NOTICE = Object.freeze({ marked: 'payment_marked', cleared: 'payment_cleared' });

/** the words a refusal says (a screen branches on `why`, never on this sentence) */
const PAID_SAID = Object.freeze({
  error: 'Cannot withdraw',
  message: 'This invoice has a payment on it, so it cannot be withdrawn. Issue a credit note for the amount instead.',
  why: 'paid'
});

/** tender: my copy of the invoice already says it was paid (a counter bill's tender, a mark) */
async function tenderOn(db, entity_id, chit_id) {
  const read = await db.query(`SELECT business_json->'payment' AS payment FROM chit_header WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id]);
  const payment = read.rows[0] && read.rows[0].payment;
  return !!(payment && typeof payment === 'object' && Object.keys(payment).length);
}

/** books: a payment still allocated to this bill in my ledger (read through the engine's own view of the party's rows) */
async function receiptInBooks(db, entity_id, chit_id) {
  const S = require('./books-store');
  const owners = await S.billParties(db, entity_id, chit_id);
  const E = require('./books-engines');
  for (const party of owners) {
    const rows = (await S.items(db, entity_id, party, null)).map(E.itemOf);
    const view = E.receivables().fromItems(rows);
    if (view.allocations.some((alloc) => String(alloc.debit) === String(chit_id) && Number(alloc.amount) > 0)) return true;
  }
  return false;
}

/** notice: the buyer's payment mark, delivered into MY timeline — true when the latest notice for this chit is `payment_marked` */
async function noticeOn(db, entity_id, chit_id) {
  const read = await db.query(
    `SELECT action FROM state_log WHERE chit_id = $1 AND entity_id = $2 AND action IN ('${NOTICE.marked}', '${NOTICE.cleared}') ORDER BY created_at DESC, log_id DESC LIMIT 1`,
    [chit_id, entity_id]
  );
  return !!(read.rows[0] && read.rows[0].action === NOTICE.marked);
}

/** is this chit an invoice I SENT? (credit and debit notes are their own purposes: not asked) */
async function isMyInvoice(db, entity_id, chit_id) {
  const read = await db.query(`SELECT purpose FROM chit_header WHERE chit_id = $1 AND entity_id = $2 AND sender_entity_id = $2`, [chit_id, entity_id]);
  return !!(read.rows[0] && read.rows[0].purpose === 'invoice');
}

/** → true when money has been applied to the invoice I sent (any amount above 0), false for anything else (an order, a note, an unpaid invoice) */
async function paidFactsOf(db, entity_id, chit_id) {
  if (!(await isMyInvoice(db, entity_id, chit_id))) return false;
  return (await tenderOn(db, entity_id, chit_id)) || (await noticeOn(db, entity_id, chit_id)) || (await receiptInBooks(db, entity_id, chit_id));
}

/**
 * the buyer pressed Mark paid / Mark unpaid on THEIR copy: tell the sender's copy, in the same transaction (their own timeline row, no shared row).
 * `db` = the buyer's handle. Another installation's sender is not reached here (the CTP return leg is RAIL-216 phase B). A failure throws: a payment
 * the seller could never see is the bug this closes, so the mark is not saved without the notice.
 */
async function tellPaid(db, buyer_id, chit_id, word, actor) {
  const sent = await db.query(`SELECT sender_entity_id FROM chit_header WHERE chit_id = $1 AND entity_id = $2`, [chit_id, buyer_id]);
  const sender = sent.rows[0] && sent.rows[0].sender_entity_id;
  if (!sender || sender === buyer_id) return false;
  await db.query(`SELECT chit_log_targets($1::uuid, ARRAY[$2]::uuid[], $3, $4::uuid, $5, $6)`, [chit_id, sender, word, actor.id || null, actor.name || null, 'The buyer marked this ' + (word === NOTICE.marked ? 'paid' : 'unpaid')]);
  return true;
}

module.exports = { paidFactsOf, tellPaid, NOTICE, PAID_SAID };
