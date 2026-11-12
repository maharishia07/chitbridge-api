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
 * ⚠️ C11 10a (12 Nov 2026) bounded the FIELDS (a figure below its column, a day, a text without control characters, a flag that is a flag, a blank name refused): a value past a bound is the standard 422, field named,
 *    where a control character was a 400 (K-1) and a bad issue quantity a 400, and 1e308 / 'garbage' / a blank name were a 500 or a silent write. The rest below still holds. The input schemas say what the handlers ALREADY take: a body is an object OR a list (a list was read as an empty body and answered the store's own 400), nothing is
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
const bounds = require('./bounds');
const shopClock = require('./shop-clock'); // C11 10a: the shop's day, for atTooLate // C11 10a: the one set of bounds a field of a body carries
const { isNotStorable, NOT_STORABLE_SENTENCE } = require('./input-hygiene'); // text Postgres cannot hold is the caller's, a 400

/* ── the words ──────────────────────────────────────────────────────────────────────────────────────────── */
const NOT_FOUND = { error: 'Not found' };
const NOT_READY = { error: 'Not ready', message: waiting('Supplies', true, 'Supplies cannot be recorded or listed yet.') };
const REFUSED_ERROR = 'validation';
const MISSING_TABLE = '42P01';

/** every sentence a supplies route refuses in; each returns { code, detail, legacy }. Frozen: docs/contracts/api-legacy.json. */
const words = {
  /** a store's own sentence (see the header for the sources) in the old body { error: 'validation', message } */
  refused: (message) => said('SUPPLY_INVALID', { error: REFUSED_ERROR, message }),
  notFound: () => said('NOT_FOUND', NOT_FOUND),
  /** C11 10a: a day past tomorrow on the shop's clock — a 422 naming the field, the standard's own invalid-input code */
  dayTooLate: (field) => {
    const detail = field + ' is later than tomorrow. Give the day the goods came in.';
    return { code: 'INVALID_INPUT', detail, field, errors: [{ field, code: 'WRONG_VALUE', detail }] };
  },
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

/** C11 10a: a day typed for a purchase may be the shop's today or tomorrow (a bill dated ahead by a night, a clock a day out), no later: true when it is later. The shop's day, not the ledger's (supplies post no books); a zone out by hours is inside the day of slack */
function atTooLate(at) {
  if (typeof at !== 'string' || at === '') return false; /* a body that is a list has no day: [].at is a function */
  const tomorrow = new Date(Date.parse(shopClock.today() + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  return String(at).slice(0, 10) > tomorrow;
}

/** OPS-10: the ref of an issue — the caller's own, else 'use-' + the Idempotency-Key of the attempt (a resend of one attempt is one movement, the stock ledger keys a movement on its ref), else undefined and the store makes its own */
const issueRefOf = (given, key) => given || (key ? 'use-' + String(key).slice(0, 59) : undefined);

/** every code these routes answer under, for the test that each is a register row with its sentence */
const CODES = ['INVALID_INPUT', 'SUPPLY_INVALID', 'SUPPLY_BILL_DIFFERS', 'NOT_FOUND', 'SUPPLIES_NOT_MIGRATED', 'INTERNAL'];

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
const flag = { type: 'boolean' };
const SUPPLY_KEYS = ['supply_item_id', 'name', 'unit', 'sku', 'keep_stock'];
const anyOf = (keys) => Object.fromEntries(keys.map((key) => [key, any]));

const CLOSED = { additionalProperties: false }; /* S33: any other body key is refused by name */

/* C11 10a (12 Nov 2026): what a supplies body says in bounded figures. A quantity is borrowed from the chit_line.quantity row (numeric(18,3)) because stock_movement.qty is numeric(18,3) too, a cost from the chit
   total's row (money); no new chit-ceiling row. Numeric TEXT stays taken (supply-store readAmount always read "2" as 2): the schema bounds a figure, the store asks the same bound of a text. A null is "not said",
   as the web's purchase sends for a cost and a unit. `unit` is a free word (a shop types "tray"), so a text and never a word list; `at` also may not run past tomorrow (routes/supplies.js, the shop's day). */
const orNull = bounds.orNull;
const FIGURE = (column) => Object.assign(orNull(bounds.amount({ column })), { type: ['number', 'string', 'null'] });
const NAME = Object.assign({}, bounds.text(), { minLength: 1 }); /* PATCH "" was a 500 (supply_item_name_chk) */
const PURCHASE_LINE = {
  type: 'object',
  properties: { name: orNull(bounds.text()), supply_item_id: orNull(bounds.text()), qty: FIGURE('quantity'), unit: orNull(bounds.text()), cost: FIGURE('total'), keep_stock: orNull(bounds.flag()) }
};
const PURCHASE_LINES_MAX = 500; /* a typed policy number: a sundry bill of more than 500 lines is a typing error, refused whole */
const BODIES = {
  add: { name: bounds.text(), unit: orNull(bounds.text()), sku: orNull(bounds.text()), note: orNull(bounds.text({ lines: true })), keep_stock: orNull(bounds.flag()) },
  edit: { name: orNull(NAME), unit: orNull(bounds.text()), sku: orNull(bounds.text()), note: orNull(bounds.text({ lines: true })), keep_stock: orNull(bounds.flag()), retired: orNull(bounds.flag()) },
  purchase: { ref: bounds.text({ max: 64 }), from: orNull(bounds.text()), at: orNull(bounds.day({ dateTime: true })), lines: bounds.list({ of: PURCHASE_LINE, max: PURCHASE_LINES_MAX }) },
  issue: { qty: bounds.qty({ column: 'quantity' }), ref: orNull(bounds.text({ max: 64 })) }
};
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
    body: BODIES.add,
    rules: CLOSED,
    inline: [400, 503] /* the handler never answered 409 here (a repeated name returns the supply it has): the status was over-declared */,
    out: object(['message', 'supply'], { message: text, supply: object(['supply_item_id', 'name', 'keep_stock', 'created'], Object.assign(anyOf(SUPPLY_KEYS), { created: flag })) })
  },
  'PATCH /:id': {
    summary: 'Rename a supply or change whether it is counted',
    list: true,
    body: BODIES.edit,
    rules: CLOSED,
    inline: [400],
    out: object(['message', 'supply'], { message: text, supply: object() })
  },
  'POST /purchase': {
    summary: 'Record a sundry purchase that came from outside ChitBridge',
    list: true,
    body: BODIES.purchase,
    rules: CLOSED,
    inline: [400, 409, 503],
    out: object(['message', 'ref', 'recorded', 'stocked', 'already', 'expensed', 'books_posted', 'failed', 'says'], { message: text, ref: text, already: any, from: any, recorded: array(object()), stocked: any, expensed: any, books_posted: flag, failed: array(object()), says: text })
  },
  'POST /:id/issue': {
    summary: 'Record that some of a counted supply was used',
    list: true,
    body: BODIES.issue,
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

module.exports = { atTooLate, issueRefOf, words, notMigrated, faultOf, CODES, OPERATIONS, ROUTES, allowedStatuses, contract };
