#!/usr/bin/env node
// @type: unit
/**
 * tests/walkax-reads-and-zero.test.cjs — AX-F-07 / AX-F-08 (2026-11-22), through the real router and the in-memory ledger.
 * OWNS      GET /cashflow (a garbage days is 400 "Pick 7 or 30 days.", a future asOf answers as at today) · GET /dues (a side that is neither customer nor supplier is 400) · POST /write-off amount 0 (400 "How much?", as -5 and "abc").
 * CALLED BY scripts/guards.cjs
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * The shop's day is the harness' pinned day; "future" is 2099-01-01.
 */
'use strict';
const path = require('path'), http = require('http');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111', MALA = '22222222-2222-4222-8222-222222222222';
const authStub = Object.assign((req, res, next) => { req.identity = { identity_id: SHOP, identity_type: 'entity', display_name: 'Chola Auto Care' }; next(); }, { entityOf: (req) => req.identity.identity_id, requireScope: () => (req, res, next) => next() });
let attempts = 0;
const call = (port, method, p, body) => new Promise((done) => {
  const b = body ? JSON.stringify(body) : '';
  const r = http.request({ host: '127.0.0.1', port, path: '/api/books' + p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b), 'Idempotency-Key': 'axr-' + ++attempts } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { /* read as {} */ } done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});
(async () => {
  if (!H.enginesSrc().dir) { console.log('   SKIP: ' + H.enginesSrc().why); process.exit(1); }
  const X = H.load({ auth: authStub });
  X.T.parties.push({ owner: SHOP, party_id: MALA, party_no: 'P-00001', name: 'Mala', customer: true, credit_days: 10 });
  const express = require('express'), app = express(); app.use(express.json());
  app.use('/api/books', require(path.join(H.API, 'routes', 'books'))); app.use('/api/books', require(path.join(H.API, 'routes', 'books-money')));
  const srv = app.listen(0), port = srv.address().port, g = (p) => call(port, 'GET', p), q = (p, b) => call(port, 'POST', p, b);
  await q('/enable', {});
  const cf = await g('/cashflow?days=7'), today = cf.body.asOf;
  ok('cashflow days=7 answers 200 (the good case is unchanged)', cf.status === 200 && cf.body.days === 7, cf.status + ' ' + JSON.stringify(cf.body).slice(0, 120));
  for (const bad of ['abc', '-5', '14']) {
    const r = await g('/cashflow?days=' + bad);
    ok('cashflow days=' + bad + ' -> 400 in words, not read as 7', r.status === 400 && /Pick 7 or 30 days/.test(String(r.body.error || r.body.message)), r.status + ' ' + JSON.stringify(r.body).slice(0, 140));
  }
  const fut = await g('/cashflow?days=7&asOf=2099-01-01');
  ok('cashflow asOf 2099-01-01 answers as at the shop\'s today, not a future day with zero figures', fut.status === 200 && fut.body.asOf === today, fut.status + ' ' + fut.body.asOf + ' vs ' + today);
  const side = await g('/dues?side=both');
  ok('dues side=both -> 400 in words', side.status === 400 && /customer or supplier/.test(String(side.body.error || side.body.message)), side.status + ' ' + JSON.stringify(side.body).slice(0, 140));
  ok('dues side=customer still answers 200', (await g('/dues?side=customer')).status === 200);
  for (const amount of [0, -5, 'abc']) {
    const r = await q('/write-off', { party_id: MALA, amount_minor: amount, reason: 'bad debt', date: '2026-10-20', client_ref: 'axr-wo' + amount });
    ok('write-off amount ' + JSON.stringify(amount) + ' -> 400 "How much?"', r.status === 400 && /How much\?/.test(String(r.body.error || r.body.message)), r.status + ' ' + JSON.stringify(r.body).slice(0, 160));
  }
  srv.close();
  console.log('\n' + (fail ? '  FAILED ' + fail : '  ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();
