/*
 * OWNS      the contract of the orders and workflow routes (23): routes/repeat-supply.js (/api/repeat, 14), routes/work.js (/api/work, 3) and routes/counters.js (/api/counters, 6) —
 *           each route's OpenAPI operation (S9) and the one way their refusals and faults are worded (said, repeatFault, levelRefusal, counterFault, failed).
 * CALLED BY routes/repeat-supply.js · routes/work.js · routes/counters.js (schemaValidate on each route, router.openapi, problem(req, res, said(...) | repeatFault(...) | counterFault(...)))
 *           → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-orders.test.cjs.
 * FLOW      operation → schemaValidate(operation, schemaOptions) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a refusal → problem(req, res, { status, ...said(code, legacy) }) → the old body beside the Problem fields
 *           a thrown error → repeatFault(e, req) | counterFault(e, req, label) | failed(e, req) → the refusal the library meant (400 · 404 · 422 · 503, its own words) or a 500 that says nothing of its cause
 * CARD      02-tasks-orders-and-workflow/everyones-work
 * This file shapes NO answer: the agreements, the work rows and the counters are lib/repeat-supply, lib/work-rows and routes/counters.js, as before.
 *
 * ⚠️ The input schemas say what the handlers ALREADY take: names, nothing required, nothing narrowed. A handler answers a missing or odd value in its own sentence
 *    ("Which bill should repeat?"), and those sentences are frozen in docs/contracts/api-legacy.json, recorded from the code before the sweep. The one thing a schema
 *    refuses is a body that is not an object, or a query value given twice: answered 400 in the shape each route always refused in. A malformed chit id on the work sheet stays
 *    a 404 (the path argument is plain text), as it was.
 * ⚠️ A legacy `code` key is kept: the Problem's `code` is that same word where the old body had one (REPEAT_*, COUNTER_HELD, BAD_PHONE, OWNER_ONLY).
 */
'use strict';
const { internalSpec } = require('./problem');
const { SAFE_SENTENCE } = require('./respond');
const { contractOf, object, array } = require('./contract-kit');

/** the old body of a refusal, as the spec parts problem() takes: { code, detail, legacy }; the words a person reads are `message`, else `error` */
const said = (code, legacy) => ({ code, detail: legacy.message === undefined ? legacy.error : legacy.message, legacy });

/* ── the words of /api/repeat ───────────────────────────────────────────────────────────────────────────── */
const REPEAT_FAILED = { error: 'Server error', message: 'Repeat supply could not answer. Try again.' };
/** the Problem codes of the two level words (lib/rail WHY): the rail's own refusals of a person who may only read or comment */
const LEVEL_CODES = { read_only: 'READ_ONLY', comment_only: 'COMMENT_ONLY' };
/** a person at viewer or commenter level asked to change something: 403 in the rail's own sentence, the word kept as `why` (the screen greys the action from it) */
function levelRefusal(levelWord, sentence) {
  return said(LEVEL_CODES[levelWord] || 'REPEAT_REFUSED', { error: 'Not permitted', message: sentence, why: levelWord });
}
/** the body a library refusal carried, with the sentence as `error` and `message` and its own keys on top (the status writer's answer is relayed whole) */
const relayedBody = (e) => Object.assign({ error: e.message, message: e.message }, e.body || {});
/**
 * repeatFault(e, req) — the spec of whatever a repeat route's catch got. lib/repeat-supply throws its refusals with a code and a status: 503 REPEAT_NOT_MIGRATED, 404, 400 (a question the
 * caller can answer), 422 (`refused`: the agreement's own step table, REPEAT_<WHY>); a status of the one status writer (accept) is relayed with its own words. Anything else is a 500
 * that says nothing of its cause (the real error is logged with the request id).
 */
function repeatFault(e, req) {
  const refusal = repeatRefusalOf(e);
  return refusal || internalSpec(req, e, REPEAT_FAILED);
}
/** ORD-73: the agreement chit the caller named (body chit_id or ?chit=) is not an id — 400 in plain words, before any database call */
const badChit = () => said('REPEAT_BAD_REQUEST', { error: 'Bad request', message: 'That bill or agreement id is not valid. Open the agreement again from the list.' });
/** ORD-73: the agreement id in the address is not an id — it names nothing here, so 404 like an unknown one */
const noSuchAgreement = () => said('NOT_FOUND', { error: 'Not found', message: 'No such agreement.' });
/** the refusals lib/repeat-supply throws by code: 503 not migrated, 404 no such agreement, 400 a question the caller can answer */
const BY_CODE = {
  REPEAT_NOT_MIGRATED: (e) => ({ status: 503, code: e.code, detail: e.message, legacy: { code: e.code, error: e.message, message: e.message } }),
  BOOKS_NOT_FOUND: (e) => ({ status: 404, ...said('NOT_FOUND', { error: 'Not found', message: e.message }) }),
  BOOKS_BAD_REQUEST: (e) => ({ status: 400, ...said('REPEAT_BAD_REQUEST', { error: e.message, message: e.message }) })
};
/** the agreement's own step table said no (422, REPEAT_<WHY>), or the status writer's 4xx is relayed with its own words; null when it is a fault of ours */
function stepRefusalOf(e) {
  if (e && e.refused) return { status: 422, ...said(e.code || 'REPEAT_REFUSED', { code: e.code || 'REPEAT_REFUSED', error: e.message, message: e.message }) };
  if (!(e && e.status >= 400 && e.status < 500)) return null;
  const body = relayedBody(e);
  return { status: e.status, ...said(body.code || 'REPEAT_REFUSED', body) };
}
/** the refusal a thrown error of lib/repeat-supply stands for, or null when it is a fault of ours */
function repeatRefusalOf(e) {
  const byCode = e && Object.hasOwn(BY_CODE, e.code) ? BY_CODE[e.code] : null;
  return byCode ? byCode(e) : stepRefusalOf(e);
}

/* ── the words of /api/work ─────────────────────────────────────────────────────────────────────────────── */
const staffOnly = () => said('WORK_STAFF_ONLY', { error: 'Forbidden', message: 'Sign in as staff to see Tasks and Orders.' });
const chitNotFound = () => said('NOT_FOUND', { error: 'Not found', message: 'Chit not found or you do not have access' });
/** a fault of ours: the screen's old words, nothing of the cause (the real error is logged with the request id) */
const failed = (e, req) => internalSpec(req, e, { error: 'Failed', message: SAFE_SENTENCE });

/* ── the words of /api/counters ─────────────────────────────────────────────────────────────────────────── */
const sessionOnly = () => said('COUNTER_SESSION_ONLY', { error: 'Forbidden', message: 'Counters are managed by a signed-in person, not by a key.' });
/** the counters' own 400: { error: 'validation', message } */
const badRequest = (message) => said('COUNTER_BAD_REQUEST', { error: 'validation', message });
const badPhone = (message) => said('BAD_PHONE', { error: 'validation', code: 'BAD_PHONE', message });
const counterNotFound = (message) => said('NOT_FOUND', message === undefined ? { error: 'Not found' } : { error: 'Not found', message });
/** a body the counters made for a refusal (open: not found, or held by another PC): its own code and words, kept whole */
const relayed = (answer) => ({ status: answer.status, ...said(answer.body.code || 'NOT_FOUND', answer.body) });
/**
 * counterFault(e, req, label) — what a counters write's catch got: a library refusal (400 · 4xx) or an update still to run (503) keeps its status and its own words under `label`
 * ('validation' on create, 'Failed' on open); anything else is a 500 whose message is the safe sentence, never the cause.
 */
function counterFault(e, req, label) {
  const status = e && e.status;
  if (status >= 400 && status < 500) return { status, ...said('COUNTER_BAD_REQUEST', { error: label, message: String(e.message) }) };
  if (status === 503) return { status, ...said('COUNTER_NOT_MIGRATED', { error: label, message: String(e.message) }) };
  return failed(e, req);
}

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
const AGREEMENT = object(['agreement']);
const CHIT_BODY = ['chit_id']; /* the customer names the agreement chit they hold (routes/repeat-supply.js chitOf) */
const REASON = ['reason'];
const GATE_STATUS = { write: 403, customer: 403, session: 403, owner: 403 };
const REPEAT_REFUSALS = [
  { status: 422, code: 'REPEAT_REFUSED', when: "the agreement is not at a step where that can be done, or the request cannot be done as it stands (REPEAT_<WHY>: its own word and sentence)" },
  { status: 404, code: 'NOT_FOUND', when: 'the bill to repeat is not one this shop holds' },
  { status: 503, code: 'REPEAT_NOT_MIGRATED', when: 'a database update (b303) is still to run' },
  { status: 409, code: 'REPEAT_REFUSED', when: "the one status writer refused the customer's move (accept): its own status and words, relayed" }
];
const COUNTER_REFUSALS = [{ status: 503, code: 'COUNTER_NOT_MIGRATED', when: 'a database update (policy flags, b130) is still to run' }];
const WRITER = ['write', 'refuses'];
const CUSTOMER = ['customer', 'refuses'];

const REPEAT_ROUTES = {
  'GET /': { summary: "The seller's agreements, each with its actions (may and why)", out: object(['agreements', 'migrated'], { agreements: array() }) },
  'POST /': { summary: 'Make an agreement from a bill that was sent: the agreement chit is sent to the customer', gates: WRITER, invalid: 400, body: ['chit_id', 'every', 'unit', 'start_on', 'anchor_day', 'until', 'mode'], out: AGREEMENT },
  'POST /sweep': { summary: 'The seller runs everything that is due now, what the nightly would do', gates: WRITER, invalid: 400, out: object(['ran', 'problems'], { ran: array(), problems: array() }) },
  'GET /:id': { summary: 'One agreement; either side (the customer names the chit they hold, ?chit=)', gates: ['refuses'], invalid: 400, query: ['chit'], out: AGREEMENT },
  'POST /:id/accept': { summary: "The customer accepts: their copy of the agreement chit moves to accepted", gates: CUSTOMER, invalid: 400, body: CHIT_BODY, query: ['chit'], out: AGREEMENT },
  'POST /:id/counter': { summary: 'The customer proposes a change (quantities, how often, from when) with a note', gates: CUSTOMER, invalid: 400, body: ['chit_id', 'lines', 'every', 'unit', 'start_on', 'anchor_day', 'note'], query: ['chit'], out: AGREEMENT },
  'POST /:id/decline': { summary: 'The customer declines; the agreement ends', gates: CUSTOMER, invalid: 400, body: ['chit_id', 'reason'], query: ['chit'], out: AGREEMENT },
  'POST /:id/skip': { summary: 'Skip the next run, either side (the customer says why)', gates: WRITER, invalid: 400, body: ['chit_id', 'reason'], query: ['chit'], out: AGREEMENT },
  'POST /:id/agree': { summary: "The seller agrees to the customer's change", gates: WRITER, invalid: 400, out: AGREEMENT },
  'POST /:id/refuse': { summary: "The seller does not agree to the customer's change; the agreement ends", gates: WRITER, invalid: 400, body: REASON, out: AGREEMENT },
  'POST /:id/pause': { summary: 'The seller pauses an agreement', gates: WRITER, invalid: 400, body: REASON, out: AGREEMENT },
  'POST /:id/resume': { summary: 'The seller resumes a paused agreement', gates: WRITER, invalid: 400, out: AGREEMENT },
  'POST /:id/end': { summary: 'The seller ends an agreement', gates: WRITER, invalid: 400, body: REASON, out: AGREEMENT },
  'POST /:id/run': { summary: 'The seller runs what is due on one agreement now, every missed day, oldest first', gates: WRITER, invalid: 400, out: object(['agreement', 'ran', 'problems'], { ran: array(), problems: array() }) }
};
const WORK_ROUTES = {
  'GET /list': { summary: "Tasks and orders as a list, by view, with counts (staff only; a key or a customer is refused)", inline: [403], invalid: 400, query: ['view', 'status', 'assigned', 'q', 'page', 'limit'], out: object(['view', 'page', 'limit', 'truncated', 'rows'], { rows: array() }) },
  'GET /facts': { summary: 'The Home box and the till pill: counts and lines in words (?unbilled=1 adds the open orders no bill names yet)', inline: [403], invalid: 400, query: ['unbilled'], out: object(['truncated', 'lines', 'figures'], { lines: array() }) },
  'GET /:chit_id': { summary: 'One order or task: its row and its lines, each with what this login may do', inline: [403], invalid: 400, out: object(['chit_id', 'lines'], { lines: array() }) }
};
const COUNTER_ROUTES = {
  'GET /': { summary: "The shop's counters, which are free, and whether this login may manage them (a signed-in person, never a key)", gates: ['session'], out: object(['counters', 'free', 'may'], { counters: array() }) },
  'POST /': { summary: 'Make a counter (owner): online, the lowest number nothing was billed under', gates: ['session', 'owner', 'refuses'], invalid: 400, inline: [400], ok: 201, body: ['name'], out: object(['counter']) },
  'PATCH /:id': { summary: 'Rename a counter (owner)', gates: ['session', 'owner'], invalid: 400, inline: [400], body: ['name'], out: object(['ok', 'id', 'name']) },
  'POST /:id/assign': { summary: 'Give a counter label to a phone number, or take it off with an empty number (owner)', gates: ['session', 'owner'], invalid: 400, inline: [400], body: ['phone'], out: object(['ok', 'counter']) },
  'POST /:id/open': { summary: 'Open a counter on this PC and get its key: one PC at a time (owner)', gates: ['session', 'owner', 'refuses'], invalid: 400, inline: [409], out: object(['key', 'counter']) },
  'POST /:id/release': { summary: 'Let a counter go from a PC that cannot close itself (owner)', gates: ['session', 'owner'], invalid: 400, out: object(['ok', 'id', 'released_from']) }
};

/** the three mounts of this area, each a contract of the kit's making */
const repeat = contractOf({ mount: '/api/repeat', routes: REPEAT_ROUTES, gateStatus: GATE_STATUS, refusals: REPEAT_REFUSALS, refusalsWhen: 'refuses', extension: 'x-repeat-refusals' });
const work = contractOf({ mount: '/api/work', routes: WORK_ROUTES, gateStatus: GATE_STATUS });
const counters = contractOf({ mount: '/api/counters', routes: COUNTER_ROUTES, gateStatus: GATE_STATUS, refusals: COUNTER_REFUSALS, refusalsWhen: 'refuses', extension: 'x-counters-refusals' });
const CONTRACTS = [repeat, work, counters];

/** a schema refusal is answered 400 in the shape the route refuses in: repeat's sentence as `error` and `message`, work's and the counters' { error: 'validation', message } */
const schemaOptionsOf = (code, legacy) => ({ status: 400, code, legacy: (failures) => legacy(failures[0].detail) });
const schemaOptions = {
  repeat: schemaOptionsOf('REPEAT_BAD_REQUEST', (sentence) => ({ error: sentence, message: sentence })),
  work: schemaOptionsOf('WORK_BAD_REQUEST', (sentence) => ({ error: 'validation', message: sentence })),
  counters: schemaOptionsOf('COUNTER_BAD_REQUEST', (sentence) => ({ error: 'validation', message: sentence }))
};
const OPERATIONS = Object.assign({}, ...CONTRACTS.map((contract) => contract.OPERATIONS));
/** the refusal statuses a test may see from one route of any of the three mounts */
const allowedStatuses = () => (key) => CONTRACTS.map((contract) => contract.allowedStatuses()(key)).find((found) => found.length) || [];

module.exports = { said, repeatFault, badChit, noSuchAgreement, levelRefusal, staffOnly, chitNotFound, failed, sessionOnly, badRequest, badPhone, counterNotFound, relayed, counterFault, schemaOptions, OPERATIONS, allowedStatuses, repeat, work, counters };
