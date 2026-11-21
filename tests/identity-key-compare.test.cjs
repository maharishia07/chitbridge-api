/**
 * identity-key-compare.test.cjs — the identities key is compared as a uuid, never cast to text (speed, 21 Nov 2026).
 *
 * `bi.identity_id::text = (expr)` cannot use the primary key: the practice list scanned all identities four times per grant
 * (167 grants, 1471 ms on sit-au, EXPLAIN ANALYZE) and 17 ms once the key is compared as a uuid. isMemberSql and isGrantParentSql
 * (lib/network-membership) carry the one comparison; a text that is not a uuid must still mean "no match", never a cast error.
 *
 * Run: node tests/identity-key-compare.test.cjs · no DB, no network.
 */
'use strict';
const assert = require('assert');
/* the SQL text is only built: a stand-in for the db so no connection is tried */
for (const mod of ['../db', '../src/db']) { const at = require.resolve(mod); require.cache[at] = { id: at, filename: at, loaded: true, exports: { query: async () => ({ rows: [] }), pool: { query: async () => ({ rows: [] }) } } }; }
const membership = require('../lib/network-membership');
const sqls = [membership.isMemberSql('b', 's'), membership.isGrantParentSql('g.grantee_entity::text', 'g.grantor_entity::text')].map((s) => s.replace(/\s+/g, ' '));
for (const sql of sqls) {
  assert.ok(!/identity_id::text/.test(sql), 'the identities key is cast to text again: ' + sql.slice(0, 160));
  assert.ok(/identity_id = CASE WHEN \(.*?\) ~ '\^\[0-9a-f\]\{8\}/.test(sql), 'the uuid guard is missing');
}
assert.strictEqual((sqls[1].match(/identity_id = CASE WHEN/g) || []).length, 4, 'four comparisons: the member test (2) and the agency test (2)');
console.log('identity-key-compare: ok · 6 checks');
