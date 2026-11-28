'use strict';
/**
 * lib/books-cheque-return.js — BB-P1-1: a cheque the bank sent back, as the Bank page posts it (the owner's reversal of the cleared receipt, POST /entries/:id/reverse).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      givenDay (the day the person gives a reversal, held to the typed-date rules) · markReturned (the 'bounced' status row of a cheque payment whose cleared receipt was reversed)
 * CALLED BY lib/books.js writeReversal (the one reversal writer); `helpers` is books.js's own helpers handed in (typedDate, refuse, isoDay, S, E, controlOf, paySide, lockedItems), so nothing is copied
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * FLOW      reverseEntry { date? } → givenDay (typed-date gate, never before the receipt, a locked month refuses) → writeReversal mirror + reopened bills → markReturned (cheque payments only)
 * ⚠️ Only a person's reversal (owner: true, reverseEntry) carries a day or writes the status row: the cheque bounce STEP (writeChequeStep) is not an owner reversal and keeps writing its own single row.
 */

/** the day a person's reversal is dated on, or null (none given, or not a person's reversal: the original's month, as before); refused in words before the ledger began, ahead of the shop's tomorrow, or before the entry it reverses */
function givenDay(helpers, setting, pack, orig, entryEvent) {
  const day = entryEvent.owner === true && entryEvent.returned_on ? helpers.isoDay(entryEvent.returned_on) : null;
  if (!day) return null;
  helpers.typedDate(setting, pack, day, false);
  if (day < helpers.isoDay(orig.posting_date)) throw helpers.refuse('A reversal cannot be dated before the entry it reverses (' + helpers.isoDay(orig.posting_date) + ').');
  return day;
}

/**
 * the reversal of the receipt of a CHEQUE payment (entry source pay:<id>, payment mode 'cheque': a cash or bank receipt has the same source_ref and stops after one read) also writes the cheque's 'bounced' status row, after the
 * reversal rows, so Dues and GET /cheques read it bounced. itemsOfCheque refuses cleared → bounced (receivables.js), so the row is made with statusItem directly; a cheque already reading bounced gets none. → rows written (0 or 1)
 */
async function markReturned(helpers, handle, entity, orig, on, by) {
  const ref = String(orig.source_ref || '');
  if (!/^pay:/.test(ref)) return 0;
  const payment = await helpers.S.payment(handle, entity, ref.slice(4));
  if (!payment || payment.mode !== 'cheque') return 0;
  const acct = await helpers.controlOf(handle, entity, await helpers.paySide(handle, entity, payment.party_id, payment.direction));
  const mine = (await helpers.lockedItems(handle, entity, payment.party_id, acct.account_id)).filter((item) => item && item.ref === ref);
  if (!mine.length || mine.some((item) => item.ref_kind === 'status' && item.status === 'bounced')) return 0;
  const row = helpers.E.receivables().statusItem({ ref, party: mine[0].party, side: mine[0].side, currency: mine[0].currency }, 'bounced', on);
  await helpers.S.insertItems(handle, entity, [helpers.E.itemRow(row, acct.account_id, { payment_id: payment.payment_id, by })]);
  return 1;
}

module.exports = { givenDay, markReturned };
