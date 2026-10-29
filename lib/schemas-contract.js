/*
 * OWNS      the contract of routes/schemas.js (7 routes, /api/schemas — the catalogue's schema engine: the shop's definition and its columns): each route's OpenAPI operation (S9), the words
 *           its refusals answer in (words), the one way a fault is worded (fault, createRefused) and the old 400 "Validation failed" body of the three express-validator chains the schemas
 *           replaced (schemaOptionsFor).
 * CALLED BY routes/schemas.js (checked on each route, router.openapi, problem(req, res, { status, ...words.x() } | fault(e, req, label))) → tools/api-register.cjs · tools/api-contract-tests.cjs ·
 *           /api/openapi.json · tests/api-problem-schemas.test.cjs.
 * FLOW      operation → schemaValidate(operation, schemaOptionsFor(route)) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a refusal → problem(req, res, { status, ...words.x(...) }) → the old { error, message } (and `code`, `used_by`) beside the Problem fields
 *           a thrown error → fault(e, req, label): the screen's label and the generic sentence, a 500 that says nothing of its cause
 * CARD      07-catalogue-and-pricing/catalogue-setup
 * This file shapes NO answer and reads no row: which columns a shop has, how many products use each and whether one may go are lib/catalogue-columns.js and lib/column-rules.js, as before.
 *
 * ⚠️ FROZEN BY VALUE: no success body, no SQL and no rule of lib/column-rules.js moved. Each refusal keeps its old keys in their old order (docs/contracts/api-legacy.json, recorded from the code
 *    before the sweep); the Problem fields ride beside them. A 409 that already carried a `code` (LOCKED · REQUIRED · IN_USE · MIGRATION) keeps that exact value as the Problem's code.
 * ⚠️ THE INPUT SCHEMAS SAY WHAT THE HANDLERS ALREADY TAKE, and since the Q18 ruling (laptop1, 23 Oct) every body is CLOSED: a key the handler never read is refused by name. The three chains of
 *    express-validator (order · visibility · the column patch) are replaced by schemas that give the same verdict on every value they were tried with (tests/lib/schemas-chains.cjs) and word the
 *    same 400 (status 400, { error: "Validation failed", details }, a field listed as many times as the chain listed it). The refusals the sweep ADDS are new answers, listed in the PR for cb-catalogue:
 *    an unknown key in a body (400 on the three chain routes, 422 on POST /create-default), and a list sent as a body. The web and the demo scripts send none.
 * ⚠️ POST /create-default RELAYS the error text of lib/schema-bootstrap.js (`message: r.error`, a database sentence) in its 500. That is a leak (S8) the sweep did not cause and may not fix: it is kept as it
 *    answered, worded here (createRefused) so the register can see the route, and filed as a finding for cb-catalogue and cb-security. The route stays unsigned until it is closed.
 */
'use strict';
const { internalSpec } = require('./problem');
const { contractOf, text } = require('./contract-kit');
const { said, failed } = require('./products-contract');

/* ── the words ──────────────────────────────────────────────────────────────────────────────────────────── */
const NOT_FOUND = 'NOT_FOUND';
const CREATE_LABEL = 'Failed to create schema';
const CHAIN_MESSAGE = 'Invalid value';
const UNKNOWN_KEY_MESSAGE = 'Not accepted here';

/** every sentence a schema route refuses in; each returns { code, detail, legacy }. Frozen: docs/contracts/api-legacy.json. */
const words = {
  noColumn: () => said('SCHEMA_COLUMN_NOT_NAMED', { error: 'No column', message: 'Name the column to remove.' }),
  locked: (key) => said('LOCKED', { error: 'Cannot remove', code: 'LOCKED', message: `"${key}" is one of the three columns every catalogue keeps — the cart, the storefront and the export all read it.` }),
  required: (name) => said('REQUIRED', { error: 'Cannot remove', code: 'REQUIRED', message: `"${name}" is required by your catalogue definition. Make it optional first.` }),
  inUse: (count, name) => said('IN_USE', { error: 'Cannot remove', code: 'IN_USE', used_by: count, message: `${count} product${count === 1 ? '' : 's'} record a value in "${name}". Clear it on those first, or keep the column.` }),
  noSuchColumn: () => said(NOT_FOUND, { error: 'Not found', message: 'Your catalogue has no such column.' }),
  noDefinition: () => said(NOT_FOUND, { error: 'Not found', message: 'Your catalogue has no definition.' }),
  noActiveCatalogue: () => said(NOT_FOUND, { error: 'Not found', message: 'No active catalogue to update' }),
  nothingToOrder: () => said('SCHEMA_NOTHING_TO_ORDER', { error: 'Nothing to order', message: 'None of those columns are in your catalogue.' }),
  unknownType: (type) => said('SCHEMA_UNKNOWN_TYPE', { error: 'Unknown type', message: `A column is text, number, choice or date — not "${type}".` }),
  /** a type change the rules refuse: IN_USE while products record a value, else LOCKED; `reason` is lib/column-rules.js retypeWhy */
  retypeRefused: (count, reason) => said(count > 0 ? 'IN_USE' : 'LOCKED', { error: 'Cannot change the type', code: count > 0 ? 'IN_USE' : 'LOCKED', used_by: count, message: reason }),
  cannotBeOptional: (key) => said('LOCKED', { error: 'Cannot make optional', code: 'LOCKED', message: `"${key}" is required by every catalogue.` }),
  notYet: () => said('MIGRATION', { error: 'Not yet available', code: 'MIGRATION', message: 'Unit and source need migration b200 on the database. Type, label and required still work.' }),
  unknownSource: () => said('SCHEMA_UNKNOWN_SOURCE', { error: 'Unknown source', message: 'A value comes from the system, the customer, a computation or ChitBridge.' }),
  unknownChannel: () => said('SCHEMA_UNKNOWN_CHANNEL', { error: 'Unknown channel', message: 'ERP, IoT or AI.' })
};

/** the spec of whatever a schema route's catch got: the screen's label and the generic sentence at 500; the real error is logged with the request id */
const fault = failed;

/**
 * createRefused(req, found) — POST /create-default when lib/schema-bootstrap.js said it could not (found.error, a database sentence) or gave no schema (found.error absent).
 * ⚠️ THE FINDING: the bootstrap's own text is the old `message`, kept byte for byte (the Problem's detail says nothing of the cause). Nothing is logged: the bootstrap logged it.
 */
const createRefused = (req, found) => internalSpec(req, null, { error: CREATE_LABEL, message: found.error || 'no schema' });

/** every code this file's words answer under, for the test that each is a register row with its sentence */
const CODES = ['LOCKED', 'REQUIRED', 'IN_USE', 'MIGRATION', NOT_FOUND, 'SCHEMA_COLUMN_NOT_NAMED', 'SCHEMA_NOTHING_TO_ORDER', 'SCHEMA_UNKNOWN_TYPE', 'SCHEMA_UNKNOWN_SOURCE', 'SCHEMA_UNKNOWN_CHANNEL', 'INVALID_INPUT', 'INTERNAL'];

/* ── the old 400 of the three chains (middleware/validate.js validate()) ────────────────────────────────── */
const NAME_MAX = 80;
const UNIT_MAX = 16;
/** the spellings express-validator's isBoolean() let through: the words and the digits, as text or as the JSON value */
const BOOLEAN_SPELLINGS = [true, false, 'true', 'false', 1, 0, '1', '0'];
const VISIBILITIES = ['private', 'restricted', 'public'];
const lengthOf = (value) => Array.from(String(value)).length;
/** the chains' first test of a text field: "is it text" fails once for anything else, a list included */
const notText = (value) => (typeof value === 'string' ? 0 : 1);
/** how many times the old chain listed each field of a body: a value that fitted was never listed */
const timesOf = {
  order: (value) => (Array.isArray(value) && value.length > 0 ? 0 : 1),
  visibility: (value) => (VISIBILITIES.includes(value) ? 0 : 1),
  /* isString then isLength(1..80), each on the value as text: a null is listed twice (not text, and empty as text) */
  field_name: (value) => (value === undefined ? 0 : typeof value === 'string' ? (lengthOf(value) >= 1 && lengthOf(value) <= NAME_MAX ? 0 : 1) : value === null ? 2 : 1 + (lengthOf(value) >= 1 && lengthOf(value) <= NAME_MAX ? 0 : 1)),
  field_type: (value) => (value === undefined ? 0 : notText(value)),
  required: (value) => (value === undefined || BOOLEAN_SPELLINGS.includes(value) ? 0 : 1),
  /* a null is a value the chain skipped; isString then isLength(max 16) */
  unit: (value) => (value === undefined || value === null ? 0 : typeof value === 'string' ? (lengthOf(value) <= UNIT_MAX ? 0 : 1) : 1 + (lengthOf(value) <= UNIT_MAX ? 0 : 1)),
  leg: (value) => (value === undefined || value === null ? 0 : notText(value)),
  via: (value) => (value === undefined || value === null ? 0 : notText(value))
};
/** the body as the chains read it: an object, else nothing (a list or a text has no field of its own) */
const objectBody = (req) => (req && req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
/**
 * the schemaValidate options that keep a chain's 400: its fields in order, each listed as many times as the chain listed it. A body the chain would have let through (an unknown key, a
 * list, a text) is refused by the schema alone, and its details name the fields the schema refused ("Not accepted here" for an unknown key).
 */
function chainRefusal(fields) {
  const legacy = (failures, req) => {
    const given = objectBody(req);
    const old = fields.flatMap((field) => Array.from({ length: timesOf[field](given[field]) }, () => ({ field, message: CHAIN_MESSAGE })));
    const added = failures.map((failure) => ({ field: failure.field, message: failure.code === 'UNKNOWN_FIELD' ? UNKNOWN_KEY_MESSAGE : CHAIN_MESSAGE }));
    return { error: 'Validation failed', details: old.length ? old : added };
  };
  return { status: 400, code: 'INVALID_INPUT', legacy };
}
const CHAIN_OPTIONS = {
  'PATCH /fields/order': chainRefusal(['order']),
  'PATCH /fields/:field_key': chainRefusal(['field_name', 'field_type', 'required', 'unit', 'leg', 'via']),
  'PATCH /visibility': chainRefusal(['visibility'])
};
/** the schemaValidate options of a route: the chain's 400 where the route had a chain, else the default 422 */
const schemaOptionsFor = (route) => CHAIN_OPTIONS[route];

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
/** an object body that names its keys and refuses every other one (Q18) */
const CLOSED = { additionalProperties: false };
const oneOf = (value) => ({ enum: value });
const BODY_COLUMN = {
  field_name: { type: 'string', minLength: 1, maxLength: NAME_MAX },
  field_type: text,
  required: Object.assign(oneOf(BOOLEAN_SPELLINGS), { description: 'true or false (the words "true" and "false" and the digits 1 and 0 are read the same way)' }),
  unit: { type: ['string', 'null'], maxLength: UNIT_MAX },
  leg: { type: ['string', 'null'] },
  via: { type: ['string', 'null'] }
};

const ROUTES = {
  'GET /my': { summary: 'The shop’s default catalogue definition with its columns, or null when it has none' },
  'POST /create-default': { summary: 'Make the shop’s default catalogue definition (name, unit, price), or answer the one it has; takes no body', body: [], rules: CLOSED },
  'GET /fields': { summary: 'The catalogue’s columns, how many products use each, whether each may go or change type, and the system columns beside them' },
  'DELETE /fields/:field_key': { summary: 'Remove a column, but only while no product records a value in it and it is not one of the three every catalogue keeps', inline: [400, 409] },
  'PATCH /fields/order': {
    summary: 'Move columns: the order sent first, the rest after in their old order',
    invalid: 400,
    inline: [404, 400],
    required: ['order'],
    body: { order: { type: 'array', minItems: 1, examples: [['grade']] } },
    rules: CLOSED
  },
  'PATCH /fields/:field_key': {
    summary: 'Change what a column is: its label, type (while unused), unit, required flag and where its value comes from',
    invalid: 400,
    inline: [400, 409],
    body: BODY_COLUMN,
    rules: CLOSED
  },
  'PATCH /visibility': {
    summary: 'Set the catalogue’s visibility: private, restricted or public',
    invalid: 400,
    inline: [404],
    required: ['visibility'],
    body: { visibility: oneOf(VISIBILITIES) },
    rules: CLOSED
  }
};

/** the contract of this area, of the kit's making */
const contract = contractOf({ mount: '/api/schemas', routes: ROUTES, gateStatus: {}, extension: 'x-schemas-refusals' });
const OPERATIONS = contract.OPERATIONS;
/** the schema check of one route as a list to spread after the sign-in: the old chain's 400 words are kept (schemaOptionsFor); a route that takes no input has none */
const checked = (route) => contract.checked(route, schemaOptionsFor(route));
/** the refusal statuses a test may see from one route */
const allowedStatuses = () => contract.allowedStatuses();

module.exports = { words, fault, createRefused, schemaOptionsFor, timesOf, checked, CODES, OPERATIONS, allowedStatuses, contract };
