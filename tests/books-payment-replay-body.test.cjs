#!/usr/bin/env node
// @type: unit
/**
 * tests/books-payment-replay-body.test.cjs — AW-F-01 (2026-11-22): POST /payments with the SAME client_ref and a CHANGED body is 409 EVENT_REF_REUSED.
 * OWNS      the payments route's replay step: routes/books.js POST /payments → B.recordPayment → firstPayment → books-event-guard.refuseOtherPayment (the same refusal
 *           as POST /events, books-event-guard.reused). Before, the route answered 200 duplicate:true with the first payment: an offline till that edited the amount was told it was recorded.
 * CALLED BY scripts/guards.cjs
 * CARD      16-finance/payments
 * Driven through the real router (Idempotency-Key per attempt, the in-memory ledger of tests/support/books-harness.cjs), so the route's own step order is what runs.
 * Hand figures: money in 400.00 = 40,000 paise; 300.00 sent again under the same ref. Money out 200.00 = 20,000; 250.00 sent again. Nothing may change in payments / entries.
 */
'use strict';
const path = require('path'), http = require('http');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111', MALA = '22222222-2222-4222-8222-222222222222', SUPP = '33333333-3333-4333-8333-333333333333';
const authStub = Object.assign((req, res, next) => { req.identity = { identity_id: SHOP, identity_type: 'entity', display_name: 'Chola Auto Care' }; next(); }, { entityOf: (req) => req.identity.identity_id, requireScope: () => (req, res, next) => next() });
let attempts = 0;
const call = (port, p, body) => new Promise((done) => {
  const b = JSON.stringify(body);
  const r = http.request({ host: '127.0.0.1', port, path: '/api/books' + p, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b), 'Idempotency-Key': 'aw-' + ++attempts } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { /* read as {} */ } done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});
(async () => {
  if (!H.enginesSrc().dir) { console.log('   SKIP: ' + H.enginesSrc().why); process.exit(1); }
  const X = H.load({ auth: authStub });
  X.T.parties.push({ owner: SHOP, party_id: MALA, party_no: 'P-00001', name: 'Mala', customer: true, credit_days: 10 }, { owner: SHOP, party_id: SUPP, party_no: 'P-00002', name: 'Kumar Traders', supplier: true, credit_days: 30 });
  const express = require('express'), app = express(); app.use(express.json());
  app.use('/api/books', require(path.join(H.API, 'routes', 'books'))); app.use('/api/books', require(path.join(H.API, 'routes', 'books-money')));
  const srv = app.listen(0), q = (p, b) => call(srv.address().port, p, b);
  await q('/enable', {});
  const base = { currency: 'INR', mode: 'cash', received_at: '2026-10-05', acknowledge: ['nothing_owed', 'excess'] };
  for (const c of [{ side: 'in', party: MALA, was: 40000, now: 30000, ref: 'awrc-1' }, { side: 'out', party: SUPP, was: 20000, now: 25000, ref: 'awpp-1' }]) {
    const body = (amount) => Object.assign({ party_id: c.party, direction: c.side, amount_minor: amount, client_ref: c.ref }, base);
    const one = await q('/payments', body(c.was));
    ok(c.side + ': the first send records (200, not a duplicate)', one.status === 200 && one.body.payment && one.body.payment.duplicate === false, JSON.stringify(one.body));
    const before = [X.T.payments.length, X.T.entries.length];
    const other = await q('/payments', body(c.now));
    ok(c.side + ': same ref, CHANGED amount -> 409 EVENT_REF_REUSED in words, not 200 duplicate', other.status === 409 && other.body.code === 'EVENT_REF_REUSED' && /already used for a different/.test(String(other.body.error || other.body.message)), other.status + ' ' + JSON.stringify(other.body));
    ok(c.side + ': nothing changed (payments and entries as before)', X.T.payments.length === before[0] && X.T.entries.length === before[1]);
    const same = await q('/payments', body(c.was));
    ok(c.side + ': same ref, SAME body -> still 200 duplicate:true with the first payment', same.status === 200 && same.body.payment && same.body.payment.duplicate === true && same.body.payment.payment_id === one.body.payment.payment_id, same.status + ' ' + JSON.stringify(same.body));
  }
  srv.close();
  console.log('\n' + (fail ? '  FAILED ' + fail : '  ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();
