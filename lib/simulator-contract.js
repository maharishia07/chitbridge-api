/*
 * OWNS      the contract of routes/simulator.js (3 PUBLIC routes, /api/simulator — the content the /tour page renders, the lead gate, the page feedback): each route's OpenAPI operation (S9), the words
 *           its refusals answer in (words), and the two ways a fault is worded (faultOf for the content read, writeFaultOf for the two writes, both over lib/problem.js internalSpec).
 * CALLED BY routes/simulator.js (contract.checked on each route, router.openapi, problem(req, res, { status, ...words.x() } | faultOf(e, req, label) | writeFaultOf(e, req))) → tools/api-register.cjs ·
 *           tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-simulator.test.cjs.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a refusal → problem(req, res, { status, ...words.x() }) → the old { error } beside the Problem fields
 *           a thrown error → faultOf / writeFaultOf: a 500 with the screen's own words and nothing of the cause
 * CARD      qa/offline-guards
 * This file shapes NO success answer and reads no row: the six lists, the lead (and the token's secret, claims and life) and the e-mail to the leads inbox are routes/simulator.js and the database, as before.
 *
 * ⚠️ NO BEHAVIOUR CHANGE. The input schemas say what the handlers ALREADY take: a body is an object OR a list (a list reads as no fields and answers the route's own 400), nothing is required (the handler's
 *    own 400 names the fields it needs), and every value is anything (the handler makes text of whatever came: a number, a list and `[5]` as a rating all pass today). An unknown key is NOT refused (the
 *    handler drops it), so strict_input stays open on both writes. The schema check in front of each route can therefore refuse nothing; the refusal the kit declares for it is declared at 400, the status
 *    the routes answer themselves. GET /content takes no input at all.
 * ⚠️ ALL THREE ARE PUBLIC: no sign-in, so no 401, and no "another shop" for a foreign-id world to ask. The limiter in front (server.js publicLimiter: 240 a minute, per address) answers a 429 Problem RATE_LIMITED (lib/rate-limit.js, API-16)
 *    with Retry-After: listed under x-simulator-refusals.
 * ⚠️ THE RELAY STILL RELAYS, AND ONLY FIXED WORDS. faultOf carries the constant sentence of lib/respond.js safeErr ('Something went wrong — please try again.') in `message` of the content read's 500: it can pass
 *    NOTHING of the error. The two writes never relayed anything: their 500 is the one literal below. Moving the relay into this file stops the raw-error ratchet counting it; the PR says so.
 */
'use strict';
const { contractOf, object, array, text } = require('./contract-kit');
const { internalSpec } = require('./problem');
const { said, failed } = require('./products-contract');

/** what the visitor reads when the lead or the feedback could not be recorded: the old literal, one key */
const COULD_NOT_RECORD = 'Could not record that — please try again.';
/** the label the content read has always answered a fault under */
const CONTENT_LABEL = 'Failed to load content';

/* ── the words ──────────────────────────────────────────────────────────────────────────────────────────── */
/** every sentence a tour route refuses in; each returns { code, detail, legacy }. Frozen: docs/contracts/api-legacy.json. */
const words = {
  /** the lead gate got a name under two letters or an e-mail without an @ (400): the old body, one key */
  leadFieldsMissing: () => said('SIM_LEAD_FIELDS_MISSING', { error: 'A name and a valid email are required.' }),
  /** the feedback has no message once the spaces are cut (400): the old body, one key */
  messageMissing: () => said('SIM_FEEDBACK_MESSAGE_MISSING', { error: 'A message is required.' })
};

/** whatever the content read's catch got, worded by the page's own label and the one safe sentence; the real error is logged with the request id */
const faultOf = (e, req, label) => failed(e, req, label || CONTENT_LABEL);

/** whatever a write's catch got: the old one-key body, nothing of the cause; the real error is logged with the request id */
const writeFaultOf = (e, req) => internalSpec(req, e, { error: COULD_NOT_RECORD });

/** every code these routes answer under, for the test that each is a register row with its sentence */
const CODES = ['SIM_LEAD_FIELDS_MISSING', 'SIM_FEEDBACK_MESSAGE_MISSING', 'INTERNAL'];

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
const LIMITED = [{ status: 429, when: 'more than 240 requests a minute from one address: the limiter answers { error, message } before the handler runs' }];
const flag = { type: 'boolean' };
const LISTS = ['layers', 'items', 'shapes', 'rules', 'compare', 'usps'];

const ROUTES = {
  'GET /content': {
    summary: 'Everything the /tour page renders from: its layers, items, shapes, rules, comparisons and what is distinctive, each in its own order (public, no sign-in)',
    public: true,
    refusals: LIMITED,
    out: object(LISTS, Object.fromEntries(LISTS.map((name) => [name, array(object())])))
  },
  'POST /lead': {
    summary: 'The tour gate: a name and an e-mail become a lead, and a token to carry through the tour (signed with a separate secret: it is no platform credential). The leads inbox is told, best effort',
    public: true,
    list: true,
    body: ['name', 'email', 'org'],
    invalid: 400,
    refusals: LIMITED,
    out: object(['token', 'leadId'], { token: text, leadId: text })
  },
  'POST /feedback': {
    summary: 'What a visitor thought of a part of the tour: a message, optionally a section, a rating and the lead id the gate gave. The leads inbox is told, best effort',
    public: true,
    list: true,
    body: ['section', 'rating', 'message', 'leadId'],
    invalid: 400,
    refusals: LIMITED,
    out: object(['ok'], { ok: flag })
  }
};

/** the contract of the router, of the kit's making */
const contract = contractOf({ mount: '/api/simulator', routes: ROUTES, gateStatus: {}, extension: 'x-simulator-refusals' });

module.exports = Object.assign({}, contract, { contract, words, faultOf, writeFaultOf, CODES, ROUTES, COULD_NOT_RECORD });
