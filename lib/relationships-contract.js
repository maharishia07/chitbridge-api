/*
 * OWNS      the contract of the three supplier doors of routes/relationships.js that the cross-installation work touched (NET-39, RAIL-101): GET /suppliers · POST /suppliers ·
 *           GET /suppliers/:supplier_entity_id/catalogue — each door's OpenAPI operation (S9), the words of the refusals the route itself writes (as they always read: error + message),
 *           and the schema options that keep POST /suppliers on its old 400 "Validation failed" body (S2). It shapes NO answer and adds NO supplier: the handlers in routes/relationships.js do.
 * CALLED BY routes/relationships.js (checked(route) in front of the three handlers, the words in their refusals, router.openapi) → tools/api-register.cjs · tools/api-contract-tests.cjs ·
 *           /api/openapi.json · tests/api-problem-relationships.test.cjs (the statuses a test may see). The other relationships routes are not here yet (their sweep is cb-crm's turn).
 * FLOW      ROUTES (one row per door) → contractOf → { OPERATIONS, checked, pathsOf, allowedStatuses } → schemaValidate at the door → problem(req, res, words.*) in the handler
 * CARD      11-crm-and-marketing/relationships
 */
'use strict';
const { contractOf, object, array, text } = require('./contract-kit');
const { internalSpec } = require('./problem');
const { SAFE_SENTENCE } = require('./respond');
const { UUID_TEXT } = require('./chits-input'); /* the one uuid schema with its example: a path id that is not one is refused by the schema, not by Postgres (22P02 was a 500) */

const BOOLEAN_LIKE = { type: ['boolean', 'string', 'integer'], enum: [true, false, 'true', 'false', '1', '0', 1, 0] };
const maybeText = (max) => Object.assign({ type: ['string', 'null'] }, max ? { maxLength: max } : {});

/* ── the words: each refusal exactly as the door answered it before the standard (error + message), with its registered code. The STATUS is written in the handler
   (problem(req, res, { status: 404, ...notFound() })): tools/api-register.cjs reads a route's statuses from the literals in its own text (R2-3 c). ── */
const CODES = { invalid: 'SUPPLIER_INVALID', exists: 'SUPPLIER_EXISTS', busy: 'SUPPLIER_ID_BUSY', notFound: 'NOT_FOUND', notYours: 'SUPPLIER_NOT_YOURS', nothing: 'NOTHING_TO_UPDATE', ownerOnly: 'OWNER_ONLY', duplicate: 'DUPLICATE_PARTY' };
const ALL_CODES = Object.values(CODES).concat(['INTERNAL', 'HAS_DUES']);
/** a 400 the door writes itself: { error: 'Invalid', message } */
const invalid = (message) => ({ code: CODES.invalid, detail: message, legacy: { error: 'Invalid', message } });
/** the one 404 of a business that is not there to add: the same words whatever was typed (a minted handle included), so nothing is revealed */
const NO_SUCH_BUSINESS = 'No business with that User ID, bridge ID, or email';
const notFound = () => ({ code: CODES.notFound, detail: NO_SUCH_BUSINESS, legacy: { error: 'Not found', message: NO_SUCH_BUSINESS } });
/** a 409 the door writes itself: { error: 'Exists', message } */
const exists = (message) => ({ code: CODES.exists, detail: message, legacy: { error: 'Exists', message } });
/** lib/local-identity mint refused ({ status, error: { error, message } }): its own words, the code by its status (400 a bad name · 409 no id could be allocated); the handler writes the status */
const mintRefused = (local) => ({ code: local.status === 409 ? CODES.busy : CODES.invalid, detail: local.error.message, legacy: local.error });
/** a remote address lib/remote-party refused ({ status, code, message }): its own status, code and words, the two old keys kept (a gate in the chain: remoteAddress.addsStatuses names its statuses) */
const remoteRefused = (refusal) => ({ status: refusal.status, code: refusal.code, detail: refusal.message, legacy: { error: 'Not added', message: refusal.message } });
/** the statuses the remote-address gate answers by itself (lib/remote-party adopt: 400 CTP_ADDRESS_INVALID · 404 CTP_ADDRESS_UNKNOWN · 409 CTP_ADDRESS_CLASH, SUPPLIER_SELLS_ONLY_HERE · 502 CTP_UNREACHABLE) */
const ADDRESS_GATE_STATUSES = [400, 404, 409, 502];
/** the bare 404 of a list row that is not this shop's: { error: 'Not found' } and nothing else (PATCH · DELETE) */
const rowNotFound = () => ({ code: CODES.notFound, detail: 'Not found', legacy: { error: 'Not found' } });
const THEIR_NAME = 'That is their own business name. Use "your name for them" instead.';
/** PATCH: renaming a business that is not one this shop minted */
const notYours = () => ({ code: CODES.notYours, detail: THEIR_NAME, legacy: { error: 'Not yours', message: THEIR_NAME } });
const NOTHING = 'Provide nickname, category, notes, supply_kind, or preferred';
/** PATCH: a body with nothing this door writes */
const nothingToUpdate = () => ({ code: CODES.nothing, detail: NOTHING, legacy: { error: 'Nothing to update', message: NOTHING } });
const OWNER_WORDS = 'Only the owner can remove a supplier.';
/** DELETE: a staff login may not remove a supplier */
const ownerOnly = () => ({ code: CODES.ownerOnly, detail: OWNER_WORDS, legacy: { code: CODES.ownerOnly, error: 'Owner only', message: OWNER_WORDS } });
/** DELETE: lib/crm removeParty refused ({ status, code, message }: 404 NOT_FOUND · 409 HAS_DUES): its code and sentence, the old three keys */
const removeRefused = (e) => ({ code: e.code || 'REFUSED', detail: e.message, legacy: { code: e.code || 'REFUSED', error: e.message, message: e.message } });
/** the party half of a PATCH refused (lib/party-fields): the duplicate tax id names its holder; any other carries its own status and sentence */
function partyRefused(e) {
  if (e.code === 'DUPLICATE_PARTY' || e.code === '23505') {
    const message = e.code === '23505' ? require('./party-fields').DUPLICATE_PARTY : e.message;
    return { code: CODES.duplicate, detail: message, legacy: Object.assign({ code: CODES.duplicate, error: message, message }, e.code === '23505' ? {} : { holder: e.holder || null, scheme: e.scheme || null }) };
  }
  const label = e.status === 404 ? 'Not found' : e.status === 409 ? 'Conflict' : 'validation';
  return { code: e.status === 404 ? CODES.notFound : e.status === 409 ? CODES.exists : CODES.invalid, detail: e.message, legacy: { error: label, message: e.message } };
}
/** a door that always answered 500 when it failed: the screen's label and the safe sentence, nothing of the cause (logged with the request id, S8) */
const failed = (e, req, label) => internalSpec(req, e, { error: label, message: SAFE_SENTENCE });

/** the old express-validator chain's refusal: 400 { error: 'Validation failed', details: [{ field, message }] }, one detail per field, the chain's own sentence for supply_kind */
const CHAIN_SAYS = { supply_kind: 'supply_kind must be resale or own_use' };
const fieldOf = (failure) => String(failure.field === '(body)' ? '' : failure.field).split('.')[0];
function validationFailed(failures) {
  const seen = new Set();
  const details = failures.map(fieldOf).filter((field) => !seen.has(field) && seen.add(field)).map((field) => ({ field, message: CHAIN_SAYS[field] || 'Invalid value' }));
  return { error: 'Validation failed', details };
}
const schemaOptions = { status: 400, code: CODES.invalid, legacy: validationFailed };
/** PATCH: what the old chain checked (six fields) plus the party fields lib/party-fields reads from the same body (PARTY_KEYS in routes/relationships.js) */
const PATCH_BODY = { nickname: maybeText(80), category: maybeText(50), notes: maybeText(2000), supply_kind: { enum: ['resale', 'own_use'] }, display_name: maybeText(120), preferred: BOOLEAN_LIKE, legal_name: {}, credit_days: {}, credit_limit: {}, credit_limit_minor: {}, state_code: {}, merged_into: {}, tax_ids: {}, phone: {}, email: {} };

/* ── the shapes ── */
const SUPPLIER_OUT = object(['bridge_id', 'display_name', 'on_rail', 'party_no', 'supply_kind', 'category', 'nickname', 'notes', 'preferred'], {
  bridge_id: text,
  display_name: text,
  on_rail: { type: 'boolean' },
  supply_kind: { enum: ['resale', 'own_use'] },
  supplier_entity_id: text,
  address: text,
  installation_key: text,
  one_sided: object(['why'], { why: text })
});
/** one row of the list: the keys the Suppliers screen reads; installation_key / installation_label name where the supplier lives when that is another installation (null here) — API-6, 25 Oct */
const SUPPLIER_ROW = object(['supplier_list_id', 'supplier_entity_id', 'bridge_id', 'display_name', 'on_rail', 'has_catalogue', 'supply_kind', 'installation_key', 'installation_label'], {
  supplier_list_id: text,
  supplier_entity_id: text,
  bridge_id: maybeText(),
  display_name: text,
  on_rail: { type: 'boolean' },
  has_catalogue: { type: 'boolean' },
  supply_kind: { enum: ['resale', 'own_use'] },
  installation_key: Object.assign({ description: 'the installation the supplier lives on when it is not this one; null for a supplier here' }, maybeText()),
  installation_label: Object.assign({ description: "that installation's label, when it is not this one" }, maybeText()),
  facts: { type: 'object' },
  for_you: array()
});
const ADD_BODY = {
  supplier_bridge_id: Object.assign({ description: 'a User ID, bridge id, e-mail, or (RAIL-101) an address id@domain or a pasted link of a business on another installation' }, maybeText()),
  name: Object.assign({ description: 'a local supplier with no ChitBridge account: a name, and an id is minted for it' }, maybeText(120)),
  supply_kind: { enum: ['resale', 'own_use'] },
  category: maybeText(50),
  nickname: maybeText(80),
  notes: maybeText(2000),
  preferred: BOOLEAN_LIKE
};

const ROUTES = {
  'GET /suppliers': {
    summary: "This shop's supplier list, preferred first: who is on the rail, who has a catalogue (a supplier on another installation keeps its catalogue there and counts as one to ask), what each gives me",
    query: ['page', 'limit'], /* each a single text value; a doubled key (?page=1&page=2) is refused 422, which no caller sends */
    out: object(['count', 'suppliers', 'total', 'page', 'limit'], { suppliers: array(SUPPLIER_ROW), count: { type: 'integer' }, total: { type: 'integer' } })
  },
  'POST /suppliers': {
    summary: 'Add a supplier: a ChitBridge business by User ID, bridge id, e-mail or (another installation) its address, or a local supplier by name; nobody is asked or notified',
    gates: ['address'],
    invalid: 400,
    inline: [400, 404, 409],
    body: ADD_BODY,
    rules: { additionalProperties: false },
    out: object(['message', 'supplier'], { message: text, supplier: SUPPLIER_OUT })
  },
  'PATCH /suppliers/:id': {
    params: { id: UUID_TEXT },
    summary: "Change what this shop keeps about a supplier (nickname, category, notes, supply kind, preferred), the party fields (legal name, credit, tax ids, phone, e-mail), or the name of a supplier this shop minted",
    invalid: 400,
    inline: [400, 403, 404, 409],
    body: PATCH_BODY,
    rules: { additionalProperties: false },
    out: object(['message'], { message: text })
  },
  'DELETE /suppliers/:id': { params: { id: UUID_TEXT }, summary: 'Take a supplier off my list (the owner only; refused while money is open either way); their record is hidden, never deleted', inline: [403, 404, 409], out: object(['message'], { message: text }) },
  'GET /suppliers/availability': {
    summary: 'One question, every supplier: who stocks this (has), who has no catalogue to ask (nocat), who was read and does not (miss), whose read failed (err); two characters or more, else an empty answer',
    query: ['q', 'page', 'limit'],
    out: object(['q', 'results', 'count', 'searched'], { results: array(), count: { type: 'integer' }, searched: { type: 'integer' } })
  },
  'GET /suppliers/:supplier_entity_id/catalogue': {
    params: { supplier_entity_id: UUID_TEXT },
    summary: "A supplier's catalogue to draft an order from: the same public view the storefront shows (a supplier on another installation is asked over the signed door, its money as the seller states it); an id nobody holds answers supplier null",
    out: object(['supplier', 'schema', 'fields', 'items', 'finishes'], { fields: array(), items: array(), finishes: array() })
  }
};

const contract = contractOf({ mount: '/api/relationships', routes: ROUTES, gateStatus: { address: 502 } });

module.exports = Object.assign({ ROUTES, CODES, ALL_CODES, ADDRESS_GATE_STATUSES, rowNotFound, notYours, nothingToUpdate, ownerOnly, removeRefused, partyRefused, invalid, notFound, exists, mintRefused, remoteRefused, failed, schemaOptions, validationFailed, NO_SUCH_BUSINESS }, contract);
