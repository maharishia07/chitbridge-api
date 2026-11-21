/**
 * tests/acc-382-people-load-in-binding.test.cjs — ACC-382 (walk sit-au W21): the owner's Assign to... picker said "holds 0" for people who hold 3 and 2 clients.
 * ROOT CAUSE: GET /api/actors read the open-load column (chit_status, a tenant table under RLS) through the context-free query(), so RLS hid every row.
 * HAND-COMPUTED: Arjun holds 3 open client jobs, Priya 2, one more is completed (not held) -> open_load 3 and 2, the same rows holdersAmong lists for the practice.
 *   the people statement runs on the shop's binding (withEntity) and the load rides it (source scan of routes/actors.js GET /)
 * Run: node tests/acc-382-people-load-in-binding.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const { factsOf, withFacts } = require('../lib/assign-people');
let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) pass++; else { fail++; console.log('  FAIL ' + name); } };
(async () => {
  const rows = [
    { identity_id: 'arjun', display_name: 'Arjun', break_status: 'active', hat: 'manager', access_level: 'editor', open_held: '3' },
    { identity_id: 'priya', display_name: 'Priya', break_status: 'active', hat: 'manager', access_level: 'editor', open_held: '2' }
  ];
  const facts = await factsOf(async () => ({ rows: [] }), 'firm', rows, undefined);
  check('Arjun holds 3', withFacts({ identity_id: 'arjun' }, facts).open_load === 3);
  check('Priya holds 2', withFacts({ identity_id: 'priya' }, facts).open_load === 2);
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'actors.js'), 'utf8');
  /* red1128: the list route was split (fn-size): the read is readActorList, the route calls it */
  const from = src.indexOf('async function readActorList');
  const list = src.slice(from, src.indexOf('// ── POST /api/actors/:id/otp'));
  check('the people list runs inside withEntity (RLS sees the shop)', /await withEntity\(entity_id, async \(shop\)/.test(list));
  check('the load and the facts read on that binding', /factsOf\(queryInShop,/.test(list) && /breakStatusCounts\(entity_id, queryInShop\)/.test(list));
  check('no context-free db( in the list route', !/await db\(/.test(list));
  console.log(`acc-382: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
