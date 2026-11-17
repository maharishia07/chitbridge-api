'use strict';
/**
 * lib/chits-till-send.js — the till key's one send beyond itself: a two-sided counter bill to ONE customer, and the two kinds of no (refuse, or one-sided).
 * OWNS      tillMaySend · customerNameOf · counterBillShapeRefusal · isCounterOrder · counterCustomerRefusal (no route, no state)
 * CALLED BY routes/chits.js (the send gate, sendTillGate)
 * FLOW      tillMaySend(sender, outward, payload) -> null (may) | { refuse } (403 TILL_SEND_REFUSED) | { oneSided } (recorded, customer's copy dropped, said)
 * CARD      01-rail-core-the-chit/chits-routes
 */
const cbLog = require('./logger');
const { withEntity } = require('../db');
const localIdentity = require('./local-identity'); /* mayTrade — may this party trade with this shop (onRail + population, b249's rule, at the door) */
const taxCopy = require('./tax-copy');

/**
 * ⭐⭐ THE ONE THING A TILL KEY MAY SEND BEYOND ITSELF — the two-sided counter bill (Athi, 2026-10-01: *"naming a connected
 * customer on a credit or named bill IS the sending"*). The key lives on a shop PC anyone can pick up, so the door opens
 * exactly this wide and no wider:
 *   · a COUNTER BILL (a bill number from a till — lib/tax-copy counterIssued), purpose 'order'
 *   · ONE outside recipient, as 'to', addressed by entity id
 *   · who is the bill's own customer (business_json.customer.entity_id) — the counter names whom it is billing
 *   · and is on THIS shop's customer list AND a business on the rail (lib/local-identity onRailSql — the same test the
 *     counter's snapshot made when it offered them) AND in the same sandbox (lib/istest mayTradeSql — b249's rule).
 *
 * ⭐⭐⭐ TWO KINDS OF NO, AND ONLY ONE OF THEM REFUSES THE BILL (Athi, 2026-10-02: *"if another customer who is not in our
 * network if the bill raised against him on credit, still we have to proceed, but only thing is it is not two ways"*).
 *   · { refuse }   — the SHAPE is wrong (two parties, a cc, not a counter bill, a customer the bill does not name). That is
 *                    not a sale this key may record at all: 403, code TILL_SEND_REFUSED.
 *   · { oneSided } — the shape is right but the customer cannot receive their copy (not on the list, not on ChitBridge,
 *                    no longer active, another sandbox, or the check could not run). THE SALE IS THE SHOP'S OWN RECORD and
 *                    is recorded with its ledger; only the customer's copy is dropped, and the answer says why.
 * ⚠️ Before this, both were a bare 403 that the counter read as "key refused" — two bills sat pending with the network green.
 */
async function tillMaySend(sender_id, outward, payload) {
  const billBody = payload || {},
    businessJson = billBody.business_json || {};
  const shapeRefusal = counterBillShapeRefusal(outward, billBody, businessJson);
  if (shapeRefusal) return shapeRefusal;
  const recipient = outward[0];
  const customerId = String(recipient.entity_id || '');
  const customerName = customerNameOf(recipient, businessJson);
  try {
    const ok = await withEntity(sender_id, (db) =>
      db.query(
        `SELECT 1 AS ok FROM customer_list c JOIN identities i ON i.identity_id = c.customer_identity_id
        WHERE c.owner_entity_id = $1 AND c.customer_identity_id = $2 AND ${localIdentity.mayTradeSql('i', '$1')}
        LIMIT 1`,
        [sender_id, customerId]
      )
    );
    if (ok.rows.length === 1) return null;
    /* the second look only says WHICH rule failed, so the words on the bill are the true ones */
    const listed = await withEntity(sender_id, (db) =>
      db.query(`SELECT 1 AS ok FROM customer_list WHERE owner_entity_id = $1 AND customer_identity_id = $2 LIMIT 1`, [sender_id, customerId])
    );
    if (!listed.rows.length) return { oneSided: customerName + " is not on this shop's customer list" };
    const verdict = await localIdentity.mayTrade(sender_id, customerId);
    return { oneSided: verdict.ok ? customerName + ' could not be sent their copy' : verdict.say };
  } catch (error) {
    cbLog.fellBack('chits tillMaySend: the customer check could not run — answered one-sided', error); /* the sale stays the shop's own record; only the customer's copy is dropped */
    return { oneSided: 'the customer could not be checked just now' };
  }
}
/** the words that name the customer on a counter bill: the recipient's name, else the bill's customer, else "this customer" */
function customerNameOf(recipient, businessJson) {
  return recipient.name || (businessJson.customer && businessJson.customer.name) || 'this customer';
}
/** the first shape rule a counter bill breaks on its way to ONE customer (one recipient · "to" · an order with a counter number · a ChitBridge id · the named customer), or null when the shape is right */
function counterBillShapeRefusal(outward, billBody, businessJson) {
  if (outward.length !== 1) return { refuse: 'a counter bill can go to one customer only' };
  const recipient = outward[0];
  if (String(recipient.role || 'to').toLowerCase() !== 'to') return { refuse: 'a counter bill can only be addressed "to" its customer' };
  if (!isCounterOrder(billBody, businessJson)) return { refuse: 'it is not a counter bill (no bill number or counter on it)' };
  return counterCustomerRefusal(String(recipient.entity_id || ''), businessJson);
}
/** is this send an order the counter numbered (purpose `order`, a bill number and counter on it)? */
function isCounterOrder(billBody, businessJson) {
  return String(billBody.purpose || 'order') === 'order' && !!taxCopy.counterIssued(businessJson);
}
/** a refusal when the recipient is no ChitBridge id, or is not the customer the bill names; null when they match */
function counterCustomerRefusal(customerId, businessJson) {
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) return { refuse: 'the customer has no ChitBridge id on this bill' };
  if (!businessJson.customer || String(businessJson.customer.entity_id || '') !== customerId) return { refuse: 'the bill names a different customer from the one it is sent to' };
  return null;
}

module.exports = { tillMaySend };
