/*
 * OWNS      the contract of routes/identity-docs.js (4 routes, /api/identity — a person's own phone, e-mail and government IDs): each route's OpenAPI operation (S9) and the one way
 *           their faults and the library's refusals are worded (faultOf, libraryRefusal).
 * CALLED BY routes/identity-docs.js (contract.checked on each route, router.openapi, problem(req, res, faultOf(e, req) | libraryRefusal(out)))
 *           → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-identity-docs.test.cjs.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a thrown error → faultOf(e, req): the old { error: <the error's code, else 'Server error'>, message } at the status the error carried, else 500
 *           a refusal lib/iddoc-verify.js built ({ status, body }) → libraryRefusal(out): its body kept as it was, now beside the Problem fields
 * CARD      18-identity-sign-in-and-access/README
 * This file shapes NO success answer: the list, the mask, the verification stamp and the code flow are routes/identity-docs.js and lib/iddoc-verify.js, as before.
 *
 * ⚠️ PERSONAL DATA, FROZEN BYTE FOR BYTE (Athi, 23 Oct): the masking of a document value, the code flow (issue, attempts, expiry), the stamp and every SQL statement are not touched. The input
 *    schemas say what the handlers ALREADY take: a body is an object OR a list (a list was read as an empty body), nothing is required, a value is anything (a number was taken as a phone),
 *    an unknown key is NOT refused (the handler drops it without a word; refusing it is an owner's decision, so strict_input stays open on the three writes), and a query value is declared
 *    as anything. So the schema check in front of each route can refuse nothing; the 422 the kit declares for a route that takes input is never answered.
 * ⚠️ THE RELAY STILL RELAYS. The four handlers answered `message: e.status ? e.message : safeErr(e)` under `e.status || 500`, ANY status: a thrown error that carries a status relays its own
 *    words, a 5xx included. Every throw that can reach it carries FIXED words: routes/identity-docs.js resolveSubject (403, two sentences) and lib/vaultcrypto.js:41-45 (503, one sentence,
 *    unreachable because the PUT checks isConfigured() first). The sender (lib/notify.js) is caught inside lib/iddoc-verify.js, and a database error carries no `.status`. Moving the relay
 *    into this file stops the raw-error ratchet counting it; it still relays, and the PR says so. A thrown 5xx keeps the old `message` (its words) beside a generic Problem `detail`.
 * ⚠️ FINDING for cb-security, frozen: the old `error` key is the error's own `code` (`e.code || 'Server error'`). A database or network error carries a code of its own (a SQLSTATE such as
 *    42501, or ECONNRESET), so a plain 500 answers `error: <that code>` with the generic sentence. It is kept as it was, and the route is never 13 of 13 while it does.
 */
'use strict';
const { contractOf, object, array, any, text } = require('./contract-kit');
const { internalSpec } = require('./problem');
const { SAFE_SENTENCE } = require('./respond');

/* ── the words ──────────────────────────────────────────────────────────────────────────────────────────── */
const REFUSED = 'IDOC_REFUSED';
const FIRST_FAILURE = 400;
const FIRST_FAULT = 500;
const LAST_FAILURE = 599;
const OLD_ERROR_WORD = 'Server error';

/** every code these four routes answer under (the route's own, resolveSubject's, vaultcrypto's and lib/iddoc-verify.js's), for the test that each is a register row with its sentence */
const CODES = [
  'IDOC_NOT_MIGRATED',
  'IDOC_NOT_FOUND',
  'IDOC_SUBJECT_FORBIDDEN',
  'IDOC_EMPLOYER_ONLY',
  'IDOC_CONSENT_REQUIRED',
  'IDOC_UNKNOWN_DOCUMENT',
  'IDOC_INVALID_VALUE',
  'VAULT_ENC_UNCONFIGURED',
  'IDOC_NOT_CODE_VERIFIED',
  'IDOC_VALUE_UNAVAILABLE',
  'PHONE_DELIVERY_NOT_CONFIGURED',
  'EMAIL_DELIVERY_NOT_CONFIGURED',
  'IDOC_NO_CODE',
  'OTP_LOCKED',
  'OTP_EXPIRED',
  'OTP_WRONG',
  REFUSED,
  'INTERNAL'
];

/** the status an error carries when it is an HTTP failure (400-599), else 500 */
const statusOf = (e) => (e && Number.isInteger(e.status) && e.status >= FIRST_FAILURE && e.status <= LAST_FAILURE ? e.status : FIRST_FAULT);

/**
 * faultOf(e, req) — the spec of whatever one of the four handlers caught, as the old catch worded it: `error` is the error's own code (else 'Server error'); an error that carries a status
 * keeps it and relays its own words in `message`; any other error answers 500 and the generic sentence (its real words go to the log with the request id).
 */
function faultOf(e, req) {
  const legacy = { error: (e && e.code) || OLD_ERROR_WORD, message: SAFE_SENTENCE };
  if (!(e && e.status)) return internalSpec(req, e, legacy);
  legacy.message = e.message;
  const status = statusOf(e);
  if (status >= FIRST_FAULT) return Object.assign(internalSpec(req, e, legacy), { status });
  return { status, code: CODES.includes(e.code) ? e.code : REFUSED, detail: e.message, legacy };
}

/**
 * libraryRefusal(out) — the spec of a refusal lib/iddoc-verify.js built ({ status, body } with body = { error, code, message }): its body is the frozen legacy, its code and its
 * sentence the Problem's. A 200 from the library is never passed here.
 */
const libraryRefusal = (out) => ({ status: out.status, code: out.body.code, detail: out.body.message, legacy: out.body });

/**
 * declaresStatuses(statuses) — a middleware that REFUSES NOTHING: it names, for the register (R2-3 d: a refusal a helper writes is a gate), the statuses a library call under
 * the handler can refuse with (lib/iddoc-verify.js start() and confirm()), so the handler does not need to spell a computed status.
 */
const declaresStatuses = (statuses) => Object.assign((req, res, next) => next(), { addsStatuses: statuses });

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
const flag = { type: 'boolean' };
/** a person's own record as the list answers it: the mask and the verdict, never the number (the statement selects no value column) */
const DOCUMENT_KEYS = ['scheme', 'country', 'value_masked', 'status', 'verified_at', 'verified_by', 'submitted_by', 'consent_at', 'verified'];
const documentRow = object(['scheme', 'value_masked', 'status', 'verified'], Object.fromEntries(DOCUMENT_KEYS.map((key) => [key, key === 'verified' ? flag : any])));
const catalogueRow = object(['scheme', 'label', 'verify', 'stored', 'selfServe'], { scheme: text, label: text, verify: text, stored: flag, selfServe: flag });

const ROUTES = {
  'GET /documents': {
    summary: 'A person\'s own record: each document\'s mask and verdict (verified, when, by whom), never the number; the owner may read a co-assist\'s (?identity_id=); and the documents this shop\'s country offers',
    query: ['identity_id', 'page', 'limit'],
    lenient: true,
    inline: [403, 503],
    out: object(['documents', 'total', 'page', 'limit', 'catalogue'], { documents: array(documentRow), total: any, page: any, limit: any, capped: flag, cap_note: text, catalogue: array(catalogueRow) })
  },
  'PUT /documents/:scheme': {
    summary: 'File one document for yourself, or (as the owner) for a co-assist: the number is sealed, only its mask comes back, and it waits for verification; Aadhaar is never stored, only its last four digits',
    list: true,
    body: ['value', 'identity_id', 'consent'],
    inline: [400, 403, 503],
    out: object(['message', 'document', 'verified_by'], { message: text, document: object(['scheme', 'value_masked', 'status', 'submitted_by'], { scheme: text, value_masked: text, status: text, submitted_by: text }), verified_by: text })
  },
  'POST /documents/:scheme/code': {
    summary: 'Send a code to the phone or e-mail on file (masked in the answer); a code is valid ten minutes and a new one starts the count of wrong tries again',
    list: true,
    body: ['identity_id'],
    query: ['identity_id'],
    lenient: true,
    inline: [400, 403, 409, 503],
    out: object(['scheme', 'delivery', 'sent_to', 'expires_in'], { scheme: text, delivery: { type: 'string', enum: ['sent', 'not_sent'] }, sent_to: text, expires_in: text, dev_otp: text })
  },
  'POST /documents/:scheme/verify': {
    summary: 'Confirm a phone or e-mail with the code that was sent: the document becomes verified with a stamp; wrong tries are counted and the code locks',
    list: true,
    body: ['code', 'identity_id'],
    query: ['identity_id'],
    lenient: true,
    inline: [400, 403, 429, 503],
    out: object(['scheme', 'verified', 'verified_at'], { scheme: text, verified: flag, verified_at: any })
  }
};

/** the contract of this area, of the kit's making */
const contract = contractOf({ mount: '/api/identity', routes: ROUTES, gateStatus: {}, extension: 'x-identity-docs-refusals' });
const OPERATIONS = contract.OPERATIONS;
/** the refusal statuses a test may see from one route */
const allowedStatuses = () => contract.allowedStatuses();

module.exports = { faultOf, libraryRefusal, declaresStatuses, CODES, OPERATIONS, ROUTES, allowedStatuses, contract };
