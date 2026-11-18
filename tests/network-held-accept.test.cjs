/**
 * tests/network-held-accept.test.cjs — L10 (cb-network): Held by on the Network list and assign at accept, no database.
 *
 * HAND-COMPUTED:
 *   accept with assign_to = staff A (editor)        → bulkAssign asked once: plug client, role from the live grant (adviser), subject the client, target A → { assigned_to 'Anna', assigned 1, skipped [] }
 *   accept with assign_to = view-only V             → mayHold('client', V) is false (A5), the writer is NEVER asked → { assigned 0, skipped [ASSIGN_HOLDER_REFUSED] } (the route still answers accepted)
 *   accept with no assign_to                        → null (the answer is today's byte for byte)
 *   accept, no live books grant                     → skipped [ASSIGN_NO_BOOKS_ACCESS], writer not asked
 *   the writer refuses (403 not a manager)          → a named skip, nothing thrown; a 500 is thrown
 *   the list                                        → books-practice.addHolders gives a store with a holder its [{ actor_id, name }] and one without []
 * Run: node tests/network-held-accept.test.cjs
 * CARD 04-network/connections-and-invitations
 */
'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const assert = require('assert');
const { assignAtAccept, SKIP } = require('../lib/network-accept-assign');
const { mayHold } = require('../lib/assign-chit');
const { addHolders } = require('../lib/books-practice');

const FIRM = 'f0000000-0000-4000-8000-000000000001', CLIENT = 'c0000000-0000-4000-8000-000000000002';
const A = { identity_id: 'a0000000-0000-4000-8000-00000000000a', display_name: 'Anna', hat: 'act' };
const V = { identity_id: 'b0000000-0000-4000-8000-00000000000b', display_name: 'Vic', hat: 'view_only' };
const team = new Map([[A.identity_id, A], [V.identity_id, V]]);
/* the one rule, the real mayHold: the fake only stands in for the team lookup */
const deps = (calls, over) => Object.assign({
  mayHoldClient: async (firm, id) => (team.get(id) && mayHold('client', team.get(id)) ? team.get(id) : null),
  grantRoleOf: async () => 'adviser',
  bulkAssign: async (asked) => { calls.push(asked.body); return { assigned: ['chit1'], skipped: [] }; }
}, over);
const req = { identity: { identity_id: FIRM } };

(async () => {
  let calls = [];
  const ok = await assignAtAccept(req, { firm: FIRM, client: CLIENT, assign_to: A.identity_id }, deps(calls));
  assert.deepStrictEqual(ok, { assigned_to: 'Anna', assigned: 1, skipped: [] });
  assert.deepStrictEqual(calls, [{ plug: 'client', role: 'adviser', subject_ids: [CLIENT], target_actor_id: A.identity_id }]);

  calls = [];
  const view = await assignAtAccept(req, { firm: FIRM, client: CLIENT, assign_to: V.identity_id }, deps(calls));
  assert.strictEqual(view.assigned, 0);
  assert.strictEqual(view.skipped[0].code, SKIP.HOLDER_REFUSED);
  assert.strictEqual(calls.length, 0, 'the writer is not asked for a view-only seat');

  assert.strictEqual(await assignAtAccept(req, { firm: FIRM, client: CLIENT }, deps([])), null);

  calls = [];
  const noGrant = await assignAtAccept(req, { firm: FIRM, client: CLIENT, assign_to: A.identity_id }, deps(calls, { grantRoleOf: async () => null }));
  assert.strictEqual(noGrant.skipped[0].code, SKIP.NO_BOOKS_ACCESS);
  assert.strictEqual(calls.length, 0);

  const refused = await assignAtAccept(req, { firm: FIRM, client: CLIENT, assign_to: A.identity_id }, deps([], { bulkAssign: async () => { throw Object.assign(new Error('partner or manager only'), { status: 403, code: 'CHIT_NOT_PERMITTED' }); } }));
  assert.strictEqual(refused.skipped[0].code, 'CHIT_NOT_PERMITTED');
  await assert.rejects(assignAtAccept(req, { firm: FIRM, client: CLIENT, assign_to: A.identity_id }, deps([], { bulkAssign: async () => { throw Object.assign(new Error('boom'), { status: 500 }); } })));

  const stores = [{ entity_id: CLIENT }, { entity_id: 'x' }];
  addHolders(stores, new Map([[CLIENT, [{ actor_id: A.identity_id, name: 'Anna' }]]]));
  assert.deepStrictEqual(stores.map((s) => s.holders), [[{ actor_id: A.identity_id, name: 'Anna' }], []]);
  console.log('network-held-accept: 6 groups pass');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
