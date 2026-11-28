'use strict';
/**
 * lib/books-approval.js — THE SHOP'S "OWNER APPROVES" MODE for its own Bookkeeper (SHOPBK slice B, 19 Nov 2026; REQ-2026-11-19-shop-bookkeeper items 5-8).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      the ONE answer to "does this request wait for the owner's OK": the setting (policy_flags.books_owner_approves, layer 7, default off) and the seat it binds · the prepare of a held Day book entry (a 202) · the two seat gates beside it (and paymentGate, which refuses the same seat a direct payment): postVerdict (may this seat post: the first step of the entry form) and openingGate (the accountant's opening balances only before the books go live).
 * CALLED BY routes/books.js (POST /events, POST /entries, POST /entries/:id/reverse: the gate after the contract check · POST /opening: openingGate · the Bank and Day book reads: postVerdict) · routes/books-actions.js (POST /: the Bookkeeper's own door to the same queue).
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

/** the kinds the shop's own Bookkeeper may prepare: a Day book event, a typed journal and a reversal (the books are corrected by reversal, never edited: 20 Nov, Athi). Lock, unlock and year close stay the owner's (REQ item 5). */
const STAFF_KINDS = ['event', 'journal', 'reverse'];

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

/** the held body of a kind: a reversal's body is the entry in the URL and the reason; the other kinds are exactly the request body */
const heldBodyOf = (req, kind) => (kind === 'reverse' ? { entry_id: req.params.id, reason: (req.body || {}).reason } : req.body || {});

/** a held entry's client reference: the one the body carries, else the same text every press of the same body makes (so a double press is the open action, not two) */
const refOf = (body) => (body && require('./books-input').clientRef(body.client_ref));

/**
 * prepareHeld(entity, req, kind, body, books) → the action view (state waiting_accept, nothing posted): the route answers it 202.
 * The body is exactly what the owner's own door would take; the owner's accept builds the event again from it and posts through the one writer.
 */
async function prepareHeld(entity, req, kind, body, books) {
  return require('./books-action').prepareAction(entity, makerOf(req), { kind, body, client_ref: refOf(body) }, books);
}

/**
 * heldGate(kind, refusalOf) → express middleware for POST /events (kind 'event'), POST /entries (kind 'journal') and POST /entries/:id/reverse (kind 'reverse'), placed AFTER the books gates and the contract check: the owner's own post and every request in a shop with the setting off
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
      return res.status(202).json(await prepareHeld(entity, req, kind, heldBodyOf(req, kind), req.books));
    } catch (err) {
      if (err && err.words) return problem(req, res, { status: err.status, code: err.code, detail: err.words, legacy: { error: err.words, message: err.words } });
      return problem(req, res, refusalOf(err, req));
    }
  };
}

/**
 * paymentGate — middleware for POST /payments (LV sec-money-01 M2, 22 Nov 2026): a payment is money out of or into the books, so the Bookkeeper seat in a shop that asked for the owner's OK may not post it directly.
 * A HELD payment is not built (the queue's kinds are entries; a payment is a row plus its settling, and a new kind needs a migration the owner runs), so the answer is the safe one: refused in words (403 OWNER_ONLY), nothing written, the owner records it.
 * The owner, an outside grant, a key, and a shop with the setting off pass straight through (no extra read). An unreadable setting is not swallowed: the request is refused, never let through.
 */
async function paymentGate(req, res, next) {
  const { problem } = require('./problem');
  try {
    if (!(await bindsRequest(req, require('../middleware/auth').entityOf(req)))) return next();
    const words = 'This shop asks the owner to approve what is recorded here. Ask the owner to record this payment.';
    return problem(req, res, { status: 403, code: 'OWNER_ONLY', detail: words, legacy: { error: words, message: words } });
  } catch (err) {
    return problem(req, res, require('./books-contract').refusalOf(err, req));
  }
}

/** W25: may this seat post an entry (the owner and the owner's own accountant, the SAME test POST /events gates on)? Read on the first step of the entry form, so a seat that cannot post is told before it types. { ok, code, why } — the screen branches on code, never on the words */
const postVerdict = (req) => (isOwner(req) || isInHouseAccountant(req) ? { ok: true, code: null, why: null } : { ok: false, code: 'OWNER_ONLY', why: 'Only the owner or bookkeeper can record this.' });

/**
 * openingGate — middleware for POST /opening, RC-7 + the 19 Nov decision: the owner's own accountant may type the opening balances only BEFORE the books go live (nothing posted past the opening); after that the opening is the owner's alone.
 * The owner is never asked. A refusal is the one OWNER_ONLY problem, in the owner's words (books-contract SAID.openingOwner).
 */
async function openingGate(req, res, next) {
  if (isOwner(req)) return next();
  const { refusalOf, SAID } = require('./books-contract'), { problem } = require('./problem'), entity = require('../middleware/auth').entityOf(req);
  try {
    if (!(await require('../db').withEntity(entity, (handle) => require('./books-store').hasTrading(handle, entity)))) return next();
    return problem(req, res, { status: 403, code: 'OWNER_ONLY', detail: SAID.openingOwner, legacy: { error: SAID.openingOwner, message: SAID.openingOwner } });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
}

/** the firm's person as the action store stamps them: the real caller (never the store's synthetic identity), the firm and the grant from the live look; `named` = a person's own sign-in. ONE definition: routes/books-actions.js reads it too */
const firmActorOf = (req) => ({ identity_id: req.identity.identity_id, name: req.identity.display_name, firm_name: req.acting_firm_name, grant_id: req.acting_for_grant, firm_entity: req.realIdentity ? req.realIdentity.parent_entity_id || req.realIdentity.identity_id : null, named: !!req.realIdentity && req.realIdentity.identity_type === 'actor' });

/** may this request PROPOSE: set only by the grant front from the LIVE grant row (posting = owner_approves), for a live adviser seat that may write; checked again here, so a missing flag or a seat that cannot write never reaches the queue */
const proposes = (req) => req.acting_bank_propose === true && req.acting_for_grant && !!req.identity && !!req.identity.acting_preset && req.identity.acting_preset === 'adviser' && require('./access').canEdit(req.identity);

/**
 * BB-P1-2 · proposeOne(entity, req, line) → one bank line becomes a PROPOSED entry: the SAME event the owner's own door would post (party, tax, status, client_ref), held in the owner's queue through the one prepare; nothing is posted.
 * A line already waiting or already posted answers as a duplicate (a retried batch is not a failure); any other refusal is that line's own answer.
 */
async function proposeOne(entity, req, line) {
  const { prepareAction } = require('./books-action');
  try {
    const view = await prepareAction(entity, firmActorOf(req), { kind: 'event', body: line, client_ref: refOf(line) }, req.books);
    return view.entry ? { ok: true, entry_no: view.entry.entry_no, entry_id: view.entry.entry_id } : { ok: true, held: true, action_id: view.action_id, state: view.state, total_minor: view.total_minor, currency: view.currency };
  } catch (err) {
    if (err && (err.code === 'ACTION_REF_OPEN' || err.code === 'ACTION_REF_POSTED')) return { ok: true, duplicate: true };
    throw err;
  }
}

/**
 * grantProposeGate(refusalOf) → TERMINAL middleware for POST /events and POST /events/batch, placed after the books gates and the contract check: a request the grant front marked as a proposal (live adviser grant, posting = owner_approves, the bank body per line) is held and answered 202;
 * it NEVER calls next(), so no writer can run for it. Every other request passes straight through (no extra read). The bank body is tested again here per line (one definition: lib/books-bank-body).
 */
function grantProposeGate(refusalOf) {
  const { problem } = require('./problem');
  const auth = require('../middleware/auth');
  const { bankEventBody } = require('./books-bank-body');
  return async (req, res, next) => {
    if (req.acting_bank_propose !== true) return next();
    try {
      const entity = auth.entityOf(req);
      if (!proposes(req)) return problem(req, res, { status: 403, code: 'OWNER_ONLY', detail: 'Only the owner posts. Your seat cannot propose entries here.', legacy: { error: 'Only the owner posts.', message: 'Only the owner posts.' } });
      const batch = String(req.path).split('/').filter(Boolean).pop() === 'batch';
      const lines = batch ? (req.body && req.body.events) : [req.body];
      if (!Array.isArray(lines) || lines.length < 1 || lines.length > 100 || !lines.every((line) => bankEventBody(line))) return problem(req, res, { status: 422, code: 'ACTION_KIND_INVALID', detail: 'An adviser firm sends the bank lines as the Bank page sends them.', legacy: { error: 'An adviser firm sends the bank lines as the Bank page sends them.', message: 'An adviser firm sends the bank lines as the Bank page sends them.' } });
      if (!batch) return res.status(202).json(await prepareLine(entity, req, lines[0]));
      const out = await require('./books-events-batch').postEventsBatch({ entity, books: req.books, by: req.identity.identity_id, request_id: req.id || null, isHeld: async () => false, said: (err) => refusalOf(err, req), post: (store, books, line) => proposeOne(store, req, line) }, lines);
      return res.status(202).json({ posted: out.posted, failed: out.failed, results: out.results, ok: out.ok, capability: out.capability, request_id: out.request_id, written: out.written, held: out.held, refused: out.refused });
    } catch (err) {
      if (err && err.words) return problem(req, res, { status: err.status, code: err.code, detail: err.words, legacy: { error: err.words, message: err.words } });
      return problem(req, res, refusalOf(err, req));
    }
  };
}
/** one proposed line, the single door: the held action (a refusal of the line is the same answer the direct post would give); a repeat answers the action already waiting as a duplicate */
async function prepareLine(entity, req, line) {
  const { prepareAction } = require('./books-action');
  return prepareAction(entity, firmActorOf(req), { kind: 'event', body: line, client_ref: refOf(line) }, req.books);
}

module.exports = { grantProposeGate, firmActorOf, proposes, postVerdict, openingGate, heldGate, paymentGate, STAFF_KINDS, isBookkeeperSeat, approvalOn, bindsRequest, makerOf, prepareHeld };
