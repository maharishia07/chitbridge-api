'use strict';
/**
 * tests/lib/rail-buyer.cjs — a buyer ON THE RAIL with bills open in my books: the world a money pack presses on.
 *
 * owns: sending a chit that must store · a fresh buyer shop added to my customers by its User ID · an invoice to it · waiting until
 *       the books hold its bills open (party_item rows).
 * called by: tests/payment-gorilla-truth.realstack.cjs (pack 2) · tests/books-payment-gorilla-truth.realstack.cjs (pack 3).
 * FLOW  buyerOnRail(shop, tag) → invoiceTo(shop, buyer, …) × n → openBills(pg, entity, party, n) → the bill refs, oldest first
 * CARD 01-rail-core-the-chit/README
 *
 * ⚠️ WHY A BUYER ON THE RAIL: a sale invoice posts only when its buyer is on the rail (lib/books-hooks.js classify, purpose 'invoice':
 * a self invoice to a local customer is queued "no buyer on the rail"), so a bill to press a payment on needs a real second shop.
 */
const H = require('./truth-harness.cjs');
const { j, ok, pause, freshShop } = H;

const textOf = (reply) => [reply && reply.error, reply && reply.message, reply && reply.why, reply && reply.detail].find((said) => typeof said === 'string' && said.trim());

/** POST /api/chits/send that must store → its chit_id (a refusal throws, naming the status and the words) */
async function sendChit(token, body) {
  const sent = await j('/api/chits/send', { method: 'POST', token, body });
  if (sent.status >= 300 || !sent.b.chit_id) throw new Error('the bill was not stored: HTTP ' + sent.status + ' ' + (textOf(sent.b) || ''));
  return sent.b.chit_id;
}

/** a fresh shop on the rail, added to `shop`'s customers by its User ID → { buyer, party } (party = my customer row's identity) */
async function buyerOnRail(shop, tag, label) {
  const buyer = await freshShop(tag, label || 'Rail Buyer');
  const added = ok(await j('/api/relationships/customers', { method: 'POST', token: shop.token, body: { handle: tag } }), 'customer ' + tag).b;
  return { buyer, party: added.customer.customer_identity_id };
}

/** an invoice from `shop` to the buyer → its chit_id */
function invoiceTo(shop, buyer, bill) {
  return sendChit(shop.token, { recipients: [{ display_name: buyer.name, bridge_id: buyer.bridge, kind: 'to' }], purpose: 'invoice', subject: 'Invoice ' + bill.no,
    manual_subject: 'Invoice ' + bill.no, client_ref: bill.no, business_json: { bill_no: bill.no, billed_at: bill.billedAt }, line_items: bill.lines });
}

/** wait (≤ 3 s) until the books hold `count` bills of the party open — a payment before that is an advance.
 *  → the bills' own refs and amounts, oldest first (the posting names the ref; nothing assumes it is the chit id), else null */
async function openBills(pg, entity, party, count) {
  for (let tries = 0; tries < 30; tries += 1) {
    const open = await pg.query("SELECT ref, ABS(amount_minor) AS minor FROM party_item WHERE entity_id = $1 AND party_id = $2 AND ref_kind = 'bill' ORDER BY item_id", [entity, party]);
    if (open.rows.length >= (count || 1)) return open.rows.map((row) => ({ ref: row.ref, minor: Number(row.minor) }));
    await pause(100);
  }
  return null;
}

module.exports = { textOf, sendChit, buyerOnRail, invoiceTo, openBills };
