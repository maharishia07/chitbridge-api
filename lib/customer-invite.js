'use strict';
/*
 * OWNS      the customer invitation (NET-40, Athi 2026-10-25: "adding someone as a supplier is fine, but to be a customer, customer should be willing"):
 *           the invite chit a seller sends, the pending list, and the ONE hook that makes the customer_list row when the invitee accepts.
 * CALLED BY routes/relationships.js POST /customers (invite) and the CRM parties answer (pending) · routes/chits.js moveStatus (the invitee accepts here)
 *           · lib/ctpreturn.js applyStatus (the invitee accepted on ANOTHER installation: the event arrives, the same hook runs at the seller)
 * FLOW      seller adds a business -> invite(): an ordinary chit (purpose general, business_json.invite) through the one send path (lib/autoraise.sendAs)
 *           -> both hold it; NO customer_list row -> the invitee presses Accept (rail status 'accepted') -> afterStatus() writes the SELLER's row (added_via 'invite').
 *           Decline writes nothing. Accept twice writes one row. The code is the same on one installation or many (PLAYBOOK-crossing-a-service).
 * CARD      04-network/NETWORK-BACKLOG NET-40 · DECISIONS 2026-10-25 10:30
 */
/**
 * ⭐ NO SECOND LINK. The link stays customer_list. The brand-store cb_edge request/approve (src/services/network.js) is a different relationship and is not reused.
 * ⭐ NO SECOND STATUS PATH. Accept and decline are the rail's own statuses (accepted, rejected) moved by moveStatus; across installations they return as the status event.
 * ⚠️ added_via 'invite' needs b795 (the column's CHECK lists the old words). Until it has run the row is written as 'manual': the customer exists either way.
 */
const { withEntity, trySavepoint } = require('../db');
const log = require('./logger');
const addressBook = require('./ctpaddress');
const partyFields = require('./party-fields'); /* the one numbering path: a party is numbered when it is added (here: when they accept) */

const KIND = 'customer_invite';
const ACCEPTED = 'accepted';
const DECLINED_SHOWN_DAYS = 30; /* a declined invitation stays visible this long, then it is only history on the chit */
const MAX_SHOWN = 50;

const WORDS = {
  sent: 'Invitation sent. They become your customer when they accept.',
  waiting: 'Invited · waiting',
  declined: 'Declined your invitation'
};

/** the chit's own slot: business_json.invite = { for: 'customer', words } (docs/FIELDS.md) */
const inviteOf = (businessJson) => (businessJson && businessJson.invite && businessJson.invite.for === 'customer' ? businessJson.invite : null);

/** the send body: an ordinary general chit with no lines, to one business */
function sendBody(sellerName, customerId) {
  const words = sellerName + ' invites you to be their customer. Accept to join their customer list; decline to stay as you are.';
  return {
    recipients: [{ entity_id: customerId, role: 'to' }],
    purpose: 'general',
    manual_subject: sellerName + ' invites you to be their customer',
    line_items: [],
    business_json: { kind: KIND, invite: { for: 'customer', words } }
  };
}

/** tests: stand in for lib/autoraise.sendAs, the loopback send (null puts the real one back) */
let sender = null;
const setSender = (fn) => {
  sender = fn || null;
};
const sendAs = (seller, body) => (sender || require('./autoraise').sendAs)(seller, body);

/** the invitations this seller sent that are still in play, newest first: { chit_id, customer_id, name, bridge_id, state: waiting|declined, at } */
async function listFor(seller) {
  const rows = await withEntity(seller, (db) =>
    db.query(
      `SELECT h.chit_id, h.created_at, p.entity_id AS customer_id, p.display_name, p.bridge_id, p.current_status
         FROM (SELECT chit_id, created_at FROM chit_header
                WHERE entity_id = $1 AND sender_entity_id = $1 AND purpose = 'general' AND business_json ? 'invite'
                ORDER BY created_at DESC LIMIT ${MAX_SHOWN}) h
         CROSS JOIN LATERAL chit_participants(h.chit_id) p
        WHERE p.entity_id <> $1`,
      [seller]
    )
  );
  const out = [];
  for (const row of rows.rows) {
    const state = stateOf(row.current_status, row.created_at);
    if (state) out.push({ chit_id: row.chit_id, customer_id: row.customer_id, name: row.display_name, bridge_id: row.bridge_id, state, words: WORDS[state], at: row.created_at });
  }
  return out;
}

/** the invitee's status as the seller reads it: waiting, declined (for a month), or nothing to show (accepted = a customer now; cancelled = withdrawn) */
function stateOf(status, createdAt) {
  if (status === 'rejected') return Date.now() - new Date(createdAt).getTime() < DECLINED_SHOWN_DAYS * 86400000 ? 'declined' : null;
  return ['accepted', 'cancelled', 'completed'].includes(status) ? null : 'waiting';
}

/**
 * Send the invitation. → { ok:true, chit_id, words } | { refused: { status, code, message } }
 * @param seller    the inviting business (identity_id)
 * @param sellerName its display name (the subject says who invites)
 * @param customer  { identity_id, display_name } the business invited
 */
async function invite(seller, sellerName, customer) {
  const pending = (await listFor(seller)).find((invitation) => String(invitation.customer_id) === String(customer.identity_id) && invitation.state === 'waiting');
  if (pending) return refuse(409, 'CUSTOMER_INVITE_PENDING', 'You already invited ' + customer.display_name + '. Waiting for their answer.');
  const sent = await sendAs(seller, sendBody(sellerName, customer.identity_id));
  if (!sent.ok) return refuse(sent.status >= 400 && sent.status < 500 ? sent.status : 502, 'CUSTOMER_INVITE_NOT_SENT', notSentWords(customer, sent));
  return { ok: true, chit_id: sent.body.chit_id, words: WORDS.sent };
}

const refuse = (status, code, message) => ({ refused: { status, code, message } });
const notSentWords = (customer, sent) =>
  'The invitation to ' + customer.display_name + ' was not sent' + (sent.body && (sent.body.message || sent.body.detail) ? ': ' + (sent.body.message || sent.body.detail) : '.') + ' Nothing was added.';

/** the seller's own copy of the invitation, if it is one and still stands: { customer_ids } | null */
async function standingInvite(db, seller, chit_id) {
  const ownCopy = await db.query(
    `SELECT h.sender_entity_id, h.purpose, h.business_json, h.all_recipients, s.current_status
       FROM chit_header h JOIN chit_status s ON s.chit_id = h.chit_id AND s.entity_id = h.entity_id
      WHERE h.chit_id = $1 AND h.entity_id = $2 LIMIT 1`,
    [chit_id, seller]
  );
  const row = ownCopy.rows[0];
  if (!row || String(row.sender_entity_id) !== String(seller) || row.purpose !== 'general' || !inviteOf(row.business_json)) return null;
  if (['cancelled', 'rejected'].includes(row.current_status)) return null; /* withdrawn by the seller */
  const guests = (Array.isArray(row.all_recipients) ? row.all_recipients : []).filter((guest) => guest && guest.role !== 'sender');
  return { customer_ids: guests.map((guest) => String(guest.entity_id)) };
}

/** INSERT the row; 'invite' first, 'manual' when b795 has not run (the CHECK refuses the new word) -> true when a row was made */
async function writeRow(db, seller, customer) {
  const insert = (howTheyCame) =>
    db.query(
      `INSERT INTO customer_list (owner_entity_id, customer_identity_id, customer_type, added_via, txn_count, last_txn_at)
       VALUES ($1, $2, 'entity', '${howTheyCame}', 0, NULL)
       ON CONFLICT (owner_entity_id, customer_identity_id) DO NOTHING
       RETURNING customer_list_id`,
      [seller, customer]
    );
  const made = (await trySavepoint(db, () => insert('invite'), null)) || (await insert('manual'));
  return made.rows.length > 0;
}

/**
 * ⭐ THE ONE HOOK. A status was written for an invitation: when it is 'accepted', the SELLER's customer_list row is made - here if the seller is on this
 * installation, otherwise by the same call on the seller's installation when the status event arrives. Never throws (a failure is logged and said: the next
 * accepted event or the invitee's second Accept makes it); never makes a row for a chit that is not an invitation from `seller` to `customer`.
 * @returns {Promise<{made:boolean, why:string}>}
 */
async function afterStatus(seller, customer, chit_id, status) {
  if (status !== ACCEPTED) return { made: false, why: 'only an acceptance makes a customer' };
  try {
    const place = await addressBook.resolve(seller);
    if (place.local === false) return { made: false, why: 'the seller is on another installation: the status event carries it there' };
    const made = await withEntity(seller, async (db) => {
      const standing = await standingInvite(db, seller, chit_id);
      if (!standing || !standing.customer_ids.includes(String(customer))) return false;
      const made = await writeRow(db, seller, customer);
      if (made) await trySavepoint(db, () => partyFields.ensureNo(db, seller, customer), null); /* before b272 there is no series: the nightly job numbers them */
      return made;
    });
    return { made, why: made ? 'customer added' : 'nothing to add (not an invitation, withdrawn, or already a customer)' };
  } catch (e) {
    log.warn('customer-invite.not-settled', { seller, customer, chit_id, error: String((e && e.message) || e), then: 'accept again, or the seller adds them again' });
    return { made: false, why: 'could not be saved just now' };
  }
}

/** moveStatus calls this with the mover's own header row (no query unless it is an invitation); the mover is the invitee */
function afterMove(entity_id, chit_id, status, header) {
  if (status !== ACCEPTED || !header || header.purpose !== 'general' || !inviteOf(header.business_json)) return Promise.resolve(null);
  return afterStatus(header.sender_entity_id, entity_id, chit_id, status);
}

module.exports = { KIND, WORDS, inviteOf, sendBody, invite, listFor, afterStatus, afterMove, setSender };
