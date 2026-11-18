#!/usr/bin/env node
// @type: unit
/**
 * practice-w12-one-reader.test.cjs — S1 (18 Nov 2026): the practice list and the books door ask ONE reader (middleware/books-grant.usableRoles).
 * OWNS      the proof that the accountant seat's practice reads the firm's AUDITOR grants read-only (W12), a non-firm person reads none, and the door (mayUseGrant) is unchanged.
 * CALLED BY CI. No database, no network.
 */
'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const assert = require('assert');
const gate = require('../middleware/books-grant');
const practice = require('../lib/books-practice');
const staff = { identity: { identity_type: 'actor', access_level: 'editor', whole_entity: true } };
const auditor = { identity: { identity_type: 'actor', access_level: 'commenter', whole_entity: true, can_see_costs: true } };
const owner = { identity: { identity_type: 'entity' } };
const nobody = { identity: { identity_type: 'actor', access_level: 'viewer', whole_entity: false } };
let n = 0;
const ok = (name, fn) => { fn(); n += 1; console.log('  ok ' + name); };
ok('usableRoles is the door itself: every role mayUseGrant allows', () => {
  for (const req of [staff, auditor, owner, nobody]) assert.deepStrictEqual(gate.usableRoles(req), ['adviser', 'auditor'].filter((r) => gate.mayUseGrant(req, r)));
});
ok('staff seat: lists adviser and auditor grants; non-firm person: none', () => {
  assert.deepStrictEqual(gate.usableRoles(staff), ['adviser', 'auditor']);
  assert.deepStrictEqual(gate.usableRoles(nobody), []);
});
ok('the door is unchanged', () => {
  assert.strictEqual(gate.mayUseGrant(staff, 'auditor'), true);
  assert.strictEqual(gate.mayUseGrant(auditor, 'adviser'), false);
  assert.strictEqual(gate.mayUseGrant(nobody, 'auditor'), false);
});
ok('chooseLive keeps an auditor-only grant for the staff seat', () => {
  const live = { grant_id: 'g', grantor_entity: 'c1', preset: 'auditor', revoked_at: null, expires_at: new Date(Date.now() + 864e5).toISOString(), unexpired: true, edge_live: true, granted_at: new Date().toISOString() };
  assert.strictEqual(practice.chooseLive([live], gate.usableRoles(staff), {}).seen.size, 1);
});
ok('a row reached through a role the seat does not hold is read only, with the grant role', () => {
  assert.strictEqual(practice.readOnlyOf({ preset: 'auditor' }, ['adviser']), true);
  assert.strictEqual(practice.readOnlyOf({ preset: 'adviser' }, ['adviser']), false);
  assert.strictEqual(practice.readOnlyOf({ preset: 'auditor' }, ['auditor']), false);
});
console.log(n + ' passed');
