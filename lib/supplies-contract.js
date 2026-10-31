/*
 * OWNS      the contract of routes/supplies.js (5 routes, /api/supplies — what a shop buys to USE): each route's OpenAPI operation (S9), the words its refusals answer in (words),
 *           and the one way a fault is worded (faultOf, over lib/products-contract.js `failed`).
 * CALLED BY routes/supplies.js (contract.checked on each route, router.openapi, problem(req, res, { status, ...words.x() } | faultOf(e, req, label))) → tools/api-register.cjs ·
 *           tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-supplies.test.cjs.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a refusal → problem(req, res, { status, ...words.x(...) }) → the old { error, message } beside the Problem fields
 *           a thrown error → faultOf(e, req, label): a 500 with the screen's own label and the generic sentence, whatever the error said
 * CARD      16-finance/supplies-routes
 * This file shapes NO success answer and reads no row: the list, the supply, the purchase record and the issue are routes/supplies.js, lib/supply-store.js and lib/stock-store.js, as before.
 *
 * ⚠️ NO BEHAVIOUR CHANGE. The input schemas say what the handlers ALREADY take: a body is an object OR a list (a list was read as an empty body and answered the store's own 400), nothing is
 *    required (the store says what is missing, in its own words, as a 400), a value is anything, and an unknown key is NOT refused (the handler drops it; refusing it is an owner's decision, so
 *    strict_input stays open on the three writes). A query value is anything (`?all=1&all=1` is not '1'). A path id is plain text to the schema; routes/supplies.js router.param answers a non-uuid one 404 NOT_FOUND before the database (OPS-74).
 *    So the schema check in front of each route can refuse nothing; the 422 the kit declares for a route that takes input is never answered.
 * ⚠️ THE RELAY STILL RELAYS. `words.refused(message)` carries a store's sentence into `message` of a 400. Every sentence that can reach it is FIXED words (lib/supply-store.js: 'a supply needs a
 *    name', 'the supply could not be created', 'a purchase needs at least one line', 'a purchase needs its own reference ...', 'no such supply', 'this supply is expensed when it arrives ...'; lib/inventory.js
 *    check()/apply(): 'a movement of nothing records nothing', 'issued takes stock out ...', and so on) EXCEPT ONE: lib/inventory.js:189 'this stock is counted in <unit>, and the movement is in <unit>'
 *    names the unit of the stored balance and the unit the caller sent. That is caller text: a FINDING for cb-security (the same sentence rides in `failed[].why` of the 200 of POST /purchase,
 *    which this file does not touch). Moving the relay into this file stops the raw-error ratchet counting it; the PR says so. A thrown error never reaches an answer: faultOf words it.
 */
'use strict';
const { contractOf, object, array, any, text } = require('./contract-kit');
const { said, failed } = require('./products-contract');

/* ── the words ──────────────────────────────────────────────────────────────────────────────────────────── */
const NOT_FOUND = { error: 'Not found' };
const NOT_READY = { error: 'Not ready', message: 'run b217 first' };
const REFUSED_ERROR = 'validation';
const MISSING_TABLE = '42P01';

/** every sentence a supplies route refuses in; each returns { code, detail, legacy }. Frozen: docs/contracts/api-legacy.json. */
const words = {
  /** a store's own sentence (see the header for the sources) in the old body { error: 'validation', message } */
  refused: (message) => said('SUPPLY_INVALID', { error: REFUSED_ERROR, message }),
  notFound: () => said('NOT_FOUND', NOT_FOUND),
  /** the supplies table (b217) is not there yet */
  notReady: () => said('SUPPLIES_NOT_MIGRATED', NOT_READY)
};

/** a missing table (b217 not run): the one fault that is told apart from the rest */
const notMigrated = (e) => !!(e && e.code === MISSING_TABLE);
/** whatever a supplies route's catch got, worded by the screen's own label; the real error is logged with the request id */
const faultOf = (e, req, label) => failed(e, req, label);

/** every code these routes answer under, for the test that each is a register row with its sentence */
const CODES = ['SUPPLY_INVALID', 'NOT_FOUND', 'SUPPLIES_NOT_MIGRATED', 'INTERNAL'];

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
const flag = { type: 'boolean' };
const SUPPLY_KEYS = ['supply_item_id', 'name', 'unit', 'sku', 'keep_stock'];
const anyOf = (keys) => Object.fromEntries(keys.map((key) => [key, any]));

const ROUTES = {
  'GET /': {
    summary: 'What this shop buys to use — never products, never priced',
    lenient: true,
    query: ['all'],
    out: object(['supplies'], { supplies: array(object()), not_ready: text })
  },
  'POST /': {
    summary: 'Add one supply by hand: a name, a unit, and whether the shop keeps a count of it',
    list: true,
    body: ['name', 'unit', 'sku', 'note', 'keep_stock'],
    inline: [400, 503],
    out: object(['message', 'supply'], { message: text, supply: object(['supply_item_id', 'name', 'keep_stock', 'created'], Object.assign(anyOf(SUPPLY_KEYS), { created: flag })) })
  },
  'PATCH /:id': {
    summary: 'Rename a supply or change whether it is counted',
    list: true,
    body: ['name', 'unit', 'sku', 'keep_stock', 'note', 'retired'],
    out: object(['message', 'supply'], { message: text, supply: object() })
  },
  'POST /purchase': {
    summary: 'Record a sundry purchase that came from outside ChitBridge',
    list: true,
    body: ['ref', 'from', 'at', 'lines'],
    inline: [400, 503],
    out: object(['message', 'ref', 'recorded', 'stocked', 'expensed', 'books_posted', 'failed', 'says'], { message: text, ref: text, from: any, recorded: array(object()), stocked: any, expensed: any, books_posted: flag, failed: array(object()), says: text })
  },
  'POST /:id/issue': {
    summary: 'Record that some of a counted supply was used',
    list: true,
    body: ['qty', 'ref'],
    inline: [400],
    out: object(['message', 'balance'], { message: text, balance: any })
  }
};

/** the contract of this area, of the kit's making */
const contract = contractOf({ mount: '/api/supplies', routes: ROUTES, gateStatus: {} });
const OPERATIONS = contract.OPERATIONS;
/** the refusal statuses a test may see from one route */
const allowedStatuses = () => contract.allowedStatuses();

module.exports = { words, notMigrated, faultOf, CODES, OPERATIONS, ROUTES, allowedStatuses, contract };
