'use strict';
// OWNS      the doors of the proposal mechanism on a chit: list · propose (the seller's pro-forma / change, or a buyer's request) · accept · reject · counter
// CALLED BY routes/chits.js (mounted on the chits router: /api/chits/:chit_id/proposals…)
// FLOW      auth → the rail's level (amend) → the schema check (lib/chit-proposals-contract) → lib/chit-proposal propose | decide → the answer, or a refusal in words (a registered code)      CARD 01-rail-core-the-chit/chit-proposal
/**
 * ⭐ ONE mechanism for the seller's pro-forma negotiation and for amendments after agreement (Athi, 25 Oct 2026, DECISIONS 11:15 and 12:05). Every decision is in lib/chit-proposal.js; this file
 * only authenticates, asks the rail whether this level may act on a chit at all (the same 'amend' verb POST /:chit_id/amend asks), checks the body against the door's own schema
 * (API-STANDARD S9/S33: a key the library never reads is refused by name, never dropped) and says what the library refused, in its words.
 *
 *   GET  /:chit_id/proposals                        my copy's rounds, newest last, with what is waiting for me
 *   POST /:chit_id/proposals                        { lines, currency_code?, note, terms? } — the SELLER prices (pro-forma round N, or a change after agreement); anyone else asks (a request, never priced)
 *   POST /:chit_id/proposals/:proposal_id/accept    { note? } — that version becomes the agreed record on both copies, byte for byte
 *   POST /:chit_id/proposals/:proposal_id/counter   { lines, note, terms? } — a request in text or numbers; the seller prices it as the next round
 *   POST /:chit_id/proposals/:proposal_id/reject    { note? } — it ends; both sides see it
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { problem } = require('../lib/problem');
const { said, failed } = require('../lib/chits-contract');
const contract = require('../lib/chit-proposals-contract');
const railActions = require('../lib/rail-actions');
const proposals = require('../lib/chit-proposal');

const whoOf = (req) => ({ id: req.identity.identity_id, name: req.identity.display_name });
const NOBODY_TO_PROPOSE_TO = { error: 'Nobody to propose to', message: 'This chit has no other party, so there is nothing to propose: change it directly.', code: 'PROPOSAL_NO_COUNTERPARTY' };
const NOBODY_TO_ASK = { error: 'Nobody to ask', message: 'This chit has no other party.', code: 'PROPOSAL_NO_COUNTERPARTY' };

/** a refusal a library meant, as { error, register code }: its own (chit-proposal), a line that was already delivered (lib/amend LINE_*), or lib/amend's input refusals (AMEND_*); null for anything else */
function meantRefusal(err) {
  if (!err) return null;
  if (err.refused) return { error: err.status === 404 ? 'Not found' : 'Not done', registered: err.code };
  if (err.status && err.status < 500 && err.code && /^LINE_/.test(err.code)) return { error: 'Already delivered', registered: 'CHIT_CONFLICT' };
  if (err.status === 400 && /^AMEND_/.test(String(err.code))) return { error: 'Not done', registered: err.code };
  return null;
}

/** the Problem spec of whatever a door caught: a refusal the library meant, in its words and its registered code; anything else is a fault (logged with the request id, said safely) */
function specOf(req, err, label) {
  const meant = meantRefusal(err);
  if (meant) return { status: err.status, ...said({ error: meant.error, message: err.message, code: err.code }, meant.registered) };
  console.error(label + ':', err && err.message);
  return failed(err, req, label);
}

/** the rail's level answers first (a gate in the chain): may this login act on a chit it holds at all */
function mayAct(req, res, next) {
  const verdict = railActions.can({ held: true }, railActions.meOf(req), 'amend');
  if (verdict.ok) return next();
  return problem(req, res, { status: 403, ...said({ error: 'Not permitted', message: railActions.WHY[verdict.why] || 'Your access does not allow this.', why: verdict.why }, 'CHIT_NOT_PERMITTED') });
}
mayAct.addsStatuses = [403]; /* tools/api-register.cjs reads the status a gate answers from here */

/** the schema check of one door (its own operation in lib/chit-proposals-contract.js), as a list to spread after the gates */
const checked = (route) => contract.checked(route);

router.get('/:chit_id/proposals', auth, mayAct, ...checked('GET /:chit_id/proposals'), async (req, res) => {
  try {
    const out = await proposals.list(auth.entityOf(req), req.params.chit_id);
    if (!out) return problem(req, res, { status: 404, ...said({ error: 'Not found', message: 'Chit not found' }, 'NOT_FOUND') });
    res.json(out);
  } catch (err) {
    problem(req, res, specOf(req, err, 'Proposals could not be read'));
  }
});

router.post('/:chit_id/proposals', auth, mayAct, ...checked('POST /:chit_id/proposals'), async (req, res) => {
  try {
    const out = await proposals.propose(auth.entityOf(req), req.params.chit_id, req.body || {}, whoOf(req));
    if (!out) return problem(req, res, { status: 409, ...said(NOBODY_TO_PROPOSE_TO, 'PROPOSAL_NO_COUNTERPARTY') });
    res.json(out);
  } catch (err) {
    problem(req, res, specOf(req, err, 'Proposal failed'));
  }
});

/** a decision door (accept · reject): the library decides, the route only says what it refused */
function decisionDoor(decision) {
  return async function decide(req, res) {
    try {
      res.json(await proposals.decide(auth.entityOf(req), req.params.chit_id, req.params.proposal_id, decision, whoOf(req), (req.body || {}).note));
    } catch (err) {
      problem(req, res, specOf(req, err, 'Decision failed'));
    }
  };
}
router.post('/:chit_id/proposals/:proposal_id/accept', auth, mayAct, ...checked('POST /:chit_id/proposals/:proposal_id/accept'), decisionDoor('accept'));
router.post('/:chit_id/proposals/:proposal_id/reject', auth, mayAct, ...checked('POST /:chit_id/proposals/:proposal_id/reject'), decisionDoor('reject'));

router.post('/:chit_id/proposals/:proposal_id/counter', auth, mayAct, ...checked('POST /:chit_id/proposals/:proposal_id/counter'), async (req, res) => {
  try {
    const out = await proposals.propose(auth.entityOf(req), req.params.chit_id, Object.assign({}, req.body || {}, { counter_of: req.params.proposal_id }), whoOf(req));
    if (!out) return problem(req, res, { status: 409, ...said(NOBODY_TO_ASK, 'PROPOSAL_NO_COUNTERPARTY') });
    res.json(out);
  } catch (err) {
    problem(req, res, specOf(req, err, 'Counter-proposal failed'));
  }
});

/* the contract beside the code it describes: the register and /api/openapi.json read it from here (routes/chits.js keeps its own fragment; no path is declared twice) */
router.openapi = { paths: contract.pathsOf(), schemas: {} };

module.exports = router;
