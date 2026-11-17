/*
 * OWNS      the contract of routes/books-actions.js (ACC-176b, API-STANDARD S9): each route's OpenAPI operation, its strict body and its closed answer.
 * CALLED BY routes/books-actions.js (checked(route) in front of each handler, router.openapi) · tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 * CARD      04-network/ACC-176B-ADVISER-REQUIREMENT
 * Maker-checker for an adviser firm in a store's books: the firm PREPARES and REVIEWS, the OWNER accepts and posts through the existing writers. Every route here carries `store_id` (the open page's store): a request
 * that names another store than the grant's is refused 409 STORE_MISMATCH and nothing is stored.
 */
'use strict';
const { contractOf, object, array, text } = require('./contract-kit');
const { SEATS } = require('./role-matrix'); /* the role matrix: what each seat is answered (register column 14) */
const B = require('./bounds'); /* the one set of input bounds: a list's page size is B.limit() (column 16, resource_cap) */
const { UUID_TEXT } = require('./chits-input');

const IDS = { id: UUID_TEXT };
const KIND = { type: 'string', enum: ['journal', 'reverse', 'lock', 'unlock', 'year_close'] };
const STATE = { type: 'string', enum: ['waiting_review', 'waiting_accept', 'open', 'returned', 'accepted', 'withdrawn', 'all'] };
/** an action as the queues read it */
/** what a prepare answers beside the action: `warnings` (advisory words, never a refusal) and, when the owner's delegation posted it at once, `entry` (the entry posted) */
const ACTION = object(['action_id', 'store', 'kind', 'state', 'client_ref', 'body_hash', 'total_minor', 'currency', 'body', 'prepared', 'reviewed', 'closed', 'grant_id', 'entry_id', 'access_ended'], { warnings: array(object(['code', 'words'])), entry: object(['entry_id', 'entry_no']) });
/** one action with every step in order (GET /:id adds `steps` to the action) */
const ACTION_WITH_STEPS = object(ACTION.required, Object.assign({}, ACTION.properties, { steps: array(object(['step', 'role', 'identity_id', 'name', 'firm', 'reason', 'at'])) }));
const ROUTES = {
  'GET /': { seats: SEATS.OWNER_ADVISER_DOOR, summary: 'The queue of adviser actions of this store, newest first: one list for the people preparing, reviewing and accepting; state and mine narrow it', gates: ['actors'], inline: [404, 503], query: ['state', 'mine', 'delegated', 'since', 'page', 'limit'], queryBounds: { limit: B.limit() }, out: object(['actions', 'total', 'page', 'limit'], { actions: array(ACTION) }) },
  'GET /:id': { seats: SEATS.OWNER_ADVISER_DOOR, summary: 'One action with every step: who, in which role, when, and why it was returned', gates: ['actors'], inline: [404, 503], params: IDS, out: ACTION_WITH_STEPS },
  'POST /': { seats: SEATS.FIRM_ONLY, summary: 'Prepare an action in the store\'s books (the firm\'s team only): a journal, a reversal, a lock, an unlock or a year close; nothing is posted', gates: ['firm'], ok: 201, inline: [404, 409, 422, 503], body: { store_id: UUID_TEXT, kind: KIND, body: { type: 'object' }, client_ref: text, working_month: text }, required: ['store_id', 'kind', 'body', 'client_ref'], rules: { additionalProperties: false }, out: ACTION },
  'POST /:id/review': { seats: SEATS.FIRM_ONLY, summary: 'Review a prepared action: a different person of the firm than the preparer, on the very body shown (its body_hash)', gates: ['firm'], inline: [404, 409, 503], params: IDS, body: { store_id: UUID_TEXT, body_hash: text }, required: ['store_id', 'body_hash'], rules: { additionalProperties: false }, out: ACTION },
  'POST /:id/return': { seats: SEATS.OWNER_ADVISER_DOOR, summary: 'Return an open action with a reason: the round ends, nothing is posted, a new action is prepared (a colleague of the firm, or the owner)', gates: ['actors'], inline: [404, 409, 422, 503], params: IDS, body: { store_id: UUID_TEXT, body_hash: text, reason: text }, required: ['store_id', 'body_hash', 'reason'], rules: { additionalProperties: false }, out: ACTION },
  'POST /:id/accept': { seats: SEATS.OWNER_ONLY, summary: 'Accept a reviewed action (the owner only): the existing writer posts it in one transaction; the total the owner confirmed must be the total prepared and the total posted', gates: ['owner'], inline: [404, 409, 422, 503], params: IDS, body: { store_id: UUID_TEXT, body_hash: text, total_minor: { type: 'integer' }, currency: text }, required: ['store_id', 'body_hash'], rules: { additionalProperties: false }, out: object(['action', 'entry'], { entry: object([]) }) }
};

module.exports = Object.assign({ ROUTES }, contractOf({ mount: '/api/books-actions', routes: ROUTES, gateStatus: { owner: 403, firm: 403, actors: 403 } }));
