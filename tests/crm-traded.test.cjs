/**
 * FX-L2C (2026-10-13) — THE FIRST BILL ENDS THE LEAD (L2C step 5): lib/crm.traded is the ONE bump of txn_count / last_txn_at for the party a
 * counter bill NAMES (business_json.customer), and routes/chits.js runs it inside the bill's own delivery transaction, in a savepoint.
 * Offline: a stub handle records the statement. The stage "customer" stays DERIVED from txn_count (lib/crm assemble · isLead · IS_CUSTOMER).
 * Run: node tests/crm-traded.test.cjs
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
const crm = require(path.join(API, 'lib', 'crm'));
const checks = [], it = (w, f) => checks.push([w, f]);
const P = '10000000-0000-4000-8000-000000000002', OWNER = '10000000-0000-4000-8000-000000000001';
const handle = (rows) => { const h = { sql: [], params: [], query: async (s, p) => { h.sql.push(String(s).replace(/\s+/g, ' ').trim()); h.params.push(p); return { rows: rows || [] }; } }; return h; };

it('one UPDATE: txn_count + 1, last_txn_at = the bill\'s moment, scoped to the owner\'s list row — never an INSERT', async () => {
  const h = handle([{ party_id: P, txn_count: 1, last_txn_at: '2026-10-13T09:00:00.000Z' }]);
  const r = await crm.traded(h, OWNER, P, '2026-10-13T09:00:00.000Z');
  assert.strictEqual(h.sql.length, 1); assert.ok(/^UPDATE customer_list SET txn_count = COALESCE\(txn_count, 0\) \+ 1, last_txn_at = COALESCE\(\$3::timestamptz, NOW\(\)\)/.test(h.sql[0]), h.sql[0]);
  assert.ok(/WHERE owner_entity_id = \$1 AND customer_identity_id = \$2/.test(h.sql[0])); assert.ok(!/INSERT/.test(h.sql[0]));
  assert.deepStrictEqual(h.params[0], [OWNER, P, '2026-10-13T09:00:00.000Z']); assert.strictEqual(r.txn_count, 1);
});
it('a party not on the list → null, nothing else tried (the counter picks from the list; a stranger is not minted here)', async () => {
  const h = handle([]); assert.strictEqual(await crm.traded(h, OWNER, P, null), null); assert.strictEqual(h.sql.length, 1);
});
it('the shop itself, or a name that is not an id → no statement at all (a shop is never its own party, H3)', async () => {
  const h = handle([]); assert.strictEqual(await crm.traded(h, OWNER, OWNER, null), null); assert.strictEqual(await crm.traded(h, OWNER, 'Ravi Stores', null), null); assert.strictEqual(h.sql.length, 0);
});
it('routes/chits.js: the bump runs INSIDE the delivery\'s withEntity, on deliver\'s own client, in a savepoint, skipping a recipient', () => {
  const s = fs.readFileSync(path.join(API, 'routes', 'chits.js'), 'utf8');
  /* T2-SPLIT (2026-10-14): the write is the sendWrite step now — the same two lines, so matched whatever their indent */
  const m = /await withEntity\(sender_id, async \(c\) => \{\r?\n\s*await mint\.deliver\(sender_id, chit_id, copies, \{ is_draft: !!promote_draft_id, client: c \}\);/.exec(s);
  const i = m ? m.index : -1;
  assert.ok(i > 0, 'deliver runs on the route\'s own withEntity client');
  const block = s.slice(i, i + 600);
  assert.ok(/trySavepoint\(c, \(\) => require\('\.\.\/lib\/crm'\)\.traded\(c, sender_id, namedParty, now\), null\)/.test(block), 'traded in a savepoint, the shop clock\'s moment');
  assert.ok(/namedParty && !isRecipient/.test(block), 'a named party that also receives the chit is counted by the recipient block only');
  assert.ok(/require\('\.\.\/lib\/crm'\)\.namedParty\(business_json\)/.test(s), 'whom the bill names: lib/crm.namedParty → books-hooks.partyFromCustomer, the one reading');
  assert.strictEqual(crm.namedParty({ customer: { name: 'Anbu', party_id: P } }), P); assert.strictEqual(crm.namedParty({ customer: { entity_id: P } }), P); assert.strictEqual(crm.namedParty({}), null);
});
it('the stage stays DERIVED: assemble() says customer once txn_count > 0; isLead() is false then', () => {
  const src = fs.readFileSync(path.join(API, 'lib', 'crm.js'), 'utf8');
  assert.ok(/p\.lead = r\.added_via === 'lead' \? \{ stage: \(Number\(r\.txn_count\) \|\| 0\) > 0 \? 'customer'/.test(src));
  assert.strictEqual(crm.isLead({ lead: { stage: 'customer' }, customer: { txn_count: 1 }, roles: { supplier: false } }), false);
  assert.strictEqual(crm.isLead({ lead: { stage: 'trial' }, customer: { txn_count: 0 }, roles: { supplier: false } }), true);
});
(async () => { let ok = 0; for (const [w, f] of checks) { try { await f(); ok++; console.log('  ok  ' + w); } catch (e) { process.exitCode = 1; console.log('  FAIL ' + w + '\n      ' + e.message); } } console.log('  ' + ok + ' checks'); })();
