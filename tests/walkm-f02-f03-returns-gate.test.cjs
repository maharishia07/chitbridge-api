#!/usr/bin/env node
// @type: unit
/**
 * walkm-f02-f03-returns-gate.test.cjs — WALK M (21 Nov, India): GET /api/tax/gstr sits behind the SAME books-read gate as the trial balance (M-F-03: a view-only seat is refused 403 OWNER_ONLY in words, the owner reads),
 * and a firm grant (adviser / auditor, X-Books-For) may read it, READ ONLY (M-F-02: returns are read like GRANT_READS '/returns'; DECISIONS 19 Nov RC-11 evidence-style read door).
 * OWNS the proof of routes/tax.js GET /gstr gate order + middleware/books-grant.js EVIDENCE_PATHS. CALLED BY CI. No database, no network.
 */
'use strict';
const assert = require('assert');
process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = ''; process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const grant = require('../middleware/books-grant');
const tax = require('../routes/tax');
const { gates } = require('../routes/books');
const { READ_MONEY_WORDS } = require('../lib/books-readers');

/* the gate is the one books-read gate, in the route's own stack */
const layer = tax.stack.find((item) => item.route && item.route.path === '/gstr');
assert.ok(layer, 'GET /gstr exists');
const names = layer.route.stack.map((item) => item.name + ':' + item.handle.toString().slice(0, 80));
assert.ok(layer.route.stack.some((item) => /moneyReader\.\s*moneyReader|gates\.moneyReader/.test(item.handle.toString()) || item.handle === gates.moneyReader), 'the route carries the books money gate: ' + names.join(' | '));
assert.ok(layer.route.stack[0].handle === grant, 'the grant front is first (a firm header is decided before the route)');

function ask(identity, extra) {
  const out = { next: false, status: null, body: null };
  const res = { statusCode: 200, status(c) { out.status = c; return this; }, setHeader() {}, set() { return this; }, type() { return this; }, json(b) { out.body = b; return this; }, send(b) { out.body = b; return this; }, end() { return this; }, locals: {} };
  const req = Object.assign({ identity, headers: {}, id: 'r1', method: 'GET', path: '/gstr', originalUrl: '/api/tax/gstr', get() { return undefined; } }, extra || {});
  const gate = layer.route.stack.find((item) => item.handle !== grant && /moneyReader/.test(item.handle.toString()) || item.handle === gates.moneyReader).handle;
  return Promise.resolve(gate(req, res, () => { out.next = true; })).then(() => out);
}
(async () => {
  const E = 'aaaaaaaa-1111-4111-8111-111111111111';
  const owner = await ask({ identity_id: E, identity_type: 'entity' });
  assert.strictEqual(owner.next, true, 'the owner reads (200 path)');
  const viewer = await ask({ identity_id: '55555552-0000-4000-8000-000000000000', parent_entity_id: E, identity_type: 'actor', access_level: 'viewer' });
  assert.strictEqual(viewer.next, false, 'a view-only seat is refused');
  assert.strictEqual(viewer.status, 403);
  assert.ok(JSON.stringify(viewer.body).includes('OWNER_ONLY') && JSON.stringify(viewer.body).includes(READ_MONEY_WORDS), 'refused in words: ' + JSON.stringify(viewer.body));
  const granted = await ask({ identity_id: E, identity_type: 'entity' }, { acting_for_grant: 'g-1' });
  assert.strictEqual(granted.next, true, 'a live firm grant reads');

  /* the firm header: passes on /api/tax/gstr for a GET only, is listed for both seats, still refused elsewhere on tax */
  const through = (p, method) => { let n = false; grant.refuseElsewhere({ path: p, headers: { 'x-books-for': 'S' }, id: 'r', method, originalUrl: p, get() { return undefined; } }, { statusCode: 200, status() { return this; }, setHeader() {}, set() { return this; }, type() { return this; }, json() { return this; }, send() { return this; }, end() { return this; }, locals: {} }, () => { n = true; }); return n; };
  assert.strictEqual(through('/api/tax/gstr', 'GET'), true, 'GET /api/tax/gstr passes with X-Books-For');
  assert.strictEqual(through('/api/tax/gstr', 'POST'), false, 'a write is refused');
  assert.strictEqual(through('/api/tax/ledger', 'GET'), false, 'other tax routes stay refused');
  for (const role of ['auditor', 'adviser']) assert.strictEqual(grant.listedFor(role, { method: 'GET', baseUrl: '/api/tax', path: '/gstr', headers: {} }), true, role + ' lists it');
  console.log('walkm-f02-f03-returns-gate: ok');
})().catch((e) => { console.error(e); process.exit(1); });
