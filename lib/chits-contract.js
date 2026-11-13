/*
 * OWNS      the contract of routes/chits.js: each route's OpenAPI operation (S9) and the one way its refusals and faults are worded (said, faultOf, failed, railRefusal).
 * CALLED BY routes/chits.js (schemaValidate on each route, router.openapi, problem(req, res, { status, ...said(...) } | faultOf(...))) → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-chits.test.cjs.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a refusal → problem(req, res, { status, ...said({ error, message, ... }) }) → the old body, key for key, beside the Problem fields
 *           a thrown error → failed(e, req, label) (always a 500) | faultOf(e, req, label) → the status the error carries (else 500) with the sentence the route always gave
 * CARD      01-rail-core-the-chit/chits-routes
 * This file shapes NO answer and moves NO chit: sending, sealing, the one status writer (moveStatus), disputes and payments are routes/chits.js and its libraries, as before.
 *
 * ⚠️ The input schemas say what the handlers ALREADY take. A query value a handler reads leniently (a bad page falls back to the first) is declared as plain text: a schema that
 *    refused it would turn a fallback into a refusal no caller has ever had. A refusal keeps the body it always had, key for key and in the same order, frozen in
 *    docs/contracts/api-legacy.json; the Problem fields are added after it.
 */
'use strict';
const { internalSpec } = require('./problem');
const { SAFE_SENTENCE, safeErr } = require('./respond');
const { contractOf, object, array } = require('./contract-kit');
const input = require('./chits-input');

/* ── the words ──────────────────────────────────────────────────────────────────────────────────────────── */
/** the Problem code of a refusal that names none of its own, by its status */
const STATUS_CODES = { 400: 'CHIT_BAD_REQUEST', 403: 'CHIT_NOT_PERMITTED', 404: 'NOT_FOUND', 409: 'CHIT_CONFLICT', 422: 'CHIT_UNPROCESSABLE', 503: 'CHIT_NOT_MIGRATED' };
const codeOfStatus = (status) => STATUS_CODES[status] || (status >= 500 ? 'INTERNAL' : STATUS_CODES[400]);
const INTERNAL_DETAIL = 'Something went wrong on our side.';

/** the code an old body carried itself ('' when it carried none) */
const ownCodeOf = (legacy) => (legacy && typeof legacy.code === 'string' ? legacy.code : '');
/** the sentence of an old body: its `message`, else its `error` */
const sentenceOf = (legacy) => (legacy.message !== undefined && legacy.message !== null ? legacy.message : legacy.error);

/**
 * said(legacy, code?, detail?) — the spec parts problem() takes ({ code, detail, legacy }) for a refusal whose old body is `legacy`, exactly as it answered.
 * A body that carried its own `code` keeps it (it is the Problem code too); else `code` names it. The detail is the old sentence: `message`, else `error`
 * (or `detail`, where the old body was one bare word such as "Forbidden").
 */
function said(legacy, code, detail) {
  const hint = typeof legacy.hint === 'string' ? legacy.hint : undefined; /* a body that carried a hint keeps it as the Problem hint */
  return { code: ownCodeOf(legacy) || code || STATUS_CODES[400], detail: String(detail || sentenceOf(legacy)), hint, legacy };
}

/** railSaid({ status, body }) — the spec of a refusal the rail's library worded (lib/rail-actions refusalOf · housekeepRefusalOf · ownCopyRefusalOf) */
const railSaid = (refusal) => Object.assign({ status: refusal.status }, said(refusal.body, codeOfStatus(refusal.status)));
/** a route that always answered 500 when it failed: the screen's label and the safe sentence, nothing of the cause (the real error is logged with the request id) */
const failed = (e, req, label) => internalSpec(req, e, { error: label, message: SAFE_SENTENCE });

/**
 * faultOf(e, req, label, { words }) — the spec of whatever a catch got, for a route that answered with the status the error carried (`e.status || 500`).
 * A 5xx, and any status when `words` is not asked for, says the safe sentence: the real error is logged with the request id (S8). With `words`, an error
 * that carries a status below 500 is a refusal a library meant, and says its own sentence (the register and the library routes always did).
 * `extra` keys ride after the message (the gate that names what is still open). A thrown refusal that carries its own `body` (refused, 4xx) is answered as that body (RAIL-147).
 */
/** RAIL-147: the body of a refusal a library THROWS as data (refused, a 4xx status, body = the old shape: error · code · message · blocked — lib/cost-write); null for any other error */
const thrownBodyOf = (e) => (e && e.refused === true && e.body && typeof e.body === 'object' && Number(e.status) >= 400 && Number(e.status) < 500 ? e.body : null);
function faultOf(e, req, label, options) {
  const { words, extra } = Object.assign({ words: false, extra: {} }, options);
  const status = (e && e.status) || 500;
  const thrownBody = thrownBodyOf(e); /* a refusal thrown with its body answers as that body, as a returned one does (said): it is meant, nothing is logged, `words` is not needed */
  if (thrownBody) return { status, ...said(thrownBody, codeOfStatus(status)) };
  const meant = words && status < 500;
  if (!meant) safeErr(e, { id: req && req.id, path: req && req.path });
  const message = meant ? e.message : SAFE_SENTENCE;
  return { status, code: codeOfStatus(status), detail: status >= 500 ? INTERNAL_DETAIL : message, legacy: Object.assign({ error: label, message }, extra) };
}

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
/** the query a chit list reads (the pager, the order, the shared filters of chitFilters) */
const LIST_QUERY = ['page', 'limit', 'after', 'q', 'sort', 'dir', 'folder_id', 'amount_min', 'amount_max', 'date_from', 'date_to', 'abroad', 'priority', 'fstatus', 'assignment', 'assigned_to', 'dispute'];
const PAGER = ['page', 'limit'];
const LIST_OUT = object(['chits', 'total', 'page', 'limit'], { chits: array() });
const REFUSALS = [
  { status: 400, code: 'CHIT_BAD_REQUEST', when: 'a request the chit routes cannot take, in its own words' },
  { status: 403, code: 'CHIT_NOT_PERMITTED', when: 'this login may not, said by the rail' },
  { status: 404, code: 'NOT_FOUND', when: 'no such chit on this login\'s side' },
  { status: 409, code: 'CHIT_CONFLICT', when: 'the chit is not in a state that allows it' },
  { status: 422, code: 'CHIT_UNPROCESSABLE', when: 'understood but refused: the books, the country setup, a payment above its quote' },
  { status: 503, code: 'CHIT_NOT_MIGRATED', when: 'a database update is still to run' }
];

/** the fields of a register entry, on a chit or on a standalone register (raida.add takes them; the chit, the register and the entity are decided by the route) */
const ENTRY_BODY = ['kind', 'body', 'line_id', 'visibility', 'owner_name', 'due_date', 'review_date', 'likelihood', 'severity', 'treatment', 'verification_method', 'response', 'template_id', 'rel_type', 'to_type', 'to_id', 'to_label', 'needed_by', 'standards'];

/** the keys a LONE row carries when it is sent as the whole body (the handler takes `rows`, or the row itself): a delivery · a line's assignment · a cost (the closed body keeps them: nothing a caller sent is taken away) */
const DELIVERY_ROW = ['line_id', 'kind', 'client_ref', 'quantity', 'unit', 'reference', 'note', 'amount', 'particulars'];
/** what raida.close takes of the body (the closing row's note, how it ended, where it moved, its evidence) and raida.revise may change (the entry's own fields; the register route and the chit route share them) */
const CLOSE_BODY = ['body', 'disposition', 'carried_to_subject_id', 'evidence_ref', 'evidence_hash'];
const REVISE_BODY = ['body', 'owner_actor_id', 'owner_name', 'due_date', 'review_date', 'likelihood', 'severity', 'treatment', 'verification_method', 'residual_likelihood', 'residual_severity', 'visibility', 'response'];
const ASSIGN_EDIT = ['line_id', 'assignee_actor_id', 'assignee_name', 'assignee_type', 'task', 'due_date', 'note', 'state'];
const COST_ROW = ['kind', 'amount', 'minutes', 'rate_per_hour', 'note', 'line_id', 'currency'];
/* QA-142: the cost body keeps its names (any value) and adds the figures' bounds (lib/chits-input COST_BODY): a boolean, a text or a figure past the money ceiling is refused 422 */
const COST_BODY_SCHEMA = Object.assign({}, input.COST_BODY, { properties: Object.assign(Object.fromEntries(COST_ROW.map((name) => [name, {}])), input.COST_BODY.properties), additionalProperties: false });

/* S35: a body example is what the generated foreign-id case sends, so the route's own input rules (an ending needs a disposition, an entry a kind, a link a dispute id) pass and the lookup of the id it names is what answers */
const ROUTES = {
  /* ── the lists and the read ── */
  'GET /sent': { summary: 'The chits this shop sent, newest first, in pages', inline: [400], query: LIST_QUERY, out: LIST_OUT },
  'GET /folder': { summary: 'Drafts, Trash or Archive: the mailbox folders, both directions, paged', inline: [400], query: ['view'].concat(LIST_QUERY), out: LIST_OUT },
  'GET /rollup': { summary: 'My chits grouped by counterparty or by state, with the open disputes', query: ['group_by', 'direction', 'assignment', 'assigned_to'], out: object(['group_by', 'direction', 'groups', 'dispute_open'], { groups: array() }) },
  'GET /inbox': { summary: 'The chits that came to this shop, newest first, in pages', inline: [400], query: ['status'].concat(LIST_QUERY), out: object(['chits', 'total', 'page', 'limit', 'next'], { chits: array() }) },
  'GET /pulse': { summary: 'A watermark that moves when anything in the chit lists changes, so the screen reads again only then', out: object(['w'], { w: { type: ['string', 'null'] } }) },
  'GET /unread': { summary: 'The chits this co-assist has not opened since they changed', out: object(['unread'], { unread: array() }) },
  'GET /:chit_id': { summary: 'One chit with its parties, its history, its lines and what this login may do next', query: ['timing'], out: object(['header', 'detail', 'participants', 'state_log', 'attachments', 'amendments', 'actions']) },
  'GET /:chit_id/costs': { summary: 'What the chit cost: everything if this login may see it, else only its own rows', inline: [503], out: object() },
  'GET /:chit_id/use': { summary: 'What each line of a bill I received will post as: my choice, else my catalogue', inline: [409], out: object(['chit_id', 'status', 'changeable']) },
  'GET /:chit_id/catalogue-overlay': { summary: 'The catalogue item that fits a line, so a correction can carry its unit and price', query: ['q', 'comment'], out: object(['has_catalogue']) },
  'GET /:chit_id/messages': { summary: 'The messages on a chit, as this copy holds them (a dispute message only where this side was in its audience)', inline: [404], query: ['thread_type', 'dispute', 'line_id'].concat(PAGER), out: object(['count', 'messages', 'total', 'page', 'limit'], { messages: array() }) },
  'GET /:chit_id/disputes': { summary: 'The disputes on a chit that this side holds, and who a new one may name', inline: [404], out: object(['disputes', 'open_count', 'raise_parties', 'actions'], { disputes: array(), raise_parties: array() }) },
  'GET /:chit_id/diagnosis': { summary: 'One card per dispute this side is party to: the fault, where, how it is routed, the proof', inline: [404], out: object(['chit_id', 'chit_subject', 'diagnoses', 'count'], { diagnoses: array() }) },
  'GET /disputes/queue': { summary: 'The disputes this shop holds across every chit, open first, paged', query: ['status', 'side', 'q', 'sort'].concat(PAGER), out: object(['disputes', 'my_disputes', 'other_disputes', 'total_open', 'rows', 'total', 'page', 'limit', 'counts'], { disputes: array(), rows: array() }) },
  'GET /:id/children': { summary: 'The chits handed on from one chit that this shop also holds', inline: [400], out: object(['parent_chit_id', 'count', 'children'], { children: array() }) },
  'GET /:id/trace': { summary: 'Walk the chain of handoffs from one chit, forward to where it went or backward to where it came from', inline: [400], query: ['dir', 'network'], out: object() },
  'GET /trace/batches': { summary: 'The batches this shop holds a handoff chit for, origins first', query: PAGER, out: object(['count', 'batches', 'total', 'page', 'limit'], { batches: array() }) },
  'GET /trace/by-batch': { summary: 'Rebuild the chain from a batch or serial number on the lines instead of the parent links', inline: [400], query: ['q'], out: object(['dir', 'by_batch', 'reconstructed', 'matched_on', 'nodes', 'edges'], { nodes: array(), edges: array() }) },
  /* ── the writes: send, the one status writer, payment, disputes, housekeeping of my copy ── */
  'POST /send': { summary: 'Send a chit to its recipients: each party gets its own co-held copy, the header sealed at send (a draft is saved, not sealed)', gates: ['said'], inline: [409], invalid: 400, body: input.SEND_BODY, rules: { description: 'At least one recipient (recipients, or the older receivers) unless it is a draft; each must name someone or be self. A line figure that is not a number is refused 400 BAD_QTY · BAD_PRICE · BAD_RATE (ACC-271), a blank qty or price too, a blank rate only when the shelf cannot fill it.' }, out: object(['chit_id']) },
  'PUT /:chit_id/status': { summary: 'Move my copy to another status; the rail decides whether that step is allowed (the one status writer)', gates: ['said'], inline: [409], invalid: 400, body: input.STATUS_BODY, required: ['status'], rules: { additionalProperties: false }, out: object(['message', 'chit_id']) },
  'PUT /:chit_id/void': { summary: 'Withdraw a chit I sent, with a reason; the other parties are asked to cancel their copies', gates: ['said'], inline: [403], invalid: 400, body: input.VOID_BODY, required: ['reason'], rules: { additionalProperties: false }, out: object(['message', 'chit_id', 'status']) },
  'POST /:chit_id/payment': { summary: 'Mark a bill paid on my copy, post it to the books, and tell the seller (a hidden marker its withdraw check reads)', gates: ['said'], inline: [409, 422], invalid: 400, body: input.PAYMENT_BODY, required: ['method'], rules: { additionalProperties: false }, out: object(['message', 'payment']) },
  'DELETE /:chit_id/payment': { summary: 'Clear the paid mark on my copy (the books still hold the entry; it says which)', out: object(['message', 'books']) },
  'POST /:chit_id/books-request': { summary: 'Ask for this chit to be sent to the books now (a signed-in person, not a key)', inline: [403], body: [], rules: { additionalProperties: false }, out: object(['ok', 'books_request']) },
  'POST /:chit_id/disputes': { summary: 'Raise a dispute on a chit, with the parties it names; only they see it', gates: ['said'], inline: [404], invalid: 400, body: input.DISPUTE_BODY, required: ['category', 'reason'], rules: { additionalProperties: false }, out: object(['dispute_id', 'category', 'reason', 'status', 'scope', 'message']) },
  'PUT /:chit_id/disputes/:dispute_id/resolve': { summary: 'Resolve a dispute I raised, for one party or for all that remain open', gates: ['said'], inline: [403], invalid: 400, body: input.RESOLVE_BODY, required: ['resolution_note'], rules: { additionalProperties: false }, out: object(['dispute_id', 'status', 'resolved_parties', 'fully_resolved', 'resolution_note', 'resolved_by', 'message']) },
  'POST /:chit_id/messages': { summary: 'Post a message on a chit, to every party or as an internal note; a dispute message reaches its roster only', gates: ['said'], inline: [403, 404], invalid: 400, body: input.MESSAGE_BODY, required: ['message_text', 'thread_type'], rules: { additionalProperties: false }, out: object(['message_id', 'thread_type', 'message_text', 'sender_display_name', 'created_at']) },
  'DELETE /:chit_id': { summary: 'Move my copy to Trash; a record both parties hold, or one with an open dispute, is refused', gates: ['said'], out: object(['message', 'chit_id']) },
  'PUT /:chit_id/priority': { summary: 'Set the internal priority of my copy; an urgent one needs a reason', gates: ['said'], invalid: 400, inline: [400], body: input.PRIORITY_BODY, required: ['priority'], rules: { additionalProperties: false }, out: object(['message', 'chit_id', 'priority_flag']) },
  'PUT /:chit_id/priority-flag': { summary: 'Flag the chit as a customer priority on every copy; written once', gates: ['said'], invalid: 400, inline: [409], body: input.PRIORITY_FLAG_BODY, required: ['priority'], rules: { additionalProperties: false }, out: object(['message', 'chit_id', 'customer_priority', 'locked']) },
  'POST /:chit_id/archive': { summary: 'Hide my copy from the lists (reversible); refused while a dispute is open', gates: ['said'], body: [], rules: { additionalProperties: false }, out: object(['message', 'chit_id']) },
  'PUT /:chit_id/star': { summary: 'Switch the star on my copies', body: [], rules: { additionalProperties: false }, out: object(['message', 'chit_id', 'star_flag']) },
  'POST /:chit_id/unread': { summary: 'Mark my copy unread', body: [], rules: { additionalProperties: false }, out: object(['message', 'chit_id']) },
  'POST /:chit_id/unarchive': { summary: 'Bring my copy back from the archive', body: [], rules: { additionalProperties: false }, out: object(['message', 'chit_id']) },
  'POST /:chit_id/restore': { summary: 'Bring my copy back from Trash', body: [], rules: { additionalProperties: false }, out: object(['message', 'chit_id']) },
  'DELETE /:chit_id/purge': { summary: 'Delete a draft for good (only the draft you made; a sent chit is never deleted)', gates: ['said'], inline: [403], out: object(['message', 'chit_id']) },
  'POST /assign-bulk': { summary: 'Push-assign up to 200 chits to one co-assist', gates: ['said'], invalid: 400, inline: [400], body: input.BULK_BODY, required: ['chit_ids', 'target_actor_id'], rules: { additionalProperties: false }, out: object(['message', 'assigned_to', 'assigned', 'skipped']) },
  'POST /:chit_id/reprice': { summary: 'Pull catalogue prices onto a chit as amendments; with preview it only shows what it would do', gates: ['said'], body: ['line_ids', 'only_unpriced', 'preview'], rules: { additionalProperties: false }, out: object() },
  'POST /:chit_id/costs': { summary: 'Record what the work cost: private to this shop, readable only where allowed', gates: ['said'], bodySchema: COST_BODY_SCHEMA, out: object() },
  'PUT /:chit_id/use': { summary: 'Say what the goods of a bill I received are for, before I accept it', gates: ['said'], body: ['use', 'bill', 'lines', 'asset_class', 'put_to_use', 'party'], rules: { additionalProperties: false }, out: object() },
  'POST /:chit_id/deliver-lines': { summary: 'Record what was delivered, line by line (a negative figure corrects an earlier one, never below what was delivered; refused on a rejected or cancelled copy)', gates: ['said'], inline: [409], list: true, body: ['rows', 'use', 'use_lines'].concat(DELIVERY_ROW), rules: { additionalProperties: false }, out: object() },
  'POST /:chit_id/assign-lines': { summary: 'Say who does which line, or take a line off a person', gates: ['said'], list: true, body: ['edits'].concat(ASSIGN_EDIT), rules: { additionalProperties: false }, out: object() },
  /* API-6 (25 Oct): the 400s lib/amend refuses with (AMEND_*) are declared; the body is closed (S33: the web sends { edits } only, checked 25 Oct) */
  'POST /:chit_id/amend': { summary: 'Correct lines of a sent chit as amendments; the original stays and counts in nothing', gates: ['said'], inline: [400, 409], list: true, body: ['edits'], rules: { additionalProperties: false }, out: object() },
  /* ── the register and the raida (risks, assumptions, issues on a chit or on a register of its own) ── */
  'GET /register/attachables': { summary: 'What a register may be attached to: an order, a campaign, an audit, a release', out: object(['attachables', 'degraded'], { attachables: array() }) },
  'GET /register/subjects': { summary: 'The registers this shop has opened, open ones first', query: ['type_key', 'open'], out: object(['subjects', 'migrated'], { subjects: array() }) },
  'POST /register/subjects': { summary: 'Open a register on a thing: a campaign, an audit, a release, an order', gates: ['said'], body: input.REGISTER_SUBJECT_BODY, rules: { additionalProperties: false }, out: object() },
  'POST /register/subjects/:subject_id/close': { summary: 'Close a register; refused while any entry in it is still open, naming the ones outstanding', gates: ['said'], rules: { additionalProperties: false }, out: object() },
  'GET /register/templates': { summary: 'The library of risks the shop keeps, so the same one is not worded twice', out: object(['templates', 'migrated'], { templates: array() }) },
  'POST /register/templates': { summary: 'Save a risk to the library', gates: ['said'], body: ['title', 'kind', 'body', 'likelihood', 'severity', 'treatment', 'verification_method', 'applies_to', 'standards'], rules: { additionalProperties: false }, out: object() },
  'POST /register/subjects/:subject_id/entries': { summary: 'Record an entry on a register that is not tied to an order', gates: ['said'], body: ENTRY_BODY, rules: { additionalProperties: false, examples: [{ kind: 'risk', body: 'Wet rice' }] }, out: object() },
  'POST /register/entries/:raida_id/close': { summary: 'End an entry wherever it lives, saying who ended it and why', gates: ['said'], body: CLOSE_BODY, rules: { additionalProperties: false, examples: [{ disposition: 'resolved' }] }, out: object() },
  'GET /register/walk/:from': { summary: 'What an entry breaks, or with backwards=1 what broke it', query: ['backwards', 'depth'], out: object(['migrated']) },
  'POST /register/entries/:raida_id/revise': { summary: 'Change what an entry says without losing what it said before', gates: ['said'], body: REVISE_BODY, rules: { additionalProperties: false, examples: [{ body: 'Wet rice, dried' }] }, out: object() },
  'POST /register/entries/:raida_id/accept': { summary: 'Accept a residual risk: a signature at the level its severity needs, with the date it comes back', gates: ['said'], body: ['accepted_by_name', 'authority_level', 'rationale', 'review_by'], rules: { additionalProperties: false }, out: object() },
  'GET /raida/report': { summary: 'Every entry this shop holds across all its chits, open and closed, filterable by register and by standard', gates: ['said'], query: ['subject_id', 'standard'], out: object(['entries', 'migrated'], { entries: array() }) },
  'GET /:chit_id/raida': { summary: 'The register on one chit, or on one line of it with the order-level entries it inherits', gates: ['said'], query: ['line_id'], out: object(['entries', 'migrated'], { entries: array() }) },
  'POST /:chit_id/raida': { summary: 'Record a risk, assumption, issue or decision against a chit this shop holds', gates: ['said'], body: ENTRY_BODY, rules: { additionalProperties: false }, out: object() },
  'POST /:chit_id/raida/:raida_id/close': { summary: 'End an entry on a chit, saying who ended it and why', gates: ['said'], body: CLOSE_BODY, rules: { additionalProperties: false, examples: [{ disposition: 'resolved' }] }, out: object() },
  'POST /:chit_id/raida/:raida_id/dispute': { summary: 'Say that a register entry was escalated to a dispute raised the usual way', gates: ['said'], body: { dispute_id: Object.assign({ 'x-bound': true }, input.UUID_TEXT) }, rules: { additionalProperties: false, examples: [{ dispute_id: '00000000-0000-4000-8000-0000000001d1' }] }, out: object() },
  'GET /trace/networks': { summary: 'The networks this shop takes part in, and how many handoffs it holds in each', out: object(['networks'], { networks: array() }) }
};

const { schemaValidate } = require('../middleware/validate');

/** the schema check of one route (its own operation above), as a list to spread after the gates: a route that takes no input has none (moved here from routes/chits.js so routes/chits-trace.js asks the same one) */
function routeChecks(route) {
  const operation = contract.operationFor(route);
  return operation.parameters || operation.requestBody ? [schemaValidate(operation, input.schemaOptionsFor(route))] : [];
}

const contract = contractOf({ mount: '/api/chits', routes: ROUTES, refusals: REFUSALS, refusalsWhen: 'said', extension: 'x-chits-refusals' });

module.exports = Object.assign({ said, failed, faultOf, codeOfStatus, railSaid, ROUTES, REFUSALS, schemaOptionsFor: input.schemaOptionsFor, routeChecks }, contract);
