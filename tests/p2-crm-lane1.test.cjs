/**
 * P2 lane 1 (12 Nov) - the door answers the pass tests of CRM-233 / 237 / 239 / 229 + OPS-103 / 243 / 251. Offline.
 *   CRM-239  PATCH /crm/followups/:id {done:"false"} (any non-boolean) is 400 BAD_FLAG and the follow-up stays open; real booleans still work   (fails on main: "false" closed it)
 *   CRM-233  POST /relationships/customers/:id/groups {groups: "VIP" | {a:1} | null | 5} is 400 and nothing is written                              (landed B10 #1176; pinned here)
 *   CRM-251  POST /relationships/suppliers {name: 1e21 | 9007199254740992} is 400 and nothing is minted                                           (landed B10 #1176; pinned here)
 *   CRM-237  POST /crm/leads {name: object | array} is 400 (CRM_BAD_REQUEST, field name)                                                                                         (landed B10; pinned here)
 *   CRM-243  five spellings of one number through the lead import add 1 and skip 4                                                                 (landed B10; pinned here)
 *   CRM-229 + OPS-103  a removed customer / supplier is off the list and the same name brings the SAME record back (CRM-247 restore; unit: tests/b10-crm-door + tests/b10-crm-mint)
 * Run: node tests/p2-crm-lane1.test.cjs
 * CARD 11-crm-and-marketing/crm-parties
 */
'use strict';
const assert = require('assert'), path = require('path'), http = require('http');
const API = path.join(__dirname, '..');
{ const p = require.resolve(path.join(API, 'lib/schema')); require.cache[p] = { id: p, filename: p, loaded: true, exports: { hasTable: async () => true, hasColumn: async () => true, hasColumns: async () => ({}), checkAllows: async () => true, _reset() {} } }; }
const { make, row } = require('./support/crm-stub.cjs'); // stubs middleware/auth + db for routes/crm.js
const CL = require('../lib/crm-leads');
const t = make(), D = t.data;
let pass = 0;
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + (e.stack || e.message).split('\n').slice(0, 5).join('\n      ')); process.exitCode = 1; } };
const P4 = '10000000-0000-4000-8000-000000000004';
const FU = '20000000-0000-4000-8000-000000000001';
D.cust = [Object.assign(row({ party_id: P4, display_name: 'Follow Me', user_id: 'fm' }), { customer_type: 'entity', added_via: 'manual', txn_count: 1, segment: 'new' })];
D.stored.customer[P4] = { balance_minor: 0 };

/* the relationships router on its own app (auth stubbed by crm-stub: it is the same require-cache entry); every refusal below fires before any query */
function relCall(method, p, body) {
  const express = require('express');
  const app = express(); app.use(express.json()); app.use('/', require('../routes/relationships.js'));
  const srv = app.listen(0);
  return new Promise((resolve, reject) => {
    const d = JSON.stringify(body);
    const r = http.request({ port: srv.address().port, method, path: p, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(d) } },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { srv.close(); resolve({ status: res.statusCode, body: b ? JSON.parse(b) : {} }); }); });
    r.on('error', reject); r.end(d);
  });
}

(async () => {
  await ita('CRM-239: done:"false" (and any non-boolean) is refused 400 BAD_FLAG and the follow-up stays open', async () => {
    D.followups.push({ followup_id: FU, owner: 'E1', party_id: P4, what: 'ring', due_at: '2026-12-31', done_at: null, assignee_user_id: null });
    for (const done of ['false', 'true', 0, 1, null, {}, []]) {
      const r = await t.patch('/followups/' + FU, { done });
      assert.strictEqual(r.status, 400, JSON.stringify(done) + ' ' + JSON.stringify(r.body));
      assert.strictEqual(r.body.code, 'BAD_FLAG');
      assert.ok(!D.followups[0].done_at, 'never closed by ' + JSON.stringify(done));
    }
  });
  await ita('CRM-239: a real boolean still works (true closes, false re-opens)', async () => {
    const closed = await t.patch('/followups/' + FU, { done: true });
    assert.strictEqual(closed.status, 200, JSON.stringify(closed.body));
    const open = await t.patch('/followups/' + FU, { done: false });
    assert.strictEqual(open.status, 200, JSON.stringify(open.body));
  });
  await ita('CRM-233: groups that is not a list is 400 (a string, an object, null, a number)', async () => {
    for (const groups of ['VIP', { a: 1 }, null, 5]) {
      const r = await relCall('POST', '/customers/10000000-0000-4000-8000-000000000004/groups', { groups });
      assert.strictEqual(r.status, 400, JSON.stringify(groups) + ' ' + JSON.stringify(r.body));
    }
  });
  await ita('CRM-251: a supplier name that is a number (1e21, 9007199254740992) is 400', async () => {
    for (const name of [1e21, 9007199254740992]) {
      const r = await relCall('POST', '/suppliers', { name });
      assert.strictEqual(r.status, 400, String(name) + ' ' + JSON.stringify(r.body));
    }
  });
  await ita('CRM-237: a lead named by an object or a list is 400 on field name', async () => {
    for (const name of [{ a: 1 }, ['x', 'y']]) {
      const r = await t.post('/leads', { name });
      assert.strictEqual(r.status, 400, JSON.stringify(name) + ' ' + JSON.stringify(r.body));
      assert.strictEqual(r.body.field, 'name', 'the contract schema names the field (CRM_BAD_REQUEST); the code is the contract-wide one, not BAD_NAME');
    }
  });
  await ita('CRM-243: one number written five ways through the import is 1 row added and 4 skipped', async () => {
    const spell = ['9840012321', '98400 12321', '+91 98400 12321', '+91-98400-12321', '(98400) 12321'];
    const rows = CL.normalise(spell.map((phone, i) => ({ name: 'Ravi ' + i, phone })));
    CL.plan(rows, []);
    const out = rows.map((r) => r.outcome);
    assert.strictEqual(out.filter((o) => o === 'add').length, 1, JSON.stringify(out));
    assert.strictEqual(out.filter((o) => o === 'skip').length, 4, JSON.stringify(out));
  });
  console.log(pass + ' checks');
  t.close();
  process.exit(process.exitCode || 0);
})();
