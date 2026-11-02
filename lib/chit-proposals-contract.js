/*
 * OWNS      the contract of routes/chit-proposals.js (API-STANDARD S9): each door's OpenAPI operation (its strict body, its closed answer, the statuses it declares),
 *           the refusals the proposal library means (lib/chit-proposal refused(): their codes and statuses, published as the x-chit-proposals-refusals extension), and the
 *           words a refusal the ROUTE itself writes carries. It shapes NO answer and decides NOTHING about a proposal: every decision stays in lib/chit-proposal.js.
 * CALLED BY routes/chit-proposals.js (checked(route) in front of each handler, router.openapi) → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json ·
 *           tests/api-problem-chit-proposals.test.cjs (the statuses a test may see).
 * FLOW      ROUTES (one row per door) → contractOf → { OPERATIONS, checked, pathsOf, allowedStatuses } → schemaValidate at the door → the register reads router.openapi
 * CARD      01-rail-core-the-chit/chit-proposal
 * ⚠️ The bodies are CLOSED (additionalProperties false, S33): these doors are new (25 Oct 2026) and no screen calls them yet (walk W25), so a key the library never reads is refused
 *    by name rather than dropped. The web's rounds screen (cb-rail, RAIL-106 part 4 card) sends exactly the keys named here.
 */
'use strict';
const { contractOf, array } = require('./contract-kit');
const { UUID_TEXT } = require('./chits-input');
/* the ids in the path are uuids: anything else is refused by the schema (422, naming the id), and a well-formed id nobody holds is the 404 */
const IDS = { chit_id: UUID_TEXT, proposal_id: UUID_TEXT };

/** an object schema that lists its fields and refuses any other (the allow-list, S33/S34) */
const closed = (required, properties) => ({ type: 'object', required: required || [], properties: properties || {}, additionalProperties: false });
const text = { type: 'string' };
const maybeText = { type: ['string', 'null'] };
const maybeObject = { type: ['object', 'null'] };
const NOTE = Object.assign({ description: 'a note for the other side (kept to 500 characters by the library)' }, maybeText);
/** one line of a round: addressed by line_id or line_index; the seller gives price and quantity, a requester gives quantity and requested_price; remove takes the line out */
const LINE = {
  type: 'object',
  properties: { line_id: maybeText, line_index: { type: ['integer', 'string', 'null'] }, price: {}, quantity: {}, requested_price: {}, remove: { type: 'boolean' }, note: maybeText, line: {} },
  description: 'one line of the round, by line_id or line_index'
};
const LINES = Object.assign(array(LINE), { description: 'the lines this round prices (the seller) or asks about (anyone else)' });
const TERMS = Object.assign({ description: 'a money-free round: a flat object of dates, scopes and notes' }, maybeObject);

/** the answer of a round put forward (propose, counter): lib/chit-proposal propose() */
const ROUND_OUT = closed(['proposal_id', 'round', 'kind', 'status'], {
  proposal_id: text,
  round: { type: 'integer' },
  kind: text,
  status: text,
  terms: maybeObject,
  money: maybeObject,
  tax_note: maybeText,
  ctp: {}
});
/** the answer of a decision (accept, reject): lib/chit-proposal decide() */
const DECISION_OUT = closed(['proposal_id', 'status', 'round'], { proposal_id: text, status: text, round: { type: 'integer' }, ctp: {} });
/** one round as the list shows it: lib/chit-proposal list() */
const ROUND_ROW = closed(['proposal_id', 'round', 'kind', 'status', 'label', 'mine', 'awaiting_me'], {
  proposal_id: text,
  round: { type: 'integer' },
  kind: text,
  status: text,
  label: text,
  mine: { type: 'boolean' },
  from_name: maybeText,
  edits: {},
  request: {},
  terms: maybeObject,
  money: maybeObject,
  jurisdiction: maybeObject,
  currency_code: maybeText,
  tax_note: maybeText,
  note: maybeText,
  created_at: {},
  decided_at: {},
  decided_by: maybeText,
  awaiting_me: { type: 'boolean' }
});
const LIST_OUT = closed(['proposals', 'migrated'], { proposals: array(ROUND_ROW), migrated: { type: 'boolean' } });

/** the refusals lib/chit-proposal means (refused(status, code, sentence)): the route says them in the library's words under these codes */
const LIBRARY_REFUSALS = [
  { status: 400, code: 'PROPOSAL_BAD', when: 'the round says nothing, or a price or quantity is not a number' },
  { status: 403, code: 'PROPOSAL_NOT_YOURS', when: 'the proposer asks to decide its own round' },
  { status: 404, code: 'NOT_FOUND', when: 'no copy of the chit is held here' },
  { status: 404, code: 'PROPOSAL_NOT_FOUND', when: 'no such round on this chit' },
  { status: 409, code: 'PROPOSAL_DOMESTIC', when: 'the chit is not an international deal and was not made as an RFQ: change it directly' },
  { status: 409, code: 'PROPOSAL_CLOSED', when: 'the round is already decided, or not open on every copy here' },
  { status: 409, code: 'PROPOSAL_STALE', when: 'a newer round replaced it, or the lines changed since it was made' },
  { status: 409, code: 'PROPOSAL_BAD', when: 'a request is answered by pricing it, not by accepting it' },
  { status: 409, code: 'CHIT_CONFLICT', when: 'a delivered line cannot be changed (lib/amend LINE_* refusals)' },
  { status: 503, code: 'PROPOSAL_NOT_SETUP', when: 'the chit_proposal table is not on this installation yet' }
];

const ROUTES = {
  'GET /:chit_id/proposals': { params: IDS, summary: "My copy's rounds on a chit, newest last, each saying whether it waits for me (an installation without the table answers none, migrated false)", gates: ['level'], out: LIST_OUT },
  'POST /:chit_id/proposals': {
    params: IDS,
    summary: 'Put a round forward: the SELLER prices the lines (a pro-forma round, or a change after agreement); anyone else asks (a request, never priced); or money-free terms',
    gates: ['level'],
    inline: [409],
    body: { lines: LINES, currency_code: Object.assign({ description: 'the currency the seller prices in; the shop’s own when left out' }, maybeText), note: NOTE, terms: TERMS },
    rules: { additionalProperties: false },
    out: ROUND_OUT
  },
  'POST /:chit_id/proposals/:proposal_id/accept': { params: IDS, summary: 'Accept a round: that version becomes the agreed record on every copy, byte for byte', gates: ['level'], body: { note: NOTE }, rules: { additionalProperties: false }, out: DECISION_OUT },
  'POST /:chit_id/proposals/:proposal_id/reject': { params: IDS, summary: 'Reject a round: it ends, and both sides see it', gates: ['level'], body: { note: NOTE }, rules: { additionalProperties: false }, out: DECISION_OUT },
  'POST /:chit_id/proposals/:proposal_id/counter': {
    params: IDS,
    summary: 'Answer a round with a request in text or numbers; the seller prices it as the next round',
    gates: ['level'],
    inline: [409],
    body: { lines: LINES, note: NOTE, terms: TERMS },
    rules: { additionalProperties: false },
    out: ROUND_OUT
  }
};

const contract = contractOf({ mount: '/api/chits', routes: ROUTES, gateStatus: { level: 403 }, refusals: LIBRARY_REFUSALS, refusalsWhen: 'level', extension: 'x-chit-proposals-refusals' });

module.exports = Object.assign({ ROUTES, LIBRARY_REFUSALS }, contract);
