/**
 * A-F-47 (Walk A, 21 Nov 2026): the leads import kept the e-mail column only inside a timeline note, so the record said "No e-mail yet".
 * party-contact.fillMany keeps it as the party's e-mail in ONE statement, never over an address the shop already holds; the import calls it for add + merge rows.
 * Run: node tests/crm-leads-import-email.test.cjs   (offline)
 * CARD      11-crm-and-marketing/leads-import-stages
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
{ const p = require.resolve(path.join(API, 'lib/schema')); require.cache[p] = { id: p, filename: p, loaded: true, exports: { hasTable: async () => true, hasColumn: async () => true } }; }
const PC = require(path.join(API, 'lib/party-contact'));
(async () => {
  const calls = [];
  const db = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: params[1].length }; } };
  const n = await PC.fillMany(db, 'OWNER', [{ party_id: 'p1', email: 'a@x.com' }, { party_id: 'p2', email: 'b@x.com' }, { party_id: 'p3', email: null }, null]);
  assert.strictEqual(n, 2); assert.strictEqual(calls.length, 1, 'one statement for the whole file');
  assert.ok(/ON CONFLICT \(owner_entity_id, party_id, channel\) DO NOTHING/.test(calls[0].sql), 'an address the shop already holds is not overwritten');
  assert.deepStrictEqual(calls[0].params[1], ['p1', 'p2']); assert.deepStrictEqual(calls[0].params[2], ['a@x.com', 'b@x.com']);
  assert.strictEqual(await PC.fillMany(db, 'OWNER', []), 0); assert.strictEqual(calls.length, 1, 'nothing to keep, nothing sent');
  const src = fs.readFileSync(path.join(API, 'lib/crm-leads.js'), 'utf8');
  assert.ok(/party-contact'\)\.fillMany\(h, owner, mails\)/.test(src), 'importLeads keeps the e-mail through fillMany');
  console.log('  ok  A-F-47: 4 checks');
})().catch((e) => { console.error('FAIL ' + e.message); process.exit(1); });
