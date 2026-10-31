/*
 * OWNS      the contract of routes/quick-keys.js (9 routes, /api/quick-keys — the manager's quick-key groups, Level 1): each route's OpenAPI operation (S9) and the one way its refusals and
 *           faults are worded (words, quickKeyFault, schemaOptions).
 * CALLED BY routes/quick-keys.js (schemaValidate on each route, router.openapi, problem(req, res, { status, ...words.x() } | quickKeyFault(e, req)))
 *           → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-quick-keys.test.cjs.
 * FLOW      operation → schemaValidate(operation, schemaOptions) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a thrown error → quickKeyFault(e, req) → the refusal lib/quick-keys.js meant (400 · 404 · 409, by the code it threw) or a 500 that says nothing of its cause
 *           a refusal → problem(req, res, spec) → the old { error, message } (and `current` on the 409) beside the Problem fields
 * CARD      28-platform-and-operations/quick-keys-routes
 * This file shapes NO answer: the groups, their keys and the screen config are lib/quick-keys.js, as before. Level 2 (the counter's own /api/till/quick-keys/*) is routes/till.js's.
 *
 * ⚠️ THE 409 IS A CONTRACT WITH THE AUTHORING SCREEN. { error: 'conflict', message, current }: `current` is the group's own row as the database holds it now, so the screen can show
 *    what the other person changed. The row is carried as the library threw it, key for key; nothing here reads, copies or trims it.
 * ⚠️ THE THREE SENTENCES THAT COME FROM THE LIBRARY ("name required", "changed since you last read it", and the 404's none) are read from e.message ONLY when the error carries the
 *    library's own code (validation · conflict). A database error carries a five-character SQLSTATE and goes to the 500, which says nothing of its cause. The raw-error ratchet no longer
 *    counts these reads (they are inside a spec now): the signer reads this paragraph, not the count.
 * ⚠️ The input schemas say what the handlers ALREADY take: names, nothing required, nothing typed (the library answers a missing name in its own sentence, frozen in
 *    docs/contracts/api-legacy.json, recorded from the code before the sweep). The one thing a schema refuses is a body that is not an object, in the route's own two keys.
 * ⚠️ A malformed group id (not a uuid) in the path is not checked in the schema (the path argument stays plain text): routes/quick-keys.js answers it 404 NOT_FOUND through router.param before
 *    the database (CTR-172, the api #649 pattern); a uuid no group holds is lib/quick-keys.js's not_found, so the reorder answers 404 too and writes nothing.
 */
'use strict';
const { internalSpec } = require('./problem');
const { SAFE_SENTENCE } = require('./respond');
const { contractOf, object, array } = require('./contract-kit');
const { UUID_SCHEMA } = require('./folders-contract'); // the one uuid schema (pattern + example)
const { said } = require('./products-contract');

/* ── the words ──────────────────────────────────────────────────────────────────────────────────────────── */
const FAILED = { error: 'Failed', message: SAFE_SENTENCE };
const VALIDATION = 'validation';

/** the words a route says itself; `status` is the route's to write (the register reads it from the handler) */
const words = {
  /** a key (a counter or a connector) reaches no quick-key route: the door, before any lookup, one body for every id */
  sessionOnly: () => said('QUICK_KEY_SESSION_ONLY', { error: 'Forbidden', message: 'Quick-key groups are managed by a signed-in person, not by a key.' }),
  productRequired: () => said('QUICK_KEY_INVALID', { error: VALIDATION, message: 'product_id required' }),
  notFound: () => said('NOT_FOUND', { error: 'Not found' })
};

/** the refusal the library meant, by the code it threw: 400 with its sentence, 404, or 409 with the group as it is now */
const MEANT = {
  validation: (e) => ({ status: 400, ...said('QUICK_KEY_INVALID', { error: VALIDATION, message: e.message }) }),
  not_found: () => ({ status: 404, ...words.notFound() }),
  conflict: (e) => ({ status: 409, ...said('QUICK_KEY_CHANGED', { error: 'conflict', message: e.message, current: e.current }) })
};

/**
 * quickKeyFault(e, req) — the spec of whatever a quick-key route's catch got. A refusal lib/quick-keys.js threw on purpose (validation · not_found · conflict) keeps its status and words;
 * anything else — a database error, whatever it carries — is a 500 that says nothing of its cause (the real error is logged with the request id).
 */
function quickKeyFault(e, req) {
  const meant = e && Object.prototype.hasOwnProperty.call(MEANT, e.code) ? MEANT[e.code] : null;
  return meant ? meant(e) : internalSpec(req, e, FAILED);
}

/** a body the schema refuses (one that is not an object) is answered 400 in the route's two keys: the first failure's sentence */
const schemaOptions = { status: 400, code: 'QUICK_KEY_INVALID', legacy: (failures) => ({ error: VALIDATION, message: failures[0].detail }) };

/** every code this file's routes answer under, for the test that each is a register row with its sentence */
const CODES = ['QUICK_KEY_SESSION_ONLY', 'QUICK_KEY_INVALID', 'QUICK_KEY_CHANGED', 'NOT_FOUND', 'INTERNAL'];

/* CTR-172: a key in the order list is a product (uuid) at a whole position that a number column can hold; an entry with no product_id is skipped by the library, as it always was */
const INT4_MAX = 2147483647;
const GROUP_PARAMS = { id: UUID_SCHEMA, productId: UUID_SCHEMA }; // the path's group id is a uuid: the contract says so and gives the generated cases an id to reach the route with
const ORDER_ITEM = { type: 'object', properties: { product_id: UUID_SCHEMA, position: { type: 'integer', minimum: -INT4_MAX, maximum: INT4_MAX } } };

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
const GATE_STATUS = { session: 403 };
const SESSION = ['session'];
const CHANGED = [{ status: 409, code: 'QUICK_KEY_CHANGED', when: 'the group was changed by someone else since the `version` sent (the answer carries `current`, the group as it is now)' }];
const GROUP_FIELDS = ['name', 'color', 'sort_order', 'window_from', 'window_to', 'suggest_on_start'];

const ROUTES = {
  'GET /groups': { summary: 'The shop’s quick-key groups, each with its keys in order', gates: SESSION, out: object(['groups'], { groups: array() }) },
  'POST /groups': { summary: 'Make a quick-key group (a name is needed)', gates: SESSION, invalid: 400, ok: 201, body: GROUP_FIELDS, out: object(['group']) },
  'PATCH /groups/:id': { summary: 'Change the fields sent of a group; send the version you read, a stale one is refused with the group as it is now', gates: SESSION, params: GROUP_PARAMS, invalid: 400, refusals: CHANGED, body: [...GROUP_FIELDS, 'version'], out: object(['group']) },
  'DELETE /groups/:id': { summary: 'Delete a group (soft: the keys stay, the history is kept); send the version you read', gates: SESSION, params: GROUP_PARAMS, invalid: 400, refusals: CHANGED, body: ['version'], rules: { additionalProperties: false }, out: object(['group']) }, /* closed (stage 2, laptop1 ruling 24 Oct): an unknown key is refused by name; no caller sends one */
  'POST /groups/:id/items': { summary: 'Put a product on a group as a key, at a position', gates: SESSION, params: GROUP_PARAMS, invalid: 400, ok: 201, body: ['product_id', 'position'], out: object(['item']) },
  'DELETE /groups/:id/items/:productId': { summary: 'Take a key off a group (the product stays in the catalogue); removed says whether it was there', gates: SESSION, params: GROUP_PARAMS, invalid: 400, out: object(['removed']) },
  'PATCH /groups/:id/items': { summary: 'Rewrite the whole order of a group’s keys in one go', gates: SESSION, params: GROUP_PARAMS, invalid: 400, body: { items: array(ORDER_ITEM) }, out: object(['ok']) },
  'GET /screen-config/default': { summary: 'The shop-wide screen style a new counter starts from', gates: SESSION, out: object(['config', 'updated_at']) },
  'PUT /screen-config/default': { summary: 'Set the shop-wide screen style a new counter starts from', gates: SESSION, invalid: 400, body: ['config'], out: object(['config']) }
};

/** the contract of this area, of the kit's making */
const contract = contractOf({ mount: '/api/quick-keys', routes: ROUTES, gateStatus: GATE_STATUS, extension: 'x-quick-keys-refusals' });
const OPERATIONS = contract.OPERATIONS;
/** the refusal statuses a test may see from one route */
const allowedStatuses = () => contract.allowedStatuses();

module.exports = { words, quickKeyFault, schemaOptions, CODES, OPERATIONS, allowedStatuses, contract };
