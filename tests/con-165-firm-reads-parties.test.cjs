#!/usr/bin/env node
// @type: unit
/**
 * con-165-firm-reads-parties.test.cjs — CON-165 (Athi 27 Nov): a firm seat with a books grant READS a client's party list and one record, and gets 403 on every write.
 * OWNS the proof of the 'parties' delegation area, middleware/books-grant.js refuseElsewhere for /api/crm, routes/crm.js's two grant fronts, and lib/party-grant-view's allow-list cut. CALLED BY CI. No database, no network.
 * CARD 11-crm-and-marketing/crm-parties
 */
'use strict';
const assert = require('assert');
process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = ''; process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const grant = require('../middleware/books-grant');
const delegation = require('../lib/delegation');
const GV = require('../lib/party-grant-view');
const router = require('../routes/crm');
const ID = '10000000-0000-4000-8000-000000000001';
function run(p, method, headers) {
  const out = { next: false, status: null, body: null };
  const res = { statusCode: 200, status(c) { out.status = c; return this; }, setHeader() {}, set() { return this; }, type() { return this; }, json(b) { out.body = b; return this; }, send(b) { out.body = b; return this; } };
  grant.refuseElsewhere({ path: p, headers: headers || { 'x-books-for': ID }, id: 'r1', method, originalUrl: p, get() { return undefined; } }, res, () => { out.next = true; });
  return out;
}
const code = (o) => JSON.stringify(o.body || {});
const doors = ['/api/crm/parties', '/api/crm/parties/' + ID];

/* 1 the two reads pass to their routes; every other method on them is refused read-only; no header is untouched */
for (const p of doors) {
  assert.strictEqual(run(p, 'GET').next, true, 'GET ' + p + ' reaches its route (which holds the grant front)');
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const o = run(p, m);
    assert.strictEqual(o.next, false, m + ' ' + p + ' refused');
    assert.strictEqual(o.status, 403);
    assert.ok(code(o).includes('BOOKS_FOR_READ_ONLY'), m + ' ' + p + ': ' + code(o));
  }
}
assert.strictEqual(run('/api/crm/parties', 'DELETE', {}).next, true, 'no header: the shop own request is untouched');

/* 2 every OTHER route of the CRM router, with the header, is refused and never reaches a handler as the firm's own */
const fronted = [];
router.stack.filter((layer) => layer.route).forEach((layer) => {
  const full = '/api/crm' + layer.route.path.replace(/:[a-z_]+/g, ID);
  const hasFront = layer.route.stack.some((s) => s.handle === grant);
  Object.keys(layer.route.methods).forEach((m) => {
    const method = m.toUpperCase();
    const listed = method === 'GET' && doors.includes(full);
    if (hasFront) fronted.push(method + ' ' + full);
    if (listed) {
      assert.ok(hasFront, 'the listed read ' + full + ' holds the grant front: with the header and no front it would answer as the firm OWN shop');
      return;
    }
    const o = run(full, method);
    assert.strictEqual(o.next, false, method + ' ' + full + ' must be refused under X-Books-For');
    assert.strictEqual(o.status, 403, method + ' ' + full);
  });
});
assert.deepStrictEqual(fronted.sort(), ['GET /api/crm/parties', 'GET /api/crm/parties/' + ID].sort(), 'exactly the two reads hold the grant front');

/* 3 Marketing and the rest of the CRM paths are closed */
for (const p of ['/api/crm/parties/' + ID + '/timeline', '/api/crm/parties/' + ID + '/contact-prefs', '/api/crm/segments', '/api/crm/followups', '/api/crm/calls', '/api/crm/leads', '/api/crm/privacy-requests', '/api/marketing/offers', '/api/marketing']) {
  const o = run(p, 'GET');
  assert.strictEqual(o.next, false, p);
  assert.ok(code(o).includes('BOOKS_FOR_NOT_HERE'), p + ': ' + code(o));
}

/* 4 the area is EXACT and the seat table decides */
assert.strictEqual(delegation.areaOfPath('/api/crm/parties'), 'parties');
assert.strictEqual(delegation.areaOfPath('/api/crm/parties/' + ID), 'parties');
for (const p of ['/api/crm/parties/' + ID + '/timeline', '/api/crm/parties/x/y/z', '/api/crm/segments', '/api/marketing/x']) assert.strictEqual(delegation.areaOfPath(p), null, p);
const seat = (level, costs) => ({ identity_type: 'actor', parent_entity_id: 'E', whole_entity: true, access_level: level, can_see_costs: costs });
const may = (identity, role) => delegation.mayActIn('parties', 'read', { identity, via: 'grant', role }).may;
for (const role of ['auditor', 'adviser']) {
  assert.strictEqual(may(seat('editor', true), role), true, 'accountant reads, ' + role);
  assert.strictEqual(may(seat('commenter', true), role), true, 'reviewer reads, ' + role);
  assert.strictEqual(may(seat('commenter', false), role), false, 'a Reports seat reads figures, not people, ' + role);
  assert.strictEqual(may(seat('viewer', true), role), false, 'a view-only seat has no seat here, ' + role);
  assert.strictEqual(delegation.mayActIn('parties', 'write', { identity: seat('editor', true), via: 'grant', role }).may, false, 'nobody writes parties through a grant, ' + role);
}
assert.strictEqual(may(seat('editor', true), 'nobody'), false, 'an unknown role');

/* 5 the cut: an allow-list; a hostile row keeps no contact, notes, points, consent or follow-ups; walk-in phones are gone */
const hostile = { party_id: ID, display_name: 'Agro Mills', name: 'Agro', party_no: 'P-0001', kind: 'entity', roles: { customer: true, supplier: true }, phone: '+61400000000', email: 'a@example.com', otp_contact: 'x', gstn: '33ABCDE1234F1Z5', gstin: { value: 'v' }, bridge_id: 'b', user_id: 'agro',
  tax_ids: [{ scheme: 'GSTIN', value: '33ABCDE1234F1Z5' }], terms: { customer: { credit_days: 30 } }, dues: { net_minor: 5 }, followups: [{ what: 'secret' }], points: 9, contact_prefs: [1], consent: [1], unbilled: 7,
  customer: { segment: 'regular', txn_count: 4, groups: ['VIP'], list_id: 'l' }, supplier: { category: 'Raw', notes: 'owner note', preferred: true }, lead: { stage: 'lead', since: 'x' } };
const cut = GV.cutParty(hostile);
for (const key of ['phone', 'email', 'otp_contact', 'gstn', 'gstin', 'bridge_id', 'user_id', 'followups', 'points', 'contact_prefs', 'consent', 'unbilled']) assert.ok(!(key in cut), key + ' is not kept');
assert.ok(!('notes' in cut.supplier) && !('groups' in cut.customer) && !('list_id' in cut.customer) && !('since' in cut.lead));
assert.strictEqual(cut.display_name, 'Agro Mills');
assert.deepStrictEqual(cut.tax_ids, hostile.tax_ids);
assert.deepStrictEqual(cut.dues, hostile.dues);
assert.ok(!JSON.stringify(cut).includes('example.com') && !JSON.stringify(cut).includes('+61400'));
const listed = GV.cutList({ parties: [hostile], walk_ins: [{ phone: '+61411111111', points: 3 }], count: 1, total: 1, page: 1, limit: 500, next: null, truncated: false, alerts: {} }, GV.readOnlyMay());
assert.deepStrictEqual(listed.walk_ins, []);
assert.ok(!JSON.stringify(listed).includes('+61411'));
assert.strictEqual(listed.may.write.may, false);
assert.strictEqual(listed.may.remove.ok, false);
assert.deepStrictEqual(GV.QUERY_KEEP, ['q', 'page', 'limit']);

/* 6 the look LISTS the two reads for either role (without this the grant look answers GRANT_ROUTE_NOT_LISTED and the feature is dead) and no write */
const reqOf = (method, path) => ({ method, baseUrl: '/api/crm', path, headers: {} });
for (const role of ['auditor', 'adviser']) {
  assert.strictEqual(grant.listedFor(role, reqOf('GET', '/parties')), true, role + ' list');
  assert.strictEqual(grant.listedFor(role, reqOf('GET', '/parties/' + ID)), true, role + ' record');
  for (const p of ['/parties/' + ID + '/timeline', '/segments', '/followups']) assert.ok(!grant.listedFor(role, reqOf('GET', p)), role + ' ' + p + ' not listed');
  assert.ok(!grant.listedFor(role, reqOf('POST', '/parties')), role + ' POST not listed');
}
/* 7 ?q under a grant is no phone or e-mail oracle */
const crm = require('../lib/crm');
const planted = { display_name: 'Agro Mills', party_no: 'P-0001', phone: '+61 412 345 678', email: 'secret@example.com', user_id: 'agromills' };
assert.strictEqual(crm.matchesQuery(planted, '412345678'), true, 'the shop itself still finds by phone');
for (const probe of ['412345678', '+61412345678', 'secret@example.com', 'secret', 'agromills']) assert.strictEqual(crm.matchesQuery(planted, probe, true), false, 'under a grant ' + probe + ' finds nothing');
assert.strictEqual(crm.matchesQuery(planted, 'agro', true), true);
assert.strictEqual(crm.matchesQuery(planted, 'P-0001', true), true);
console.log('con-165-firm-reads-parties: ok');
