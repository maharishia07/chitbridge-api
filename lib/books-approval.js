'use strict';
/**
 * lib/books-approval.js — THE SHOP'S "OWNER APPROVES" MODE for its own Bookkeeper (SHOPBK slice B, 19 Nov 2026; REQ-2026-11-19-shop-bookkeeper items 5-8).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      the ONE answer to "does this request wait for the owner's OK": the setting (policy_flags.books_owner_approves, layer 7, default off) and the seat it binds · the prepare of a held Day book entry (a 202).
 * CALLED BY routes/books.js (POST /events, POST /entries: the gate after the contract check) · routes/books-actions.js (POST /: the Bookkeeper's own door to the same queue).
 * FLOW      request → isInHouseAccountant and not the owner, not a grant → the shop's flag read SERVER-SIDE (never the request body) → books-action.prepareAction (kind event | journal, role staff, nothing posted) → 202 + the action.
 *           The owner accepts or returns through the existing /api/books-actions/:id/accept | /return (ONE queue, the ONE writer B.postEntry); the audit carries both people (the prepared step, the accepted step).
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * AUDIT: the posted entry's `by` (created_by) is the PREPARER (the Bookkeeper), as QuickBooks and Xero record the creator; the approver is the `accepted` step (role owner), and source_ref action:<id> joins them. Both people show in GET /api/books-actions/:id.
 * RETURNED: the owner's note reaches the Bookkeeper on the Bookkeeper's own /todo (kind entries_returned, books-action.returnedFor: the same queue read, preparer filter, last 14 days).
 * ⚠️ NOT the grant's `posting` owner_approves (lib/books-grant.js): that is a per-grant choice the owner makes for an OUTSIDE adviser firm; this is the shop's own layer and binds its own staff seat. Same word, different layer.
 * ⚠️ Law is not a switch: the setting changes WHO presses post, never what a posting is. Setting off: nothing here runs and the Bookkeeper posts exactly as slice A.
 * ⚠️ A failed read of the flag must never let an entry through the owner asked to see: policy.get answers the default (off) on a missing row, but a thrown read is NOT swallowed here.
 */
const policy = require('./policy');
const { isOwner, isInHouseAccountant } = require('./owner');

/** the kinds the shop's own Bookkeeper may prepare: a Day book event and a typed journal. Lock, unlock, year close and reverse stay the owner's (REQ item 5). */
const STAFF_KINDS = ['event', 'journal'];

/** is the shop's own Bookkeeper seat the caller: the in-house accountant, never the owner, a key or an outside grant */
const isBookkeeperSeat = (req) => !isOwner(req) && !req.acting_for_grant && !req.api_key && isInHouseAccountant(req);

/** the shop's setting, read from its own flags: true only for an explicit 'on' */
async function approvalOn(entity) {
  const flags = await policy.get(entity);
  return !!flags && flags.books_owner_approves === 'on';
}

/** does THIS request wait for the owner: the Bookkeeper seat, in a shop that asked for approval (one read, only for that seat: the owner's own post costs no extra trip) */
async function bindsRequest(req, entity) {
  return isBookkeeperSeat(req) && (await approvalOn(entity));
}

/** the preparer as the action store stamps them: the real person, no firm, no grant */
const makerOf = (req) => ({ identity_id: req.identity.identity_id, name: req.identity.display_name || null, staff: true });

/** a held entry's client reference: the one the body carries, else the same text every press of the same body makes (so a double press is the open action, not two) */
const refOf = (body) => (body && body.client_ref ? String(body.client_ref).slice(0, 80) : null);

/**
 * prepareHeld(entity, req, kind, body, books) → the action view (state waiting_accept, nothing posted): the route answers it 202.
 * The body is exactly what the owner's own door would take; the owner's accept builds the event again from it and posts through the one writer.
 */
async function prepareHeld(entity, req, kind, body, books) {
  return require('./books-action').prepareAction(entity, makerOf(req), { kind, body, client_ref: refOf(body) }, books);
}

/**
 * heldGate(kind, refusalOf) → express middleware for POST /events (kind 'event') and POST /entries (kind 'journal'), placed AFTER the books gates and the contract check: the owner's own post and every request in a shop with the setting off
 * pass straight through (no extra read for the owner); the Bookkeeper's in a shop that asked for approval is held and answered 202 with the action (state waiting_accept, nothing posted). A refusal of the held entry (a locked month,
 * a missing figure, a reference already open) is the same answer the direct post would have been.
 */
function heldGate(kind, refusalOf) {
  const { problem } = require('./problem');
  const auth = require('../middleware/auth');
  return async (req, res, next) => {
    try {
      const entity = auth.entityOf(req);
      if (!(await bindsRequest(req, entity))) return next();
      return res.status(202).json(await prepareHeld(entity, req, kind, req.body || {}, req.books));
    } catch (err) {
      if (err && err.words) return problem(req, res, { status: err.status, code: err.code, detail: err.words, legacy: { error: err.words, message: err.words } });
      return problem(req, res, refusalOf(err, req));
    }
  };
}

module.exports = { heldGate, STAFF_KINDS, isBookkeeperSeat, approvalOn, bindsRequest, makerOf, prepareHeld };
