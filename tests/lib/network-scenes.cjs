/**
 * network-scenes.cjs — the named scenarios of tests/api-problem-network.test.cjs: an answer the generic worlds cannot reach (a refusal inside a handler, a success to prove byte for byte).
 *
 * OWNS      the extras: one scenario per answer of the 23 routes of the network area (src/routes/network.js, routes/network-design.js, routes/connections.js), each with the stand-in
 *           rows it needs (tests/lib/network-memory.cjs for the tree, the edges and the handshake; plain answers for the design and the stores).
 * CALLED BY tests/api-problem-network.test.cjs. Not a test itself.
 * FLOW      extras(tools) → [{ id, route, expect, setup: { sqlRows, who, db }, patch, body, url, after }] → the harness runs each one against the real route
 * CARD      04-network/connections-and-invitations
 */
'use strict';
const { memory, A, B, C, NODE, EDGE, CONNECTION } = require('./network-memory.cjs');

const NET = '/api/network';
const DES = '/api/network-design';
const CON = '/api/connections';
const AT = '2026-10-01T00:00:00.000Z';
const ROOT_NODE = { key: 'r', name: 'Shop A', root: true, owned: true, parent_key: null, holds: [] };
const CHILD_NODE = { key: 'a', name: 'Clothing', owned: true, parent_key: 'r', holds: ['catalogue'] };
const DESIGN = { nodes: [ROOT_NODE, CHILD_NODE] };

/** the tools a scene is built from: the harness's own stand-ins and the rows of the network world */
function extras(tools) {
  const { OWNER, STAFF, SECRET_SQL, answering, raising, firstOf } = tools;
  const STRANGER = { identity_id: B, identity_type: 'entity', display_name: 'Shop B' };
  const CHILD = { identity_id: C, identity_type: 'entity', display_name: 'Shop C' };
  const X = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  /** a scenario for an answer the sweep ADDS (the schema's refusal): it is not frozen, since the old code answered it otherwise */
  const N = (id, route, expect, more) => X(id, route, expect, Object.assign({ after: true }, more));
  const world = (options, setup) => Object.assign({ sqlRows: memory(options).answer }, setup);
  const failing = { db: 'fail' };
  const at = (tail) => NET + tail;
  const edgeUrl = (verb) => at('/connections/' + EDGE + '/' + verb);
  const nodeUrl = (node, verb) => at('/entities/' + node + '/' + verb);
  const ASKED = { edge: { state: 'requested' } };
  const LIVE = { edge: { state: 'active' } };

  /* ── /api/network: the tree, the edges between businesses ── */
  const tree = [
    X('register-no-name', 'POST ' + at('/entities'), 400, { body: {} }),
    X('register-made', 'POST ' + at('/entities'), 200, { body: { name: 'Acme' }, setup: world() }),
    X('register-mint-collides', 'POST ' + at('/entities'), 500, { body: { name: 'Acme' }, setup: { sqlRows: raising(/insert into cb_entity/i, '23505') } }),
    X('register-db-fails', 'POST ' + at('/entities'), 500, { body: { name: 'Acme' }, setup: failing }),
    X('lookup-found', 'GET ' + at('/entities/lookup'), 200, { url: at('/entities/lookup?bridgeId=aaaa2222'), setup: world() }),
    X('lookup-none', 'GET ' + at('/entities/lookup'), 200, { url: at('/entities/lookup?bridgeId=NOPE'), setup: world() }),
    N('lookup-asked-twice', 'GET ' + at('/entities/lookup'), 400, { url: at('/entities/lookup?bridgeId=a&bridgeId=b'), setup: world() }),
    X('claim-unknown', 'POST ' + at('/entities/:id/claim'), 404, { url: nodeUrl(NODE.b.replace(/b$/, 'd'), 'claim'), body: {}, setup: world() }),
    X('claim-already', 'POST ' + at('/entities/:id/claim'), 409, { url: nodeUrl(NODE.a, 'claim'), body: {}, setup: world() }),
    X('claim-not-yours', 'POST ' + at('/entities/:id/claim'), 403, { url: nodeUrl(NODE.c, 'claim'), body: {}, setup: world() }),
    X('claim-made', 'POST ' + at('/entities/:id/claim'), 200, { url: nodeUrl(NODE.c, 'claim'), body: {}, setup: world({}, { who: CHILD }) }),
    X('place-found', 'GET ' + at('/place'), 200, { url: at('/place?bridgeId=CCCC4444'), setup: world({ tree: true }) }),
    X('place-a-root', 'GET ' + at('/place'), 200, { url: at('/place?bridgeId=AAAA2222'), setup: world({ tree: true }) }),
    X('place-suspended-member', 'GET ' + at('/place'), 200, { url: at('/place?bridgeId=CCCC4444'), setup: world({ tree: true, edge: { state: 'suspended' } }, { who: CHILD }) }),
    X('place-no-such-business', 'GET ' + at('/place'), 200, { url: at('/place?bridgeId=NOPE'), setup: world({ tree: true }) }),
    X('subtree-foreign', 'GET ' + at('/entities/:id/subtree'), 403, { url: nodeUrl(NODE.c, 'subtree'), setup: world({ tree: true }, { who: STRANGER }) }),
    X('subtree-own', 'GET ' + at('/entities/:id/subtree'), 200, { url: nodeUrl(NODE.c, 'subtree'), setup: world({ tree: true }) }),
    X('subtree-suspended-member', 'GET ' + at('/entities/:id/subtree'), 403, { url: nodeUrl(NODE.a, 'subtree'), setup: world({ tree: true, edge: { state: 'suspended' } }, { who: CHILD }) }),
    X('connections-foreign', 'GET ' + at('/entities/:id/connections'), 403, { url: nodeUrl(NODE.c, 'connections'), setup: world({ tree: true }, { who: STRANGER }) }),
    X('connections-own', 'GET ' + at('/entities/:id/connections'), 200, { url: nodeUrl(NODE.c, 'connections'), setup: world({ tree: true, edge: { state: 'active' } }) }),
    X('request-bad-type', 'POST ' + at('/connections'), 400, { body: { type: 'friendly' }, setup: world() }),
    X('request-parent-missing', 'POST ' + at('/connections'), 404, { body: { parentId: NODE.b.replace(/b$/, 'd'), childId: NODE.c }, setup: world() }),
    X('request-child-missing', 'POST ' + at('/connections'), 404, { body: { childHandle: 'ghost' }, setup: world() }),
    X('request-to-self', 'POST ' + at('/connections'), 400, { body: { childId: NODE.a }, setup: world() }),
    X('request-not-your-edge', 'POST ' + at('/connections'), 403, { body: { parentId: NODE.b, childId: NODE.c }, setup: world() }),
    X('request-child-has-a-parent', 'POST ' + at('/connections'), 409, { body: { childId: NODE.c }, setup: world(LIVE) }),
    X('request-already-asked', 'POST ' + at('/connections'), 409, { body: { childId: NODE.c, type: 'commercial' }, setup: world({ edge: { state: 'requested', type: 'commercial' } }) }),
    X('request-made', 'POST ' + at('/connections'), 200, { body: { childId: NODE.c }, setup: world() }),
    X('request-by-handle', 'POST ' + at('/connections'), 200, { body: { childHandle: 'shop-a.c' }, setup: world() }),
    N('request-body-a-list', 'POST ' + at('/connections'), 400, { body: [], setup: world() }),
    X('approve-unknown', 'POST ' + at('/connections/:id/approve'), 404, { url: edgeUrl('approve'), body: {}, setup: world() }),
    X('approve-stranger', 'POST ' + at('/connections/:id/approve'), 403, { url: edgeUrl('approve'), body: {}, setup: world(ASKED, { who: STRANGER }) }),
    X('approve-by-the-asker', 'POST ' + at('/connections/:id/approve'), 403, { url: edgeUrl('approve'), body: {}, setup: world(ASKED) }),
    X('approve-already-active', 'POST ' + at('/connections/:id/approve'), 409, { url: edgeUrl('approve'), body: {}, setup: world(LIVE, { who: CHILD }) }),
    X('approve-unclaimed-child', 'POST ' + at('/connections/:id/approve'), 409, { url: edgeUrl('approve'), body: {}, setup: world(ASKED, { who: CHILD }) }),
    X('approve-made', 'POST ' + at('/connections/:id/approve'), 200, { url: edgeUrl('approve'), body: {}, setup: world(Object.assign({ childClaimed: true }, ASKED), { who: CHILD }) }),
    X('decline-unknown', 'POST ' + at('/connections/:id/decline'), 404, { url: edgeUrl('decline'), body: {}, setup: world() }),
    X('decline-stranger', 'POST ' + at('/connections/:id/decline'), 403, { url: edgeUrl('decline'), body: {}, setup: world(ASKED, { who: STRANGER }) }),
    X('decline-not-pending', 'POST ' + at('/connections/:id/decline'), 409, { url: edgeUrl('decline'), body: {}, setup: world(LIVE, { who: CHILD }) }),
    X('decline-made', 'POST ' + at('/connections/:id/decline'), 200, { url: edgeUrl('decline'), body: {}, setup: world(ASKED, { who: CHILD }) }),
    X('suspend-unknown', 'POST ' + at('/connections/:id/suspend'), 404, { url: edgeUrl('suspend'), body: {}, setup: world() }),
    X('suspend-by-the-member', 'POST ' + at('/connections/:id/suspend'), 403, { url: edgeUrl('suspend'), body: {}, setup: world(LIVE, { who: CHILD }) }),
    X('suspend-not-active', 'POST ' + at('/connections/:id/suspend'), 409, { url: edgeUrl('suspend'), body: {}, setup: world(ASKED) }),
    X('suspend-made', 'POST ' + at('/connections/:id/suspend'), 200, { url: edgeUrl('suspend'), body: {}, setup: world(LIVE) }),
    X('resume-unknown', 'POST ' + at('/connections/:id/resume'), 404, { url: edgeUrl('resume'), body: {}, setup: world() }),
    X('resume-not-held', 'POST ' + at('/connections/:id/resume'), 409, { url: edgeUrl('resume'), body: {}, setup: world(LIVE) }),
    X('resume-made', 'POST ' + at('/connections/:id/resume'), 200, { url: edgeUrl('resume'), body: {}, setup: world({ edge: { state: 'suspended' } }) }),
    X('disconnect-unknown', 'POST ' + at('/connections/:id/disconnect'), 404, { url: edgeUrl('disconnect'), body: {}, setup: world() }),
    X('disconnect-stranger', 'POST ' + at('/connections/:id/disconnect'), 403, { url: edgeUrl('disconnect'), body: {}, setup: world(LIVE, { who: STRANGER }) }),
    X('disconnect-not-live', 'POST ' + at('/connections/:id/disconnect'), 409, { url: edgeUrl('disconnect'), body: {}, setup: world(ASKED) }),
    X('disconnect-open-chit', 'POST ' + at('/connections/:id/disconnect'), 409, { url: edgeUrl('disconnect'), body: {}, setup: world({ edge: { state: 'active', in_flight: true } }) }),
    X('disconnect-made', 'POST ' + at('/connections/:id/disconnect'), 200, { url: edgeUrl('disconnect'), body: {}, setup: world(LIVE) }),
    X('disconnect-settling', 'POST ' + at('/connections/:id/disconnect'), 200, { url: edgeUrl('disconnect'), body: { settle: true }, setup: world({ edge: { state: 'active', in_flight: true } }) })
  ];

  /* ── /api/network-design: the saved drawing, the check, the build, the code, the search ── */
  const design = answering(/FROM network_design/, [{ draft: DESIGN, updated_at: AT }]);
  const meRow = (more) => answering(/FROM identities\s+WHERE identity_id = \$1/, [Object.assign({ identity_id: A, bridge_id: 'AAAA2222', display_name: 'Shop A', user_id: 'shop-a', country: 'IN', currency_code: 'INR', catalogue_visibility: 'public', lat: null, lng: null }, more)]);
  const own = answering(/SELECT identity_id, bridge_id, display_name, lat, lng FROM identities WHERE identity_id = \$1/, [{ identity_id: A, bridge_id: 'AAAA2222', display_name: 'Shop A', lat: null, lng: null }]);
  const tooBig = { x: 'a'.repeat(2000001) };
  const executes = (answer) => ({ run: { execute: answer } });
  const built = async () => ({ created: [], updated: [], invited: [], failedInvites: [] });
  const sqlState = (code) => async () => { throw Object.assign(new Error('pg ' + code), { code }); };
  const members = (rows) => ({ membership: { treeOf: async () => rows } });
  const unread = Object.assign(new Error('The tree could not be read'), { code: 'NETWORK_READ_FAILED', status: 503 });
  const store = (more) => Object.assign({ identity_id: A, bridge_id: 'AAAA2222', display_name: 'Shop A', purpose: 'Head office', city: 'Pune', lat: null, lng: null, currency_code: 'INR', service_km: null, dispatch_days: null, ship_within_days: null, ship_beyond_days: null, sort_order: null, catalogue_visibility: 'public', plan: null, params_override: {} }, more);
  const stores = answering(/FROM identities\s+WHERE bridge_id = ANY/, [store(), store({ identity_id: C, bridge_id: 'CCCC4444', display_name: 'Shop C', city: 'Goa', sort_order: 1 }), store({ identity_id: B, bridge_id: 'BBBB3333', display_name: 'Closed', catalogue_visibility: 'private' })]);
  const found = answering(/FROM network_search/, [{ store_name: 'Shop C', bridge_id: 'CCCC4444', city: 'Goa', entity_id: C, item_id: 'i1', item_data: { name: 'Tea', price: { amount: 10, currency: 'INR' }, avail: { qty: 4, source: 'count' } }, lat: null, lng: null, currency_code: 'INR', service_km: null, dispatch_days: null, ship_within_days: null, ship_beyond_days: null, catalogue_visibility: 'public', plan: null, params_override: {} }]);
  const items = answering(/FROM catalogue_items/, [{ item_id: 'i1', item_data: { name: 'Tea', price: 10, avail: { qty: 4, source: 'count' } } }]);
  const buildRows = (more) => firstOf(meRow(more), design);
  const designed = [
    X('design-saved', 'GET ' + DES, 200, { setup: { sqlRows: design } }),
    X('save-draft-not-an-object', 'PUT ' + DES, 400, { body: { draft: [] } }),
    X('save-too-large', 'PUT ' + DES, 413, { body: { draft: tooBig } }),
    X('save-made', 'PUT ' + DES, 200, { body: { draft: DESIGN }, setup: { sqlRows: answering(/INSERT INTO network_design/, [{ updated_at: AT }]) } }),
    X('save-keeps-the-receipt', 'PUT ' + DES, 200, { body: { draft: { nodes: [{ key: 'a', name: 'Clothing' }] } }, setup: { sqlRows: firstOf(answering(/SELECT draft FROM network_design/, [{ draft: { nodes: [{ key: 'a', built: { bridge_id: 'X1' } }] } }]), answering(/INSERT INTO network_design/, [{ updated_at: AT }])) } }),
    X('save-db-fails', 'PUT ' + DES, 500, { body: { draft: DESIGN }, setup: failing }),
    N('save-body-a-list', 'PUT ' + DES, 400, { body: [] }),
    X('validate-draft-not-an-object', 'POST ' + DES + '/validate', 400, { body: { draft: 'text' } }),
    X('validate-too-large', 'POST ' + DES + '/validate', 413, { body: { draft: tooBig } }),
    X('validate-a-sketch', 'POST ' + DES + '/validate', 200, { body: { sample: true, draft: DESIGN } }),
    X('validate-the-saved-design', 'POST ' + DES + '/validate', 200, { body: {}, setup: { sqlRows: firstOf(answering(/SELECT user_id FROM identities/, [{ user_id: 'shop-a' }]), design) } }),
    X('validate-a-draft-and-root', 'POST ' + DES + '/validate', 200, { body: { draft: DESIGN, root_handle: 'Shop-A', ceiling: 'network' }, setup: { sqlRows: answering(/LIKE \$1/, [{ h: 'shop-a.shoes' }]) } }),
    N('validate-body-a-list', 'POST ' + DES + '/validate', 400, { body: [] }),
    X('build-by-staff', 'POST ' + DES + '/build', 403, { body: {}, setup: { who: STAFF } }),
    X('build-needs-a-user-id', 'POST ' + DES + '/build', 409, { body: {}, setup: { sqlRows: buildRows({ user_id: null }) } }),
    X('build-user-id-unusable', 'POST ' + DES + '/build', 409, { body: {}, setup: { sqlRows: buildRows({ user_id: 'a@b.com' }) } }),
    X('build-root-name-unusable', 'POST ' + DES + '/build', 400, { body: { root_handle: 'a b' }, setup: { sqlRows: buildRows({ user_id: null }) } }),
    X('build-root-name-taken', 'POST ' + DES + '/build', 409, { body: { root_handle: 'taken' }, setup: { sqlRows: firstOf(answering(/SELECT 1 FROM identities WHERE LOWER\(user_id\)/, [{ '?column?': 1 }]), buildRows({ user_id: null })) } }),
    X('build-nothing-designed', 'POST ' + DES + '/build', 400, { body: {}, setup: { sqlRows: meRow() } }),
    X('build-a-preview', 'POST ' + DES + '/build', 200, { body: { dry_run: true }, setup: { sqlRows: buildRows() } }),
    X('build-already-matches', 'POST ' + DES + '/build', 200, { body: {}, setup: { sqlRows: firstOf(meRow(), answering(/FROM network_design/, [{ draft: { nodes: [{ key: 'bad', name: 'Bad', owned: true, parent_key: 'r' }] } }])) } }),
    X('build-made', 'POST ' + DES + '/build', 200, { body: {}, setup: { sqlRows: buildRows() }, patch: executes(built) }),
    X('build-name-taken-meanwhile', 'POST ' + DES + '/build', 409, { body: {}, setup: { sqlRows: buildRows() }, patch: executes(sqlState('23505')) }),
    X('build-visibility-not-migrated', 'POST ' + DES + '/build', 409, { body: {}, setup: { sqlRows: buildRows() }, patch: executes(sqlState('23514')) }),
    X('build-fails', 'POST ' + DES + '/build', 500, { body: {}, setup: { sqlRows: buildRows() }, patch: executes(async () => { throw new Error(SECRET_SQL); }) }),
    N('build-body-a-list', 'POST ' + DES + '/build', 400, { body: [], setup: { sqlRows: buildRows() } }),
    X('reissue-by-staff', 'POST ' + DES + '/reissue', 403, { body: { user_id: 'shop-a.c' }, setup: { who: STAFF } }),
    X('reissue-no-store-named', 'POST ' + DES + '/reissue', 400, { body: {} }),
    X('reissue-not-yours', 'POST ' + DES + '/reissue', 404, { body: { user_id: 'shop-a.c' } }),
    X('reissue-made', 'POST ' + DES + '/reissue', 200, { body: { user_id: 'Shop-A.C' }, setup: { sqlRows: answering(/FROM identities\s+WHERE LOWER\(user_id\) = LOWER\(\$1\)/, [{ identity_id: C, display_name: 'Shop C', user_id: 'shop-a.c' }]) }, patch: { otp: { generateOTP: () => '123456' } } }),
    X('reissue-db-fails', 'POST ' + DES + '/reissue', 500, { body: { user_id: 'shop-a.c' }, setup: failing }),
    N('reissue-body-a-list', 'POST ' + DES + '/reissue', 400, { body: [] }),
    X('availability-too-short', 'GET ' + DES + '/availability', 400, { url: DES + '/availability?q=a' }),
    X('availability-account-unread', 'GET ' + DES + '/availability', 404, { url: DES + '/availability?q=tea' }),
    X('availability-no-network', 'GET ' + DES + '/availability', 200, { url: DES + '/availability?q=tea', setup: { sqlRows: own }, patch: members([]) }),
    X('availability-one-query', 'GET ' + DES + '/availability', 200, { url: DES + '/availability?q=tea', setup: { sqlRows: firstOf(found, own) }, patch: members(['AAAA2222', 'CCCC4444']) }),
    X('availability-fallback', 'GET ' + DES + '/availability', 200, { url: DES + '/availability?q=tea', setup: { sqlRows: firstOf(raising(/network_search/, '42883'), stores, items, own) }, patch: members(['AAAA2222', 'CCCC4444']) }),
    X('availability-tree-unread', 'GET ' + DES + '/availability', 503, { url: DES + '/availability?q=tea', setup: { sqlRows: own }, patch: { membership: { treeOf: async () => { throw unread; } } } }),
    X('availability-db-fails', 'GET ' + DES + '/availability', 500, { url: DES + '/availability?q=tea', setup: failing }),
    N('availability-asked-twice', 'GET ' + DES + '/availability', 400, { url: DES + '/availability?q=tea&q=jam', setup: { sqlRows: own }, patch: members([]) }),
    X('stores-account-unread', 'GET ' + DES + '/stores', 404, {}),
    X('stores-no-network', 'GET ' + DES + '/stores', 200, { setup: { sqlRows: own }, patch: members([]) }),
    X('stores-listed', 'GET ' + DES + '/stores', 200, { setup: { sqlRows: firstOf(stores, own) }, patch: members(['AAAA2222', 'CCCC4444', 'BBBB3333']) }),
    X('stores-tree-unread', 'GET ' + DES + '/stores', 503, { setup: { sqlRows: own }, patch: { membership: { treeOf: async () => { throw unread; } } } }),
    X('stores-db-fails', 'GET ' + DES + '/stores', 500, { setup: failing })
  ];

  /* ── /api/connections: the handshake between two businesses ── */
  const asked = { request: true };
  const handshake = [
    X('request-needs-a-receiver', 'POST ' + CON + '/request', 400, { body: {} }),
    X('request-note-too-long', 'POST ' + CON + '/request', 400, { body: { to_entity_id: C, note: 'n'.repeat(501) } }),
    X('request-spaces-are-trimmed', 'POST ' + CON + '/request', 200, { body: { to_entity_id: '  ' + C + '  ', note: '  hello  ' }, setup: world() }),
    X('handshake-to-self', 'POST ' + CON + '/request', 400, { body: { to_entity_id: A }, setup: world() }),
    X('handshake-receiver-unknown', 'POST ' + CON + '/request', 404, { body: { to_entity_id: C } }),
    X('handshake-already-there', 'POST ' + CON + '/request', 400, { body: { to_entity_id: C }, setup: world(asked) }),
    X('handshake-made', 'POST ' + CON + '/request', 200, { body: { to_entity_id: C, note: 'hi' }, setup: world() }),
    X('handshake-db-fails', 'POST ' + CON + '/request', 500, { body: { to_entity_id: C }, setup: failing }),
    N('handshake-body-a-list', 'POST ' + CON + '/request', 400, { body: [], setup: world() }),
    X('pending-one', 'GET ' + CON + '/pending', 200, { setup: world(asked) }),
    X('pending-a-page', 'GET ' + CON + '/pending', 200, { url: CON + '/pending?page=1&limit=1', setup: world(asked) }),
    X('respond-needs-an-action', 'PUT ' + CON + '/:id/respond', 400, { url: CON + '/' + CONNECTION + '/respond', body: { action: 'maybe' } }),
    X('respond-unknown', 'PUT ' + CON + '/:id/respond', 404, { url: CON + '/' + CONNECTION + '/respond', body: { action: 'accept' }, setup: world() }),
    X('respond-accepted', 'PUT ' + CON + '/:id/respond', 200, { url: CON + '/' + CONNECTION + '/respond', body: { action: 'accept' }, setup: world(asked) }),
    X('respond-rejected', 'PUT ' + CON + '/:id/respond', 200, { url: CON + '/' + CONNECTION + '/respond', body: { action: 'reject' }, setup: world(asked) }),
    X('respond-spaced-word', 'PUT ' + CON + '/:id/respond', 200, { url: CON + '/' + CONNECTION + '/respond', body: { action: ' accept ' }, setup: world(asked) }),
    X('respond-db-fails', 'PUT ' + CON + '/:id/respond', 500, { url: CON + '/' + CONNECTION + '/respond', body: { action: 'accept' }, setup: failing }),
    X('list-one', 'GET ' + CON + '/list', 200, { setup: world({ request: 'accepted' }) }),
    X('list-a-page', 'GET ' + CON + '/list', 200, { url: CON + '/list?limit=1', setup: world({ request: 'accepted' }) })
  ];
  return tree.concat(designed, handshake);
}

module.exports = { extras, NET, DES, CON };
