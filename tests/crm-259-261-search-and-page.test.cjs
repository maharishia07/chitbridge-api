/**
 * CARD  11-crm-and-marketing/crm-parties
 * CRM-259 · CRM-261 (batch 1136): GET /api/crm/parties honours ?q on the server (name, nickname, party no, user id, phone, e-mail; a phone however spaced), and pages by the shared limitOf:
 * 500 a page by default, { total, page, limit, next } with next = the next page number or null on the last. Offline over tests/support/crm-stub.cjs.
 * Run: node tests/crm-259-261-search-and-page.test.cjs
 */
'use strict';
const assert = require('assert');
const { make, row } = require('./support/crm-stub.cjs');
const t = make();
const D = t.data;
const P = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const cs = (r) => Object.assign({}, r, { customer_type: 'entity', added_via: 'manual', txn_count: 1, last_txn_at: '2026-09-30T10:00:00Z', groups: [], segment: 'regular' });
let pass = 0;
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n      ')); process.exitCode = 1; } };

(async () => {
  D.cust = [
    cs(row({ party_id: P(1), display_name: 'Agro Mills', user_id: 'agromills', party_no: 'P-0001', phone: '+61 412 345 678' })),
    cs(row({ party_id: P(2), display_name: 'Chola Auto Care', user_id: 'chola', party_no: 'P-0002' })),
    cs(row({ party_id: P(3), display_name: 'Ravi Traders', user_id: 'ravi', party_no: 'P-0003' }))
  ];
  D.sup = []; D.walk = [];
  await ita('?q narrows by name, and total counts the match, not the shop', async () => {
    const r = await t.get('/parties?q=chola');
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.parties.map((p) => p.party_id), [P(2)]);
    assert.strictEqual(r.body.total, 1);
    assert.strictEqual(r.body.next, null);
  });
  await ita('?q finds a party number, and a phone however it is spaced', async () => {
    assert.deepStrictEqual((await t.get('/parties?q=P-0003')).body.parties.map((p) => p.party_id), [P(3)]);
    assert.deepStrictEqual((await t.get('/parties?q=' + encodeURIComponent('+61412345678'))).body.parties.map((p) => p.party_id), [P(1)]);
  });
  await ita('no match is an empty page, never an error', async () => {
    const r = await t.get('/parties?q=zzzz');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.total, 0);
    assert.deepStrictEqual(r.body.parties, []);
  });
  await ita('paged: limit 2 gives next 2, then null; the pages add up to the shop', async () => {
    const a = (await t.get('/parties?limit=2')).body;
    assert.strictEqual(a.parties.length, 2);
    assert.strictEqual(a.total, 3);
    assert.strictEqual(a.limit, 2);
    assert.strictEqual(a.next, 2);
    const b = (await t.get('/parties?limit=2&page=2')).body;
    assert.strictEqual(b.parties.length, 1);
    assert.strictEqual(b.next, null);
  });
  await ita('the default page is 500 (not 5000) and says there is a next page', async () => {
    const keep = D.cust;
    const extra = [];
    for (let i = 0; i < 510; i++) extra.push(cs(row({ party_id: P(1000 + i), display_name: 'Bulk ' + i, user_id: 'bulk' + i })));
    D.cust = keep.concat(extra);
    const r = (await t.get('/parties')).body;
    assert.strictEqual(r.parties.length, 500);
    assert.strictEqual(r.limit, 500);
    assert.strictEqual(r.total, 513);
    assert.strictEqual(r.next, 2);
    assert.strictEqual((await t.get('/parties?limit=9000')).body.limit, 500, 'a bigger ask is cut to the ceiling');
    D.cust = keep;
  });
  t.close();
  console.log(pass + ' checks');
})();
