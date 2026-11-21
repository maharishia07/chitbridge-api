#!/usr/bin/env node
// @type: unit
/**
 * books-grants-seats.test.cjs — GET /api/books-grants prints the seats the person holds and, per received grant, may_use (frame P0, 16 Nov 2026).
 *
 * OWNS      the proof that the list answers `seats` and `may_use` from the ONE rule (middleware/books-grant.js holdsSeat / mayUseGrant), for three identities:
 *           the firm's owner (both seats), the auditor preset (auditor only) and the editor whole-entity person (adviser only, who may also open an auditor grant: W12).
 * CALLED BY CI. No database, no network.
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 */
'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const assert = require('assert');
const router = require('../routes/books-grants');
const gate = require('../middleware/books-grant');
const answer = router.seatAnswer;
assert.strictEqual(typeof answer, 'function', 'routes/books-grants exposes seatAnswer');

const received = [{ grant_id: 'a', preset: 'auditor' }, { grant_id: 'b', preset: 'adviser' }, { grant_id: 'c', preset: null }];
const owner = { identity: { identity_type: 'entity' } };
const auditor = { identity: { identity_type: 'actor', access_level: 'commenter', whole_entity: true, can_see_costs: true } };
const adviser = { identity: { identity_type: 'actor', access_level: 'editor', whole_entity: true } };
const nobody = { identity: { identity_type: 'actor', access_level: 'viewer', whole_entity: false } };
const keyed = { identity: { identity_type: 'entity' }, api_key: 'k' };
const uses = (out) => out.received.map((row) => row.may_use);
const rule = (req, row) => gate.mayUseGrant(req, row.preset === 'adviser' ? 'adviser' : 'auditor');

let n = 0;
const ok = (name, fn) => { fn(); n += 1; console.log('  ok ' + name); };
ok('the firm owner holds both seats and may use every grant', () => {
  const out = answer(owner, received);
  assert.deepStrictEqual(out.seats, ['adviser', 'auditor']);
  assert.deepStrictEqual(uses(out), [true, true, true]);
});
ok('the auditor preset holds one seat: the auditor door only', () => {
  const out = answer(auditor, received);
  assert.deepStrictEqual(out.seats, ['auditor']);
  assert.deepStrictEqual(uses(out), [true, true, true]); /* GRANT-SEAT: the reviewer opens an adviser grant too, read only */
});
ok('the accountant seat holds one seat (the work) and (GRANT-SEAT 20 Nov) reads through the auditor door too: the grant is the ceiling, prepare and check stay two people at the sign-off', () => {
  const out = answer(adviser, received);
  assert.deepStrictEqual(out.seats, ['adviser']);
  assert.deepStrictEqual(uses(out), [true, true, true]); /* GRANT-SEAT: the accountant opens an auditor grant too, read only; prepare and check stay two people at the sign-off */
});
ok('a person with no seat gets no seats and no door', () => {
  const out = answer(nobody, received);
  assert.deepStrictEqual(out.seats, []);
  assert.deepStrictEqual(uses(out), [false, false, false]);
});
ok('a key is not a person: no seats, no door', () => {
  const out = answer(keyed, received);
  assert.deepStrictEqual(out.seats, []);
  assert.deepStrictEqual(uses(out), [false, false, false]);
});
ok('may_use is the middleware rule itself, row by row, for every identity', () => {
  [owner, auditor, adviser, nobody, keyed].forEach((req) => answer(req, received).received.forEach((row, i) => assert.strictEqual(row.may_use, rule(req, received[i]))));
});
ok('the row keeps its own keys; an empty list stays an empty list', () => {
  assert.strictEqual(answer(owner, received).received[0].grant_id, 'a');
  assert.deepStrictEqual(answer(owner, undefined).received, []);
});
console.log('\n  ✓ ' + n + ' passed');
