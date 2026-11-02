/*
 * OWNS      the contract of routes/kyb.js (5 routes, /api/kyb — the "Know your business" panel): each route's OpenAPI operation (S9) and the one way their faults are worded
 *           (faultOf, credentialFault).
 * CALLED BY routes/kyb.js (contract.checked on each route, router.openapi, problem(req, res, faultOf(e, req, label) | credentialFault(e, req)))
 *           → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-kyb.test.cjs.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a thrown error → faultOf(e, req, label): the old { error: <the screen's label>, message: <the generic sentence> } at the status the error carried, else 500
 *                          → credentialFault(e, req): POST /credential alone relays the words of a refusal under 500
 * CARD      21-compliance-attestation-and-trade/know-your-business
 * This file shapes NO answer: the credentials, the position, the risk and the field search are lib/kyb.js (computed from the shop's own rows), as before. It NEVER makes a governance
 * claim, and neither do the routes: the sections' own notes ("declared / documented", "not advice", "verify at the source") are lib/kyb.js's words and are replayed byte for byte.
 *
 * ⚠️ FROZEN BY VALUE (Athi, 23 Oct): no success body, no computed section, no metering or 24h cache of POST /field and no credential state changes. The input schemas say what the
 *    handlers ALREADY take: a body is an object OR a list (a list was an empty body, answered 400 "a title or standard_key is required"), nothing is required, and an unknown key is NOT
 *    refused (the handler drops it without a word; refusing it is an owner's decision, so strict_input stays open on both POST routes). A query value is declared as anything: a repeated
 *    one was read as it came. So the schema check in front of each route can refuse nothing; the 422 the kit declares for a route that takes input is never answered.
 * CMP-23 (BH-14): credentialInputFault refuses, before the database, a title / standard_key / doc_key / evidence_ref that is not text and a valid_until that is not a real calendar day (400 VALIDATION_FAILED,
 *    the old { error, message } kept beside it); a body that held these was a 500 (22007) or stored a stringified array.
 * ⚠️ POST /credential RELAYS the words of a refusal under 500 (the old line 26). Every throw that can reach it carries fixed words: lib/kyb.js:113 "a title or standard_key is required" (400)
 *    and lib/readiness.js:407 "standard_key and doc_key required" (400, unreachable from here). A database error carries no `.status`. Moving the relay into this file stops the raw-error
 *    ratchet counting it; it still relays, and the PR says so.
 * ⚠️ The four other routes passed any status an error carried and ALWAYS the generic sentence. No library throw under them carries a status today; the pass-through is kept as it was
 *    (only 400-599 are statuses: anything else is a 500), declared as 500 alone.
 */
'use strict';
const { contractOf, object, array, any, text } = require('./contract-kit');
const { internalSpec } = require('./problem');
const { SAFE_SENTENCE, safeErr } = require('./respond');
const { isCalendarDay } = require('../middleware/validate'); // CMP-23: the one calendar-day test

/* ── the words ──────────────────────────────────────────────────────────────────────────────────────────── */
const BAD_REQUEST = 'KYB_BAD_REQUEST';
const REFUSED = 'KYB_REFUSED';
const CREDENTIAL_LABEL = 'Add credential failed';
const FIRST_FAILURE = 400;
const FIRST_FAULT = 500;
const LAST_FAILURE = 599;

/** the status an error carries when it is an HTTP failure (400-599), else 500 */
const statusOf = (e) => (e && Number.isInteger(e.status) && e.status >= FIRST_FAILURE && e.status <= LAST_FAILURE ? e.status : FIRST_FAULT);
/** the code a refusal under 500 answers under: a 400 is a bad request, any other is a refusal the library meant */
const refusalCode = (status) => (status === FIRST_FAILURE ? BAD_REQUEST : REFUSED);

/**
 * faultOf(e, req, label) — the spec of whatever one of the four reads or the field search caught: the screen's label and the generic sentence, at the status the error carried (500 when it
 * carried none). The real error is logged with the request id (safeErr); its words never leave.
 */
function faultOf(e, req, label) {
  const status = statusOf(e);
  const fault = internalSpec(req, e, { error: label, message: SAFE_SENTENCE });
  return status < FIRST_FAULT ? { ...fault, status, code: refusalCode(status), detail: SAFE_SENTENCE } : { ...fault, status };
}

/**
 * credentialFault(e, req) — the spec of whatever POST /credential caught. A refusal the library meant (a status under 500) keeps its status and its own words, as the route always
 * relayed them; anything else is the generic fault.
 */
function credentialFault(e, req) {
  const status = statusOf(e);
  if (status >= FIRST_FAULT) return faultOf(e, req, CREDENTIAL_LABEL);
  const message = e.message || safeErr(e, { id: req && req.id, path: req && req.path });
  return { status, code: refusalCode(status), detail: message, legacy: { error: CREDENTIAL_LABEL, message } };
}

/** the fields of POST /credential that are read as text */
const CREDENTIAL_TEXTS = ['title', 'standard_key', 'doc_key', 'evidence_ref'];
/** the 400 spec of one field at fault, the old { error, message } kept beside it */
const refusedField = (field, detail) => ({ status: FIRST_FAILURE, code: 'VALIDATION_FAILED', detail, field, legacy: { error: CREDENTIAL_LABEL, message: detail } });

/**
 * credentialInputFault(body) — CMP-23 (BH-14): the spec of a refusal when a field of POST /credential is not what the handler can store, else null. The four texts must be text
 * (an array or object was stringified into a key, an evidence ref of [] went to the database) and valid_until, when given, a REAL calendar day (2026-02-30 is not one): Postgres would
 * answer 22007 / 22008 under a 500. Said before the database is asked. null, undefined and '' mean "not given", as the handler already read them.
 */
function credentialInputFault(body) {
  const given = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const notText = CREDENTIAL_TEXTS.find((field) => given[field] != null && typeof given[field] !== 'string');
  if (notText) return refusedField(notText, notText + ' must be text.');
  const until = given.valid_until;
  const notGiven = until == null || until === '';
  return notGiven || isCalendarDay(until) ? null : refusedField('valid_until', 'valid_until must be a real day written YYYY-MM-DD.');
}

/** every code this file's faults answer under, for the test that each is a register row with its sentence */
const CODES = [BAD_REQUEST, REFUSED, 'VALIDATION_FAILED', 'INTERNAL'];

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
/** an answer that lists every key it can hold and no other (the allow-list): the panel's bodies are built key by key, never spread from a row */
const section = (name) => ({ type: 'string', enum: [name] });
const SECTION_KEYS = ['section', 'facts', 'note'];
const sectionBody = (name) => object(SECTION_KEYS, { section: section(name), facts: object(), note: text });
const FIELD_KEYS = ['section', 'cached', 'charged', 'configured', 'results', 'reach', 'note', 'wall'];
const flag = { type: 'boolean' };
/** a body or list that names the keys the handler reads and requires none */
const ASKED_CREDENTIAL = ['title', 'standard_key', 'doc_key', 'evidence_ref', 'valid_until'];

const ROUTES = {
  'GET /yourself': { summary: 'What the shop holds, and how far each paper can be trusted: declared (typed), documented (an owned evidence chit) or verified (confirmed at the source)', out: sectionBody('yourself') },
  'POST /credential': {
    summary: 'Add a paper CB does not know (a village NOC, a municipal licence): it lands declared and rises to documented with an owned evidence chit; the trust rung is written by the platform',
    list: true,
    inline: [400],
    body: ASKED_CREDENTIAL,
    rules: { examples: [{ title: 'Village NOC' }] } /* a body the handler takes: the generated cases send it (without it they send {} and meet the 400) */,
    out: object(['added'], { added: object(['standard', 'doc', 'title'], { standard: text, doc: text, title: any }) })
  },
  'GET /position': {
    summary: 'Where the shop can sell, directionally: reachable now, one step away, structural (?vertical= and ?origin= to ask for another sector or country; the shop\'s own are used otherwise)',
    query: ['vertical', 'origin'],
    lenient: true,
    out: sectionBody('position')
  },
  'GET /risk': { summary: 'Where the shop\'s exposure sits: buyer concentration split by currency, and papers about to expire; facts, never advice', out: sectionBody('risk') },
  'POST /field': {
    summary: 'Where the demand is (metered per search, cached 24 hours, declared only, a source and a date on every line): answers "not connected" until a trade-data source is plugged in',
    list: true,
    body: [],
    out: object(['section', 'cached', 'charged'], Object.fromEntries(FIELD_KEYS.map((key) => [key, key === 'results' ? array() : key === 'section' || key === 'note' ? text : key === 'reach' ? any : flag])))
  }
};

/** the contract of this area, of the kit's making */
const contract = contractOf({ mount: '/api/kyb', routes: ROUTES, gateStatus: {}, extension: 'x-kyb-refusals' });
const OPERATIONS = contract.OPERATIONS;
/** the refusal statuses a test may see from one route */
const allowedStatuses = () => contract.allowedStatuses();

module.exports = { faultOf, credentialFault, credentialInputFault, CODES, OPERATIONS, ROUTES, allowedStatuses, contract };
