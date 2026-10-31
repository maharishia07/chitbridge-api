/*
 * OWNS      the contract of routes/folders.js: each route's OpenAPI operation (S9) and the one way its refusals and faults are worded (said, faultOf, invalidFolder).
 * CALLED BY routes/folders.js (schemaValidate on each route, router.openapi, problem(req, res, said(...) | faultOf(...))) → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-finance.test.cjs.
 * FLOW      operation → schemaValidate(operation, schemaOptionsFor(route)) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a refusal → problem(req, res, { status, ...said(code, error, message) }) → the old { error, message } beside the Problem fields
 *           a thrown error → failed(e, req, label) (always a 500) | faultOf(e, req, label) → a refusal the library meant (400 · 404 · 503, its own words) or a 500 that says nothing of its cause
 * CARD      01-rail-core-the-chit/folders
 * This file shapes NO answer and files no chit: the lists and the figures are lib/folder-views, lib/select, lib/measure and the rest, as before.
 *
 * ⚠️ The input schemas say what the handlers ALREADY take. Where the route used an express-validator chain (an id that must be a uuid, a name of 1 to 60 characters) the schema says the
 *    same, answers 400 as the chain did, and words the refusal in the chain's own body ({ error: "Validation failed", details: [{ field, message }] }), frozen in docs/contracts/api-legacy.json.
 *    Every other missing or odd value is answered by the handler in its own sentence, and those sentences are frozen too. A query value the handler reads leniently (a bad page falls back to
 *    the first) is declared as plain text: a schema that refused it would turn a fallback into a refusal no caller has ever had.
 * ⚠️ S33: the eight writes refuse a body key no one reads, by name (closed below); every key the handler, its library or a web caller sends stays declared, even one the route ignores.
 */
'use strict';
const { internalSpec } = require('./problem');
const { SAFE_SENTENCE } = require('./respond');
const { contractOf, object, array } = require('./contract-kit');

/* ── the words ──────────────────────────────────────────────────────────────────────────────────────────── */
/**
 * the old body of a refusal, as the spec parts problem() takes: { code, detail, legacy }. `message` is left out of the body where the route never sent one;
 * `withCode` keeps the `code` key the old body carried, in the place it had it: 'before' the message, or true = after it.
 */
function said(code, error, message, withCode) {
  const legacy = Object.assign({ error }, withCode === 'before' ? { code } : {}, message === undefined ? {} : { message }, withCode === true ? { code } : {});
  return { code, detail: message === undefined ? error : message, legacy };
}

/** a route that always answered 500 when it failed: the screen's label, and nothing of the cause (the real error is logged with the request id) */
const failed = (e, req, label) => internalSpec(req, e, { error: label, message: SAFE_SENTENCE });

const REFUSAL_CODES = { 400: 'FOLDER_BAD_REQUEST', 404: 'NOT_FOUND', 503: 'FOLDER_NOT_MIGRATED' };
/**
 * faultOf(e, req, label) — the spec of whatever a folder route's catch got. `label` is the screen's own word for the failure ("Rule create failed").
 * A library refusal carries a status and its own sentence (400 "Nothing to update", 404 "Rule not found", 503 "not migrated"): it keeps both.
 * Anything else, and any 5xx but the 503 of an update still to run, is a 500 that says nothing of its cause (S8): the real error is logged with the request id.
 */
function faultOf(e, req, label) {
  const status = e && e.status;
  if (!status || (status >= 500 && status !== 503)) return failed(e, req, label);
  const words = e.message || SAFE_SENTENCE;
  return { status, code: REFUSAL_CODES[status] || REFUSAL_CODES[400], detail: words, legacy: { error: label, message: words } };
}

/** the sentences express-validator gave: "Invalid value" for every field, but the one the route worded itself */
const INVALID_VALUE = 'Invalid value';
/** the old body of a validation refusal: { error: "Validation failed", details: [{ field, message }] }, one detail per field at fault (the chain gave one per field too) */
function invalidFolder(failures, sentences) {
  const given = sentences || {};
  const seen = new Set();
  const details = failures.filter((failure) => !seen.has(failure.field) && seen.add(failure.field)).map((failure) => ({ field: failure.field, message: given[failure.field] || INVALID_VALUE }));
  return { error: 'Validation failed', details };
}
/** what schemaValidate takes for a route that answered with the chain: status 400, this code, this body */
const schemaRefusal = (sentences) => ({ status: 400, code: 'FOLDER_INVALID', legacy: (failures) => invalidFolder(failures, sentences) });

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
const UUID_PATTERN =
  '^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|[fF]{8}-[fF]{4}-[fF]{4}-[fF]{4}-[fF]{12})$';
const EXAMPLE_ID = '11111111-2222-4333-8444-555555555555';
/** an id the chain checked with isUUID(): text of the uuid shape validator.js calls 'all' (version 1 to 8, the nil and the max uuid; case-blind) */
const UUID = { type: 'string', pattern: UUID_PATTERN, examples: [EXAMPLE_ID] };
/** a folder id, or null for "no folder" (unfile): RAIL-137 (a), a word that is not an id used to reach the database and answer 500 */
const FOLDER_OR_NONE = { type: ['string', 'null'], pattern: UUID_PATTERN, examples: [EXAMPLE_ID] };
/** a folder name: 1 to 60 characters once the edges are trimmed (the chain trimmed, then counted) */
const NAME = { type: 'string', pattern: '^\\s*\\S(?:[\\s\\S]{0,58}\\S)?\\s*$', examples: ['Mayur'] };
const ID_PARAMS = { id: UUID };
const RULE_PARAMS = { rule_id: UUID };
const PAGE = ['page', 'limit'];
const RULE_BODY = ['name', 'when', 'enabled', 'sort', 'stop_processing'];
/**
 * S33 strict input: a write's body lists every key the route, its library (lib/folder-rules create · update · preview) or a web caller (app/cap-folders.js · app/cap-messages.js · app.html) sends,
 * and refuses any other by name (UNKNOWN_FIELD, in the route's own refusal). `examples` is a request that is valid as a whole (an annotation, it refuses nothing): the generated cases send it,
 * so a write that needs one value (a rename, a rule's condition) is reached past "Nothing to update" and its id is what decides the reply: S35.
 */
const closed = (example) => Object.assign({ additionalProperties: false }, example ? { examples: [example] } : {});
const REFUSALS = [
  { status: 400, code: 'FOLDER_BAD_REQUEST', when: 'a request the folders cannot take, in its own words' },
  { status: 404, code: 'NOT_FOUND', when: 'no such rule' },
  { status: 503, code: 'FOLDER_NOT_MIGRATED', when: 'a database update (b132 · b130) is still to run' }
];
const FOLDER_LIST = object(['folders', 'total', 'page', 'limit'], { folders: array() });
const MEASURES = ['count', 'by_status', 'by_direction', 'open', 'closed', 'unread', 'overdue'];

const ROUTES = {
  'GET /': { summary: "The shop's folders: the system ones first, then its own tree, each with its open count", query: PAGE, out: FOLDER_LIST },
  'GET /inventory': { summary: 'Every folder a shop can have, numbered with its ledger, on or off, and whether this login may switch them', out: object(['rows', 'can_change'], { rows: array() }) },
  'PUT /inventory/:code': { summary: 'Switch one system folder on or off, or set its messaging level (owner)', gates: ['said'], inline: [400, 403, 404, 409], body: ['on', 'msg'], rules: closed(), out: object(['rows', 'can_change'], { rows: array() }) },
  'POST /': { summary: 'Make a folder, filed or a view, under a parent', invalid: 400, inline: [400, 503], body: { name: NAME, parent_id: FOLDER_OR_NONE, scope: {}, kind: {} }, required: ['name'], rules: closed(), out: object(['folder']) },
  'PATCH /:id': { summary: 'Rename a folder and/or move it under another', invalid: 400, inline: [400], params: ID_PARAMS, body: { name: NAME, parent_id: {} }, rules: closed({ name: 'Mayur' }), out: object(['folder']) },
  'DELETE /:id': { summary: 'Delete a folder; its chits go back unfiled', invalid: 400, params: ID_PARAMS, out: object(['deleted']) },
  'POST /move': { summary: 'File a chit into a folder, or unfile it (this login\'s own copy only)', invalid: 400, inline: [400], body: { chit_id: UUID, folder_id: FOLDER_OR_NONE, direction: {} }, required: ['chit_id'], rules: closed(), out: object(['moved', 'folder_id', 'scope']) },
  'GET /:id/chits': { summary: "The chits in one folder, paged; a system or view folder answers with what its rule matches", invalid: 400, inline: [404], params: ID_PARAMS, query: ['archived', 'state'].concat(PAGE), out: object(['chits', 'total', 'page', 'limit'], { chits: array() }) },
  'GET /:id/metrics': { summary: 'What is in one folder, as numbers: open, overdue, ageing, unread', invalid: 400, inline: [404], params: ID_PARAMS, query: ['archived'], out: object(['folder_id', 'scope'].concat(MEASURES)) },
  'GET /:id/rules': { summary: "The rules that file into one folder (a system folder's own rule is shown, fixed)", gates: ['said'], invalid: 400, params: ID_PARAMS, out: object(['rules', 'migrated'], { rules: array() }) },
  'POST /:id/rules': { summary: 'Add a rule to a folder: a condition and where to file', gates: ['said'], invalid: 400, inline: [400], params: ID_PARAMS, body: RULE_BODY, rules: closed({ name: 'Invoices', when: { doc: 'invoice' } }), out: object(['rule_id', 'folder_id', 'when']) },
  'PATCH /rules/:rule_id': { summary: 'Change a rule; only the fields sent change', gates: ['said'], invalid: 400, params: RULE_PARAMS, body: RULE_BODY, rules: closed({ enabled: true }), out: object(['rule_id', 'folder_id', 'when']) },
  'DELETE /rules/:rule_id': { summary: 'Delete a rule', gates: ['said'], invalid: 400, params: RULE_PARAMS, out: object(['deleted']) },
  'POST /rules/preview': { summary: 'What a rule would have caught among the chits that already exist, nothing saved', gates: ['said'], body: ['when', 'limit'], rules: closed(), out: object(['scanned', 'matched', 'sample'], { sample: array() }) },
  'GET /rules/vocabulary': { summary: 'The conditions a rule may use, so the builder offers no term the matcher does not know', out: object(['keys']) },
  'GET /rules': { summary: "Every rule this shop has, across all its folders, paged", gates: ['said'], query: PAGE, out: object(['rules', 'migrated', 'total', 'page', 'limit'], { rules: array() }) },
  'GET /groupsum': { summary: 'What a pile of tasks or orders adds up to: the requirement per item, and who asked', query: ['scope', 'folder_id', 'chit_ids', 'archived'], out: object(['scope']) },
  'GET /worklist': { summary: "One person's lines across every chit (a co-assist sees only their own)", inline: [400], query: ['due_on', 'actor_id'], out: object(['people', 'lines', 'migrated']) },
  'GET /messages': { summary: 'Every external message that still wants this shop, across every chit; with count=1 only the unread count', query: ['all', 'count'].concat(PAGE), out: object(['count']) },
  'POST /messages/:message_id/mark': { summary: 'Mark one external message read and/or kept', inline: [400, 404, 503], body: ['read', 'kept'], rules: closed(), out: object(['ok', 'updated']) },
  'GET /reconcile': { summary: 'Does the arithmetic add up: total = unfiled + every folder, for tasks or orders', query: ['scope'], out: object(['scope', 'direction', 'total', 'unfiled', 'inbox', 'in_bills', 'filed', 'folders', 'overall', 'reconciles']) },
  'GET /mis': { summary: 'The same measurement for received, sent and all, since a day', inline: [400], query: ['since'], out: object(['overdue_days', 'since', 'truncated', 'all', 'received', 'sent']) }
};

const contract = contractOf({ mount: '/api/folders', routes: ROUTES, refusals: REFUSALS, refusalsWhen: 'said', extension: 'x-folders-refusals' });
/** the options schemaValidate takes for a route: the chain's refusal where the route had a chain, else the default */
const schemaOptionsFor = (route) => {
  const row = ROUTES[route];
  if (!row || !row.invalid) return undefined;
  return schemaRefusal(route === 'POST /' ? { name: 'Name required' } : undefined);
};

module.exports = Object.assign({ said, failed, faultOf, invalidFolder, schemaOptionsFor, ROUTES, REFUSALS, UUID_PATTERN, UUID_SCHEMA: UUID }, contract);
