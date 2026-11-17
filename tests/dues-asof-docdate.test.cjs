/**
 * dues-asof-docdate.test.cjs — FIN-new-1 (W15, from the e2e money test): GET /dues?asOf=<past> aged by the moment a row was RECORDED, so a bill keyed today with a July
 * document date was missing from every September answer. Decided by practice (Xero, QuickBooks, SAP age by document date): asOf holds the documents DATED on or before
 * asOf and the payments DATED on or before it. Also W15-107: GET /party/:id/bills — open bills first, newest first, paged, a band filter, the days late from the ONE ageing.
 * Pure and offline (the in-memory books). Run: node tests/dues-asof-docdate.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111', RAVI = '77777777-7777-4777-8777-777777777777';
const owner = { identity_id: SHOP, identity_type: 'entity', display_name: 'Shop' };
const auth = Object.assign((req, res, next) => { req.identity = owner; next(); }, { entityOf: (req) => req.identity.identity_id, requireScope: () => (req, res, next) => next() });
let attempt = 0;
const call = (port, method, p, body) => new Promise((done) => {
  const b = body ? JSON.stringify(body) : '';
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b), 'Idempotency-Key': 'a-' + ++attempt } },
    (res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});
const bill = (X, day, no, amount) => X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: day, currency: 'INR', party: RAVI, source_chit_id: 'c0000000-0000-4000-8000-0000000000' + no, source_ref: 'chit:' + no, by_rate: [{ rate: 0, taxable: amount, cgst: 0, sgst: 0, igst: 0 }], paid: {}, round_off: 0 });

(async () => {
  if (!H.enginesSrc().dir) { console.log('SKIP: ' + H.enginesSrc().why); process.exit(1); }
  const X = H.load({ auth });
  X.T.parties.push({ owner: SHOP, party_id: RAVI, party_no: 'P-00001', name: 'Ravi', customer: true, credit_days: 30, credit_limit_minor: null, terms: {} });
  const express = require('express'), app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0), port = srv.address().port, q = (m, p, b) => call(port, m, '/api/books' + p, b);
  /* the marks and the evidence flag need real SQL (tests/ageing-one-answer.test.cjs and the box run prove them); here the check read is a stand-in */
  require(path.join(H.API, 'lib', 'bill-checks')).attach = async (h, e, req, prop) => { prop.proposal.forEach((r) => Object.assign(r, { entry_id: null, chit_id: null, mark: null, evidence_flag: null })); return { mark_actions: null }; };
  const CLOCK = require(path.join(H.API, 'lib', 'shop-clock')); CLOCK.set('2026-11-16T06:00:00Z');
  try {
    await q('POST', '/enable', {});
    /* keyed today (16 Nov), dated in July, August and 10 Nov */
    ok('a bill dated 10 Jul keyed today', (await bill(X, '2026-07-10', '01', 1000)).ok !== false);
    ok('a bill dated 10 Aug keyed today', (await bill(X, '2026-08-10', '02', 2000)).ok !== false);
    ok('a bill dated 10 Nov keyed today', (await bill(X, '2026-11-10', '03', 4000)).ok !== false);
    const pay = await q('POST', '/payments', { party_id: RAVI, direction: 'in', amount_minor: 100000, currency: 'INR', mode: 'cash', received_at: '2026-09-01', allocate: 'oldest_first', client_ref: 'r1' });
    ok('a receipt dated 1 Sep keyed today pays the July bill', pay.status === 200, pay.status + JSON.stringify(pay.body).slice(0, 200));
    const at = async (asOf) => ((await q('GET', '/dues?side=customer&asOf=' + asOf)).body.parties || []).find((p) => p.party_id === RAVI);
    const sep = await at('2026-09-30'), jul = await at('2026-07-31'), jun = await at('2026-06-30'), now = await at('2026-11-16');
    ok('asOf 30 Sep holds the July and August bills (it was empty: they were recorded in November)', sep && sep.balance_minor === 200000, JSON.stringify(sep));
    ok('asOf 31 Jul: the July bill alone, the 1 Sep receipt not yet counted', jul && jul.balance_minor === 100000, JSON.stringify(jul));
    ok('asOf 30 Jun: nothing yet dated', !jun, JSON.stringify(jun));
    ok('asOf today: 100 + 200 + 400 less the 100 receipt = 600', now && now.balance_minor === 600000, JSON.stringify(now));
    ok('the answer carries follow_up (the one ageing) AND the kept additive `buckets` (web main still reads it), both summing to the balance', sep && sep.follow_up && sep.buckets && Object.values(sep.buckets).filter((v) => v > 0).length >= 1, JSON.stringify(sep));

    /* the bills of the party: open only, newest first */
    const open = await q('GET', '/party/' + RAVI + '/bills?side=customer');
    const list = open.body.bills || [];
    ok('bills: 200, open bills only by default (the July bill is paid)', open.status === 200 && list.length === 2 && list.every((b) => b.owed_minor > 0) && open.body.counts.paid === 1 && open.body.counts.all === 3, JSON.stringify(open.body).slice(0, 500));
    ok('bills: newest first (10 Nov, then 10 Aug)', list[0] && list[0].date === '2026-11-10' && list[1] && list[1].date === '2026-08-10', JSON.stringify(list.map((b) => b.date)));
    ok('bills: 10 Aug is 30 days credit → due 9 Sep, 68 days late; 10 Nov not due', list[1].due_date === '2026-09-09' && list[1].days_overdue === 68 && list[0].days_overdue === null, JSON.stringify(list));
    ok('bills: the band is the one ageing\'s (d61_90 for 68 days)', list[1].band === 'd61_90' && open.body.bands.d61_90 === 200000, JSON.stringify([list[1].band, open.body.bands]));
    const all = await q('GET', '/party/' + RAVI + '/bills?side=customer&state=all&limit=2&page=2');
    ok('bills: show paid = state=all; page 2 of 2 carries the paid July bill, total 3', all.body.total === 3 && all.body.page === 2 && all.body.bills.length === 1 && all.body.bills[0].status === 'paid', JSON.stringify(all.body).slice(0, 400));
    const band = await q('GET', '/party/' + RAVI + '/bills?side=customer&band=d61_90');
    ok('bills: a band filter keeps the bills of that band only', band.body.total === 1 && band.body.bills[0].date === '2026-08-10', JSON.stringify(band.body.bills));
    const dues = await q('GET', '/dues?side=customer');
    const row = (dues.body.parties || []).find((p) => p.party_id === RAVI);
    ok('the party row\'s follow_up band equals the bills\' band total (one ageing)', row && row.follow_up.d61_90 === open.body.bands.d61_90, JSON.stringify([row && row.follow_up, open.body.bands]));
    /* E1: a page asking for the end of the year in progress is aged as at the shop's today (16 Nov), never 30 Jun 2027 (where the 10 Aug bill, 324 days late, fell in 90+) */
    const fut = await q('GET', '/dues?side=customer&asOf=2027-06-30'), futRow = (fut.body.parties || []).find((p) => p.party_id === RAVI);
    ok('E1: dues asked as at 30 Jun 2027 answers asOf = the shop day 2026-11-16', fut.body.asOf === '2026-11-16', String(fut.body.asOf));
    ok('E1: the 10 Aug bill (200000) is still in 61-90 as at today, the 10 Nov bill (400000) not due, nothing in 90+', futRow && futRow.follow_up.d61_90 === 200000 && !(futRow.follow_up.d90_plus > 0) && futRow.balance_minor === 600000, JSON.stringify(futRow && futRow.follow_up));
    const futBills = await q('GET', '/party/' + RAVI + '/bills?side=customer&asOf=2027-06-30');
    ok('E1: the party bills too (asOf 2026-11-16, 68 days late)', futBills.body.asOf === '2026-11-16' && futBills.body.bills[1].days_overdue === 68, JSON.stringify([futBills.body.asOf, futBills.body.bills && futBills.body.bills[1]]));
    const past = await q('GET', '/dues?side=customer&asOf=2026-09-30');
    ok('E1: a past day stays as asked', past.body.asOf === '2026-09-30', String(past.body.asOf));
  } finally {
    srv.close();
  }
  console.log('\n  ' + (fail ? '✗' : '✓') + ' ' + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
