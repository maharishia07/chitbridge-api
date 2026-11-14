// @stage tested
// @stage-note The receiving CTP door's own facts about an arriving copy (R3-03): direction, role, arrival status, first log row; the owned business_json keys never arrive.
// OWNER rail · RISK a key added to OWNED_KEYS changes what every arriving copy keeps; the accounting owner confirms the list
'use strict';
// OWNS      what the receiving CTP door fixes on an arriving copy ITSELF (R3-03): direction, the recipient's role, the status it is born in, its first timeline row, and the business_json keys a copy never brings
// CALLED BY routes/ctp.js POST /deliver (the copy handed to mint.deliver)
// FLOW      the sealed copy (the shared record: lines, money, invoice, parties) + the door's own facts about THIS recipient → one copy for mint.deliver → chit_deliver
//           the same facts the local send sets (routes/chits receiverCopyOf: rail-actions arrivalStatus + HEADER_ROLE), so a copy that crossed is born exactly as one that did not    CARD 05-ctp-and-cross-installation/ctp-return-path
/**
 * ── ⭐ THE SENDER'S COPY SAYS WHAT THE CHIT IS; THE DOOR SAYS WHAT IT IS TO ITS HOLDER ───────────────────────────────────────────
 *
 * A copy is co-held, never shared: each party keeps its own status, its own direction, its own books marks. So nothing of that kind travels. An arriving copy used to keep the peer's `current_status`,
 * `direction`, `role` and every key of its business_json, so a peer could send an invoice born `accepted` (the books gate reads that), a copy that says `paid`, or the recipient's own bill number.
 *
 * ⚠️ THE OWNED KEYS are the ones a holder writes about ITS OWN copy: its dedupe key, its payment mark, how it uses the bill, its books posting and the party notes. They are stripped from what arrives;
 * the sender's own copy keeps its own, the receiver starts without. (The list is the accounting owner's to confirm; a new owned key is added HERE, nowhere else.)
 */
const railActions = require('./rail-actions');

/** the business_json keys a holder writes about its OWN copy: never taken from a copy that arrives */
const OWNED_KEYS = Object.freeze(['client_ref', 'payment', 'use', 'books', 'books_log', 'books_skip', 'books_request', 'party']);

/**
 * ⚠️ `payment.parts` IS A SHARED FACT OF THE BILL, NOT THE HOLDER'S MARK: a counter bill is sent with the tender it was paid in, the local send keeps it on the customer's copy, and the customer's books
 * read it to post what was paid and what is owed (books-hooks boughtCounterBillVerdict). So of `payment` only the holder's marks (method, ref, amount, note, at, by) are dropped and `parts` stays.
 * The accounting owner confirms this (and rules on `their_bill` and `money_override`, which are also per-holder facts).
 */
const SHARED_INSIDE = Object.freeze({ payment: ['parts'] });

/** the all_recipients word → how the recipient was addressed (to | cc | for) */
const KIND_OF_ROLE = Object.freeze({ receiver: 'to', cc: 'cc', for: 'for' });

/** the named keys of an owned object that are shared facts; null when it carries none */
function sharedPart(owned, names) {
  const kept = {};
  for (const name of names) if (owned[name] !== undefined) kept[name] = owned[name];
  return Object.keys(kept).length ? kept : null;
}

/** a business_json without the owned keys (a new object; the input is untouched) */
function withoutOwned(business) {
  const kept = Object.assign({}, business && typeof business === 'object' ? business : {});
  for (const key of OWNED_KEYS) {
    const shared = SHARED_INSIDE[key] && kept[key] && typeof kept[key] === 'object' ? sharedPart(kept[key], SHARED_INSIDE[key]) : null;
    delete kept[key];
    if (shared) kept[key] = shared;
  }
  return kept;
}

/** how the copy names THIS recipient: to | cc | for. A recipient the header does not name is only told (cc), never asked to act */
function kindOf(header, recipientId) {
  const named = (Array.isArray(header.all_recipients) ? header.all_recipients : []).find((entry) => entry && entry.entity_id && String(entry.entity_id) === String(recipientId));
  return KIND_OF_ROLE[named && named.role] || 'cc';
}

/**
 * arrivalCopy(copy, header, to, stamp) — the copy mint.deliver writes for the recipient `to` (a row of OUR database): the sealed record, the localised parties (`header`), and the facts the door sets.
 * `stamp` is the ctp_arrival marker (which installation, when). → a new object; `copy` is untouched
 */
function arrivalCopy(copy, header, to, stamp) {
  const kind = kindOf(header, to.identity_id);
  const status = railActions.arrivalStatus(kind);
  const from = copy.sender_entity_display_name || 'the sender';
  return Object.assign({}, copy, header, {
    entity_id: to.identity_id,
    direction: 'received',
    role: railActions.HEADER_ROLE[kind],
    current_status: status,
    priority_flag: 'normal',
    log: { action: 'delivered', action_by_identity_id: header.sender_entity_id, action_by_display_name: from, new_status: status, detail: 'Chit received from ' + from + ' (' + kind.toUpperCase() + ')' },
    business_json: Object.assign(withoutOwned(copy.business_json), { ctp_arrival: stamp })
  });
}

module.exports = { arrivalCopy, withoutOwned, OWNED_KEYS };
