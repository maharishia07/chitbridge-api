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
  return { code: ownCodeOf(legacy) || code || STATUS_CODES[400], detail: String(detail || sentenceOf(legacy)), legacy };
}
/** a route that always answered 500 when it failed: the screen's label and the safe sentence, nothing of the cause (the real error is logged with the request id) */
const failed = (e, req, label) => internalSpec(req, e, { error: label, message: SAFE_SENTENCE });

/**
 * faultOf(e, req, label, { words }) — the spec of whatever a catch got, for a route that answered with the status the error carried (`e.status || 500`).
 * A 5xx, and any status when `words` is not asked for, says the safe sentence: the real error is logged with the request id (S8). With `words`, an error
 * that carries a status below 500 is a refusal a library meant, and says its own sentence (the register and the library routes always did).
 * `extra` keys ride after the message (the gate that names what is still open).
 */
function faultOf(e, req, label, options) {
  const { words, extra } = Object.assign({ words: false, extra: {} }, options);
  const status = (e && e.status) || 500;
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
  { status: 503, code: 'CHIT_NOT_MIGRATED', when: 'a database update is still to run' }
];

/** the fields of a register entry, on a chit or on a standalone register (raida.add takes them; the chit, the register and the entity are decided by the route) */
const ENTRY_BODY = ['kind', 'body', 'line_id', 'visibility', 'owner_name', 'due_date', 'review_date', 'likelihood', 'severity', 'treatment', 'verification_method', 'response', 'template_id', 'rel_type', 'to_type', 'to_id', 'to_label', 'needed_by'];

const ROUTES = {
  /* ── the lists and the read ── */
  'GET /sent': { summary: 'The chits this shop sent, newest first, in pages', query: LIST_QUERY, out: LIST_OUT },
  'GET /folder': { summary: 'Drafts, Trash or Archive: the mailbox folders, both directions, paged', query: ['view'].concat(LIST_QUERY), out: LIST_OUT },
  'GET /rollup': { summary: 'My chits grouped by counterparty or by state, with the open disputes', query: ['group_by', 'direction', 'assignment', 'assigned_to'], out: object(['group_by', 'direction', 'groups', 'dispute_open'], { groups: array() }) },
  'GET /inbox': { summary: 'The chits that came to this shop, newest first, in pages', query: ['status'].concat(LIST_QUERY), out: object(['chits', 'total', 'page', 'limit', 'next'], { chits: array() }) },
  'GET /pulse': { summary: 'A watermark that moves when anything in the chit lists changes, so the screen reads again only then', out: object(['w'], { w: { type: ['string', 'null'] } }) },
  'GET /unread': { summary: 'The chits this co-assist has not opened since they changed', out: object(['unread'], { unread: array() }) },
  'GET /:chit_id': { summary: 'One chit with its parties, its history, its lines and what this login may do next', query: ['timing'], out: object(['header', 'detail', 'participants', 'state_log', 'attachments', 'amendments', 'actions']) },
  'GET /:chit_id/costs': { summary: 'What the chit cost: everything if this login may see it, else only its own rows', inline: [503], out: object() },
  'GET /:chit_id/use': { summary: 'What each line of a bill I received will post as: my choice, else my catalogue', inline: [409], out: object(['chit_id', 'status', 'changeable']) },
  'GET /:chit_id/catalogue-overlay': { summary: 'The catalogue item that fits a line, so a correction can carry its unit and price', query: ['q', 'comment'], out: object(['has_catalogue']) },
  'GET /:chit_id/messages': { summary: 'The messages on a chit, as this copy holds them (a dispute message only where this side was in its audience)', inline: [403], query: ['thread_type', 'dispute', 'line_id'].concat(PAGER), out: object(['count', 'messages', 'total', 'page', 'limit'], { messages: array() }) },
  'GET /:chit_id/disputes': { summary: 'The disputes on a chit that this side holds, and who a new one may name', inline: [403], out: object(['disputes', 'open_count', 'raise_parties', 'actions'], { disputes: array(), raise_parties: array() }) },
  'GET /:chit_id/diagnosis': { summary: 'One card per dispute this side is party to: the fault, where, how it is routed, the proof', inline: [403], out: object(['chit_id', 'chit_subject', 'diagnoses', 'count'], { diagnoses: array() }) },
  'GET /disputes/queue': { summary: 'The disputes this shop holds across every chit, open first, paged', query: ['status', 'side', 'q', 'sort'].concat(PAGER), out: object(['disputes', 'my_disputes', 'other_disputes', 'total_open', 'rows', 'total', 'page', 'limit', 'counts'], { disputes: array(), rows: array() }) },
  'GET /:id/children': { summary: 'The chits handed on from one chit that this shop also holds', inline: [400], out: object(['parent_chit_id', 'count', 'children'], { children: array() }) },
  'GET /:id/trace': { summary: 'Walk the chain of handoffs from one chit, forward to where it went or backward to where it came from', inline: [400], query: ['dir', 'network'], out: object() },
  'GET /trace/batches': { summary: 'The batches this shop holds a handoff chit for, origins first', query: PAGER, out: object(['count', 'batches', 'total', 'page', 'limit'], { batches: array() }) },
  'GET /trace/by-batch': { summary: 'Rebuild the chain from a batch or serial number on the lines instead of the parent links', inline: [400], query: ['q'], out: object(['dir', 'by_batch', 'reconstructed', 'matched_on', 'nodes', 'edges'], { nodes: array(), edges: array() }) },
  /* ── the register and the raida (risks, assumptions, issues on a chit or on a register of its own) ── */
  'GET /register/attachables': { summary: 'What a register may be attached to: an order, a campaign, an audit, a release', out: object(['attachables', 'degraded'], { attachables: array() }) },
  'GET /register/subjects': { summary: 'The registers this shop has opened, open ones first', query: ['type_key', 'open'], out: object(['subjects', 'migrated'], { subjects: array() }) },
  'POST /register/subjects': { summary: 'Open a register on a thing: a campaign, an audit, a release, an order', gates: ['said'], body: ['type_key', 'ref_id', 'ref_label', 'name'], out: object() },
  'POST /register/subjects/:subject_id/close': { summary: 'Close a register; refused while any entry in it is still open, naming the ones outstanding', gates: ['said'], out: object() },
  'GET /register/templates': { summary: 'The library of risks the shop keeps, so the same one is not worded twice', out: object(['templates', 'migrated'], { templates: array() }) },
  'POST /register/templates': { summary: 'Save a risk to the library', gates: ['said'], body: ['title', 'kind', 'body', 'likelihood', 'severity', 'treatment', 'verification_method', 'applies_to', 'standards'], out: object() },
  'POST /register/subjects/:subject_id/entries': { summary: 'Record an entry on a register that is not tied to an order', gates: ['said'], body: ENTRY_BODY, out: object() },
  'POST /register/entries/:raida_id/close': { summary: 'End an entry wherever it lives, saying who ended it and why', gates: ['said'], body: ['body', 'disposition'], out: object() },
  'GET /register/walk/:from': { summary: 'What an entry breaks, or with backwards=1 what broke it', query: ['backwards', 'depth'], out: object(['migrated']) },
  'POST /register/entries/:raida_id/revise': { summary: 'Change what an entry says without losing what it said before', gates: ['said'], body: ['body', 'response'], out: object() },
  'POST /register/entries/:raida_id/accept': { summary: 'Accept a residual risk: a signature at the level its severity needs, with the date it comes back', gates: ['said'], body: ['accepted_by_name', 'authority_level', 'rationale', 'review_by'], out: object() },
  'GET /raida/report': { summary: 'Every entry this shop holds across all its chits, open and closed, filterable by register and by standard', gates: ['said'], query: ['subject_id', 'standard'], out: object(['entries', 'migrated'], { entries: array() }) },
  'GET /:chit_id/raida': { summary: 'The register on one chit, or on one line of it with the order-level entries it inherits', gates: ['said'], query: ['line_id'], out: object(['entries', 'migrated'], { entries: array() }) },
  'POST /:chit_id/raida': { summary: 'Record a risk, assumption, issue or decision against a chit this shop holds', gates: ['said'], body: ENTRY_BODY, out: object() },
  'POST /:chit_id/raida/:raida_id/close': { summary: 'End an entry on a chit, saying who ended it and why', gates: ['said'], body: ['body'], out: object() },
  'POST /:chit_id/raida/:raida_id/dispute': { summary: 'Say that a register entry was escalated to a dispute raised the usual way', gates: ['said'], body: ['dispute_id'], out: object() },
  'GET /trace/networks': { summary: 'The networks this shop takes part in, and how many handoffs it holds in each', out: object(['networks'], { networks: array() }) }
};

const contract = contractOf({ mount: '/api/chits', routes: ROUTES, refusals: REFUSALS, refusalsWhen: 'said', extension: 'x-chits-refusals' });

module.exports = Object.assign({ said, failed, faultOf, codeOfStatus, ROUTES, REFUSALS }, contract);
