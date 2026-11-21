#!/usr/bin/env node
// @type: unit
/**
 * tests/delegation.test.cjs — lib/delegation.js, the area-neutral delegation rule: the grant is the ceiling (a LEVEL per area), the seat narrows within it (Athi 20 Nov; H-h1 critic slice 0).
 * OWNS      unit proof of seatKindOf (the seat kinds), mayActIn ({ may, code, why }: ceiling level AND seat), the hostile pairs (widest seat on the narrowest grant, an absent or unknown role, object-key role names, no via), areaOfPath (books only today), fail-closed.
 * CALLED BY CI (unit). No database. CARD 04-network/ACC-176B-ADVISER-REQUIREMENT
 */
'use strict';
const assert = require('assert');
const d = require('../lib/delegation');
const actor = (level, whole, costs) => ({ identity_type: 'actor', parent_entity_id: 'f', access_level: level, whole_entity: whole, can_see_costs: costs });
let n = 0;
const ok = (name, fn) => { fn(); n += 1; console.log('  ok   ' + name); };
const may = (area, action, asker) => d.mayActIn(area, action, asker).may;
const ACTIONS = ['read', 'reports', 'review', 'write'];
ok('seat kinds come from level, reach and cost sight only', () => {
  assert.strictEqual(d.seatKindOf({ identity_type: 'entity' }), 'owner');
  assert.strictEqual(d.seatKindOf(actor('editor', true, true)), 'accountant');
  assert.strictEqual(d.seatKindOf(actor('editor', true, false)), 'accountant');
  assert.strictEqual(d.seatKindOf(actor('commenter', true, true)), 'reviewer');
  assert.strictEqual(d.seatKindOf(actor('commenter', true, false)), 'reports');
  assert.strictEqual(d.seatKindOf(actor('viewer', false, false)), null);
  assert.strictEqual(d.seatKindOf(actor('viewer', true, true)), null);
  assert.strictEqual(d.seatKindOf(actor('editor', false, false)), null);
  assert.strictEqual(d.seatKindOf(actor(undefined, true, true)), null, 'an absent level is no seat here');
  assert.strictEqual(d.seatKindOf(actor('god', true, true)), null);
});
ok('the seat narrows within the adviser grant: reviewer reads and reviews, never writes; reports reads reports only', () => {
  const as = (identity) => (action) => may('books', action, { identity, via: 'grant', role: 'adviser' });
  assert.deepStrictEqual(ACTIONS.map(as(actor('commenter', true, true))), [true, true, true, false]);
  assert.deepStrictEqual(ACTIONS.map(as(actor('commenter', true, false))), [false, true, false, false]);
  assert.deepStrictEqual(ACTIONS.map(as(actor('editor', true, true))), [true, true, true, true]);
});
ok('HOSTILE: the widest seat on the narrowest grant: an editor accountant and the owner on an AUDITOR grant never write', () => {
  for (const identity of [actor('editor', true, true), { identity_type: 'entity' }]) {
    const r = d.mayActIn('books', 'write', { identity, via: 'grant', role: 'auditor' });
    assert.strictEqual(r.may, false); assert.strictEqual(r.code, 'GRANT_CEILING'); assert.ok(r.why);
    assert.deepStrictEqual(['read', 'reports', 'review'].map((a) => may('books', a, { identity, via: 'grant', role: 'auditor' })), [true, true, true]);
  }
});
ok('HOSTILE: an absent or unknown role on a grant asker is refused, never the widest', () => {
  const identity = actor('editor', true, true);
  for (const role of [undefined, null, '', 'owner', 'Adviser', 'admin', 7, {}, [], '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'prototype']) {
    const r = d.mayActIn('books', 'write', { identity, via: 'grant', role });
    assert.strictEqual(r.may, false, 'role ' + String(role));
    assert.strictEqual(r.code, 'GRANT_ROLE_UNKNOWN');
  }
  assert.strictEqual(d.grantReaches('__proto__', 'books'), false);
  assert.strictEqual(d.grantReaches('constructor', 'books'), false);
});
ok('HOSTILE: object-key area and action names find nothing', () => {
  const identity = { identity_type: 'entity' };
  for (const area of ['__proto__', 'constructor', 'toString', 'catalogue', undefined]) assert.strictEqual(d.mayActIn(area, 'read', { identity, via: 'self' }).may, false, String(area));
  for (const action of ['__proto__', 'constructor', 'toString', 'delete', undefined]) assert.strictEqual(d.mayActIn('books', action, { identity, via: 'self' }).code, 'ACTION_UNKNOWN', String(action));
});
ok('no via, or any via but grant|self, is refused; self is the seat alone', () => {
  const identity = actor('editor', true, true);
  for (const via of [undefined, 'owner', '', 'GRANT', {}]) assert.strictEqual(d.mayActIn('books', 'read', { identity, via, role: 'adviser' }).code, 'VIA_NEEDED');
  assert.strictEqual(may('books', 'write', { identity, via: 'self' }), true);
  assert.strictEqual(may('books', 'write', { identity: actor('commenter', true, true), via: 'self' }), false);
});
ok('the grant is the ceiling: an area no grant kind reaches is refused for every seat', () => {
  assert.strictEqual(d.mayActIn('catalogue', 'read', { identity: { identity_type: 'entity' }, via: 'grant', role: 'adviser' }).code, 'AREA_NOT_DELEGATED');
  assert.strictEqual(d.grantReaches('auditor', 'books'), true);
  assert.strictEqual(d.grantReaches('auditor', 'catalogue'), false);
});
ok('areaOfPath: the books paths are the books area, any other path is no delegated area', () => {
  for (const p of ['/api/books/pl', '/api/books-actions', '/api/books-grants/practice', '/api/marks']) assert.strictEqual(d.areaOfPath(p), 'books');
  for (const p of ['/api/catalogue/items', '/api/actors', '/api/till/sale', '/api/books2', '/api/__proto__']) assert.strictEqual(d.areaOfPath(p), null);
});
ok('fail closed: no asker, no identity, a device key, no seat: no, with a code and words', () => {
  for (const asker of [null, undefined, {}, { identity: { identity_type: 'entity' }, api_key: 'k', via: 'self' }, { identity: actor('viewer', false, false), via: 'self' }]) {
    const r = d.mayActIn('books', 'read', asker); assert.strictEqual(r.may, false); assert.ok(r.code && r.why);
  }
});
console.log('\n' + n + ' ok');
