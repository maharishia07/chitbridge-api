/*
 * OWNS      the contract of routes/channels.js (10 routes, /api/channels — Settings › Channels: which number or address belongs to this shop, its provider reference, its templates, and the
 *           platform's approval): each route's OpenAPI operation (S9) and the one way their refusals and faults are worded (faultOf, adminOff, adminWrongKey, schemaOptions, CODES).
 * CALLED BY routes/channels.js (checked(route) after auth or the platform gate, router.openapi, problem(req, res, faultOf(err, req, label, relay) | { status, ...words.x() }))
 *           → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-channels.test.cjs.
 * FLOW      operation → schemaValidate(operation, schemaOptions) at the route (after auth, or after the platform gate) → the register reads router.openapi → the contract cases run from the same schemas
 *           a thrown error → faultOf(err, req, label, relay) → the refusal lib/channels.js meant (its status, its sentence) or a fault that says nothing of its cause
 *           a refusal → problem(req, res, spec) → the old { error, message } beside the Problem fields
 * CARD      11-crm-and-marketing/channels
 * Reuses lib/products-contract.js (said · failed: the one way to word a refusal and a fault) and lib/contract-kit.js. This file shapes NO answer: the bindings, the provider state, the templates and the
 * receipts are lib/channels.js, as before.
 *
 * ⚠️ A RELAY STILL RELAYS. faultOf answers a library's own refusal with the sentence it threw (`relay`: 'any' = whatever status, 'below500' = only under 500, 'none' = never), exactly the three ways
 *    the catches did. Every sentence lib/channels.js throws with a status is fixed words (traced in docs/critique/API-4-channels.md); a database error has no status. The raw-error ratchet no longer counts
 *    these catches; the signer reads this spec.
 * ⚠️ GET /outbound's 200 lists each receipt's stored `reason`, which lib/whatsapp-out.js fills with the provider's own error text: a finding for cb-security (SEC-95), so that route is built but not put forward.
 * ⚠️ THE THREE PLATFORM DOORS (approve, template-approve, revoke) ARE NOT A SESSION: the key in the x-cb-admin-key header against CB_ADMIN_KEY is their credential (`public: true` here, so no 401), and the
 *    gate refuses before any lookup with one body whatever the id (403 'Forbidden', or 503 when the key is not set on the server). Who may call them is exactly as it was.
 * ⚠️ The input schemas say what the handlers ALREADY take: names, nothing required, nothing typed, and (as before) a list read as a body with nothing in it. The one thing a schema refuses is a query
 *    value given twice on GET /outbound (answered 400 in the express-validator body); a malformed binding id in a path is plain text here, as before: the database says its own 500.
 */
'use strict';
const { schemaValidate } = require('../middleware/validate');
const { safeErr } = require('./respond');
const { said, failed } = require('./products-contract');
const { contractOf, object, array } = require('./contract-kit');

/* ── the words ──────────────────────────────────────────────────────────────────────────────────────────── */
/** every code this file's routes answer under, for the test that each is a register row with its sentence */
const CODES = ['ADMIN_DISABLED', 'ADMIN_KEY_WRONG', 'CHANNEL_ADDRESS_TAKEN', 'CHANNEL_BAD_REQUEST', 'CHANNEL_PLATFORM_ONLY', 'CHANNEL_REFUSED', 'CHANNEL_STORE_MISSING', 'INTERNAL', 'INVALID_INPUT', 'NOT_FOUND'];
/** the code a status the library raised answers under, when the error carries none of its own */
const REFUSAL_CODES = { 400: 'CHANNEL_BAD_REQUEST', 403: 'CHANNEL_PLATFORM_ONLY', 404: 'NOT_FOUND', 409: 'CHANNEL_ADDRESS_TAKEN', 503: 'CHANNEL_STORE_MISSING' };
const RELAYS = {
  any: () => true,
  below500: (status) => status < 500,
  none: () => false
};
const codeOf = (error, status) => (CODES.includes(error.code) ? error.code : REFUSAL_CODES[status] || 'CHANNEL_REFUSED');

/**
 * faultOf(e, req, label, relay) — the spec of whatever a channel route's catch got. A thrown error WITHOUT a status is a 500 that says nothing of its cause (logged with the request id). One WITH a status
 * keeps that status: its own sentence when the route's `relay` lets it through ('any', 'below500' or 'none'), else the safe sentence.
 */
function faultOf(e, req, label, relay) {
  const status = e && e.status;
  if (!status) return failed(e, req, label);
  const code = codeOf(e, status);
  if (RELAYS[relay](status)) return { status, ...said(code, { error: label, message: e.message || safeErr(e, { id: req && req.id, path: req && req.path }) }) };
  return { ...failed(e, req, label), status, code };
}

/** the platform doors' two refusals: no key set on this server, and a key that does not match (a bare Forbidden: nothing is said of why) */
const adminOff = () => said('ADMIN_DISABLED', { error: 'Admin disabled', message: 'CB_ADMIN_KEY is not set on this server.' });
const adminWrongKey = () => said('ADMIN_KEY_WRONG', { error: 'Forbidden' });

/** a query value given twice is answered 400 in the express-validator body: one {field, message} per field at fault */
const schemaOptions = {
  status: 400,
  code: 'INVALID_INPUT',
  legacy: (failures) => ({ error: 'Validation failed', details: failures.map((failure) => ({ field: failure.field, message: failure.detail })) })
};

/* ── the shapes ──────────────────────────────────────────────────────────────────────────────────────────── */
const GATE_STATUS = { platform: 403 };
const PLATFORM = ['platform'];
const NOT_MIGRATED = { status: 503, code: 'CHANNEL_STORE_MISSING', when: 'the channel table (b123) is not run yet' };
const PLATFORM_ONLY = { status: 403, code: 'CHANNEL_PLATFORM_ONLY', when: 'a shop says a template is approved: only the platform can say that (a shop may say it is pending)' };
const TAKEN = { status: 409, code: 'CHANNEL_ADDRESS_TAKEN', when: 'another shop already holds that address (it is not said which)' };
const ID = '/:id';
const PLATFORM_DOOR = { public: true, gates: PLATFORM, inline: [503], list: true, invalid: 400 };
const BINDING = ['id', 'channel', 'address', 'status', 'verified_at', 'verified_via'];

const ROUTES = {
  'GET /': { summary: 'Every channel, whether its provider is configured, and this shop\'s bindings, in one read; the note says when the channel table is not run yet', out: object(['note', 'channels'], { channels: array() }) },
  'GET /outbound': { summary: 'The receipts: what was tried to send back and what became of it, newest first (?purpose=marketing is Offers sent; ?status= one outcome; ?page= ?limit=)', query: ['purpose', 'status', 'page', 'limit'], invalid: 400, out: object(['outbound', 'total', 'page', 'limit'], { outbound: array() }) },
  'POST /': { summary: 'Bind an address to this shop: a channel and its address, with a label and, for WhatsApp, Meta\'s phone number id', ok: 201, list: true, invalid: 400, refusals: [TAKEN, NOT_MIGRATED], body: ['channel', 'address', 'label', 'provider_ref'], out: object(['id', 'channel', 'address', 'label', 'provider_ref', 'status', 'created_at']) },
  ['POST ' + ID + '/provider-ref']: { summary: 'Set Meta\'s phone number id for this line; a changed one withdraws the platform\'s grant until it checks the number again', list: true, invalid: 400, refusals: [NOT_MIGRATED], body: ['provider_ref'], out: object(['id', 'address', 'provider_ref', 'status']) },
  ['POST ' + ID + '/auto-raise']: { summary: 'Turn hands-free raising on or off for one line; an unverified line raises nothing whatever this says', list: true, invalid: 400, refusals: [NOT_MIGRATED], body: ['on'], out: object(['id', 'address', 'status', 'auto_raise']) },
  ['POST ' + ID + '/template']: { summary: 'The shop says a template is waiting at Meta (pending); only the platform can say approved', list: true, invalid: 400, refusals: [PLATFORM_ONLY, NOT_MIGRATED], body: ['name', 'state'], out: object(['id', 'address', 'templates']) },
  ['POST ' + ID + '/approve']: { summary: 'The platform verifies this line (key in the x-cb-admin-key header; off when CB_ADMIN_KEY is not set)', ...PLATFORM_DOOR, refusals: [NOT_MIGRATED], body: ['via'], out: object(BINDING) },
  ['POST ' + ID + '/template-approve']: { summary: 'The platform records that Meta approved a template on a shop\'s line (key in the x-cb-admin-key header)', ...PLATFORM_DOOR, refusals: [NOT_MIGRATED], body: ['entity_id', 'name'], out: object(['id', 'address', 'templates']) },
  ['POST ' + ID + '/revoke']: { summary: 'The platform withdraws a line\'s verification (key in the x-cb-admin-key header)', ...PLATFORM_DOOR, refusals: [NOT_MIGRATED], body: [], out: object(BINDING) },
  ['DELETE ' + ID]: { summary: 'Remove one of this shop\'s bindings', invalid: 400, refusals: [NOT_MIGRATED], out: object(['ok', 'id']) }
};

/** the contract of this area, of the kit's making */
const contract = contractOf({ mount: '/api/channels', routes: ROUTES, gateStatus: GATE_STATUS, extension: 'x-channels-refusals' });
const OPERATIONS = contract.OPERATIONS;
const allowedStatuses = () => contract.allowedStatuses();

/** the schema check of one route as a list to spread after its gate (a route that takes no input has none) */
const checked = (route) => {
  const operation = contract.operationFor(route);
  return operation.parameters || operation.requestBody ? [schemaValidate(operation, schemaOptions)] : [];
};

module.exports = { faultOf, adminOff, adminWrongKey, schemaOptions, checked, contract, CODES, OPERATIONS, allowedStatuses, ROUTES };
