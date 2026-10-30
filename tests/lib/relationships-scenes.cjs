/**
 * relationships-scenes.cjs — the named scenarios of tests/api-problem-relationships.test.cjs: an answer the generic worlds cannot reach (a refusal inside a handler, a success to prove byte for byte).
 *
 * OWNS      the extras: one scenario per answer of the 14 routes of routes/relationships.js (the supplier list, the customer list, named groups, rewards, the scorecard), each with
 *           the stand-in rows it needs (answered by the shape of the statement, so the same facts meet the old code and the new), and the stand-in that holds ONE list row for ONE shop
 *           (ownedRow), which the foreign-id world plants.
 * CALLED BY tests/api-problem-relationships.test.cjs. Not a test itself.
 * FLOW      extras(tools) → [{ id, route, expect, setup: { sqlRows, who, db }, patch, body, url, after }] → the harness runs each one against the real route
 * CARD      11-crm-and-marketing/relationships-routes
 */
'use strict';

const REL = '/api/relationships';
const SHOP = '11111111-1111-4111-8111-111111111111';
const STRANGER_ID = '66666666-6666-4666-8666-666666666666';
const LIST_S = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; /* a supplier_list row of the shop */
const LIST_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; /* a customer_list row of the shop */
const SUPP = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; /* the supplier's identity */
const CUSTP = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'; /* the customer's identity */
const BIZ = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; /* a business found by its handle */
const NEWP = 'ffffffff-ffff-4fff-8fff-ffffffffffff'; /* a party just minted */

/** the tools a scene is built from: the harness's own stand-ins */
function extras(tools) {
  const { STAFF, SECRET_SQL, answering, raising, firstOf } = tools;
  const X = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  /** a scenario for an answer the sweep ADDS (the schema's refusal): it is not frozen, since the old code answered it otherwise */
  const N = (id, route, expect, more) => X(id, route, expect, Object.assign({ after: true }, more));
  const failing = { db: 'fail' };
  const at = (tail) => REL + tail;
  const row = (pattern, one) => answering(pattern, [one]);
  const sqlState = (code, message) => () => {
    throw Object.assign(new Error(message || 'pg ' + code), { code });
  };
  const when = (pattern, run) => (sql, params) => (pattern.test(sql) ? run(sql, params) : null);
  const boom = () => {
    throw new Error(SECRET_SQL);
  };

  /* the rows the stand-in database answers, by the shape of the statement */
  const SIGNED = { user_id: 'shop-a', bridge_id: 'AAAA2222' };
  const ownHandle = row(/SELECT user_id, bridge_id FROM identities WHERE identity_id/, SIGNED);
  const minted = (name, kind) => row(/INSERT INTO identities/, { identity_id: NEWP, bridge_id: 'LLLL0001', display_name: name, user_id: '~shop-a.' + kind + '-0001' });
  const found = row(/WHERE \(bridge_id = \$1 OR LOWER\(user_id\)/, { identity_id: BIZ, display_name: 'Shop B', user_id: 'shop-b', bridge_id: 'BBBB3333' });
  const foundSelf = row(/WHERE \(bridge_id = \$1 OR LOWER\(user_id\)/, { identity_id: SHOP, display_name: 'Shop A', user_id: 'shop-a', bridge_id: 'AAAA2222' });
  const onRail = row(/FROM identities i WHERE i\.identity_id = \$2/, { display_name: 'Shop B', status: 'active', user_id: 'shop-b', on_rail: true, same_world: true });
  const offRail = row(/FROM identities i WHERE i\.identity_id = \$2/, { display_name: 'Shop B', status: 'inactive', user_id: 'shop-b', on_rail: false, same_world: true });
  const alreadySupplier = row(/SELECT 1 FROM supplier_list WHERE owner_entity_id = \$1 AND supplier_entity_id = \$2/, { '?column?': 1 });
  const addedCustomer = row(/INSERT INTO customer_list/, { customer_list_id: LIST_C });
  const phoneHolder = row(/SELECT i\.identity_id, i\.display_name, i\.user_id FROM customer_list cl/, { identity_id: CUSTP, display_name: 'Chola Auto Care', user_id: '~shop-a.cus-0001' });
  const SUP_ROW = { supplier_list_id: LIST_S, category: 'tea', nickname: 'Tea man', preferred: true, notes: null, created_at: '2026-10-01T00:00:00.000Z', supply_kind: 'resale', on_rail: false, bridge_id: 'BBBB3333', user_id: '~shop-a.sup-0001', display_name: 'Corner Hardware', supplier_entity_id: SUPP, gstn: null, country: 'IN', policy_flags: {}, supplier_money: 'INR', has_catalogue: false };
  const suppliers = row(/FROM supplier_list sl\s+JOIN identities i ON i\.identity_id = sl\.supplier_entity_id\s+WHERE sl\.owner_entity_id = \$1\s+ORDER BY/, SUP_ROW);
  const CUST_ROW = { customer_list_id: LIST_C, customer_type: 'entity', added_via: 'manual', txn_count: 2, last_txn_at: '2026-10-02T00:00:00.000Z', groups: ['dealers'], customer_identity_id: CUSTP, bridge_id: 'CCCC4444', user_id: 'chola', display_name: 'Chola Auto Care', email: null, phone: null, otp_contact: null, customer_since: '2026-09-01T00:00:00.000Z', identity_type: 'entity', owner_scope: null, segment: 'regular', on_rail: true };
  const customers = row(/SELECT cl\.customer_list_id/, CUST_ROW);
  /* a list row of the shop: the statements that name the row and the owner answer it only when the owner is the one that holds it */
  const listRow = { supplier_list_id: LIST_S, customer_list_id: LIST_C, supplier_entity_id: SUPP, customer_identity_id: CUSTP, owner_entity_id: SHOP, identity_id: SUPP, user_id: '~shop-a.sup-0001', groups: [], legal_name: null, nickname: null, credit_days: null, credit_limit: null, credit_limit_minor: null, state_code: null, merged_into: null };
  const heldBy = (owner, id) => ownedRow(owner, id, listRow);
  const withPartyColumns = (name) => when(new RegExp('SELECT \\* FROM ' + name), () => ({ rows: [listRow], rowCount: 1 }));
  const withoutPartyColumns = (name) => when(new RegExp('SELECT \\* FROM ' + name), () => ({ rows: [{ supplier_list_id: LIST_S, customer_list_id: LIST_C, supplier_entity_id: SUPP, customer_identity_id: CUSTP }], rowCount: 1 }));
  const clash = row(/SELECT t\.party_id, i\.display_name FROM party_tax_id t/, { party_id: BIZ, display_name: 'Shop B' });
  const longName = 'x'.repeat(130);

  /* ── POST /suppliers ── */
  const addSupplier = [
    X('supplier-needs-who', 'POST ' + at('/suppliers'), 400, { body: {} }),
    X('supplier-chain-refused', 'POST ' + at('/suppliers'), 400, { body: { name: 'Corner', supply_kind: 'bad', preferred: 'maybe', nickname: longName } }),
    X('supplier-minted-handle', 'POST ' + at('/suppliers'), 404, { body: { supplier_bridge_id: '~acme.sup-0001' } }),
    X('supplier-local-added', 'POST ' + at('/suppliers'), 200, { body: { name: 'Corner Hardware', category: 'tools', nickname: 'Corner', notes: 'cash', preferred: true, supply_kind: 'own_use' }, setup: { sqlRows: firstOf(ownHandle, minted('Corner Hardware', 'sup')) } }),
    X('supplier-local-added-plain', 'POST ' + at('/suppliers'), 200, { body: { name: 'Plain Traders' }, setup: { sqlRows: firstOf(ownHandle, minted('Plain Traders', 'sup')) } }),
    X('supplier-local-already-there', 'POST ' + at('/suppliers'), 409, { body: { name: 'Corner Hardware' }, setup: { sqlRows: firstOf(ownHandle, minted('Corner Hardware', 'sup'), alreadySupplier) } }),
    X('supplier-local-name-is-an-email', 'POST ' + at('/suppliers'), 400, { body: { name: 'corner@shop.com' } }),
    X('supplier-local-id-busy', 'POST ' + at('/suppliers'), 409, { body: { name: 'Corner Hardware' }, setup: { sqlRows: firstOf(ownHandle, raising(/INSERT INTO identities/, '23505')) } }),
    X('supplier-local-has-no-handle', 'POST ' + at('/suppliers'), 400, { body: { name: 'Corner Hardware' }, setup: { sqlRows: firstOf(row(/SELECT user_id, bridge_id FROM identities WHERE identity_id/, { user_id: null, bridge_id: null })) } }),
    X('supplier-local-insert-fails', 'POST ' + at('/suppliers'), 500, { body: { name: 'Corner Hardware' }, setup: { sqlRows: firstOf(ownHandle, minted('Corner Hardware', 'sup'), raising(/INSERT INTO supplier_list/, 'XX000')) } }),
    X('supplier-handle-unknown', 'POST ' + at('/suppliers'), 404, { body: { supplier_bridge_id: 'ghost' } }),
    X('supplier-handle-is-self', 'POST ' + at('/suppliers'), 400, { body: { supplier_bridge_id: 'shop-a' }, setup: { sqlRows: foundSelf } }),
    X('supplier-handle-already-there', 'POST ' + at('/suppliers'), 409, { body: { supplier_bridge_id: 'shop-b' }, setup: { sqlRows: firstOf(found, alreadySupplier) } }),
    X('supplier-handle-added-on-rail', 'POST ' + at('/suppliers'), 200, { body: { supplier_bridge_id: 'shop-b', category: 'tea' }, setup: { sqlRows: firstOf(found, onRail) } }),
    X('supplier-handle-added-one-sided', 'POST ' + at('/suppliers'), 200, { body: { supplier_bridge_id: 'shop-b' }, setup: { sqlRows: firstOf(found, offRail) } }),
    X('supplier-handle-added-unchecked', 'POST ' + at('/suppliers'), 200, { body: { supplier_bridge_id: 'shop-b' }, setup: { sqlRows: firstOf(found, when(/FROM identities i WHERE i\.identity_id = \$2/, sqlState('XX000', SECRET_SQL))) } }),
    X('supplier-handle-insert-fails', 'POST ' + at('/suppliers'), 500, { body: { supplier_bridge_id: 'shop-b' }, setup: { sqlRows: firstOf(found, raising(/INSERT INTO supplier_list/, 'XX000')) } }),
    X('supplier-handle-lookup-fails', 'POST ' + at('/suppliers'), 500, { body: { supplier_bridge_id: 'shop-b' }, setup: failing }),
    N('supplier-body-a-list', 'POST ' + at('/suppliers'), 400, { body: [] })
  ];

  /* ── GET /suppliers ── */
  const listSuppliers = [
    X('suppliers-listed', 'GET ' + at('/suppliers'), 200, { setup: { sqlRows: suppliers } }),
    X('suppliers-listed-on-rail', 'GET ' + at('/suppliers'), 200, { setup: { sqlRows: row(/FROM supplier_list sl\s+JOIN identities i/, Object.assign({}, SUP_ROW, { on_rail: true, has_catalogue: true })) } }),
    X('suppliers-listed-a-page', 'GET ' + at('/suppliers'), 200, { url: at('/suppliers?page=1&limit=1'), setup: { sqlRows: suppliers } }),
    X('suppliers-none', 'GET ' + at('/suppliers'), 200, {}),
    X('suppliers-db-fails', 'GET ' + at('/suppliers'), 500, { setup: failing }),
    N('suppliers-page-asked-twice', 'GET ' + at('/suppliers'), 400, { url: at('/suppliers?page=1&page=2') })
  ];

  /* ── PATCH /suppliers/:id ── */
  const sUrl = at('/suppliers/' + LIST_S);
  const patchSupplier = [
    X('supplier-patch-chain-refused', 'PATCH ' + at('/suppliers/:id'), 400, { url: sUrl, body: { supply_kind: 'bad', preferred: 'maybe' } }),
    X('supplier-patch-nothing', 'PATCH ' + at('/suppliers/:id'), 400, { url: sUrl, body: {} }),
    X('supplier-patch-unknown', 'PATCH ' + at('/suppliers/:id'), 404, { url: sUrl, body: { nickname: 'Tea man' } }),
    X('supplier-patch-saved', 'PATCH ' + at('/suppliers/:id'), 200, { url: sUrl, body: { nickname: 'Tea man', category: 'tea', notes: 'cash', preferred: true, supply_kind: 'own_use' }, setup: { sqlRows: heldBy(SHOP, LIST_S) } }),
    X('supplier-patch-saved-as-text-flag', 'PATCH ' + at('/suppliers/:id'), 200, { url: sUrl, body: { preferred: 'true', supply_kind: 'resale', nickname: null }, setup: { sqlRows: heldBy(SHOP, LIST_S) } }),
    X('supplier-rename-unknown', 'PATCH ' + at('/suppliers/:id'), 404, { url: sUrl, body: { display_name: 'Corner Hardware & Sons' } }),
    X('supplier-rename-not-yours', 'PATCH ' + at('/suppliers/:id'), 403, { url: sUrl, body: { display_name: 'Acme' }, setup: { sqlRows: row(/SELECT i\.identity_id, i\.user_id FROM supplier_list sl/, { identity_id: SUPP, user_id: 'acme' }) } }),
    X('supplier-rename-clash', 'PATCH ' + at('/suppliers/:id'), 409, { url: sUrl, body: { display_name: 'Corner Hardware' }, setup: { sqlRows: firstOf(heldBy(SHOP, LIST_S), raising(/UPDATE identities SET display_name/, '23505')) } }),
    X('supplier-rename-saved', 'PATCH ' + at('/suppliers/:id'), 200, { url: sUrl, body: { display_name: 'Corner  Hardware & Sons' }, setup: { sqlRows: heldBy(SHOP, LIST_S) } }),
    X('supplier-rename-and-note', 'PATCH ' + at('/suppliers/:id'), 200, { url: sUrl, body: { display_name: 'Corner Hardware & Sons', notes: 'cash' }, setup: { sqlRows: heldBy(SHOP, LIST_S) } }),
    X('supplier-rename-fails', 'PATCH ' + at('/suppliers/:id'), 500, { url: sUrl, body: { display_name: 'Corner Hardware' }, setup: { sqlRows: firstOf(heldBy(SHOP, LIST_S), sqlState('XX000', SECRET_SQL)) } }),
    X('supplier-party-credit-days-bad', 'PATCH ' + at('/suppliers/:id'), 400, { url: sUrl, body: { credit_days: 'abc' } }),
    X('supplier-party-unknown-tax-kind', 'PATCH ' + at('/suppliers/:id'), 400, { url: sUrl, body: { tax_ids: [{ scheme: 'XYZ', value: '1' }] } }),
    X('supplier-party-not-found', 'PATCH ' + at('/suppliers/:id'), 404, { url: sUrl, body: { legal_name: 'Corner Hardware Pvt' } }),
    X('supplier-party-not-migrated', 'PATCH ' + at('/suppliers/:id'), 409, { url: sUrl, body: { legal_name: 'Corner Hardware Pvt' }, setup: { sqlRows: withoutPartyColumns('supplier_list') } }),
    X('supplier-party-merged-into-itself', 'PATCH ' + at('/suppliers/:id'), 400, { url: sUrl, body: { merged_into: SUPP }, setup: { sqlRows: withPartyColumns('supplier_list') } }),
    X('supplier-party-tax-id-held', 'PATCH ' + at('/suppliers/:id'), 409, { url: sUrl, body: { tax_ids: [{ scheme: 'PAN', value: 'ABCDE1234F' }] }, setup: { sqlRows: firstOf(withPartyColumns('supplier_list'), clash) } }),
    X('supplier-party-tax-id-race', 'PATCH ' + at('/suppliers/:id'), 409, { url: sUrl, body: { tax_ids: [{ scheme: 'PAN', value: 'ABCDE1234F' }] }, setup: { sqlRows: firstOf(withPartyColumns('supplier_list'), raising(/INSERT INTO party_tax_id/, '23505')) } }),
    X('supplier-party-saved', 'PATCH ' + at('/suppliers/:id'), 200, { url: sUrl, body: { legal_name: 'Corner Hardware Pvt', credit_days: 30, state_code: '29' }, setup: { sqlRows: withPartyColumns('supplier_list') } }),
    X('supplier-party-saved-with-a-note', 'PATCH ' + at('/suppliers/:id'), 200, { url: sUrl, body: { legal_name: 'Corner Hardware Pvt', notes: 'cash' }, setup: { sqlRows: firstOf(withPartyColumns('supplier_list'), heldBy(SHOP, LIST_S)) } }),
    X('supplier-party-fails', 'PATCH ' + at('/suppliers/:id'), 500, { url: sUrl, body: { legal_name: 'Corner Hardware Pvt' }, setup: failing }),
    /* the party library throws a database sentence with a code of its own: only the fixed words may reach the caller */
    X('supplier-party-library-throws-the-database', 'PATCH ' + at('/suppliers/:id'), 500, { url: sUrl, body: { legal_name: 'Corner Hardware Pvt' }, patch: { partyFields: { patch: async () => boom() } } }),
    X('supplier-party-library-says-duplicate', 'PATCH ' + at('/suppliers/:id'), 409, { url: sUrl, body: { legal_name: 'Corner Hardware Pvt' }, patch: { partyFields: { patch: async () => { throw Object.assign(new Error(SECRET_SQL), { code: '23505' }); } } } }),
    N('supplier-patch-body-a-list', 'PATCH ' + at('/suppliers/:id'), 400, { url: sUrl, body: [] })
  ];

  /* ── DELETE /suppliers/:id ── */
  const refusal = (message, status, code) => async () => {
    throw Object.assign(new Error(message), { status }, code ? { code } : {});
  };
  const removeSupplier = [
    X('supplier-remove-staff', 'DELETE ' + at('/suppliers/:id'), 403, { url: sUrl, setup: { who: STAFF } }),
    X('supplier-remove-by-key', 'DELETE ' + at('/suppliers/:id'), 403, { url: sUrl, setup: { asKey: true } }),
    X('supplier-remove-unknown', 'DELETE ' + at('/suppliers/:id'), 404, { url: sUrl }),
    X('supplier-removed', 'DELETE ' + at('/suppliers/:id'), 200, { url: sUrl, setup: { sqlRows: heldBy(SHOP, LIST_S) }, patch: { crm: { removeParty: async () => ({ party_id: SUPP }) } } }),
    X('supplier-remove-has-dues', 'DELETE ' + at('/suppliers/:id'), 409, { url: sUrl, setup: { sqlRows: heldBy(SHOP, LIST_S) }, patch: { crm: { removeParty: refusal('There are open dues on this party.', 409, 'HAS_DUES') } } }),
    X('supplier-remove-not-your-party', 'DELETE ' + at('/suppliers/:id'), 404, { url: sUrl, setup: { sqlRows: heldBy(SHOP, LIST_S) }, patch: { crm: { removeParty: refusal('Not your party.', 404, 'NOT_FOUND') } } }),
    X('supplier-remove-refused-without-a-code', 'DELETE ' + at('/suppliers/:id'), 400, { url: sUrl, setup: { sqlRows: heldBy(SHOP, LIST_S) }, patch: { crm: { removeParty: refusal('Not allowed.', 400) } } }),
    X('supplier-remove-not-migrated', 'DELETE ' + at('/suppliers/:id'), 500, { url: sUrl, setup: { sqlRows: heldBy(SHOP, LIST_S) }, patch: { crm: { removeParty: refusal('CRM needs migration b276 (migrations/b276_crm_party.sql) — Athi runs it in the Supabase SQL editor.', 503, 'CRM_NOT_MIGRATED') } } }),
    X('supplier-remove-library-throws-the-database', 'DELETE ' + at('/suppliers/:id'), 500, { url: sUrl, setup: { sqlRows: heldBy(SHOP, LIST_S) }, patch: { crm: { removeParty: async () => boom() } } }),
    X('supplier-remove-lookup-fails', 'DELETE ' + at('/suppliers/:id'), 500, { url: sUrl, setup: failing })
  ];

  /* ── GET /suppliers/availability ── */
  const mine = (over) => row(/FROM supplier_list sl\s+JOIN identities i ON i\.identity_id = sl\.supplier_entity_id\s+WHERE sl\.owner_entity_id = \$1\s+AND COALESCE/, Object.assign({}, SUP_ROW, { currency_code: 'INR', business_status: 'open' }, over));
  const view = (body) => ({ catalogueView: { buildPublicView: async () => body } });
  const availability = [
    X('availability-too-short', 'GET ' + at('/suppliers/availability'), 200, { url: at('/suppliers/availability?q=t') }),
    X('availability-nothing-asked', 'GET ' + at('/suppliers/availability'), 200, {}),
    X('availability-none-listed', 'GET ' + at('/suppliers/availability'), 200, { url: at('/suppliers/availability?q=tea') }),
    X('availability-no-catalogue', 'GET ' + at('/suppliers/availability'), 200, { url: at('/suppliers/availability?q=tea'), setup: { sqlRows: mine({}) } }),
    X('availability-has', 'GET ' + at('/suppliers/availability'), 200, { url: at('/suppliers/availability?q=tea'), setup: { sqlRows: mine({ has_catalogue: true }) }, patch: view({ available: true, shop: { currency_code: 'INR' }, items: [{ item_id: 'i1', item_data: { name: 'Green Tea', unit: 'kg', price: 120, code: 'GT' } }, { item_id: 'i2', item_data: { name: 'Black coffee' } }] }) }),
    X('availability-miss', 'GET ' + at('/suppliers/availability'), 200, { url: at('/suppliers/availability?q=tea'), setup: { sqlRows: mine({ has_catalogue: true }) }, patch: view({ available: true, items: [{ item_id: 'i2', item_data: { name: 'Black coffee' } }] }) }),
    X('availability-shop-not-showing', 'GET ' + at('/suppliers/availability'), 200, { url: at('/suppliers/availability?q=tea'), setup: { sqlRows: mine({ has_catalogue: true }) }, patch: view({ available: false }) }),
    /* one supplier's catalogue cannot be read: its row says so with the one safe sentence, never the cause */
    X('availability-one-unreadable', 'GET ' + at('/suppliers/availability'), 200, { url: at('/suppliers/availability?q=tea'), setup: { sqlRows: mine({ has_catalogue: true }) }, patch: { catalogueView: { buildPublicView: async () => boom() } } }),
    X('availability-a-page', 'GET ' + at('/suppliers/availability'), 200, { url: at('/suppliers/availability?q=tea&page=1&limit=1'), setup: { sqlRows: mine({}) } }),
    X('availability-db-fails', 'GET ' + at('/suppliers/availability'), 500, { url: at('/suppliers/availability?q=tea'), setup: failing }),
    N('availability-asked-twice', 'GET ' + at('/suppliers/availability'), 400, { url: at('/suppliers/availability?q=tea&q=coffee') })
  ];

  /* ── GET /suppliers/:supplier_entity_id/catalogue ── */
  const cUrl = at('/suppliers/' + SUPP + '/catalogue');
  const identityRow = row(/FROM identities WHERE identity_id = \$1 AND identity_type = 'entity'/, { identity_id: SUPP, display_name: 'Corner Hardware', bridge_id: 'BBBB3333', currency_code: 'INR', business_status: 'open' });
  const onMyList = row(/FROM supplier_list WHERE owner_entity_id = [$]1 AND supplier_entity_id = [$]2/, { '?column?': 1 });
  const catalogue = [
    N('catalogue-unknown-supplier', 'GET ' + at('/suppliers/:supplier_entity_id/catalogue'), 404, { url: cUrl }),
    /* SEC-91: a business that is not on this shop's supplier list is refused like an unknown id; the supplier list is asked before identities, so no name is read */
    N('catalogue-stranger-refused', 'GET ' + at('/suppliers/:supplier_entity_id/catalogue'), 404, { url: cUrl, setup: { sqlRows: firstOf(identityRow) } }),
    X('catalogue-not-showing', 'GET ' + at('/suppliers/:supplier_entity_id/catalogue'), 200, { url: cUrl, setup: { sqlRows: firstOf(onMyList, identityRow) }, patch: view({ available: false }) }),
    X('catalogue-read', 'GET ' + at('/suppliers/:supplier_entity_id/catalogue'), 200, { url: cUrl, setup: { sqlRows: firstOf(onMyList, identityRow) }, patch: view({ available: true, schema: { fields: [] }, fields: [], items: [{ item_id: 'i1' }], groups: [], finishes: [], offers: [], categories: [] }) }),
    X('catalogue-own', 'GET ' + at('/suppliers/:supplier_entity_id/catalogue'), 200, { url: at('/suppliers/' + SHOP + '/catalogue'), setup: { sqlRows: row(/FROM identities WHERE identity_id = \$1 AND identity_type = 'entity'/, { identity_id: SHOP, display_name: 'Shop A', bridge_id: 'AAAA2222', currency_code: 'INR', business_status: 'open' }) }, patch: view({ available: true, items: [] }) }),
    X('catalogue-view-fails', 'GET ' + at('/suppliers/:supplier_entity_id/catalogue'), 500, { url: cUrl, setup: { sqlRows: firstOf(onMyList, identityRow) }, patch: { catalogueView: { buildPublicView: async () => boom() } } }),
    X('catalogue-lookup-fails', 'GET ' + at('/suppliers/:supplier_entity_id/catalogue'), 500, { url: cUrl, setup: failing })
  ];

  /* ── GET /customers/groups · GET /customers ── */
  const groups = [
    X('groups-named', 'GET ' + at('/customers/groups'), 200, { patch: { customerGroups: { namesOf: async () => [{ name: 'dealers', count: 2 }] } } }),
    X('groups-none', 'GET ' + at('/customers/groups'), 200, {}),
    X('groups-fail', 'GET ' + at('/customers/groups'), 500, { patch: { customerGroups: { namesOf: async () => boom() } } })
  ];
  const customerList = [
    X('customers-listed', 'GET ' + at('/customers'), 200, { setup: { sqlRows: customers } }),
    X('customers-listed-by-segment', 'GET ' + at('/customers'), 200, { url: at('/customers?segment=regular&limit=1'), setup: { sqlRows: customers } }),
    X('customers-listed-by-another-segment', 'GET ' + at('/customers'), 200, { url: at('/customers?segment=inactive'), setup: { sqlRows: customers } }),
    X('customers-none', 'GET ' + at('/customers'), 200, {}),
    X('customers-groups-column-missing', 'GET ' + at('/customers'), 200, { setup: { sqlRows: firstOf(when(/cl\.groups,/, sqlState('42703', 'column "groups" does not exist')), customers) } }),
    X('customers-ledger-table-missing', 'GET ' + at('/customers'), 200, { setup: { sqlRows: firstOf(when(/party_item/, sqlState('42P01', 'relation "party_item" does not exist')), customers) } }),
    X('customers-both-missing', 'GET ' + at('/customers'), 200, { setup: { sqlRows: firstOf(when(/cl\.groups,/, sqlState('42703', 'column "groups" does not exist')), when(/party_item/, sqlState('42P01', 'relation "party_item" does not exist')), customers) } }),
    X('customers-other-state', 'GET ' + at('/customers'), 500, { setup: { sqlRows: sqlState('XX000', SECRET_SQL) } }),
    X('customers-db-fails', 'GET ' + at('/customers'), 500, { setup: failing }),
    N('customers-segment-asked-twice', 'GET ' + at('/customers'), 400, { url: at('/customers?segment=new&segment=regular') })
  ];

  /* ── GET /customers/:id/rewards ── */
  const rUrl = at('/customers/' + CUSTP + '/rewards');
  const programme = { name: 'Chola points', expires_months: 12 };
  const balance = { programme, points: 120, worth: 120, negative: false, entries: [{ points: 120, why: 'bill' }], expired: [{ points: -5 }] };
  const rewards = [
    X('rewards-no-programme', 'GET ' + at('/customers/:id/rewards'), 200, { url: rUrl, patch: { rewardStore: { balance: async () => ({ programme: null, points: 0, worth: 0, entries: [], expired: [], negative: false }) } } }),
    X('rewards-held', 'GET ' + at('/customers/:id/rewards'), 200, { url: rUrl, patch: { rewardStore: { balance: async () => balance } } }),
    X('rewards-not-switched-on', 'GET ' + at('/customers/:id/rewards'), 200, { url: rUrl, patch: { rewardStore: { balance: sqlState('42P01', 'relation "reward_ledger" does not exist') } } }),
    X('rewards-fail', 'GET ' + at('/customers/:id/rewards'), 500, { url: rUrl, patch: { rewardStore: { balance: async () => boom() } } }),
    X('rewards-db-fails', 'GET ' + at('/customers/:id/rewards'), 500, { url: rUrl, setup: failing })
  ];

  /* ── POST /customers ── */
  const localCustomer = (name) => firstOf(ownHandle, minted(name, 'cus'), addedCustomer);
  const addCustomer = [
    X('customer-needs-who', 'POST ' + at('/customers'), 400, { body: {} }),
    X('customer-minted-handle', 'POST ' + at('/customers'), 404, { body: { handle: '~acme.cus-0001' } }),
    X('customer-phone-bad', 'POST ' + at('/customers'), 400, { body: { name: 'Chola Auto Care', phone: '12' } }),
    X('customer-local-name-is-an-email', 'POST ' + at('/customers'), 400, { body: { name: 'chola@shop.com' } }),
    X('customer-local-added', 'POST ' + at('/customers'), 200, { body: { name: 'Chola Auto Care', phone: '9876543210', gstin: ' 29abcde1234f1z5 ' }, setup: { sqlRows: localCustomer('Chola Auto Care') } }),
    X('customer-local-added-by-name', 'POST ' + at('/customers'), 200, { body: { name: 'Walk In' }, setup: { sqlRows: localCustomer('Walk In') } }),
    X('customer-local-name-on-the-list', 'POST ' + at('/customers'), 409, { body: { name: 'Chola Auto Care' }, setup: { sqlRows: firstOf(ownHandle, minted('Chola Auto Care', 'cus')) } }),
    X('customer-local-phone-on-the-list', 'POST ' + at('/customers'), 409, { body: { name: 'Chola Auto Care', phone: '9876543210' }, setup: { sqlRows: phoneHolder } }),
    X('customer-local-id-busy', 'POST ' + at('/customers'), 409, { body: { name: 'Chola Auto Care' }, setup: { sqlRows: firstOf(ownHandle, raising(/INSERT INTO identities/, '23505')) } }),
    X('customer-local-insert-fails', 'POST ' + at('/customers'), 500, { body: { name: 'Chola Auto Care' }, setup: { sqlRows: firstOf(ownHandle, minted('Chola Auto Care', 'cus'), raising(/INSERT INTO customer_list/, 'XX000')) } }),
    X('customer-handle-unknown', 'POST ' + at('/customers'), 404, { body: { handle: 'ghost' } }),
    X('customer-handle-is-self', 'POST ' + at('/customers'), 400, { body: { handle: 'shop-a' }, setup: { sqlRows: foundSelf } }),
    X('customer-handle-already-there', 'POST ' + at('/customers'), 409, { body: { handle: 'shop-b' }, setup: { sqlRows: found } }),
    X('customer-handle-added-on-rail', 'POST ' + at('/customers'), 200, { body: { handle: 'shop-b' }, setup: { sqlRows: firstOf(found, addedCustomer, onRail) } }),
    X('customer-handle-added-one-sided', 'POST ' + at('/customers'), 200, { body: { handle: 'shop-b' }, setup: { sqlRows: firstOf(found, addedCustomer, offRail) } }),
    X('customer-handle-insert-fails', 'POST ' + at('/customers'), 500, { body: { handle: 'shop-b' }, setup: { sqlRows: firstOf(found, raising(/INSERT INTO customer_list/, 'XX000')) } }),
    X('customer-lookup-fails', 'POST ' + at('/customers'), 500, { body: { handle: 'shop-b' }, setup: failing }),
    N('customer-body-a-list', 'POST ' + at('/customers'), 400, { body: [] })
  ];

  /* ── POST /customers/:id/groups ── */
  const gUrl = at('/customers/' + LIST_C + '/groups');
  const setGroups = [
    X('groups-set-by-key', 'POST ' + at('/customers/:id/groups'), 403, { url: gUrl, body: { groups: ['dealers'] }, setup: { asKey: true } }),
    X('groups-set-unknown', 'POST ' + at('/customers/:id/groups'), 404, { url: gUrl, body: { groups: ['dealers'] } }),
    X('groups-set', 'POST ' + at('/customers/:id/groups'), 200, { url: gUrl, body: { groups: ['dealers', ' Wholesale  ', 'bad!name'] }, setup: { sqlRows: heldBy(SHOP, LIST_C) } }),
    X('groups-set-none-sent', 'POST ' + at('/customers/:id/groups'), 200, { url: gUrl, body: {}, setup: { sqlRows: heldBy(SHOP, LIST_C) } }),
    X('groups-set-not-migrated', 'POST ' + at('/customers/:id/groups'), 409, { url: gUrl, body: { groups: ['dealers'] }, setup: { sqlRows: sqlState('42703', 'column "groups" does not exist') } }),
    X('groups-set-fails', 'POST ' + at('/customers/:id/groups'), 500, { url: gUrl, body: { groups: ['dealers'] }, setup: failing }),
    N('groups-set-body-a-list', 'POST ' + at('/customers/:id/groups'), 400, { url: gUrl, body: [] })
  ];

  /* ── PATCH /customers/:id ── */
  const pUrl = at('/customers/' + LIST_C);
  const patchCustomer = [
    X('customer-patch-chain-refused', 'PATCH ' + at('/customers/:id'), 400, { url: pUrl, body: { segment_override: 'vip' } }),
    X('customer-patch-nothing', 'PATCH ' + at('/customers/:id'), 400, { url: pUrl, body: {} }),
    X('customer-patch-unknown', 'PATCH ' + at('/customers/:id'), 404, { url: pUrl, body: { segment_override: 'regular' } }),
    X('customer-patch-saved', 'PATCH ' + at('/customers/:id'), 200, { url: pUrl, body: { segment_override: 'high_value' }, setup: { sqlRows: heldBy(SHOP, LIST_C) } }),
    X('customer-party-credit-days-bad', 'PATCH ' + at('/customers/:id'), 400, { url: pUrl, body: { credit_days: 99999 } }),
    X('customer-party-not-found', 'PATCH ' + at('/customers/:id'), 404, { url: pUrl, body: { legal_name: 'Chola Auto Care Pvt' } }),
    X('customer-party-not-migrated', 'PATCH ' + at('/customers/:id'), 409, { url: pUrl, body: { legal_name: 'Chola Auto Care Pvt' }, setup: { sqlRows: withoutPartyColumns('customer_list') } }),
    X('customer-party-tax-id-held', 'PATCH ' + at('/customers/:id'), 409, { url: pUrl, body: { tax_ids: [{ scheme: 'PAN', value: 'ABCDE1234F' }] }, setup: { sqlRows: firstOf(withPartyColumns('customer_list'), clash) } }),
    X('customer-party-saved', 'PATCH ' + at('/customers/:id'), 200, { url: pUrl, body: { legal_name: 'Chola Auto Care Pvt', nickname: 'Chola' }, setup: { sqlRows: withPartyColumns('customer_list') } }),
    X('customer-party-and-segment', 'PATCH ' + at('/customers/:id'), 200, { url: pUrl, body: { legal_name: 'Chola Auto Care Pvt', segment_override: 'regular' }, setup: { sqlRows: firstOf(withPartyColumns('customer_list'), heldBy(SHOP, LIST_C)) } }),
    X('customer-patch-fails', 'PATCH ' + at('/customers/:id'), 500, { url: pUrl, body: { segment_override: 'regular' }, setup: failing }),
    N('customer-patch-body-a-list', 'PATCH ' + at('/customers/:id'), 400, { url: pUrl, body: [] })
  ];

  /* ── GET /scorecard · GET /scorecard/:entity_id ── */
  const sc = [
    X('scorecard-none', 'GET ' + at('/scorecard'), 200, { patch: { select: { counterparties: async () => [] } } }),
    X('scorecard-listed', 'GET ' + at('/scorecard'), 200, { url: at('/scorecard?since=2026-01-01'), patch: { select: { counterparties: async () => [{ counterparty_id: SUPP, name: 'Corner Hardware', chits: 3 }] } } }),
    X('scorecard-list-fails', 'GET ' + at('/scorecard'), 500, { patch: { select: { counterparties: async () => boom() } } }),
    X('scorecard-db-fails', 'GET ' + at('/scorecard'), 500, { setup: failing }),
    N('scorecard-since-twice', 'GET ' + at('/scorecard'), 400, { url: at('/scorecard?since=2026-01-01&since=2026-02-01') }),
    /* S35: an id this shop shares no chit with is the unknown id's 404 (before: 200 with an empty card), in the window or out of it; a real counterparty with nothing in the window keeps its empty card */
    N('scorecard-one-unknown', 'GET ' + at('/scorecard/:entity_id'), 404, { url: at('/scorecard/' + SUPP), patch: { policy: { get: async () => ({ overdue_days: 30 }) }, select: { rows: async () => [] } } }),
    N('scorecard-one-unknown-in-a-window', 'GET ' + at('/scorecard/:entity_id'), 404, { url: at('/scorecard/' + SUPP + '?since=2026-01-01'), patch: { policy: { get: async () => ({ overdue_days: 30 }) }, select: { rows: async () => [] } } }),
    X('scorecard-one-empty-window', 'GET ' + at('/scorecard/:entity_id'), 200, { url: at('/scorecard/' + SUPP + '?since=2026-01-01'), patch: { policy: { get: async () => ({ overdue_days: 30 }) }, select: { rows: async (owner, sel) => (sel.since ? [] : [{ counterparty_name: 'Corner Hardware', status: 'paid', total: 100 }]) } } }),
    X('scorecard-one', 'GET ' + at('/scorecard/:entity_id'), 200, { url: at('/scorecard/' + SUPP + '?since=2026-01-01'), patch: { policy: { get: async () => ({ overdue_days: 30 }) }, select: { rows: async () => [{ counterparty_name: 'Corner Hardware', status: 'paid', total: 100 }] } } }),
    X('scorecard-one-fails', 'GET ' + at('/scorecard/:entity_id'), 500, { url: at('/scorecard/' + SUPP), patch: { policy: { get: async () => boom() } } }),
    X('scorecard-one-rows-fail', 'GET ' + at('/scorecard/:entity_id'), 500, { url: at('/scorecard/' + SUPP), patch: { policy: { get: async () => ({}) }, select: { rows: async () => boom() } } })
  ];

  return [].concat(addSupplier, listSuppliers, patchSupplier, removeSupplier, availability, catalogue, groups, customerList, rewards, addCustomer, setGroups, patchCustomer, sc);
}

/**
 * ownedRow(owner, id, one) — a stand-in database that holds ONE list row, of one shop: a statement that names the row (`supplier_list_id = $n` or `customer_list_id = $n`) and the
 * owner (`owner_entity_id = $m`) answers the row only when both are the held ones, as RLS and `WHERE owner_entity_id = $1` would; a statement that names the row but not the owner is unscoped and answers it to anyone. Anything else answers nothing.
 */
function ownedRow(owner, id, one) {
  const bound = (sql, params, pattern) => {
    const found = pattern.exec(sql);
    return found ? params[Number(found[1]) - 1] : undefined;
  };
  return (sql, params) => {
    const rowId = bound(sql, params, /(?:supplier|customer)_list_id = \$(\d)/);
    const rowOwner = bound(sql, params, /owner_entity_id = \$(\d)/);
    if (rowId === undefined && rowOwner === undefined) return null;
    /* a statement that names the row but not the owner is unscoped: it answers the row to anyone, as the SQL itself would */
    const held = rowId === id && (rowOwner === undefined || rowOwner === owner);
    return held ? { rows: [one], rowCount: 1 } : { rows: [], rowCount: 0 };
  };
}

module.exports = { extras, ownedRow, REL, SHOP, STRANGER_ID, LIST_S, LIST_C, SUPP, CUSTP, BIZ, NEWP };
