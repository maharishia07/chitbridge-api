/*
 * OWNS      the contract of the relationship routes (14): routes/relationships.js (/api/relationships) — each route's OpenAPI operation (S9) and the one way its refusals and faults are worded
 *           (words.*, partyRefusal, mintRefusal, removeFault, failed).
 * CALLED BY routes/relationships.js (schemaValidate on each route, router.openapi, problem(req, res, { status, ...words.x() } | partyRefusal(e) | mintRefusal(local) | removeFault(e, req) | failed(e, req, label)))
 *           → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-relationships.test.cjs.
 * FLOW      operation → schemaValidate(operation, schemaOptions) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a refusal → problem(req, res, spec) → the old { error, message, ... } beside the Problem fields; a thrown error → failed(e, req, label) → a 500 that says nothing of its cause
 * CARD      11-crm-and-marketing/relationships-routes
 * This file shapes NO answer: the supplier list, the customer list, the groups, the rewards and the scorecard are lib/party-fields.js, lib/local-identity.js, lib/crm.js, lib/customer-groups.js,
 * lib/reward-store.js and lib/select.js, as before.
 *
 * ⚠️ WHAT IS RELAYED, AND WHY IT IS NOT RAW TEXT (traced to the throw, API-4-relationships.md): partyRefusal carries the sentence of lib/party-fields `bad()` and removeFault the sentence of lib/crm
 *    removeParty (crm-followups `bad()`): fixed words. The words of a local-identity mint are fixed too. A thrown error of any other kind (a database's, a provider's) is failed(): the generic sentence.
 * ⚠️ The input schemas say what the handlers ALREADY take: names, nothing required, nothing typed (a handler reads every field through String(...) and answers a missing or odd value in its own
 *    sentence, frozen in docs/contracts/api-legacy.json, recorded from the code before the sweep). The one thing a schema refuses is a body that is not an object, or a query value given twice:
 *    answered 400 in the keys the chains of this file always used (error 'Validation failed', details).
 */
'use strict';
const { internalSpec } = require('./problem');
const { SAFE_SENTENCE } = require('./respond');
const { contractOf, object, array, text } = require('./contract-kit');
const partyFields = require('./party-fields');

/** the old body of a refusal, as the spec parts problem() takes: { code, detail, legacy }; the words a person reads are `message`, else `error` */
const said = (code, legacy) => ({ code, detail: legacy.message === undefined ? legacy.error : legacy.message, legacy });

/** the party fields a PATCH may carry (a supplier's list has no nickname of its own here: the supplier's `nickname` is the owner's label, set by the other half of the same PATCH) */
const PARTY_KEYS = ['legal_name', 'nickname', 'credit_days', 'credit_limit', 'credit_limit_minor', 'state_code', 'merged_into', 'tax_ids', 'phone', 'email'];

/* ── the words of a refusal (the sentences are the ones these routes always said; a sentence said at more than one site is built here, once) ── */
const NO_BUSINESS = 'No business with that User ID, bridge ID, or email';
/** the statuses the remote-address gate answers by itself (lib/remote-party adopt: 400 CTP_ADDRESS_INVALID · 404 CTP_ADDRESS_UNKNOWN · 409 CTP_ADDRESS_CLASH, SUPPLIER_SELLS_ONLY_HERE · 502 CTP_UNREACHABLE) */
const ADDRESS_GATE_STATUSES = [400, 404, 409, 502];
const words = {
  ADDRESS_GATE_STATUSES,
  /** a remote address lib/remote-party refused ({ status, code, message }): its own status, code and words, the two old keys kept (RAIL-101) */
  remoteRefused: (refusal) => ({ status: refusal.status, code: refusal.code, detail: refusal.message, legacy: { error: 'Not added', message: refusal.message } }),
  needSupplierParty: () => said('REL_NEED_PARTY', { error: 'Invalid', message: 'Give a User ID or email for a ChitBridge business, or a name for a local supplier' }),
  noBusiness: () => said('REL_NO_BUSINESS', { error: 'Not found', message: NO_BUSINESS }),
  addSelf: () => said('REL_SELF', { error: 'Invalid', message: 'Cannot add yourself' }),
  /** the person is already on the list: `message` is the sentence the caller reads (it names the supplier, or the customer's phone holder) */
  listed: (message) => said('REL_EXISTS', { error: 'Exists', message }),
  notFound: () => said('NOT_FOUND', { error: 'Not found' }),
  notOnYourList: () => said('REL_NOT_ON_YOUR_LIST', { error: 'Not found', message: 'That business is not on your supplier list. Add them as a supplier to see their catalogue.' }),
  notYours: () => said('REL_NOT_YOURS', { error: 'Not yours', message: 'That is their own business name. Use "your name for them" instead.' }),
  nothingToUpdate: (message) => said('REL_NOTHING_TO_UPDATE', { error: 'Nothing to update', message }),
  badPhone: () => said('BAD_PHONE', { error: 'Invalid', message: 'Enter a valid phone number.' }),
  ownerOnly: () => said('OWNER_ONLY', { code: 'OWNER_ONLY', error: 'Owner only', message: 'Only the owner can remove a supplier.' }),
  keyFence: () => said('SIGN_IN', { error: 'Forbidden', message: 'Sign in to place a customer in a group.' }),
  groupsNotMigrated: () => said('GROUPS_NOT_MIGRATED', { error: 'Not migrated', message: 'Named groups need the customer_groups migration (migrations/b205_customer_groups.sql) — run it in the Supabase SQL editor.' }),
  needCustomerId: () => said('BAD_ID', { error: 'validation', message: 'a customer id is required' })
};

/** the status of a library refusal that carries its own: party-fields' 404 (Not found), 409 (Conflict) and 400 (validation), in the words the route always sent them */
const PARTY_ERROR = { 404: 'Not found', 409: 'Conflict' };
const PARTY_CODE = { 404: 'NOT_FOUND', 409: 'REL_PARTY_CONFLICT' };

/** a tax id another party of the shop already holds: its code and sentences, and who holds it (the holder and the kind ride as null when the library gave none) */
const heldTaxId = (e) => ({ status: 409, ...said('DUPLICATE_PARTY', { code: 'DUPLICATE_PARTY', error: e.message, message: e.message, holder: e.holder || null, scheme: e.scheme || null }) });
/** a refusal of the party fields that carries its own status: the library's sentence, under the error word the route always used for that status */
const partyFieldRefusal = (e) => ({ status: e.status, ...said(PARTY_CODE[e.status] || 'REL_PARTY_INVALID', { error: PARTY_ERROR[e.status] || 'validation', message: e.message }) });
/** the database's unique violation on a tax id: the duplicate sentence, never the database's text */
const taxIdRace = () => ({ status: 409, ...said('DUPLICATE_PARTY', { code: 'DUPLICATE_PARTY', error: partyFields.DUPLICATE_PARTY, message: partyFields.DUPLICATE_PARTY }) });

/**
 * partyRefusal(e) — the spec of a refusal the party half of a PATCH raised, or null when the error is not one of its refusals (the route then answers its own 500).
 * A held tax id keeps its code, sentences and who holds it; a refusal with a status keeps that status and the library's sentence; a unique violation is the duplicate sentence.
 */
function partyRefusal(e) {
  if (!e) return null;
  if (e.code === 'DUPLICATE_PARTY') return heldTaxId(e);
  if (e.status) return partyFieldRefusal(e);
  return e.code === '23505' ? taxIdRace() : null;
}

/** mintRefusal(local) — the spec of a local-identity mint that said no: its own status (400 a name it will not take, 409 no id to give) and its own body, whole */
const mintRefusal = (local) => ({ status: local.status, ...said(local.status === 409 ? 'REL_ID_BUSY' : 'REL_NAME_REFUSED', local.error) });

/** failed(e, req, label) — a 500 in the screen's own label and the one safe sentence; the real error is logged with the request id */
const failed = (e, req, label) => internalSpec(req, e, { error: label, message: SAFE_SENTENCE });

/**
 * removeFault(e, req) — the spec of whatever DELETE /suppliers/:id's catch got: a library's refusal (a status under 500) keeps its status, code (REFUSED when it has none) and sentence;
 * anything else — a database error, and also a 503 such as "CRM not migrated" — is the 500 this route always answered.
 */
function removeFault(e, req) {
  if (e && e.status && e.status < 500) {
    const code = e.code || 'REFUSED';
    return { status: e.status, ...said(code, { code, error: e.message, message: e.message }) };
  }
  return failed(e, req, 'Remove supplier failed');
}

/** a request the schema refuses is answered 400 in the keys the chains of this file always used: 'Validation failed' and one { field, message } per failure */
const schemaOptions = { status: 400, code: 'INVALID_INPUT', legacy: (failures) => ({ error: 'Validation failed', details: failures.map((failure) => ({ field: failure.field, message: failure.detail })) }) };

/** every code this file's routes answer under, for the test that each is a register row with its sentence */
const CODES = [
  'INVALID_INPUT', 'REL_NEED_PARTY', 'REL_NO_BUSINESS', 'REL_SELF', 'REL_EXISTS', 'REL_NAME_REFUSED', 'REL_ID_BUSY', 'REL_NOT_YOURS', 'REL_NOT_ON_YOUR_LIST', 'REL_NOTHING_TO_UPDATE', 'REL_PARTY_CONFLICT',
  'REL_PARTY_INVALID', 'BAD_PHONE', 'OWNER_ONLY', 'SIGN_IN', 'GROUPS_NOT_MIGRATED', 'BAD_ID', 'NOT_FOUND', 'DUPLICATE_PARTY', 'REFUSED', 'HAS_DUES', 'INTERNAL'
];

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
const PAGE_QUERY = ['page', 'limit'];
const PARTY_REFUSALS = [
  { status: 409, code: 'DUPLICATE_PARTY', when: 'another party of the shop already holds the tax id (the holder and the kind ride beside the sentence)' },
  { status: 409, code: 'REL_PARTY_CONFLICT', when: 'the party fields (migration b274) are not run yet' }
];
const PARTY_BODY = PARTY_KEYS.filter((name) => name !== 'nickname');

const ROUTES = {
  'POST /suppliers': { summary: 'Add a supplier: a ChitBridge business by its User ID, bridge id or email, or a local one by name (given an id of its own)', invalid: 400, inline: [404, 409], body: ['supplier_bridge_id', 'name', 'supply_kind', 'category', 'nickname', 'notes', 'preferred'], out: object(['message', 'supplier'], { message: text, supplier: object(['display_name', 'on_rail', 'supply_kind', 'preferred']) }) },
  'GET /suppliers': { summary: 'My suppliers, each with what they give me and the party fields, in pages', invalid: 400, query: PAGE_QUERY, out: object(['count', 'suppliers', 'total', 'page', 'limit'], { suppliers: array() }) },
  'PATCH /suppliers/:id': { summary: 'Change my side of a supplier (nickname, category, notes, preferred, supply kind), rename one I minted, and set its party fields', invalid: 400, inline: [403, 409], body: ['nickname', 'category', 'notes', 'supply_kind', 'display_name', 'preferred', ...PARTY_BODY], refusals: PARTY_REFUSALS, out: object(['message']) },
  'DELETE /suppliers/:id': { summary: 'Remove a supplier from my list (owner only, no open dues); hides the row and deletes no history', invalid: 400, inline: [403], refusals: [{ status: 409, code: 'HAS_DUES', when: 'the supplier has money open either way' }], out: object(['message']) },
  'GET /suppliers/availability': { summary: 'Which of my suppliers stock a product: has, no catalogue, miss or unreadable, per supplier', invalid: 400, query: ['q', ...PAGE_QUERY], out: object(['q', 'results', 'count', 'searched'], { results: array() }) },
  'GET /suppliers/:supplier_entity_id/catalogue': { summary: 'A supplier\'s catalogue as the public storefront shows it, to draft an order; a business not on my supplier list (or unknown) is refused 404 in a sentence', invalid: 400, out: object(['supplier']) },
  'GET /customers/groups': { summary: 'The names of my customer groups', out: object(['names', 'migrated'], { names: array() }) },
  'GET /customers': { summary: 'My customers with their segment and groups, in pages', invalid: 400, query: ['segment', ...PAGE_QUERY], out: object(['count', 'groups_migrated', 'customers', 'total', 'page', 'limit'], { customers: array() }) },
  'GET /customers/:id/rewards': { summary: 'What a customer holds in points and what it means in the shop\'s own words', invalid: 400, out: object(['programme', 'points', 'says']) },
  'POST /customers': { summary: 'Add a customer: a ChitBridge business by its User ID, bridge id or email, or a local one by name and phone', invalid: 400, inline: [404, 409], body: ['handle', 'name', 'phone', 'gstin'], out: object(['message', 'customer'], { message: text, customer: object(['customer_list_id', 'customer_identity_id', 'display_name', 'segment', 'added_via', 'on_rail']) }) },
  'POST /customers/:id/groups': { summary: 'Place a customer in named groups (replaces the set); a key may not', invalid: 400, inline: [403, 409], body: ['groups'], out: object(['ok', 'groups']) },
  'PATCH /customers/:id': { summary: 'Override a customer\'s segment and set its party fields', invalid: 400, body: ['segment_override', ...PARTY_KEYS], refusals: PARTY_REFUSALS, out: object(['message']) },
  'GET /scorecard': { summary: 'Everyone I have traded with, scored from the chits both sides hold', invalid: 400, query: ['since'], out: object(['counterparties'], { counterparties: array() }) },
  'GET /scorecard/:entity_id': { summary: 'One counterparty in depth, from the chits both sides hold', invalid: 400, query: ['since'], out: object(['counterparty_id', 'name']) }
};

/** the contract of this area, of the kit's making */
const contract = contractOf({ mount: '/api/relationships', routes: ROUTES, gateStatus: {}, extension: 'x-relationships-refusals' });
const OPERATIONS = contract.OPERATIONS;
/** the refusal statuses a test may see from one route */
const allowedStatuses = () => contract.allowedStatuses();

module.exports = { said, words, PARTY_KEYS, partyRefusal, mintRefusal, failed, removeFault, schemaOptions, CODES, OPERATIONS, allowedStatuses, contract, ...words };
