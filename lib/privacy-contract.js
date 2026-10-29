/*
 * OWNS      the contract of routes/privacy.js (4 routes, /api/privacy — the public privacy facts and a storefront shopper's own privacy answer): each route's OpenAPI operation (S9)
 *           and the one way their faults are worded (faultOf).
 * CALLED BY routes/privacy.js (contract.checked on each route, router.openapi, problem(req, res, faultOf(e, req)))
 *           → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-privacy.test.cjs.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a thrown error → faultOf(e, req): migrations not run → 503 PRIVACY_NOT_MIGRATED · a refusal the code meant (a status under 500) → that status and its own fixed words ·
 *                          anything else → 500 and the generic sentence, whatever status or text it carried
 * CARD      11-crm-and-marketing/privacy-consent
 * This file shapes NO success answer: the facts, what the shop holds, the consent state and the request record are lib/privacy.js and routes/privacy.js, as before.
 *
 * ⚠️ PERSONAL DATA, FROZEN BYTE FOR BYTE (Athi, 23 Oct): the notice text and version, the sub-processors and regions, the shopper's lines, the consent history, the request record and every
 *    SQL statement are not touched. The input schemas say what the handlers ALREADY take: a body is an object OR a list (a list was read as an empty body and answered the library's own 400),
 *    nothing is required, a value is anything (a number for `kind` was refused by the library in its own words), and an unknown key is NOT refused (the handler never reads it; refusing it
 *    is an owner's decision, so strict_input stays open on both POST routes). So the schema check in front of each route can refuse nothing; the 422 the kit declares for a route that
 *    takes input is never answered.
 * ⚠️ THE RELAY STILL RELAYS. The one catch answered the words of any error that carried a status under 500 (`error` and `message` both), and `why` when it carried one. Every throw that can
 *    reach it carries FIXED words: routes/privacy.js whoOf (403 NO_SHOP), lib/privacy.js need() (503 PRIVACY_NOT_MIGRATED), checkedPref (400, three sentences) and logRequest (400, two
 *    sentences). `why` is set only by privacy.refusal(), which none of these routes calls. A database error carries a SQLSTATE `code` and no `.status`, so it can never take that branch.
 *    A carried 5xx was never relayed: it answered the generic 500. Moving the relay into this file stops the raw-error ratchet counting it; it still relays fixed words, and the PR says so.
 * ⚠️ A status below 400 (or one that is not a whole number) is not an HTTP failure: no code under these routes raises one, and it answers the generic 500 here. The old catch would have
 *    written it as the status of an error body.
 */
'use strict';
const { contractOf, object, array, any, text } = require('./contract-kit');
const { internalSpec } = require('./problem');
const { SAFE_SENTENCE } = require('./respond');
const log = require('./logger');

/* ── the words ──────────────────────────────────────────────────────────────────────────────────────────── */
const NOT_MIGRATED = 'PRIVACY_NOT_MIGRATED';
const NOT_MIGRATED_ERROR = 'Not migrated yet';
const NOT_MIGRATED_STATUS = 503;
const REFUSED = 'REFUSED';
const FAILED = 'Failed';
const FIRST_FAILURE = 400;
const FIRST_FAULT = 500;
const NOT_TIED_TO_A_SHOP = 'NO_SHOP';

/** every code these four routes answer under (the route's own, the library's, the default of a refusal that has none), for the test that each is a register row with its sentence */
const CODES = [NOT_MIGRATED, NOT_TIED_TO_A_SHOP, REFUSED, 'INTERNAL'];

/** the status of a refusal the code meant: a whole number from 400 to 499; null for anything else (that answers the generic 500) */
const refusalStatus = (e) => (e && Number.isInteger(e.status) && e.status >= FIRST_FAILURE && e.status < FIRST_FAULT ? e.status : null);

/**
 * faultOf(e, req) — the spec of whatever one of the three shopper routes caught, as the old catch worded it:
 *   PRIVACY_NOT_MIGRATED       → 503 { code, error: 'Not migrated yet', message: <its fixed words> }
 *   a status under 500         → that status { code: <its code, else REFUSED>, error, message (both its fixed words), [why] }
 *   anything else              → 500 { error: 'Failed', message: <the generic sentence> }; the real error goes to the log with the request id
 */
function faultOf(e, req) {
  if (e && e.code === NOT_MIGRATED) return { status: NOT_MIGRATED_STATUS, code: e.code, detail: e.message, legacy: { code: e.code, error: NOT_MIGRATED_ERROR, message: e.message } };
  const status = refusalStatus(e);
  if (status) {
    const code = e.code || REFUSED;
    return { status, code, detail: e.message, legacy: Object.assign({ code, error: e.message, message: e.message }, e.why ? { why: e.why } : {}) };
  }
  log.error('privacy/me failed', { err: e && e.message });
  return internalSpec(req, e, { error: FAILED, message: SAFE_SENTENCE });
}

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
const flag = { type: 'boolean' };
/** "may I, and why / why not": the verdict a screen greys on */
const mayShape = object(['may', 'code', 'why'], { may: flag, code: text, why: any });
const PROCESSOR_KEYS = ['name', 'role', 'region', 'source', 'on'];
const processor = object(PROCESSOR_KEYS, { name: text, role: text, region: any, source: text, on: flag });
const HELD_KEYS = ['key', 'label', 'value'];
const PREF_KEYS = ['pref_id', 'channel', 'purpose', 'allowed', 'basis', 'notice_version', 'noted_at', 'noted_by', 'withdrawn_at', 'source', 'source_ref'];
const REQUEST_KEYS = ['request_id', 'party_id', 'who', 'kind', 'country', 'received_at', 'due_at', 'answered_at', 'outcome', 'answer', 'late', 'answered_late'];
const anyOf = (keys) => Object.fromEntries(keys.map((key) => [key, any]));

const ROUTES = {
  'GET /facts': {
    summary: 'Who processes the data and where, the privacy notice in force and the privacy contact (each said in words as not yet published until the owner publishes it), and the legal clocks; anyone, no sign-in',
    public: true,
    out: object(['notice_version', 'notice', 'contact', 'contact_line', 'processors', 'due_days'], { notice_version: any, notice: text, contact: any, contact_line: text, processors: array(processor), due_days: object() })
  },
  'GET /me': {
    summary: 'The shopper\'s own privacy answer: what the shop holds about them, the law that applies, the consent they have given and the requests they have made (the shopper and the shop come from the token)',
    inline: [403],
    out: object(['shop', 'law', 'held', 'consent', 'requests', 'may_consent', 'may_request'], {
      shop: object(['name', 'country'], { name: any, country: any }),
      law: object(),
      held: array(object(HELD_KEYS, anyOf(HELD_KEYS))),
      consent: object(['migrated', 'history', 'may'], { migrated: flag, history: array(object(PREF_KEYS, anyOf(PREF_KEYS))), may: object() }),
      requests: object(['migrated', 'requests', 'total'], { migrated: flag, requests: array(object(REQUEST_KEYS, anyOf(REQUEST_KEYS))), total: any }),
      may_consent: mayShape,
      may_request: mayShape
    })
  },
  'POST /me/consent': {
    summary: 'The shopper says yes or no to a channel for a purpose: one new consent row, written as them ("by them, online"); the earlier rows stay',
    list: true,
    body: ['channel', 'purpose', 'allowed'],
    ok: 201,
    inline: [400, 403, 503],
    out: object(['pref', 'may'], { pref: object(PREF_KEYS, anyOf(PREF_KEYS)), may: object() })
  },
  'POST /me/requests': {
    summary: 'The shopper asks the shop for a copy, a correction, an erasure, to withdraw, to nominate someone, or makes a grievance: recorded in the shop\'s register with the date the law sets, answered by the owner',
    list: true,
    body: ['kind'],
    ok: 201,
    inline: [400, 403, 503],
    out: object(['request'], { request: object(REQUEST_KEYS, anyOf(REQUEST_KEYS)) })
  }
};

/** the contract of this area, of the kit's making */
const contract = contractOf({ mount: '/api/privacy', routes: ROUTES, gateStatus: {}, extension: 'x-privacy-refusals' });
const OPERATIONS = contract.OPERATIONS;
/** the refusal statuses a test may see from one route */
const allowedStatuses = () => contract.allowedStatuses();

module.exports = { faultOf, CODES, OPERATIONS, ROUTES, allowedStatuses, contract };
