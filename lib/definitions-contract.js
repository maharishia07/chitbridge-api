/*
 * OWNS      the contract of routes/definitions.js (6 routes, /api/definitions): each route's OpenAPI operation (S9), the words its refusals answer in (words), the one way a fault is
 *           worded (definitionFault) and the old 400 "Validation failed" body of the two express-validator chains the schemas replaced (schemaOptionsFor).
 * CALLED BY routes/definitions.js (schemaValidate on each route, router.openapi, problem(req, res, { status, ...words.x() } | definitionFault(e, req, options))) → tools/api-register.cjs ·
 *           tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-definitions.test.cjs.
 * FLOW      operation → schemaValidate(operation, schemaOptionsFor(route)) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a refusal → problem(req, res, { status, ...words.x(...) }) → the old { error, message } beside the Problem fields
 *           a thrown error → definitionFault(e, req, options): b160 not run → 503 · a taken name → 409 · anything else a 500 that says nothing of its cause
 * CARD      07-catalogue-and-pricing/definitions
 * This file shapes NO answer and reads no row: the shelf, the versions, the freeze, the governed slabs and the offer clash are routes/definitions.js and its libraries, as before.
 *
 * ⚠️ FROZEN BY VALUE (the route file's header): nothing here touches a version write, the freeze or a success body. The input schemas say what the handlers ALREADY take: the keys they read,
 *    and only what the old express-validator chains required (POST / needs a text kind and name; POST /freeze needs a list of ids). No key is refused for being unknown (the Offer Lab sends what its
 *    form holds) and no row is filtered on the way out (the shelf answers the table's own columns): strict_input and output_allowlist are therefore NOT claimed. A body that is not an object, or a
 *    query value given twice, is a 400 in the chains' own words ({ error: "Validation failed", details }).
 * ⚠️ The refusals the offer clash and the slab guard raise are libraries' ({ status, body } with their own words, lib/offer-clash.js · lib/slab-cites.js); they are worded here by code, their bodies kept whole.
 */
'use strict';
const { contractOf, object, array, any, text } = require('./contract-kit');
const { refusalFor } = require('./storefront-contract');
const { said, failed } = require('./products-contract');

/* ── the words ──────────────────────────────────────────────────────────────────────────────────────────── */
const NOT_FOUND = { error: 'Not found' };
const GOVERNED = { error: 'Governed', message: 'This slab is declared by the jurisdiction and cannot be edited or retired here. To differ from it, declare a slab of your own.' };
const NOT_CONFIRMED = { error: 'Not confirmed', message: 'An offer goes live only after you confirm it. Nothing was changed.' };
const NAME_TAKEN = { error: 'Name taken', message: 'You already have a definition of this kind with that name.' };
const NOT_PROVISIONED = { error: 'Not provisioned', message: 'Definitions need migration b160. Ask the operator to run it.' };
const FAILED_LABEL = 'Failed';
const TAKEOVER_CODES = { same: 'DEFINITION_TAKEOVER_SAME', no_takeover: 'DEFINITION_TAKEOVER_NOT_LIVE' };

/** every sentence a definitions route refuses in; each returns { code, detail, legacy }. Frozen: docs/contracts/api-legacy.json. */
const words = {
  notFound: () => said('NOT_FOUND', NOT_FOUND),
  governed: () => said('DEFINITION_GOVERNED', GOVERNED),
  incomplete: (message) => said('DEFINITION_INCOMPLETE', { error: 'Incomplete rule', message }),
  /** UX-110: an offer made live without the shop's explicit yes (confirmed: true) */
  liveUnconfirmed: () => said('OFFER_LIVE_UNCONFIRMED', NOT_CONFIRMED),
  /** the offer clash of lib/offer-clash.js: its whole body (error, code, message, clashes) is the old body */
  clash: (body) => said('OFFER_CLASH', body),
  /** a slab that products or categories still cite (lib/slab-cites.js): its whole body is the old body */
  cited: (body) => said('DEFINITION_CITED', body),
  /** the takeover slab is the one being retired, or is not a live slab here (lib/slab-cites.js) */
  takeover: (body) => said(TAKEOVER_CODES[body.error] || 'DEFINITION_TAKEOVER_NOT_LIVE', body)
};

/**
 * definitionFault(e, req, options) — the spec of whatever a definitions route's catch got. b160 not run (a missing table) is the short 503; a taken name (options.nameTaken: the unique index on
 * a create or an edit) is the 409 with its sentence; anything else is a 500 that says nothing of its cause (the real error is logged with the request id).
 */
function definitionFault(e, req, options) {
  if (e && e.code === '42P01') return { status: 503, ...said('DEFINITIONS_NOT_MIGRATED', NOT_PROVISIONED) };
  if (e && e.code === '23505' && options && options.nameTaken) return { status: 409, ...said('DEFINITION_NAME_TAKEN', NAME_TAKEN) };
  return failed(e, req, FAILED_LABEL);
}

/* ── the old 400 of the two chains (middleware/validate.js validate()) ──────────────────────────────────── */
const INVALID_VALUE = 'Invalid value';
/** a value that reads as empty once turned to text and trimmed (null and undefined are empty) */
const blank = (value) => String(value == null ? '' : value).trim() === '';
/** how many times the old chain listed a text field: isString failed once, notEmpty once per empty value (each element of a list is its own value) */
const NAME_MAX = 200; // API-18: a kind or a name is a label, not a document
const tooLong = (value) => typeof value === 'string' && Array.from(value).length > NAME_MAX; // API-18: the schema's maxLength, counted the same way
const timesKindOrName = (value) => (Array.isArray(value) ? 1 + value.filter(blank).length : (typeof value === 'string' ? 0 : 1) + (blank(value) ? 1 : 0) + (tooLong(value) ? 1 : 0));
/** how many times the old chain listed a list field: isArray failed once */
const timesList = (value) => (Array.isArray(value) ? 0 : 1);
/** the schemaValidate options that keep a chain's 400: its fields in order, each listed as many times as the chain listed it */
function chainRefusal(fields, timesOf) {
  const legacy = (failures, req) => {
    const given = req && req.body && typeof req.body === 'object' ? req.body : {};
    return { error: 'Validation failed', details: fields.flatMap((field) => Array.from({ length: timesOf[field](given[field]) }, () => ({ field, message: INVALID_VALUE }))) };
  };
  return { status: 400, code: 'INVALID_INPUT', legacy };
}
const CHAIN_OPTIONS = {
  'POST /': chainRefusal(['kind', 'name'], { kind: timesKindOrName, name: timesKindOrName }),
  'POST /freeze': chainRefusal(['definition_ids'], { definition_ids: timesList })
};
/** the schemaValidate options of a route: the chain's 400 where the route had a chain, else the same "Validation failed" body, each field once */
const schemaOptionsFor = (route) => CHAIN_OPTIONS[route] || refusalFor([]);

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
const integer = { type: 'integer' };
const PAGE = { total: integer, page: integer, limit: integer, capped: { type: 'boolean' }, cap_note: text };
/** a text that is not only spaces and not longer than NAME_MAX: the old chain's isString().trim().notEmpty(), API-18's cap */
const FILLED_TEXT = { type: 'string', pattern: '\\S', maxLength: NAME_MAX };
const NOT_PROVISIONED_REFUSAL = { status: 503, code: 'DEFINITIONS_NOT_MIGRATED', when: 'the definitions tables (b160) are not run yet' };
const CLASH_REFUSAL = { status: 409, code: 'OFFER_CLASH', when: 'the offer would be live beside another live discount on the same items' };
const UNCONFIRMED_REFUSAL = { status: 428, code: 'OFFER_LIVE_UNCONFIRMED', when: 'an offer is made live without confirmed: true in the body' };
const NAME_REFUSAL = { status: 409, code: 'DEFINITION_NAME_TAKEN', when: 'the shop already has a definition of this kind with that name' };

const ROUTES = {
  'GET /': {
    summary: 'The shelf: the shop’s definitions with their current rules, the governed tax slabs of its country, and what a brand’s stores have released',
    invalid: 400,
    query: ['kind', 'status', 'all', 'page', 'limit'],
    refusals: [NOT_PROVISIONED_REFUSAL],
    out: object(['count', 'definitions', 'total', 'page', 'limit'], Object.assign({ count: integer, governed_why: text, definitions: array(object()) }, PAGE))
  },
  'GET /:id': {
    summary: 'One definition with its full version history and who changed its status',
    invalid: 400,
    refusals: [NOT_PROVISIONED_REFUSAL],
    out: object(['definition', 'versions', 'status_log'], { definition: object(), versions: array(object()), status_log: array(object()) })
  },
  'POST /': {
    summary: 'Author one definition: the definition and its version 1 in one go',
    invalid: 400,
    inline: [409, 422, 428],
    ok: 201,
    refusals: [NOT_PROVISIONED_REFUSAL, NAME_REFUSAL, UNCONFIRMED_REFUSAL],
    required: ['kind', 'name'],
    body: { kind: FILLED_TEXT, name: FILLED_TEXT, sub_kind: any, note: any, status: any, confirmed: any, rules: any },
    out: object(['message', 'definition', 'version'], { message: text, definition: object(), version: integer })
  },
  'PUT /:id': {
    summary: 'Edit a definition: changed rules are a new version, a rename or a status change is not',
    invalid: 400,
    inline: [403, 409, 422, 428],
    refusals: [NOT_PROVISIONED_REFUSAL, NAME_REFUSAL, UNCONFIRMED_REFUSAL],
    body: { rules: any, name: any, note: any, status: any, confirmed: any },
    out: object(['message', 'definition', 'version', 'new_version'], { message: text, definition: object(), version: integer, new_version: { type: 'boolean' } })
  },
  'DELETE /:id': {
    summary: 'Retire a definition (it is never deleted); a tax slab that is cited needs the slab that takes over',
    invalid: 400,
    inline: [403, 409],
    query: ['takeover'],
    refusals: [NOT_PROVISIONED_REFUSAL],
    out: object(['message', 'retired', 'moved'], { message: text, retired: { type: 'boolean' }, moved: { type: ['object', 'null'] } }, true)
  },
  'POST /freeze': {
    summary: 'The snapshot a chit embeds when it cites these definitions: the copy and the pointer, retired ones too; the ids not found come back as missing',
    invalid: 400,
    refusals: [NOT_PROVISIONED_REFUSAL],
    required: ['definition_ids'],
    body: { definition_ids: { type: 'array' } },
    out: object(['frozen', 'missing', 'frozen_at'], { frozen: array(object()), missing: array(text), frozen_at: { type: ['string', 'null'] } }, true)
  }
};

/** the contract of this area, of the kit's making */
const contract = contractOf({ mount: '/api/definitions', routes: ROUTES, gateStatus: {}, extension: 'x-definitions-refusals' });
const OPERATIONS = contract.OPERATIONS;
/** the refusal statuses a test may see from one route */
const allowedStatuses = () => contract.allowedStatuses();
/** every code this file's words answer under, for the test that each is a register row with its sentence */
const CODES = ['NOT_FOUND', 'DEFINITION_GOVERNED', 'DEFINITION_INCOMPLETE', 'OFFER_LIVE_UNCONFIRMED', 'OFFER_CLASH', 'DEFINITION_CITED', 'DEFINITION_TAKEOVER_SAME', 'DEFINITION_TAKEOVER_NOT_LIVE', 'DEFINITIONS_NOT_MIGRATED', 'DEFINITION_NAME_TAKEN', 'INVALID_INPUT', 'INTERNAL'];

module.exports = { words, definitionFault, schemaOptionsFor, timesKindOrName, timesList, CODES, OPERATIONS, allowedStatuses, contract };
