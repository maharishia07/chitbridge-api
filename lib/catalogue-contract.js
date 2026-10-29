/*
 * OWNS      the contract of the signed-in routes of routes/catalogue.js (the shopper's own orders and documents, the product enquiries, the photo read) and of routes/catalogue-face.js:
 *           each route's OpenAPI operation (S9) and the words their refusals answer in. The 11 public storefront doors are lib/storefront-contract.js's.
 * CALLED BY routes/catalogue.js · routes/catalogue-face.js (schemaValidate on each route, router.openapi, problem(req, res, { status, ...words.x() })) → tools/api-register.cjs ·
 *           tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-catalogue.test.cjs.
 * FLOW      operation → schemaValidate(operation, schemaOptionsFor(route)) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a refusal → problem(req, res, { status, ...words.x(...) }) → the old { error, message } beside the Problem fields; a fault → failed(e, req, label) | aiFault(e, req)
 * CARD      storefront-and-catalogue/products-routes
 * Reuses lib/products-contract.js (said · failed · refusalCode: the catalogue's one way to word a refusal and a fault) and lib/storefront-contract.js (refusalFor · trimmed: the old
 * 400 "Validation failed" body and the chain's trim()). This file shapes NO answer and reads no row.
 *
 * ⚠️ Input is described as the handlers ALREADY take it: nothing narrowed, nothing required but what the old chain required (the enquiry's message_text). `images` and `face` carry no type:
 *    the handlers answer a wrong one in their own sentence, and those sentences are frozen in docs/contracts/api-legacy.json.
 */
'use strict';
const { internalSpec } = require('./problem');
const { SAFE_SENTENCE } = require('./respond');
const { contractOf, object, any } = require('./contract-kit');
const { refusalFor } = require('./storefront-contract');
const { said, failed, refusalCode } = require('./products-contract');
const rateDoor = require('./rate-door'); // CAT-211: the one rate sentence and code, here for the face's shop default

/* ── the words ──────────────────────────────────────────────────────────────────────────────────────────── */
const words = {
  noSuchDocument: () => said('NOT_FOUND', { error: 'Not found', message: 'No such document of yours' }),
  noSuchProduct: () => said('NOT_FOUND', { error: 'Not found', message: 'No such product' }),
  enquiryNotMigrated: () => said('PRODUCT_NOT_READY', { error: 'Not migrated', message: 'Product enquiries need b162 — not applied on this deployment.' }),
  noImages: () => said('PRODUCT_BAD_REQUEST', { error: 'No images', message: 'Send images: [{ mime, b64 }].' }),
  faceNotAnObject: () => said('PRODUCT_BAD_REQUEST', { error: 'Bad request', message: 'face must be an object' }),
  /* CAT-211: the shop's default rate is a money promise: owner or manager only (the same 403 as every rate door) */
  rateOwnerOnly: rateDoor.refusal,
  faceTooLarge: (max) => said('PRODUCT_TOO_LARGE', { error: 'Too large', message: 'face exceeds ' + max + ' bytes' }),
  /** the declarations the catalogue cannot enforce: the old body listed them as `errors` (text), and still does — the screen shows the joined `message` */
  notSupported: (declErrors) => Object.assign(said('PRODUCT_REFUSED', { error: 'Declaration not supported', message: declErrors.join('; ') }), { errors: declErrors })
};

/**
 * aiFault(err, req) — the spec of a failed photo read. The skill's own refusal (no wallet, too many reads, not connected) carries its status; a 4xx keeps the skill's sentence, anything
 * else keeps its status and says nothing of its cause (the real error is logged with the request id).
 */
function aiFault(err, req) {
  const status = err.status || 500;
  if (err.status && err.status < 500) {
    const message = err.message || SAFE_SENTENCE;
    return { status, code: refusalCode(status), detail: message, legacy: { error: 'Photo read failed', message } };
  }
  return Object.assign(internalSpec(req, err, { error: 'Photo read failed', message: SAFE_SENTENCE }), { status });
}

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
const PAGE = ['page', 'limit'];
const THREADS = ['external', 'internal'];
/** the old chain: trim(), then not empty — a number or a flag was turned to text and passed, as it still does */
const MESSAGE_TEXT = { anyOf: [{ type: 'string', pattern: '\\S' }, { type: ['number', 'boolean'] }], examples: ['Is this in stock?'] };
const AI_REFUSALS = [
  { status: 402, when: 'the skill needs a wallet that has run out' },
  { status: 429, when: 'too many photo reads just now' },
  { status: 503, when: 'the skill is not connected, or its daily cap is reached: the sentence is ours, never the cause' }
];

const ROUTES = {
  'GET /enquiry': { summary: 'The product questions waiting for this business: about its products (side=in) or the ones it asked (side=out)', invalid: 400, query: ['side'].concat(PAGE), out: object(['enquiries', 'total', 'page', 'limit']) },
  'GET /enquiry/:item_id': { summary: 'The thread of questions about one product, as this business holds it', invalid: 400, query: PAGE, out: object(['messages', 'count', 'total', 'page', 'limit']) },
  'POST /enquiry/:item_id': { summary: 'Ask the supplier about a product before there is a chit', invalid: 400, ok: 201, says: 'asked', inline: [404, 503], body: { message_text: MESSAGE_TEXT, thread_type: { type: 'string', enum: THREADS }, msg_type: any }, required: ['message_text'], out: object(['message_id', 'created_at']) },
  'POST /photo-extract': { summary: 'Read products out of a photo: proposes rows, never commits them', invalid: 400, inline: [400], refusals: AI_REFUSALS, body: ['images'], out: object() },
  'GET /:bridge_id/my-orders': { summary: "The signed-in shopper's own orders, with the shop's status", invalid: 400, query: PAGE, out: object(['orders', 'count', 'total', 'page', 'limit']) },
  'GET /:bridge_id/my-documents': { summary: 'The documents the signed-in shopper submitted: their own copies only', invalid: 400, query: PAGE, out: object(['documents', 'count', 'total', 'page', 'limit']) },
  'DELETE /:bridge_id/my-documents/:id': { summary: "Delete the shopper's own copy of a document; the shop's copy is untouched", invalid: 400, inline: [404], out: object(['ok', 'deleted']) }
};
const FACE_ROUTES = {
  'GET /': { summary: "This business's saved catalogue face (null when none yet)", out: object(['face', 'updated_at']) },
  'PUT /': { summary: 'Save the whole catalogue face; a declaration that cannot be enforced is refused when it is written', invalid: 400, inline: [400, 403, 413, 422], body: ['face'], out: object(['ok', 'updated_at']) }
};

const catalogue = contractOf({ mount: '/api/catalogue', routes: ROUTES, gateStatus: {}, extension: 'x-catalogue-refusals' });
const face = contractOf({ mount: '/api/catalogue-face', routes: FACE_ROUTES, gateStatus: {}, extension: 'x-catalogue-refusals' });
/** the options schemaValidate takes for a route: the old chain's 400 where it had one (the enquiry), else the same body shape for a body that is not an object */
const schemaOptionsFor = (route) => refusalFor(route === 'POST /enquiry/:item_id' ? [['message_text', 'Message text required'], ['thread_type']] : []);

/** the paths of both mounts, merged with the storefront's (a path can hold methods from both) */
function mergePaths(...fragments) {
  const merged = {};
  fragments.forEach((paths) => Object.keys(paths).forEach((apiPath) => Object.assign((merged[apiPath] = merged[apiPath] || {}), paths[apiPath])));
  return merged;
}

module.exports = { words, aiFault, failed, schemaOptionsFor, mergePaths, ROUTES, FACE_ROUTES, catalogue, face, MESSAGE_TEXT, THREADS };
