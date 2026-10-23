/*
 * OWNS      the contract of routes/forms.js (8 routes, /api/forms — the authority-forms engine): each route's OpenAPI operation (S9) and the one way their faults are worded (faultOf).
 * CALLED BY routes/forms.js (contract.checked on each route, router.openapi, problem(req, res, faultOf(e, req, label)))
 *           → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-forms.test.cjs.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a thrown error → faultOf(e, req, label): the old { error: <the screen's label>, code?, message, unresolved? } at the status the error carried, else 500
 * CARD      21-compliance-attestation-and-trade/functions/authority-forms
 * This file shapes NO answer: the registry of forms, the fill, the freeze, the signature and the filing are lib/forms.js, as before; the success bodies are the library's own and are
 * replayed byte for byte (tests/api-problem-forms.test.cjs --compare).
 *
 * ⚠️ BEHAVIOUR FROZEN (Athi, 23 Oct). The input schemas say what the handlers ALREADY take: a body is an object OR a list (a list read as nothing), nothing is required (a missing chit_id is
 *    the handler's own 400 in its own words), and a query value is declared as anything (a repeated context_ref was read as it came and answered 400). The ONE change is Q18 (the standing
 *    ruling of 23 Oct): each write body is CLOSED, so a key the route never named is refused by name (422) instead of dropped without a word. The web page sends only the named keys.
 * ⚠️ The old fail() relayed the library's own words for any status under 500 and the generic sentence for the rest; both are kept. Every throw that reaches it carries fixed words (lib/forms.js
 *    names the form asked for, or the labels of the missing fields); a database error carries no `.status`, so its text never rides. The old 5xx body also echoed `err.code`: for a database
 *    error that was a SQLSTATE, and `code` is the Problem's own key now (INTERNAL), so that echo ends; the three codes the library sets itself (FORM_NOT_READY, FORMS_BAD_CONTEXT,
 *    FORMS_STORE_MISSING) are the Problem's codes too, so those bodies are byte for byte.
 */
'use strict';
const { contractOf } = require('./contract-kit');
const { internalSpec } = require('./problem');
const { SAFE_SENTENCE, safeErr } = require('./respond');

/* ── the words ──────────────────────────────────────────────────────────────────────────────────────────── */
const NOT_READY = 'FORM_NOT_READY';
const BAD_CONTEXT = 'FORMS_BAD_CONTEXT';
const STORE_MISSING = 'FORMS_STORE_MISSING';
const BAD_REQUEST = 'FORMS_BAD_REQUEST';
const NOT_FOUND = 'FORMS_NOT_FOUND';
const NOT_PARTICIPANT = 'FORMS_NOT_PARTICIPANT';
const ALREADY_SIGNED = 'FORMS_ALREADY_SIGNED';
const REFUSED = 'FORMS_REFUSED';
const FIRST_FAILURE = 400;
const FIRST_FAULT = 500;
const LAST_FAILURE = 599;
const STORE_MISSING_DETAIL = 'Forms are not available here yet: the forms store has not been set up.';
/** the codes the library sets on its own errors: they ARE the Problem's codes, so the old `code` key is byte for byte */
const LIBRARY_CODES = [NOT_READY, BAD_CONTEXT, STORE_MISSING];
/** the code a refusal under 500 answers under when the library gave none: what happened, by the status it carries */
const CODE_BY_STATUS = { 400: BAD_REQUEST, 403: NOT_PARTICIPANT, 404: NOT_FOUND, 409: ALREADY_SIGNED };

/** the status an error carries when it is an HTTP failure (400-599), else 500 */
const statusOf = (e) => (e && Number.isInteger(e.status) && e.status >= FIRST_FAILURE && e.status <= LAST_FAILURE ? e.status : FIRST_FAULT);
/** the code the library set when it is one of its own, else null */
const libraryCode = (e) => (e && LIBRARY_CODES.includes(e.code) ? e.code : null);

/** the old `code` key, present only when the library set one of its own */
const codeKeyOf = (e) => (libraryCode(e) ? { code: e.code } : {});
/** the old `unresolved` key (the fields a form is missing), present only when the library listed them */
const unresolvedKeyOf = (e) => (e && e.unresolved !== undefined ? { unresolved: e.unresolved } : {});
/** the old body of a failure, key by key in the order it was sent: the screen's label, the library's code, the message, the list of missing fields */
const legacyOf = (label, e, message) => Object.assign({ error: label }, codeKeyOf(e), { message }, unresolvedKeyOf(e));
/** the words a refusal under 500 relays: the library's own, else the generic sentence (the real error is logged with the request id) */
const wordsOf = (e, req) => (e && e.message) || safeErr(e, { id: req && req.id, path: req && req.path });
/** the plain sentence of the one 5xx that has its own: the forms store is not set up */
const detailKeyOf = (e) => (e && e.code === STORE_MISSING ? { detail: STORE_MISSING_DETAIL } : {});

/**
 * faultOf(e, req, label) — the spec of whatever a forms route caught. A refusal the library meant (a status under 500) keeps its status and its own words; anything else is the generic
 * sentence at the status the error carried (500 when it carried none), and the real error is logged with the request id (safeErr), its words never leave.
 */
function faultOf(e, req, label) {
  const status = statusOf(e);
  if (status < FIRST_FAULT) {
    const message = wordsOf(e, req);
    return { status, code: libraryCode(e) || CODE_BY_STATUS[status] || REFUSED, detail: message, legacy: legacyOf(label, e, message) };
  }
  const fault = internalSpec(req, e, legacyOf(label, e, SAFE_SENTENCE), libraryCode(e) || undefined);
  return Object.assign({}, fault, { status }, detailKeyOf(e));
}

/** every code this file's faults answer under, for the test that each is a register row with its sentence */
const CODES = [NOT_READY, BAD_CONTEXT, STORE_MISSING, BAD_REQUEST, NOT_FOUND, NOT_PARTICIPANT, ALREADY_SIGNED, REFUSED, 'INTERNAL'];

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
/** the refusals a library raises beyond a row's own statuses: its status and code, the words are the library's (frozen in docs/contracts/api-legacy.json) */
const refusal = (status, code, when) => ({ status, code, when });
const UNKNOWN_FORM = refusal(404, NOT_FOUND, 'the form key is not one of the registry');
const NO_STORE = refusal(503, STORE_MISSING, 'the forms store (b108) is not set up yet');
/** a write body that names the keys its handler reads, requires none and CLOSES the rest (Q18); the handlers read a list as nothing, so a list stays accepted */
const closedBody = (examples) => ({ additionalProperties: false, examples });
/** issue, sign and attach are the owner's or an editor's: access.writeGate answers a viewer or a commenter with a 403 Problem in the rail's own word (read_only, comment_only) */
const WRITE = ['write'];
const GATE_STATUS = { write: 403 };
const FILL_BODY = ['context_ref', 'manual'];

const ROUTES = {
  'GET /': { summary: 'The forms a shop can fill (certificate of origin, commercial invoice, packing list, authority application), and what this login may do with them (may)' },
  'GET /:key': { summary: 'One form: its fields and where each is filled from, in order', refusals: [UNKNOWN_FORM] },
  'POST /:key/resolve': {
    summary: 'Fill a form for preview, free: each field with its source and trust rung (body: context_ref = the deal\'s chit, manual = typed values); nothing is saved',
    list: true,
    body: FILL_BODY,
    rules: closedBody([{ manual: { purpose: 'Trade licence renewal' } }]),
    refusals: [UNKNOWN_FORM]
  },
  'POST /:key/issue': {
    gates: WRITE,
    summary: 'Freeze a filled form by value into an issued form; refused while a required field is empty (the owner or an editor)',
    list: true,
    body: FILL_BODY,
    rules: closedBody([{ manual: { purpose: 'Trade licence renewal' } }]),
    refusals: [UNKNOWN_FORM, refusal(400, NOT_READY, 'a required field is empty; the answer lists which (unresolved)'), NO_STORE]
  },
  'GET /instances/all': {
    summary: 'The issued forms, newest first (?context_ref= the deal\'s chit narrows to the papers of that one deal), and what this login may do (may)',
    query: ['context_ref'],
    lenient: true,
    refusals: [refusal(400, BAD_CONTEXT, 'context_ref is not a chit id')]
  },
  'GET /instances/:id': { summary: 'One issued form: the frozen fields with their provenance', refusals: [refusal(404, NOT_FOUND, 'no issued form of this id belongs to the shop (another shop\'s id answers the same)')] },
  'POST /instances/:id/sign': {
    gates: WRITE,
    summary: 'Stamp who signed and when onto an issued form (body: name, designation; the vault\'s signatory otherwise); an attestation record, not a cryptographic signature (the owner or an editor)',
    list: true,
    body: ['name', 'designation'],
    rules: closedBody([{ name: 'R Kumar' }]),
    refusals: [
      refusal(400, BAD_REQUEST, 'the form is not ready, or there is no signatory to stamp'),
      refusal(404, NOT_FOUND, 'no issued form of this id belongs to the shop'),
      refusal(409, ALREADY_SIGNED, 'the form is already signed')
    ]
  },
  'POST /instances/:id/attach': {
    gates: WRITE,
    summary: 'File an issued form onto a chit as a copy for every participant, so it rides the rail (body: chit_id; the owner or an editor)',
    list: true,
    body: ['chit_id'],
    rules: closedBody([{ chit_id: '33333333-3333-4333-8333-333333333333' }]),
    refusals: [
      refusal(400, BAD_REQUEST, 'chit_id is missing'),
      refusal(403, NOT_PARTICIPANT, 'the chit is not one the shop is on (another shop\'s chit answers the same)'),
      refusal(404, NOT_FOUND, 'no issued form of this id belongs to the shop'),
      NO_STORE
    ]
  }
};

/** the contract of this area, of the kit's making */
const contract = contractOf({ mount: '/api/forms', routes: ROUTES, gateStatus: GATE_STATUS, extension: 'x-forms-refusals' });
const OPERATIONS = contract.OPERATIONS;
/** the refusal statuses a test may see from one route */
const allowedStatuses = () => contract.allowedStatuses();

module.exports = { faultOf, CODES, OPERATIONS, ROUTES, allowedStatuses, contract };
