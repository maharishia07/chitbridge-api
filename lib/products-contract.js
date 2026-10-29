/*
 * OWNS      the contract of routes/products.js: each route's OpenAPI operation (S9), the words its refusals answer in (words), and the one way a fault is worded (faultOf · failed · badStatus).
 * CALLED BY routes/products.js (schemaValidate on each route, router.openapi, problem(req, res, { status, ...words.x() } | faultOf(e, req, label))) → tools/api-register.cjs · tools/api-contract-tests.cjs ·
 *           /api/openapi.json · tests/api-problem-products.test.cjs.
 * FLOW      operation → schemaValidate(operation, schemaOptionsFor(route)) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a refusal → problem(req, res, { status, ...words.x(...) }) → the old { error, message } beside the Problem fields
 *           a thrown error → faultOf(e, req, label): a library refusal keeps its 4xx and its words, anything else is a 500 that says nothing of its cause
 * CARD      storefront-and-catalogue/products-routes
 * This file shapes NO answer and writes no product: the figures and the rows are lib/catalogue-write, lib/mint-product and the rest, as before.
 *
 * ⚠️ The input schemas say what the handlers ALREADY take. Where the route used an express-validator chain (an object that must be an object, a list of at least one) the schema says the same,
 *    answers 400 as the chain did, and words the refusal in the chain's own body ({ error: "Validation failed", details: [{ field, message }] }, lib/storefront-contract refusalFor),
 *    frozen in docs/contracts/api-legacy.json. Every other missing or odd value is answered by the handler in its own sentence, and those sentences are frozen too. A query value the handler
 *    reads leniently is declared as plain text. No key is refused for being unknown: the catalogue keeps taking what it took.
 * ⚠️ A limiter's 429 is express-rate-limit's own answer ({ error, message }) in front of the handler: listed under x-products-refusals, not a Problem.
 */
'use strict';
const { internalSpec } = require('./problem');
const { SAFE_SENTENCE } = require('./respond');
const { contractOf, object, array, any } = require('./contract-kit');
const { refusalFor } = require('./storefront-contract');
const catalogueColumns = require('./catalogue-columns');
const itemstatus = require('./itemstatus');
const rateDoor = require('./rate-door'); // CAT-210: the one rate sentence and code (also POST /till/rate)

/* ── the words ──────────────────────────────────────────────────────────────────────────────────────────── */
/** the old body of a refusal as the parts problem() takes: { code, detail, legacy }. The detail is the sentence the body carried (its message, else its error word). */
const said = (code, legacy) => ({ code, detail: legacy.message || legacy.error, legacy });
const badRequest = (legacy) => said('PRODUCT_BAD_REQUEST', legacy);
const invalidProduct = (message) => said('PRODUCT_INVALID', { error: 'Invalid product', message });
const unreadable = (message) => said('PRODUCT_FILE_UNREADABLE', { error: 'Could not read the file', message });
const NO_DEFINITION = { error: 'No catalogue definition', message: 'Your catalogue has no definition to add columns to.' };
const NOT_FOUND = { error: 'Not found' };
const NO_SUCH_ITEM = { error: 'Not found', message: 'No such item in your catalogue.' };

/** the status a library refusal keeps, and the code it answers under */
const REFUSAL_CODES = { 400: 'PRODUCT_BAD_REQUEST', 404: 'NOT_FOUND', 409: 'PRODUCT_CLASH' };
const refusalCode = (status) => REFUSAL_CODES[status] || 'PRODUCT_REFUSED';

/** a route that always answered 500 when it failed: the screen's label, and nothing of the cause (the real error is logged with the request id) */
const failed = (e, req, label) => internalSpec(req, e, { error: label, message: SAFE_SENTENCE });

/**
 * faultOf(e, req, label) — the spec of whatever a products route's catch got. A deliberate refusal of a library (a price in another currency, an unknown status word) carries a 4xx and its own
 * sentence, and keeps both; anything else — including a 5xx the library raised — is a 500 that says nothing of its cause. The label is the screen's own word for the failure ("Add failed").
 */
function faultOf(e, req, label) {
  const status = e && e.status;
  if (status >= 400 && status < 500) return { status, code: refusalCode(status), detail: e.message, legacy: { error: label, message: e.message } };
  return failed(e, req, label);
}

/** the spec of an error that carries its own status (a lifecycle word that is not allowed): that status, the library's sentence (the generic one for a 5xx), the label "Bad status" */
function badStatus(e, words) {
  return { status: e.status, code: e.status < 500 ? refusalCode(e.status) : 'INTERNAL', detail: words, legacy: { error: 'Bad status', message: words } };
}

/** the parts of the 4xx a refused declaration answers (a server-owned key travels with its code) */
const declined = (label, decl) =>
  said(decl.code || 'PRODUCT_INVALID', Object.assign({ error: label }, decl.code ? { code: decl.code } : {}, { message: decl.error }));

/** the parts of the refusal catalogue-write's writeItems gave (the route answers it at the status it carries) */
const writeRefused = (written) => said(written.code || 'PRODUCT_INVALID', { error: written.error, message: written.message, invalid: written.invalid });

/** every sentence a products route refuses in; each returns { code, detail, legacy }. Frozen: docs/contracts/api-legacy.json. */
const words = {
  notFound: () => said('NOT_FOUND', NOT_FOUND),
  noSuchPicture: () => ({ code: 'NOT_FOUND', detail: 'We could not find that picture.' }),
  noSuchItem: () => said('NOT_FOUND', NO_SUCH_ITEM),
  noDefinition: () => said('PRODUCT_NO_DEFINITION', NO_DEFINITION),
  declined,
  writeRefused,
  costBlind: (refused) => said(refused.code, refused),
  /* CAT-237: a replace without merge:true would erase the stored keys it leaves out — the same code, gate and `blocked` list as a key the body names, with the line that says what to send instead */
  costBlindErase: (refused) =>
    said(refused.code, Object.assign({}, refused, { message: 'Sent as a whole record, this change would also remove: ' + (refused.blocked || []).join(', ') + '. Your access does not include them. Send only the field you changed (merge:true).' })),
  /* CAT-210: a rate is a money promise — the till door's code and sentence, whole request refused, nothing written */
  rateOwnerOnly: rateDoor.refusal,
  tooMany: (max) => badRequest({ error: 'Too many', message: `At most ${max} items in one request.` }),
  notObjects: () => invalidProduct('Every item must be an object.'),
  notStrings: () => badRequest({ error: 'Bad ids', message: 'Every id must be a string.' }),
  bulkStatus: (allowed) =>
    badRequest({ error: 'Bad status', message: 'In bulk, status must be one of: ' + allowed.join(', ') + '. retired and redundant need a per-item reason, so they are set one at a time.' }),
  badShape: () => badRequest({ error: 'Bad shape', message: 'Every item must be { id, item_data }.' }),
  refusedItems: (list) => said('PRODUCT_INVALID', { error: 'Invalid product', message: list.length + ' item(s) were refused and nothing was written.', invalid: list }),
  listStatus: () => badRequest({ error: 'Bad status', message: 'status must be one of: ' + itemstatus.STATUSES.join(', ') + ', not-available' }),
  fileEmpty: () => badRequest({ error: 'Nothing to read', message: 'The file is empty.' }),
  nothingToImport: () => badRequest({ error: 'Nothing to import', message: 'The file is empty.' }),
  unreadable,
  notConfirmed: () => badRequest({ error: 'Not confirmed', message: 'Nothing was imported — this needs an explicit confirmation.' }),
  workbookCut: (sheetCut) => said('WORKBOOK_CUT', Object.assign({ error: 'Workbook too large' }, sheetCut)),
  tooManyRows: (count, max) =>
    said('PRODUCT_TOO_LARGE', { error: 'Too many rows', message: `This file has ${count} rows and one upload can carry ${max}. Nothing was imported — split the file and it will all go in.` }),
  fileProblems: (report, count) =>
    said('PRODUCT_IMPORT_BLOCKED', { error: 'The file has problems', report, message: `${count} row problem(s) must be fixed first. Nothing was imported.` }),
  choicesDoNotHold: (errors) => badRequest({ error: 'Those choices do not hold up', messages: errors, message: errors[0] + ' Nothing was imported.' }),
  noNameAfterChoices: () => badRequest({ error: 'Nothing to import', message: 'No row had a product name once your choices were applied, so there was nothing to create.' }),
  unknownTrade: () => badRequest({ error: 'Unknown trade', message: 'That is not one of the standard sets.' }),
  badQuantity: () =>
    badRequest({ error: 'Bad quantity', message: 'A quantity must be zero or more. A negative figure means the feed is wrong, and storing it would make a full shelf look empty.' }),
  scheduleRefused: (outcome) => said(outcome.error === 'not_enabled' ? 'PRODUCT_CLASH' : 'PRODUCT_BAD_REQUEST', { error: outcome.error, message: outcome.message }),
  storeOff: () => said('PRODUCT_NOT_READY', { error: 'media store not configured' }),
  notAVideoLink: () => badRequest({ error: 'not_a_video_link', message: 'Paste a YouTube or Vimeo link.' }),
  mediaNeedsBytes: () => badRequest({ error: 'validation', message: 'name and data_base64, or a video url' }),
  mediaNotConfigured: () => said('PRODUCT_NOT_READY', { error: 'not_configured', message: 'The media store is not configured (S3 env, or run b204 for the database store).' }),
  mediaEmpty: () => badRequest({ error: 'empty' }),
  mediaTooLarge: (max) => said('PRODUCT_TOO_LARGE', { error: 'too_large', message: `Up to ${max / (1024 * 1024)} MB per file.` }),
  badDate: () => badRequest({ error: 'Bad date', message: '`at` must be a timestamp.' }),
  versionsNotMigrated: () => said('PRODUCT_NOT_READY', { error: 'Not migrated', message: 'Item versions need b146 on this environment.' }),
  unknownList: (message, choices) => badRequest({ error: 'unknown list', message, choices }),
  badListStatus: (message) => badRequest({ error: 'status', message }),
  categoriesFailed: (message) => failedWith('Failed', 'Your categories could not be set up, so nothing was added. ' + message)
};
/** a 500 whose sentence is ours (the real error was logged by safeErr before the sentence was made) */
function failedWith(error, message) {
  return { code: 'INTERNAL', detail: message, legacy: { error, message } };
}

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
const OBJECT = { type: 'object' };
const TEXT = { type: 'string' };
/** a list the old chain insisted had at least one entry (a list of one is the example a generated case sends) */
const nonEmpty = (max) => Object.assign({ type: 'array', minItems: 1, examples: [[{}]] }, max ? { maxItems: max } : {});
/** the old chain's isInt({ min: 1, max: 1000 }): a whole number, or text that reads as one, from 1 to 1000 (leading zeros and a plus sign were fine) */
const HEADER_ROW = { anyOf: [{ type: 'integer', minimum: 1, maximum: 1000 }, { type: 'string', pattern: '^\\+?0*(?:[1-9][0-9]{0,2}|1000)$' }] };
const LIMITED = [{ status: 429, when: 'too many in a quarter of an hour: the limiter answers { error, message } before the handler runs' }];
const REFUSALS = [
  { status: 400, code: 'PRODUCT_BAD_REQUEST', when: 'a library refused on purpose (a lifecycle word, a date), in its own words' },
  { status: 404, code: 'NOT_FOUND', when: 'a key outside the shop, or nothing there' },
  { status: 409, code: 'PRODUCT_CLASH', when: 'a price in another currency than the catalogue is priced in' },
  { status: 422, code: 'PRODUCT_REFUSED', when: 'a price that is not a finite number, a quantity that is not' }
];

/* the old express-validator chains, field by field, in the order they ran: schemaOptionsFor keeps their 400 body */
const CHAINS = {
  'POST /': [['item_data']],
  'POST /bulk': [['items']],
  'POST /status/bulk': [['ids'], ['status']],
  'POST /bulk-update': [['items']],
  'POST /import/preflight': [['csv'], ['xlsx'], ['header_row']],
  'POST /import': [['csv'], ['xlsx'], ['header_row'], ['decisions']],
  'POST /starter-columns': [['vertical']],
  'PATCH /:id': [['item_data']],
  'POST /:id/schedule': [['effective_at'], ['item_data']],
  'POST /availability/bulk': [['items']],
  'PUT /:id/availability': [['qty'], ['source'], ['as_of']],
  'PUT /:id/status': [['status']],
  'POST /lists/adopt': [['list']]
};

const PAGE_LIST = ['q', 'limit', 'offset', 'status'];
const ITEM_PUT = { item_data: OBJECT };
const IMPORT_FILE = { csv: TEXT, xlsx: TEXT, header_row: HEADER_ROW, sheet: any };
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const FAULTS = ['fails'];

const ROUTES = {
  'POST /': { summary: 'Add one product, declared and validated by the catalogue', gates: FAULTS, invalid: 400, inline: [400, 403], body: ITEM_PUT, required: ['item_data'], out: object(['message', 'item']) },
  'POST /bulk': { summary: 'Add up to 200 products in one request, all or none', gates: FAULTS, invalid: 400, inline: [400, 403], refusals: LIMITED, body: { items: nonEmpty() }, required: ['items'], out: object(['message', 'added', 'items']) },
  'POST /status/bulk': { summary: 'Mark many products available or unavailable in one request', gates: FAULTS, invalid: 400, inline: [400], body: { ids: nonEmpty(), status: TEXT }, required: ['ids', 'status'], out: object(['message', 'updated', 'missed', 'status']) },
  'POST /bulk-update': { summary: 'Edit many products in one request, all or none', gates: FAULTS, invalid: 400, inline: [400, 403], body: { items: nonEmpty() }, required: ['items'], out: object(['message', 'updated', 'missed']) },
  'GET /': { summary: "The shop's products, one page: with the status tally and the products in each category", invalid: 400, inline: [400], query: PAGE_LIST, out: object(['items', 'count', 'total', 'offset', 'limit', 'page', 'truncated', 'status_counts', 'category_counts', 'uncategorised']) },
  'GET /workbook.xlsx': { summary: 'The catalogue and its masters as a workbook (Products, Categories, Units)', gates: FAULTS, media: XLSX_TYPE },
  'GET /export.csv': { summary: 'The whole catalogue as a CSV file', gates: FAULTS, media: 'text/csv' },
  'GET /template': { summary: "The blank upload sheet for this catalogue: the columns it accepts, as the file's first row", gates: FAULTS, out: object(['columns', 'optional', 'preset', 'filename']) },
  'POST /import/preflight': { summary: 'Read an uploaded file before any of it becomes data: what maps where, what is blocked, which rows would fail', gates: FAULTS, invalid: 400, inline: [400], refusals: LIMITED, body: IMPORT_FILE, out: object(['report', 'accepted', 'optional', 'dry_run', 'header_row']) },
  'POST /import': { summary: 'Import the file after a decision for every column; nothing is deleted, a row with a problem stops it all', gates: FAULTS, invalid: 400, inline: [400, 403, 409, 413, 500], refusals: LIMITED, body: Object.assign({ decisions: array(), confirm: any }, IMPORT_FILE), required: ['decisions'], out: object(['message', 'created_columns', 'outcome', 'summary']) },
  'GET /starter-columns': { summary: 'The standard column sets by trade, and the set of one trade when asked', gates: FAULTS, invalid: 400, query: ['vertical'], out: object(['verticals']) },
  'POST /starter-columns': { summary: 'Adopt a trade\'s standard columns, and your own: additive, never retypes a column in use', gates: FAULTS, invalid: 400, inline: [400, 500], body: { vertical: TEXT, fields: any, custom: any }, required: ['vertical'], out: object(['message', 'vertical', 'added', 'rejected', 'unchanged']) },
  'PATCH /:id': { summary: 'Edit a product: the whole record, or only the keys sent with merge: true', gates: FAULTS, invalid: 400, inline: [400, 403, 404], body: Object.assign({ merge: any }, ITEM_PUT), required: ['item_data'], out: object(['message', 'item']) },
  'GET /:id/schedule': { summary: 'The changes parked on a product for a later date', gates: FAULTS, invalid: 400, out: object(['enabled', 'pending']) },
  'POST /:id/schedule': { summary: 'Park a change to a product for a later date', gates: FAULTS, invalid: 400, inline: [400, 403, 404, 409], body: { effective_at: TEXT, item_data: OBJECT }, required: ['effective_at', 'item_data'], out: object(['message', 'scheduled']) },
  'DELETE /:id/schedule/:sid': { summary: 'Cancel a parked change', gates: FAULTS, invalid: 400, out: object(['cancelled']) },
  'POST /availability/bulk': { summary: 'Stock with a stamp for up to 2000 products in one transaction (a connector\'s feed)', gates: FAULTS, invalid: 400, body: { items: nonEmpty(2000) }, required: ['items'], out: object(['message', 'written', 'unknown', 'bad']) },
  'PUT /:id/availability': { summary: 'What this shop has of one product, and when that was last true', gates: FAULTS, invalid: 400, inline: [400, 404], body: { qty: any, source: TEXT, as_of: TEXT, location: any }, required: ['qty'], out: object(['message', 'availability']) },
  'PUT /:id/status': { summary: 'Set the lifecycle of a product: available, unavailable, redundant or retired', gates: FAULTS, invalid: 400, inline: [404], body: { status: TEXT, until: any, replaced_by: any, note: any }, required: ['status'], out: object(['message', 'status', 'reads_as', 'matchable', 'offerable', 'item_id', 'schema_org']) },
  'DELETE /:id': { summary: 'Remove a product (it is kept, switched off)', invalid: 400, inline: [404], out: object(['message']) },
  'GET /media/:item_id/:mid': { summary: 'A product picture, streamed from the private store (public: the storefront shows it)', public: true, invalid: 400, inline: [404, 503], media: 'application/octet-stream' },
  'POST /:id/media': { summary: 'Add a picture or file (base64), or link a YouTube or Vimeo video', gates: FAULTS, invalid: 400, inline: [400, 404, 413, 503], body: { name: any, mime: any, data_base64: any, url: any }, out: object(['message', 'id', 'media']) },
  'DELETE /:id/media/:mid': { summary: 'Remove a picture, a file or a video link from a product', gates: FAULTS, invalid: 400, inline: [404], out: object(['message', 'media']) },
  'GET /:id/versions': { summary: 'What a product was, in order; with at= what it was at one moment', gates: FAULTS, invalid: 400, inline: [400, 404, 503], query: ['at'], out: object(['item_id']) },
  'GET /lists': { summary: 'The ready-made product lists, what the shop already sells, and the list its trade opens on', gates: FAULTS, out: object(['have', 'currency', 'vertical', 'pick', 'lists', 'language_names', 'mine']) },
  'POST /lists/adopt': { summary: 'Adopt rows of a ready-made list into the catalogue, off the shelf until switched on', gates: FAULTS, invalid: 400, inline: [400, 500], refusals: LIMITED, body: { list: TEXT, categories: any, languages: any, names: any, skip_existing: any, status: any }, required: ['list'], out: object(['ok', 'added', 'skipped', 'pin', 'message']) }
};

const contract = contractOf({ mount: '/api/products', routes: ROUTES, refusals: REFUSALS, refusalsWhen: 'fails', extension: 'x-products-refusals' });
/** the options schemaValidate takes for a route: the 400 of its old chain (the chain's own fields, in order), else the same body for a body that is not an object */
const schemaOptionsFor = (route) => refusalFor(CHAINS[route] || []);

module.exports = Object.assign({ words, said, refusalCode, faultOf, failed, badStatus, schemaOptionsFor, ROUTES, REFUSALS, CHAINS, SERVER_OWNED_CODE: catalogueColumns.SERVER_OWNED_CODE }, contract);
