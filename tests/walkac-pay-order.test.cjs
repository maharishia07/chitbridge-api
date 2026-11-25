/**
 * walkac-pay-order.test.cjs - walk AC 1129 (AE) findings AC-F-09 and AC-F-10, through the real router over the in-memory store.
 *   AC-F-09 oldest first on two bills of the SAME day: the lower bill number is paid first (the chit id is arbitrary and must not decide).
 *   AC-F-10 paying exactly the amount still open is a new payment: W4 just_settled (compared with the ORIGINAL bill) stays silent.
 * Hand: AB-1 500.00 + 5% = 525.00 (chit id ...9); AB-2 200.00 + 5% = 210.00 (chit id ...1, so an id sort puts AB-2 first). Pay 210.00 oldest first:
 *   AB-1 takes 210.00 (open 315.00), AB-2 untouched. Then pay 315.00 (AB-1's open) and 210.00 (AB-2's) in turn.
 * Run: node tests/walkac-pay-order.test.cjs
 * CARD      16-finance/payments
 */
'use strict';
const path = require('path');
const http = require('http');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const SHOP = '11111111-1111-4111-8111-111111111111', SUPP = '33333333-3333-4333-8333-333333333333';
const authStub = Object.assign((req, res, next) => { req.identity = { identity_id: SHOP, identity_type: 'entity', display_name: 'Chola Auto Care' }; next(); }, {
  entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id,
  requireScope: () => (req, res, next) => next(),
});
let attempts = 0;
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b), 'Idempotency-Key': 'attempt-' + ++attempts } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});
(async () => {
  console.log('\n== walk AC 1129 - oldest first by number, the open amount is not a duplicate ==');
  if (!H.enginesSrc().dir) { console.log('\n   SKIP: ' + H.enginesSrc().why + '\n'); process.exit(1); }
  const X = H.load({ auth: authStub });
  X.db.query = ((realQuery) => async (text, v) => (/SELECT can_see_costs FROM identities/.test(String(text)) ? { rows: [{ can_see_costs: true }] } : realQuery(text, v)))(X.db.query);
  X.T.parties.push({ owner: SHOP, party_id: SUPP, party_no: 'P-00002', name: 'Kumar Traders', supplier: true, credit_days: 30 });
  const express = require('express');
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books'))); app.use('/api/books', require(path.join(H.API, 'routes', 'books-money')));
  const srv = app.listen(0), port = srv.address().port, q = (m, p, b) => call(port, m, '/api/books' + p, b);
  await q('POST', '/enable', {});
  const ID = (n) => 'c0000000-0000-4000-8000-00000000000' + n;
  for (const [n, no, taxable, half] of [['9', 'AB-1', 500, 12.5], ['1', 'AB-2', 200, 5]]) {
    await X.B.postEntry(X.db, SHOP, { type: 'purchase_bill', date: '2026-09-01', currency: 'INR', party: SUPP, source_chit_id: ID(n), source_ref: 'chit:' + n,
      by_rate: [{ rate: 5, taxable, cgst: half, sgst: half, igst: 0 }], paid: {}, round_off: 0 });
    X.T.chits.push({ chit_id: ID(n), bill_no: no, entity_id: SHOP, purpose: 'order', business_json: { bill_no: no } });
  }
  const pv = await q('POST', '/payments/preview', { party_id: SUPP, direction: 'out', amount_minor: 21000, currency: 'INR', allocate: 'oldest_first' });
  eq('AC-F-09: ₹210.00 oldest first -> AB-1 (the lower number) takes it, AB-2 is untouched',
    pv.body.proposal.map((p) => [p.bill_no, p.open_minor, p.apply_minor]), [['AB-1', 52500, 21000], ['AB-2', 21000, 0]]);
  const PAY = { party_id: SUPP, direction: 'out', currency: 'INR', mode: 'cash', received_at: new Date().toISOString().slice(0, 10) };
  const rec = await q('POST', '/payments', Object.assign({}, PAY, { amount_minor: 52500, allocate: 'oldest_first', client_ref: 'ac-1' }));
  ok('₹525.00 oldest first settles AB-1 whole', rec.status === 200 && rec.body.allocation && rec.body.allocation.allocated_minor === 52500, JSON.stringify(rec.body).slice(0, 300));
  /* the in-memory rows carry no clock of their own: stamp them as written now, as the real store does */
  const now = new Date().toISOString();
  X.T.payments.forEach((p) => { p.created_at = now; p.received_at = now.slice(0, 10); });
  X.T.items.forEach((i) => { i.created_at = now; });
  const after = await q('POST', '/payments/preview', { party_id: SUPP, direction: 'out', amount_minor: 21000, currency: 'INR' });
  ok('AC-F-10: paying the ₹210.00 still open on AB-2 right after AB-1 was settled -> no just_settled, no "Already paid?"',
    after.status === 200 && !(after.body.warnings || []).some((w) => w.code === 'just_settled'), JSON.stringify(after.body.warnings));
  const rec2 = await q('POST', '/payments', Object.assign({}, PAY, { amount_minor: 21000, allocate: 'oldest_first', client_ref: 'ac-2' }));
  ok('…and it records without an acknowledgement', rec2.status === 200, rec2.status + ' ' + JSON.stringify(rec2.body).slice(0, 300));
  srv.close();
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();
