/*
 * OWNS      the contract of routes/service.js (7 routes, /api/service — a chit as a service request: the clock, and the pause that gets argued about): each route's OpenAPI operation (S9) and the
 *           one way its refusals and faults are worded (the words, serviceFault, isOwnClaim, the column lists RECORD_COLUMNS and PAUSE_COLUMNS, pick).
 * CALLED BY routes/service.js (checked(route) on each route, router.openapi, problem(req, res, { status, ...words.x() } | serviceFault(e, req))) → tools/api-register.cjs · tools/api-contract-tests.cjs ·
 *           tests/api-problem-service.test.cjs.
 * FLOW      operation → schemaValidate(operation, schemaOptions) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a refusal → problem(req, res, { status, ...words.x() }) → the old body ({ error, message }) beside the Problem fields
 *           a thrown error → serviceFault(e, req) → the 503 "not migrated" the screen always got, or a 500 that says nothing of its cause (the real error is logged with the request id)
 * CARD      02-tasks-orders-and-workflow/README (the service clock is the SLA capability: docs/process, project-service-sla)
 * This file shapes NO answer of its own: the clock is lib/clockLib.js, the rows are chit_sla and chit_sla_pause (b147), as before.
 *
 * ⚠️ STRICT INPUT (API-3, S33): each body lists the keys its handler reads and refuses any other, naming it. The keys are the ones the handlers read, which the web (cap-service.js) sends and no more:
 *    PUT impact · urgency · priority · policy; resolve resolution_code · note; pause reason · note · on_counterparty · from; end to; answer accepted; respond none.
 * ⚠️ The old express-validator chains (impact/urgency/priority/reason/resolution_code optional or required strings; accepted a boolean) answered 400 { error: 'Validation failed', details: [{ field, message: 'Invalid value' }] }.
 *    The schema check answers the same words, so a caller that sent a wrong kind still reads what it always read; only a key nobody reads is newly refused.
 * ⚠️ NOTHING IS SAID OF THE CAUSE. The two catch blocks that used to put the database's own text in `message` now answer the generic sentence; a missing table (b147 not run) is still the plain 503.
 */
'use strict';
const clockLib = require('./sla');
const { internalSpec } = require('./problem');
const { SAFE_SENTENCE } = require('./respond');
const { contractOf, object, array, text } = require('./contract-kit');

/** the old body of a refusal as the parts problem() takes: { code, detail, legacy }. The detail is the sentence the body carried (its message, else its error word). */
const said = (code, legacy) => ({ code, detail: legacy.message === undefined ? legacy.error : legacy.message, legacy });
const list = (items) => items.join(', ');

/* ── the words ──────────────────────────────────────────────────────────────────────────────────────────── */
const words = {
  notFound: () => said('NOT_FOUND', { error: 'Not found' }),
  notTracked: () => said('SERVICE_NOT_TRACKED', { error: 'Not tracked', message: 'Start the service clock first.' }),
  badPriority: () => said('SERVICE_BAD_PRIORITY', { error: 'Bad priority', message: 'priority must be one of: ' + list(clockLib.PRIORITIES) }),
  badResolution: () => said('SERVICE_BAD_RESOLUTION', { error: 'Bad resolution', message: 'resolution_code must be one of: ' + list(clockLib.RESOLUTION_CODES) }),
  badReason: () => said('SERVICE_BAD_REASON', { error: 'Bad reason', message: 'reason must be one of: ' + list(clockLib.PAUSE_REASONS) }),
  alreadyPaused: () => said('SERVICE_ALREADY_PAUSED', { error: 'Already paused', message: 'This request is already paused by you — end that pause before starting another.' }),
  notOpen: () => said('SERVICE_PAUSE_NOT_OPEN', { error: 'Not open', message: 'That pause is already ended — its end time cannot be moved.' }),
  ownClaim: () => said('SERVICE_OWN_CLAIM', { error: 'Your own claim', message: 'You raised this pause — the other party is the one who accepts or rejects it.' }),
  notMigrated: () => said('SERVICE_NOT_MIGRATED', { error: 'Not migrated', message: 'The service clock needs b147 on this environment.' })
};

/** every code this file's routes answer under, for the test that each is a register row with its sentence */
const CODES = ['INTERNAL', 'INVALID_INPUT', 'NOT_FOUND', 'SERVICE_NOT_TRACKED', 'SERVICE_BAD_PRIORITY', 'SERVICE_BAD_RESOLUTION', 'SERVICE_BAD_REASON', 'SERVICE_ALREADY_PAUSED', 'SERVICE_PAUSE_NOT_OPEN', 'SERVICE_OWN_CLAIM', 'SERVICE_NOT_MIGRATED'];

/** a table that b147 has not made yet (42P01), a column or a function it adds (42703, 42883): the environment is behind, not the feature broken */
const notMigrated = (failure) => !!failure && ['42P01', '42703', '42883'].includes(failure.code);
/** the SQL function refuses a party answering its own pause claim: a rule, not a fault (the library's sentence is matched, never relayed) */
const isOwnClaim = (failure) => /cannot answer its own/.test(String((failure && failure.message) || ''));
/** serviceFault(e, req) — the spec of whatever a service route's catch got: the plain 503 before b147, else a 500 that says nothing of its cause */
const serviceFault = (failure, req) => (notMigrated(failure) ? { status: 503, ...words.notMigrated() } : internalSpec(req, failure, { error: 'Failed', message: SAFE_SENTENCE }));

/** the named columns of a row, in the order named (a column that is not listed never leaves) */
const pick = (row, columns) => Object.fromEntries(columns.filter((name) => row && name in row).map((name) => [name, row[name]]));

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
const closed = (required, properties) => Object.assign(object(required, properties), { additionalProperties: false });
const STAMP = { type: ['string', 'null'], format: 'date-time' };
const WORDS = { type: ['string', 'null'] };
const UUID = { type: 'string', format: 'uuid' };
const FLAG = { type: ['boolean', 'null'] };
/** what a SQL function counts (integer from the driver, text for a bigint): a count of copies written */
const COUNT = { type: ['integer', 'string'] };
/** the kind of each column: what the allow-list says about a value, so the contract is a description and not only a fence */
const RECORD_KINDS = { chit_id: UUID, entity_id: UUID, impact: WORDS, urgency: WORDS, priority: WORDS, raised_at: STAMP, responded_at: STAMP, resolved_at: STAMP, closed_at: STAMP, resolution_code: WORDS, resolution_note: WORDS, closed_by_counterparty: FLAG, policy: { type: ['object', 'null'] }, created_at: STAMP, updated_at: STAMP };
const PAUSE_KINDS = { pause_id: UUID, paused_from: STAMP, paused_to: STAMP, reason: WORDS, note: WORDS, on_counterparty: FLAG, claimed_by_entity_id: UUID, claimed_by_name: WORDS, accepted: FLAG, accepted_at: STAMP, accepted_by: WORDS };
/** the columns an answer may carry (b147), in the table's order — a column added to the table later is not in the answer until it is listed here */
const RECORD_COLUMNS = Object.keys(RECORD_KINDS);
const PAUSE_COLUMNS = Object.keys(PAUSE_KINDS);
const RECORD = closed([], RECORD_KINDS);
const PAUSE = closed([], Object.assign({}, PAUSE_KINDS, { mine: { type: 'boolean' } }));
const LISTS = { resolution_codes: array(text), pause_reasons: array(text), impacts: array(text), urgencies: array(text) };
const CLOCK_ANSWER = closed(['tracked', 'chit_id', 'resolution_codes', 'pause_reasons', 'impacts', 'urgencies'], Object.assign({ tracked: { type: 'boolean' }, chit_id: text, record: RECORD, clock: { type: 'object' }, pauses: array(PAUSE), readable: { type: 'object' } }, LISTS));
const COPIES = closed(['message', 'copies'], { message: text, copies: COUNT });
const RECORDED = closed(['message', 'responded_at'], { message: text, responded_at: STAMP });
const RESOLVED = closed(['message', 'resolved_at', 'resolution_code'], { message: text, resolved_at: STAMP, resolution_code: text });
const PAUSED = closed(['message', 'pause_id', 'copies'], { message: text, pause_id: text, copies: COUNT });
const STARTED = closed(['message', 'record'], { message: text, record: RECORD });

/** the reason and the code a valid request names: the first the clock knows, so the generated cases reach the handler (a bare 'x' would be refused by it in its own words) */
const reasonField = { type: 'string', examples: [clockLib.PAUSE_REASONS[0]] };
const codeField = { type: 'string', examples: [clockLib.RESOLUTION_CODES[0]] };
const NO_UNKNOWN_KEYS = { additionalProperties: false };
const GATE_STATUS = {};
const NOT_MIGRATED = [{ status: 503, code: 'SERVICE_NOT_MIGRATED', when: 'a database update (b147) is still to run' }];
const SERVICE = ['refuses'];

const ROUTES = {
  'GET /:chit_id': { summary: 'The service clock of a chit this shop holds, computed as agreed and as contested', gates: SERVICE, out: CLOCK_ANSWER },
  'PUT /:chit_id': { summary: 'Start the clock, or change impact and urgency (the priority follows from them)', gates: SERVICE, invalid: 400, inline: [400], body: { impact: { type: 'string' }, urgency: { type: 'string' }, priority: { type: 'string' }, policy: {} }, rules: NO_UNKNOWN_KEYS, out: STARTED },
  'POST /:chit_id/respond': { summary: 'Someone picked it up: the first response is the one that counts', gates: SERVICE, invalid: 400, body: {}, rules: NO_UNKNOWN_KEYS, out: RECORDED },
  'POST /:chit_id/resolve': { summary: 'What was done (a resolution code); closing it is a separate act', gates: SERVICE, invalid: 400, inline: [400], body: { resolution_code: codeField, note: {} }, required: ['resolution_code'], rules: NO_UNKNOWN_KEYS, out: RESOLVED },
  'POST /:chit_id/pause': { summary: 'Stop the clock, and say on whom (written into every participant copy)', gates: SERVICE, invalid: 400, inline: [400, 409], body: { reason: reasonField, note: {}, on_counterparty: {}, from: {} }, required: ['reason'], rules: NO_UNKNOWN_KEYS, out: PAUSED },
  'POST /:chit_id/pause/:pause_id/end': { summary: 'Restart the clock: end an open pause', gates: SERVICE, invalid: 400, inline: [409], body: { to: {} }, rules: NO_UNKNOWN_KEYS, out: COPIES },
  'POST /:chit_id/pause/:pause_id/answer': { summary: "Accept or reject the other side's pause: the disagreement, made into a fact", gates: SERVICE, invalid: 400, inline: [409], body: { accepted: { type: 'boolean' } }, required: ['accepted'], rules: NO_UNKNOWN_KEYS, out: COPIES }
};

const contract = contractOf({ mount: '/api/service', routes: ROUTES, gateStatus: GATE_STATUS, refusals: NOT_MIGRATED, refusalsWhen: 'refuses', extension: 'x-service-refusals' });

/** a schema refusal is the old express-validator body: the field named, 'Invalid value' for a wrong kind, the schema's own sentence for a key nobody reads */
const schemaOptions = {
  status: 400,
  code: 'INVALID_INPUT',
  legacy: (failures) => ({ error: 'Validation failed', details: failures.map((failure) => ({ field: failure.field, message: failure.code === 'UNKNOWN_FIELD' ? failure.detail : 'Invalid value' })) })
};
const checked = (route) => require('../middleware/validate').schemaValidate(contract.operationFor(route), schemaOptions);

module.exports = { said, words, CODES, serviceFault, isOwnClaim, notMigrated, pick, RECORD_COLUMNS, PAUSE_COLUMNS, schemaOptions, checked, OPERATIONS: contract.OPERATIONS, pathsOf: contract.pathsOf, allowedStatuses: contract.allowedStatuses, contract };
