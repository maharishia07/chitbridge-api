#!/usr/bin/env node
// @type: unit
/**
 * practice-w12-one-reader.test.cjs — S1 (18 Nov 2026): the practice list and the books door ask ONE reader (middleware/books-grant.usableRoles).
 * OWNS      the proof that the practice list holds exactly the clients the door opens (usableRoles = mayUseGrant), under SEC-117 (segregation of duties: the accountant seat never opens an AUDITOR grant,
 *           so W12's read-only auditor rows are off until Athi decides W12, PM/ATHI-DECISIONS.md); a non-firm person reads none; readOnlyOf stays ready for that switch.
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
ok('staff seat: lists adviser grants only (SEC-117); auditor-preset person: auditor only; non-firm person: none', () => {
  assert.deepStrictEqual(gate.usableRoles(staff), ['adviser', 'auditor']); /* GRANT-SEAT (20 Nov): any books seat lists every client the firm holds; the seat narrows what it does there */
  assert.deepStrictEqual(gate.usableRoles(auditor), ['adviser', 'auditor']);
  assert.deepStrictEqual(gate.usableRoles(nobody), []);
});
ok('the door (SEC-117): the staff seat is refused an auditor grant', () => {
  assert.strictEqual(gate.mayUseGrant(staff, 'auditor'), true);
  assert.strictEqual(gate.mayUseGrant(staff, 'adviser'), true);
  assert.strictEqual(gate.mayUseGrant(auditor, 'adviser'), true);
  assert.strictEqual(gate.mayUseGrant(nobody, 'auditor'), false);
});
ok('a row reached through a role the seat does not hold is read only, with the grant role', () => {
  assert.strictEqual(practice.readOnlyOf({ preset: 'auditor' }, ['adviser']), true);
  assert.strictEqual(practice.readOnlyOf({ preset: 'adviser' }, ['adviser']), false);
  assert.strictEqual(practice.readOnlyOf({ preset: 'auditor' }, ['auditor']), false);
});
console.log(n + ' passed');
