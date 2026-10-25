'use strict';
// OWNS      the doors of the proposal mechanism on a chit: list · propose (the seller's pro-forma / change, or a buyer's request) · accept · reject · counter
// CALLED BY routes/chits.js (mounted on the chits router: /api/chits/:chit_id/proposals…)
// FLOW      auth → the rail's level (amend) → lib/chit-proposal propose | decide → the answer, or a refusal in words (a registered code)      CARD 01-rail-core-the-chit/chit-proposal
/**
 * ⭐ ONE mechanism for the seller's pro-forma negotiation and for amendments after agreement (Athi, 25 Oct 2026, DECISIONS 11:15 and 12:05). Every decision is in lib/chit-proposal.js; this file
 * only authenticates, asks the rail whether this level may act on a chit at all (the same 'amend' verb POST /:chit_id/amend asks), and says what the library refused, in its words.
 *
 *   GET  /:chit_id/proposals                        my copy's rounds, newest last, with what is waiting for me
 *   POST /:chit_id/proposals                        { lines, currency_code?, note } — the SELLER prices (pro-forma round N, or a change after agreement); anyone else asks (a request, never priced)
 *   POST /:chit_id/proposals/:proposal_id/accept    { note? } — that version becomes the agreed record on both copies, byte for byte
 *   POST /:chit_id/proposals/:proposal_id/counter   { lines, note } — a request in text or numbers; the seller prices it as the next round
 *   POST /:chit_id/proposals/:proposal_id/reject    { note? } — it ends; both sides see it
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { problem } = require('../lib/problem');
const { said, failed } = require('../lib/chits-contract');
const railActions = require('../lib/rail-actions');
const proposals = require('../lib/chit-proposal');

const whoOf = (req) => ({ id: req.identity.identity_id, name: req.identity.display_name });

/** a refusal the library meant, in its words and its registered code; anything else is a fault */
function answer(req, res, err, label) {
  if (err && err.refused) {
    return problem(req, res, { status: err.status, ...said({ error: err.status === 404 ? 'Not found' : 'Not done', message: err.message, code: err.code }, err.code) });
  }
  if (err && err.status && err.status < 500 && err.code && /^LINE_/.test(err.code)) {
    return problem(req, res, { status: err.status, ...said({ error: 'Already delivered', message: err.message, code: err.code }, 'CHIT_CONFLICT') });
  }
  console.error(label + ':', err && err.message);
  return problem(req, res, failed(err, req, label));
}

/** the rail's level answers first: may this login act on a chit it holds at all */
function mayAct(req, res) {
  const verdict = railActions.can({ held: true }, railActions.meOf(req), 'amend');
  if (verdict.ok) return true;
  problem(req, res, railActions && { status: 403, ...said({ error: 'Not permitted', message: railActions.WHY[verdict.why] || 'Your access does not allow this.', why: verdict.why }, 'CHIT_NOT_PERMITTED') });
  return false;
}

router.get('/:chit_id/proposals', auth, async (req, res) => {
  try {
    const out = await proposals.list(auth.entityOf(req), req.params.chit_id);
    if (!out) return problem(req, res, { status: 404, ...said({ error: 'Not found', message: 'Chit not found' }, 'NOT_FOUND') });
    res.json(out);
  } catch (err) {
    answer(req, res, err, 'Proposals could not be read');
  }
});

router.post('/:chit_id/proposals', auth, async (req, res) => {
  if (!mayAct(req, res)) return;
  try {
    const out = await proposals.propose(auth.entityOf(req), req.params.chit_id, req.body || {}, whoOf(req));
    if (!out) return problem(req, res, { status: 409, ...said({ error: 'Nobody to propose to', message: 'This chit has no other party, so there is nothing to propose: change it directly.', code: 'PROPOSAL_NO_COUNTERPARTY' }, 'PROPOSAL_NO_COUNTERPARTY') });
    res.json(out);
  } catch (err) {
    answer(req, res, err, 'Proposal failed');
  }
});

for (const [verb, decision] of [['accept', 'accept'], ['reject', 'reject']]) {
  router.post('/:chit_id/proposals/:proposal_id/' + verb, auth, async (req, res) => {
    if (!mayAct(req, res)) return;
    try {
      res.json(await proposals.decide(auth.entityOf(req), req.params.chit_id, req.params.proposal_id, decision, whoOf(req), (req.body || {}).note));
    } catch (err) {
      answer(req, res, err, 'Decision failed');
    }
  });
}

router.post('/:chit_id/proposals/:proposal_id/counter', auth, async (req, res) => {
  if (!mayAct(req, res)) return;
  try {
    const out = await proposals.propose(auth.entityOf(req), req.params.chit_id, Object.assign({}, req.body || {}, { counter_of: req.params.proposal_id }), whoOf(req));
    if (!out) return problem(req, res, { status: 409, ...said({ error: 'Nobody to ask', message: 'This chit has no other party.', code: 'PROPOSAL_NO_COUNTERPARTY' }, 'PROPOSAL_NO_COUNTERPARTY') });
    res.json(out);
  } catch (err) {
    answer(req, res, err, 'Counter-proposal failed');
  }
});

module.exports = router;
