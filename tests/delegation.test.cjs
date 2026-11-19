#!/usr/bin/env node
// @type: unit
/**
 * tests/delegation.test.cjs — lib/delegation.js, the area-neutral delegation rule: the grant is the ceiling, the seat narrows within it (Athi 20 Nov).
 * OWNS      unit proof of seatKindOf (the five seat kinds), mayDo (ceiling AND seat), areaOfPath (books only today), the refusal paths (no seat, no area, device key) and fail-closed (an empty asker is no).
 * CALLED BY CI (unit). No database. CARD 04-network/ACC-176B-ADVISER-REQUIREMENT
 */
'use strict';
const assert = require('assert');
const d = require('../lib/delegation');
const actor = (level, whole, costs) => ({ identity_type: 'actor', parent_entity_id: 'f', access_level: level, whole_entity: whole, can_see_costs: costs });
let n = 0;
const ok = (name, fn) => { fn(); n += 1; console.log('  ok   ' + name); };
ok('seat kinds come from level, reach and cost sight only', () => {
  assert.strictEqual(d.seatKindOf({ identity_type: 'entity' }), 'owner');
  assert.strictEqual(d.seatKindOf(actor('editor', true, true)), 'accountant');
  assert.strictEqual(d.seatKindOf(actor('commenter', true, true)), 'reviewer');
  assert.strictEqual(d.seatKindOf(actor('commenter', true, false)), 'reports');
  assert.strictEqual(d.seatKindOf(actor('viewer', false, false)), null);
  assert.strictEqual(d.seatKindOf(actor('editor', false, false)), null);
});
ok('the seat narrows within the grant: reviewer reads and reviews, never writes; reports reads reports only', () => {
  const as = (identity) => (action) => d.mayDo('books', action, { identity, role: 'adviser' });
  const reviewer = as(actor('commenter', true, true));
  assert.deepStrictEqual(['read', 'reports', 'review', 'write'].map(reviewer), [true, true, true, false]);
  const reports = as(actor('commenter', true, false));
  assert.deepStrictEqual(['read', 'reports', 'review', 'write'].map(reports), [false, true, false, false]);
  assert.deepStrictEqual(['read', 'reports', 'review', 'write'].map(as(actor('editor', true, true))), [true, true, true, true]);
});
ok('the grant is the ceiling: an area no grant kind reaches is refused for every seat', () => {
  assert.strictEqual(d.mayDo('catalogue', 'read', { identity: { identity_type: 'entity' }, role: 'adviser' }), false);
  assert.strictEqual(d.grantReaches('auditor', 'books'), true);
  assert.strictEqual(d.grantReaches('auditor', 'catalogue'), false);
});
ok('areaOfPath: the books paths are the books area, any other path is no delegated area', () => {
  for (const p of ['/api/books/pl', '/api/books-actions', '/api/books-grants/practice', '/api/marks']) assert.strictEqual(d.areaOfPath(p), 'books');
  for (const p of ['/api/catalogue/items', '/api/actors', '/api/till/sale', '/api/books2']) assert.strictEqual(d.areaOfPath(p), null);
});
ok('fail closed: no asker, no identity, a device key, no seat: no', () => {
  assert.strictEqual(d.mayDo('books', 'read', null), false);
  assert.strictEqual(d.mayDo('books', 'read', {}), false);
  assert.strictEqual(d.mayDo('books', 'read', { identity: { identity_type: 'entity' }, api_key: 'k' }), false);
  assert.strictEqual(d.mayDo('books', 'read', { identity: actor('viewer', false, false) }), false);
});
console.log('\n' + n + ' ok');
