#!/usr/bin/env node
// @type: unit
/**
 * tests/books-ref-guard-doors.test.cjs — AX-F-02 (2026-11-22): every books write door that takes a client_ref refuses a reused ref with a CHANGED body (409 EVENT_REF_REUSED) and replays the same body (200 duplicate:true).
 * OWNS      the doors loans, accruals, accruals, closing stock, contra and write-off, driven through the real router (the in-memory ledger of tests/support/books-harness.cjs).
 * CALLED BY scripts/guards.cjs
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * The asset door has no register in the in-memory store (503 before b280); it shares postOwn with these doors and is covered by tests/books-ref-guard-scan.test.cjs.
 * Hand figures: each door is sent once (first amount kept), then again with another amount under the same ref. Nothing may change in the entries after the second send.
 */
'use strict';
const path = require('path'), http = require('http');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111', MALA = '22222222-2222-4222-8222-222222222222';
const authStub = Object.assign((req, res, next) => { req.identity = { identity_id: SHOP, identity_type: 'entity', display_name: 'Chola Auto Care' }; next(); }, { entityOf: (req) => req.identity.identity_id, requireScope: () => (req, res, next) => next() });
let attempts = 0;
const call = (port, p, body) => new Promise((done) => {
  const b = JSON.stringify(body);
  const r = http.request({ host: '127.0.0.1', port, path: '/api/books' + p, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b), 'Idempotency-Key': 'ax-' + ++attempts } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { /* read as {} */ } done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});
(async () => {
  if (!H.enginesSrc().dir) { console.log('   SKIP: ' + H.enginesSrc().why); process.exit(1); }
  const X = H.load({ auth: authStub });
  X.T.parties.push({ owner: SHOP, party_id: MALA, party_no: 'P-00001', name: 'Mala', customer: true, credit_days: 10 });
  const express = require('express'), app = express(); app.use(express.json());
  app.use('/api/books', require(path.join(H.API, 'routes', 'books'))); app.use('/api/books', require(path.join(H.API, 'routes', 'books-money')));
  const srv = app.listen(0), q = (p, b) => call(srv.address().port, p, b);
  await q('/enable', {});
  /* a customer owing 500.00 so the write-off has something to write off */
  await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-10-01', currency: 'INR', party: MALA, source_chit_id: 'c0000000-0000-4000-8000-00000000000a', source_ref: 'chit:a', by_rate: [{ rate: 5, taxable: 1000, cgst: 25, sgst: 25, igst: 0 }], paid: {}, round_off: 0 });
  const doors = [
    { name: 'loan', path: '/loans', body: (n) => ({ ref: 'AX-LOAN', client_ref: 'ax-loan', lender: 'Bank', amount_minor: n, into: 'cash', date: '2026-10-05' }), was: 1000000, now: 1005000 },
    { name: 'loan instalment', path: '/loans/AX-LOAN/emi', body: (n) => ({ principal_minor: n, interest_minor: 5000, from: 'cash', date: '2026-10-10', client_ref: 'ax-emi' }), was: 100000, now: 150000 },
    { name: 'accrual', path: '/accruals', body: (n) => ({ ref: 'AX-ACC', client_ref: 'ax-acc', kind: 'outstanding', class: 'electricity', amount_minor: n, date: '2026-10-31' }), was: 30000, now: 35000 },
    { name: 'closing stock', path: '/closing-stock', body: (n) => ({ date: '2026-10-31', value_minor: n, method: 'manual', client_ref: 'ax-stock' }), was: 500000, now: 505000 },
    { name: 'write-off', path: '/write-off', body: (n) => ({ party_id: MALA, amount_minor: n, reason: 'bad debt', date: '2026-10-20', client_ref: 'ax-wo' }), was: 10000, now: 15000 },
    { name: 'contra', path: '/contra', body: (n) => ({ from: 'cash', to: 'bank', amount_minor: n, date: '2026-10-06', client_ref: 'ax-contra' }), was: 10000, now: 15000 }
  ];
  for (const d of doors) {
    const one = await q(d.path, d.body(d.was));
    ok(d.name + ': the first send posts (200, not a duplicate)', one.status === 200 && !one.body.duplicate, one.status + ' ' + JSON.stringify(one.body));
    const before = X.T.entries.length;
    const other = await q(d.path, d.body(d.now));
    ok(d.name + ': same ref, CHANGED amount -> 409 EVENT_REF_REUSED in words, not 200 duplicate', other.status === 409 && other.body.code === 'EVENT_REF_REUSED' && /already used for a different/.test(String(other.body.error || other.body.message)), other.status + ' ' + JSON.stringify(other.body));
    ok(d.name + ': nothing changed in the entries', X.T.entries.length === before);
    const same = await q(d.path, d.body(d.was));
    ok(d.name + ': same ref, SAME body -> still 200 duplicate (a replay)', same.status === 200 && (same.body.duplicate === true || same.body.posted && same.body.posted.duplicate === true || JSON.stringify(same.body).includes('"duplicate":true')), same.status + ' ' + JSON.stringify(same.body));
  }
  srv.close();
  console.log('\n' + (fail ? '  FAILED ' + fail : '  ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();
