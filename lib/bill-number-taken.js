// @stage tested
// @stage-note AB-F-06 (walk AB, 1129): one bill number, one tax invoice per shop - a second bill with a number already held is refused in words, never taken
'use strict';
/**
 * lib/bill-number-taken.js - A SHOP'S BILL NUMBER BELONGS TO ONE BILL.
 *
 * OWNS       the refusal "that number is already on another bill": the read of the holder, the one lock per number, the sentence. 409 BILL_NUMBER_TAKEN, thrown as data
 *            (lib/knownerr thrownRefusal), nothing written. Replay of the SAME client_ref is not a second bill: the duplicate path answers it first, and the read ignores the same client_ref.
 * CALLED BY  routes/chits.js sendBillTaken (the early look, before anything is written) and sendWrite / sendLegacyWrite (again, under the number's lock, in the transaction that inserts the bill).
 * FLOW       send body ──> applies? (a counter document that carries a bill_no, not a draft) ──> lock bill-no|<number> (lib/xact-lock) ──> the shop's other sent copy with that number
 *            ──> none: go on · one: refuse, naming it
 * WHY        two sales with one bill_no and different client_ref were both taken (AB-F-06): the day sheet counted one, so a sale reached no sheet and no books. AU, IN and AE law each want a tax
 *            invoice number to be unique; the unique index (migrations/b907_chit_bill_no_unique.sql) is the second fence, run by hand; until it runs THIS check, under the lock, holds alone.
 * ⚠️ The number is compared as sent (trimmed), upper-case insensitive is NOT applied: C1/0001 and c1/0001 are two numbers to the printed paper and to the index.
 */
const lock = require('./xact-lock');

const CODE = 'BILL_NUMBER_TAKEN';

/** the bill number a send carries, or null when it is not a counter document with a number (drafts and receipts of a supplier's bill are not judged) */
function numberOf(sendState) {
  const business = sendState && sendState.business_json;
  if (!sendState || sendState.is_draft || !business || typeof business !== 'object') return null;
  if (!(business.till && typeof business.till === 'object')) return null;
  const sent = business.bill_no;
  if (typeof sent !== 'string' && typeof sent !== 'number') return null;
  const text = String(sent).trim();
  return text ? text : null;
}

/** the shop's OWN sent copy that holds this number under another reference, or null: the oldest, never a draft, never this send's own client_ref */
async function holderOf(db, shop, number, clientRef) {
  const found = await db.query(
    `SELECT chit_id, business_json ->> 'client_ref' AS client_ref FROM chit_header
      WHERE entity_id = $1 AND sender_entity_id = $1 AND role <> 'Draft' AND business_json ? 'till'
        AND btrim(business_json ->> 'bill_no') = $2::text
        AND (business_json ->> 'client_ref') IS DISTINCT FROM $3::text
      ORDER BY created_at LIMIT 1`,
    [shop, number, clientRef || null]
  );
  return found.rows[0] || null;
}

/** the refusal thrown as data: 409, the registered code, the sentence naming the bill that holds the number */
function refusalOf(number, holder) {
  const where = holder.client_ref ? ' (' + holder.client_ref + ')' : '';
  return Object.assign(new Error('Bill number ' + number + ' is already on another bill' + where + ' of this shop. One number goes on one bill, so this bill was not taken. Number it again and send it.'), {
    status: 409, refused: true, code: CODE, title: 'Bill number already used', holder_chit_id: holder.chit_id
  });
}

/**
 * judge(db, sendState, { locked }) - throws the refusal when another bill holds the number. `locked` takes the number's lock first (the write transaction: two staff at once
 * wait here, and the second reads the first one's committed header); the early look in the route takes none (it only spares the work).
 */
async function judge(db, sendState, options) {
  const number = numberOf(sendState);
  if (!number) return;
  const shop = sendState.sender_id;
  if (options && options.locked) await lock.lockKeys(db, shop, ['bill-no|' + number]);
  const holder = await holderOf(db, shop, number, sendState.client_ref || (sendState.business_json && sendState.business_json.client_ref));
  if (holder) throw refusalOf(number, holder);
}

module.exports = { judge, numberOf, holderOf, CODE };
