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
 *    required (the store says what is missing, in its own words, as a 400), a value is anything, and an unknown key IS refused by name on the four writes (batch 1 of the
 *    contract bulk pass, 5 Nov: cap-supplies.js sends only the keys named here), the standard 422. A query value is anything (`?all=1&all=1` is not '1'). A path id is plain text to the schema; routes/supplies.js router.param answers a non-uuid one 404 NOT_FOUND before the database (OPS-74).
 *    So the schema check refuses only an unknown body key; every other input is taken as before.
 * ⚠️ THE RELAY STILL RELAYS. `words.refused(message)` carries a store's sentence into `message` of a 400. Every sentence that can reach it is FIXED words (lib/supply-store.js: 'a supply needs a
 *    name', 'the supply could not be created', 'a purchase needs at least one line', 'a purchase needs its own reference ...', 'no such supply', 'this supply is expensed when it arrives ...'; lib/inventory.js
 *    check()/apply(): 'a movement of nothing records nothing', 'issued takes stock out ...', and so on) EXCEPT ONE: lib/inventory.js:189 'this stock is counted in <unit>, and the movement is in <unit>'
 *    names the unit of the stored balance and the unit the caller sent. That is caller text: a FINDING for cb-security (the same sentence rides in `failed[].why` of the 200 of POST /purchase,
 *    which this file does not touch). Moving the relay into this file stops the raw-error ratchet counting it; the PR says so. A thrown error never reaches an answer: faultOf words it.
 */
'use strict';
const { waiting } = require('./not-migrated');
const { contractOf, object, array, any, text } = require('./contract-kit');
const { said, failed } = require('./products-contract');
const { isNotStorable, NOT_STORABLE_SENTENCE } = require('./input-hygiene'); // text Postgres cannot hold is the caller's, a 400

/* ── the words ──────────────────────────────────────────────────────────────────────────────────────────── */
const NOT_FOUND = { error: 'Not found' };
const NOT_READY = { error: 'Not ready', message: waiting('Supplies', true) };
const REFUSED_ERROR = 'validation';
const MISSING_TABLE = '42P01';

/** every sentence a supplies route refuses in; each returns { code, detail, legacy }. Frozen: docs/contracts/api-legacy.json. */
const words = {
  /** a store's own sentence (see the header for the sources) in the old body { error: 'validation', message } */
  refused: (message) => said('SUPPLY_INVALID', { error: REFUSED_ERROR, message }),
  notFound: () => said('NOT_FOUND', NOT_FOUND),
  /** the supplies table (b217) is not there yet */
  notReady: () => said('SUPPLIES_NOT_MIGRATED', NOT_READY),
  /** OPS-72: the same supplier's bill number again, with other lines — nothing is changed */
  billDiffers: (ref, from) =>
    said('SUPPLY_BILL_DIFFERS', {
      error: 'Bill already recorded',
      message: 'Bill ' + ref + (from ? ' from ' + from : '') + ' is already recorded with different lines; record a correction or use a new bill number.'
    })
};

/** a missing table (b217 not run): the one fault that is told apart from the rest */
const notMigrated = (e) => !!(e && e.code === MISSING_TABLE);
/** whatever a supplies route's catch got, worded by the screen's own label; the real error is logged with the request id. Text the database cannot store (a NUL byte) is the caller's: a 400 in plain words (K-1) */
const faultOf = (e, req, label) => (isNotStorable(e) ? { status: 400, ...words.refused(NOT_STORABLE_SENTENCE) } : failed(e, req, label));

/** every code these routes answer under, for the test that each is a register row with its sentence */
const CODES = ['SUPPLY_INVALID', 'SUPPLY_BILL_DIFFERS', 'NOT_FOUND', 'SUPPLIES_NOT_MIGRATED', 'INTERNAL'];

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
const flag = { type: 'boolean' };
const SUPPLY_KEYS = ['supply_item_id', 'name', 'unit', 'sku', 'keep_stock'];
const anyOf = (keys) => Object.fromEntries(keys.map((key) => [key, any]));

const CLOSED = { additionalProperties: false }; /* S33: any other body key is refused by name */
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
    rules: CLOSED,
    inline: [400, 409, 503],
    out: object(['message', 'supply'], { message: text, supply: object(['supply_item_id', 'name', 'keep_stock', 'created'], Object.assign(anyOf(SUPPLY_KEYS), { created: flag })) })
  },
  'PATCH /:id': {
    summary: 'Rename a supply or change whether it is counted',
    list: true,
    body: ['name', 'unit', 'sku', 'keep_stock', 'note', 'retired'],
    rules: CLOSED,
    inline: [400],
    out: object(['message', 'supply'], { message: text, supply: object() })
  },
  'POST /purchase': {
    summary: 'Record a sundry purchase that came from outside ChitBridge',
    list: true,
    body: ['ref', 'from', 'at', 'lines'],
    rules: CLOSED,
    inline: [400, 409, 503],
    out: object(['message', 'ref', 'recorded', 'stocked', 'already', 'expensed', 'books_posted', 'failed', 'says'], { message: text, ref: text, already: any, from: any, recorded: array(object()), stocked: any, expensed: any, books_posted: flag, failed: array(object()), says: text })
  },
  'POST /:id/issue': {
    summary: 'Record that some of a counted supply was used',
    list: true,
    body: ['qty', 'ref'],
    rules: CLOSED,
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
