/**
 * relationships-scenes.cjs — the named scenarios of tests/api-problem-relationships.test.cjs: an answer the generic worlds cannot reach (a refusal inside a handler, a success to prove byte for byte).
 *
 * OWNS      the extras: one scenario per answer of the six supplier doors of routes/relationships.js (list · add · availability · patch · remove · a supplier's catalogue), each with the
 *           stand-in rows or the one swapped library answer it needs (answered by the shape of the statement, so the same facts meet old and new code).
 * CALLED BY tests/api-problem-relationships.test.cjs. Not a test itself.
 * FLOW      extras(tools) → [{ id, route, expect, setup: { sqlRows, who, db }, patch, body, url, after }] → the harness runs each one against the real route
 * CARD      11-crm-and-marketing/relationships
 * A scenario with `after: true` is an answer the sweep ADDS (the schema's refusal of a key the door never reads, or of a doubled query value): never frozen.
 */
'use strict';

const R = '/api/relationships';
const OTHER = '33333333-3333-4333-8333-333333333333'; /* a business on the rail, or a party this shop minted */
const LIST_ID = '22222222-2222-4222-8222-222222222222'; /* the supplier_list row the harness puts in the path */
const SECRET = 'relation "catalogue_items" does not exist -- SELECT secret FROM vault';

/** a refusal as lib/local-identity mint and lib/crm-followups bad() raise it */
const refusal = (message, status, code) => Object.assign(new Error(message), { status, code });
const throwing = (error) => async () => {
  throw error;
};

/** the tools a scene is built from: the harness's own stand-ins */
function extras(tools) {
  const { OWNER, STAFF, answering, raising, firstOf } = tools;
  const X = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  /** an answer the sweep adds: never frozen */
  const N = (id, route, expect, more) => X(id, route, expect, Object.assign({ after: true }, more));
  const withRows = (answer) => ({ sqlRows: answer });
  const failing = { db: 'fail' };
  const at = (tail) => R + tail;
  const LIST = 'GET ' + R + '/suppliers';
  const ADD = 'POST ' + R + '/suppliers';
  const AVAIL = 'GET ' + R + '/suppliers/availability';
  const PATCH = 'PATCH ' + R + '/suppliers/:id';
  const REMOVE = 'DELETE ' + R + '/suppliers/:id';
  const CATALOGUE = 'GET ' + R + '/suppliers/:supplier_entity_id/catalogue';
  /* the rows */
  /* the two columns the SQL computes per row (Postgres does; the stand-in states them): a supplier here carries null, one on another installation its key and label */
  const listRow = { installation_key: null, installation_label: null, supplier_list_id: LIST_ID, category: null, nickname: null, preferred: false, notes: null, created_at: '2026-10-01T00:00:00.000Z', supply_kind: 'resale', on_rail: true, bridge_id: 'CBOTHER001', user_id: 'other-shop', display_name: 'Other shop', supplier_entity_id: OTHER, gstn: null, country: 'IN', policy_flags: {}, supplier_money: 'INR', has_catalogue: true };
  const listed = answering(/FROM supplier_list sl\s+JOIN identities i ON i\.identity_id = sl\.supplier_entity_id\s+WHERE sl\.owner_entity_id = \$1\s+ORDER BY/, [listRow]);
  const business = (identity_id) => answering(/SELECT identity_id, display_name FROM identities/, [{ identity_id, display_name: 'Other shop' }]);
  const alreadyListed = answering(/SELECT 1 FROM supplier_list WHERE owner_entity_id = \$1 AND supplier_entity_id = \$2/, [{ '?column?': 1 }]);
  const supplierRow = answering(/SELECT identity_id, display_name, bridge_id, currency_code, business_status\s+FROM identities WHERE identity_id = \$1/, [{ identity_id: OTHER, display_name: 'Other shop', bridge_id: 'CBOTHER001', currency_code: 'AUD', business_status: 'open' }]);
  const listRowOf = (user_id) => answering(/SELECT i\.identity_id, i\.user_id FROM supplier_list sl JOIN identities i/, [{ identity_id: OTHER, user_id }]);
  const patched = answering(/UPDATE supplier_list SET [^;]*RETURNING supplier_list_id/, [{ supplier_list_id: LIST_ID }]);
  const held = answering(/SELECT supplier_entity_id FROM supplier_list WHERE supplier_list_id = \$1 AND owner_entity_id = \$2/, [{ supplier_entity_id: OTHER }]);
  /* the libraries a scene swaps */
  const minted = { 'local-identity': { mint: async () => ({ created: true, identity_id: OTHER, bridge_id: 'CBLOCAL001', display_name: 'Corner Hardware', user_id: '~testshop.corner-hardware' }) } };
  const mintRefused = (status, error) => ({ 'local-identity': { mint: async () => ({ status, error }) } });
  const trades = { istest: { mayTrade: async () => ({ ok: true }) } };
  const oneSided = { istest: { mayTrade: async () => ({ ok: false, why: 'they are in another sandbox' }) } };
  const adopted = (answer) => ({ 'remote-party': { adopt: async () => answer } });
  const addressRefused = (status, code, message) => adopted({ error: { status, code, message } });
  const FAR_PARTY = { party: { identity_id: OTHER, bridge_id: 'CBREMOTE01', display_name: 'Far shop', address: 'CBREMOTE01@far.example', installation_key: 'far', domain: 'far.example' }, created: true };
  const partyPatch = (answer) => ({ 'party-fields': { patch: answer } });
  const removal = (answer) => ({ crm: { removeParty: answer } });
  const view = (available) => ({ 'catalogue-view': { buildPublicView: async () => ({ available, schema: null, fields: [], items: [], groups: [], finishes: [] }) }, 'remote-catalogue': { forSupplier: async () => null } });
  const REMOTE_VIEW = { supplier: { identity_id: OTHER, display_name: 'Other shop', bridge_id: 'CBOTHER001', currency_code: 'AUD', business_status: 'open' }, schema: null, fields: [], items: [{ item_id: 'i1', name: 'Basmati rice 5 kg', price: 12.5 }], groups: [], finishes: [], shop: { currency_code: 'AUD' }, remote: { ok: true, installation_key: 'far', why: null } };
  return [
    /* ── the list ── */
    X('suppliers-listed', LIST, 200, { setup: withRows(listed) }),
    X('suppliers-listed-one-sided', LIST, 200, { setup: withRows(answering(/FROM supplier_list sl\s+JOIN identities i ON i\.identity_id = sl\.supplier_entity_id\s+WHERE sl\.owner_entity_id = \$1\s+ORDER BY/, [Object.assign({}, listRow, { on_rail: false })])) }),
    X('suppliers-listed-remote', LIST, 200, { setup: withRows(answering(/FROM supplier_list sl\s+JOIN identities i ON i\.identity_id = sl\.supplier_entity_id\s+WHERE sl\.owner_entity_id = \$1\s+ORDER BY/, [Object.assign({}, listRow, { installation_key: 'far', installation_label: 'Far side', country: null, supplier_money: null })])) }),
    N('suppliers-list-doubled-page', LIST, 422, { url: at('/suppliers?page=1&page=2') }),
    /* ── adding one ── */
    X('add-nothing-given', ADD, 400, { body: {} }),
    X('add-minted-handle', ADD, 404, { body: { supplier_bridge_id: '~acme.corner-hardware' } }),
    X('add-bad-supply-kind', ADD, 400, { body: { name: 'Corner Hardware', supply_kind: 'gift' } }),
    N('add-unknown-key', ADD, 400, { body: { name: 'Corner Hardware', colour: 'red' } }),
    X('add-local-name', ADD, 200, { body: { name: 'Corner Hardware', supply_kind: 'own_use', preferred: 'true' }, patch: minted }),
    X('add-local-name-refused', ADD, 400, { body: { name: 'x@y.z' }, patch: mintRefused(400, { error: 'Invalid', message: 'That looks like an email. Add them as a ChitBridge business, or type their name instead.' }) }),
    X('add-local-id-busy', ADD, 409, { body: { name: 'Corner Hardware' }, patch: mintRefused(409, { error: 'Busy', message: 'Could not allocate an ID for Corner Hardware. Try once more.' }) }),
    X('add-local-name-twice', ADD, 409, { body: { name: 'Corner Hardware' }, setup: withRows(alreadyListed), patch: minted }),
    X('add-local-name-fails', ADD, 500, { body: { name: 'Corner Hardware' }, setup: failing, patch: minted }),
    X('add-unknown-business', ADD, 404, { body: { supplier_bridge_id: 'nobody-here' } }),
    X('add-yourself', ADD, 400, { body: { supplier_bridge_id: 'me' }, setup: withRows(business(OWNER.identity_id)) }),
    X('add-business-twice', ADD, 409, { body: { supplier_bridge_id: 'other-shop' }, setup: withRows(firstOf(business(OTHER), alreadyListed)) }),
    X('add-business', ADD, 200, { body: { supplier_bridge_id: 'other-shop', category: 'Grocer', nickname: 'Rice man', notes: 'Pays late' }, setup: withRows(business(OTHER)), patch: trades }),
    X('add-business-one-sided', ADD, 200, { body: { supplier_bridge_id: 'other-shop' }, setup: withRows(business(OTHER)), patch: oneSided }),
    X('add-business-fails', ADD, 500, { body: { supplier_bridge_id: 'other-shop' }, setup: failing }),
    X('add-by-address-unreadable', ADD, 400, { body: { supplier_bridge_id: 'https://far.example/@@' }, patch: addressRefused(400, 'CTP_ADDRESS_INVALID', 'That is not an address we can read: no bridge id in it. Type it as id@domain, or paste the business’s link.') }),
    X('add-by-address-not-dealt-with', ADD, 404, { body: { supplier_bridge_id: 'CBREMOTE01@nowhere.example' }, patch: addressRefused(404, 'CTP_ADDRESS_UNKNOWN', 'We do not deal with nowhere.example, so nobody there can be added. no such installation.') }),
    X('add-by-address-sells-only-there', ADD, 409, { body: { supplier_bridge_id: 'CBREMOTE01@far.example' }, patch: addressRefused(409, 'SUPPLIER_SELLS_ONLY_HERE', 'Far shop sells only on their own ChitBridge, so they cannot be your supplier from here.') }),
    X('add-by-address-unreachable', ADD, 502, { body: { supplier_bridge_id: 'CBREMOTE01@far.example' }, patch: addressRefused(502, 'CTP_UNREACHABLE', 'Could not ask far.example: timed out. Nothing was added; try again when they are reachable.') }),
    X('add-by-address', ADD, 200, { body: { supplier_bridge_id: 'CBREMOTE01@far.example' }, setup: withRows(business(OTHER)), patch: Object.assign(adopted(FAR_PARTY), trades) }),
    X('add-by-address-fails', ADD, 500, { body: { supplier_bridge_id: 'CBREMOTE01@far.example' }, patch: { 'remote-party': { adopt: throwing(new Error(SECRET)) } } }),
    /* ── availability ── */
    X('availability-too-short', AVAIL, 200, { url: at('/suppliers/availability?q=a') }),
    X('availability-asked', AVAIL, 200, { url: at('/suppliers/availability?q=rice') }),
    X('availability-fails', AVAIL, 500, { url: at('/suppliers/availability?q=rice'), setup: failing }),
    N('availability-doubled-q', AVAIL, 422, { url: at('/suppliers/availability?q=rice&q=tea') }),
    /* ── changing one ── */
    X('patch-nothing-to-update', PATCH, 400, { body: {} }),
    X('patch-bad-supply-kind', PATCH, 400, { body: { supply_kind: 'gift' } }),
    N('patch-unknown-key', PATCH, 400, { body: { nickname: 'Rice man', colour: 'red' } }),
    X('patch-nickname', PATCH, 200, { body: { nickname: 'Rice man', category: 'Grocer', notes: null, preferred: true, supply_kind: 'own_use' }, setup: withRows(patched) }),
    X('patch-row-not-mine', PATCH, 404, { body: { nickname: 'Rice man' } }),
    X('patch-rename-row-not-found', PATCH, 404, { body: { display_name: 'Corner Hardware & Sons' } }),
    X('patch-rename-their-own-name', PATCH, 403, { body: { display_name: 'Corner Hardware & Sons' }, setup: withRows(listRowOf('other-shop')) }),
    X('patch-rename-minted', PATCH, 200, { body: { display_name: 'Corner Hardware & Sons' }, setup: withRows(listRowOf('~testshop.corner-hardware')) }),
    X('patch-rename-duplicate', PATCH, 409, { body: { display_name: 'Corner Hardware & Sons' }, setup: withRows(firstOf(listRowOf('~testshop.corner-hardware'), raising(/UPDATE identities SET display_name/, '23505'))) }),
    X('patch-party-saved', PATCH, 200, { body: { legal_name: 'Other Shop Pvt Ltd', credit_days: 30 }, patch: partyPatch(async () => ({ changed: ['legal_name', 'credit_days'] })) }),
    X('patch-party-duplicate-tax-id', PATCH, 409, { body: { tax_ids: { gstin: '27AAAAA0000A1Z5' } }, patch: partyPatch(throwing(Object.assign(refusal('Another party already has this tax id.', 409, 'DUPLICATE_PARTY'), { holder: 'Rice man', scheme: 'gstin' }))) }),
    X('patch-party-duplicate-by-index', PATCH, 409, { body: { tax_ids: { gstin: '27AAAAA0000A1Z5' } }, patch: partyPatch(throwing(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }))) }),
    X('patch-party-not-found', PATCH, 404, { body: { legal_name: 'Other Shop Pvt Ltd' }, patch: partyPatch(throwing(refusal('Not your party.', 404))) }),
    X('patch-party-conflict', PATCH, 409, { body: { merged_into: OTHER }, patch: partyPatch(throwing(refusal('Already merged.', 409))) }),
    X('patch-party-bad', PATCH, 400, { body: { credit_days: 'thirty' }, patch: partyPatch(throwing(refusal('Credit days must be a number.', 400))) }),
    X('patch-fails', PATCH, 500, { body: { nickname: 'Rice man' }, setup: failing }),
    /* ── removing one ── */
    X('remove-by-staff', REMOVE, 403, { setup: { who: STAFF } }),
    X('remove-row-not-mine', REMOVE, 404, {}),
    X('remove-supplier', REMOVE, 200, { setup: withRows(held), patch: removal(async () => undefined) }),
    X('remove-with-open-dues', REMOVE, 409, { setup: withRows(held), patch: removal(throwing(refusal('There are open dues on this party.', 409, 'HAS_DUES'))) }),
    X('remove-not-your-party', REMOVE, 404, { setup: withRows(held), patch: removal(throwing(refusal('Not your party.', 404, 'NOT_FOUND'))) }),
    X('remove-fails', REMOVE, 500, { setup: withRows(held), patch: removal(throwing(new Error(SECRET))) }),
    /* ── a supplier's catalogue ── */
    X('catalogue-nobody-there', CATALOGUE, 200, {}),
    X('catalogue-local-supplier', CATALOGUE, 200, { setup: withRows(supplierRow), patch: view(true) }),
    X('catalogue-nothing-published', CATALOGUE, 200, { setup: withRows(supplierRow), patch: view(false) }),
    X('catalogue-remote-supplier', CATALOGUE, 200, { setup: withRows(supplierRow), patch: { 'remote-catalogue': { forSupplier: async () => REMOTE_VIEW } } }),
    X('catalogue-fails', CATALOGUE, 500, { setup: failing })
  ];
}

module.exports = { extras, OTHER, LIST_ID, SECRET };
