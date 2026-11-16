/**
 * dues-zero-party.test.cjs — E15 (Fable multi-role walk 17 Nov): Who owes whom listed a party whose bills were all paid ("Ravi Stores A$0.00 · 2 shown").
 * A party with no open document and a zero balance is not a row. Pure and offline (the in-memory books). Run: node tests/dues-zero-party.test.cjs
 * HAND-COMPUTED  Ravi: a bill of 1,000.00 (taxable 1000 major = 100000 minor) then a receipt of 100000 allocated oldest first → 0 open. Sita: one bill of 50.00 (5000 minor), unpaid.
 *   Asked as at 30 Sep 2026 (a past day reads every row, so a settled party is still in the ageing). Before the receipt: parties = [Ravi 100000, Sita 5000], total 105000. After it: parties = [Sita 5000], total 5000.
 * OWNS the offline guard of E15.   CALLED BY scripts/guards.cjs.   CARD 14-accounting
 */
'use strict';
const path = require('path');
const http = require('http');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111', RAVI = '77777777-7777-4777-8777-777777777777', SITA = '88888888-8888-4888-8888-888888888888';
const owner = { identity_id: SHOP, identity_type: 'entity', display_name: 'Shop' };
const auth = Object.assign((req, res, next) => { req.identity = owner; next(); }, { entityOf: (req) => req.identity.identity_id, requireScope: () => (req, res, next) => next() });
let attempt = 0;
const call = (port, method, p, body) => new Promise((done) => {
  const b = body ? JSON.stringify(body) : '';
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b), 'Idempotency-Key': 'z-' + ++attempt } },
    (res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});
const bill = (X, party, day, no, amount) => X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: day, currency: 'INR', party, source_chit_id: 'c0000000-0000-4000-8000-0000000000' + no, source_ref: 'chit:' + no, by_rate: [{ rate: 0, taxable: amount, cgst: 0, sgst: 0, igst: 0 }], paid: {}, round_off: 0 });

(async () => {
  if (!H.enginesSrc().dir) { console.log('SKIP: ' + H.enginesSrc().why); process.exit(1); }
  const X = H.load({ auth });
  X.T.parties.push({ owner: SHOP, party_id: RAVI, party_no: 'P-00001', name: 'Ravi', customer: true, credit_days: 30, credit_limit_minor: null, terms: {} });
  X.T.parties.push({ owner: SHOP, party_id: SITA, party_no: 'P-00002', name: 'Sita', customer: true, credit_days: 30, credit_limit_minor: null, terms: {} });
  const express = require('express'), app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0), port = srv.address().port, q = (m, p, b) => call(port, m, '/api/books' + p, b);
  require(path.join(H.API, 'lib', 'bill-checks')).attach = async (h, e, req, prop) => { prop.proposal.forEach((r) => Object.assign(r, { entry_id: null, chit_id: null, mark: null, evidence_flag: null })); return { mark_actions: [] }; };
  const CLOCK = require(path.join(H.API, 'lib', 'shop-clock')); CLOCK.set('2026-11-16T06:00:00Z');
  try {
    await q('POST', '/enable', {});
    await bill(X, RAVI, '2026-07-10', '01', 1000);
    await bill(X, SITA, '2026-07-10', '02', 50);
    const before = (await q('GET', '/dues?side=customer&asOf=2026-09-30')).body;
    ok('before the receipt: Ravi and Sita, 105000', (before.parties || []).length === 2 && before.total_minor === 105000, JSON.stringify(before.parties));
    const pay = await q('POST', '/payments', { party_id: RAVI, direction: 'in', amount_minor: 100000, currency: 'INR', mode: 'cash', received_at: '2026-07-12', allocate: 'oldest_first', client_ref: 'r1' });
    ok('the receipt posts', pay.status === 200, pay.status + JSON.stringify(pay.body).slice(0, 200));
    const after = (await q('GET', '/dues?side=customer&asOf=2026-09-30')).body;
    ok('after it: Sita alone (Ravi owes nothing and holds nothing open)', (after.parties || []).length === 1 && after.parties[0].party_id === SITA, JSON.stringify((after.parties || []).map((p) => [p.party_id, p.balance_minor])));
    ok('the total is the same carried figure: 5000', after.total_minor === 5000, String(after.total_minor));
  } finally {
    srv.close();
  }
  console.log('\n  ' + (fail ? '✗' : '✓') + ' ' + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
