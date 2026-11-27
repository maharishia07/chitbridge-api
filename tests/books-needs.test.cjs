/**
 * books-needs.test.cjs — W15-114/115/116: who needs you, and why, counted on the server by ONE list of reasons (lib/books-needs).
 *   · reasonsOf: a bill's reasons in the order they matter (a hold keeps its reason beside the tax-invoice flag; the web shows one chip + n)
 *   · partyNeeds: the flag (the Day book's rule asked of THESE entries) and the open marks, by bill and by party
 *   · GET /dues carries `needs` per party and by side; GET /party/:id/bills?tab=needs|open|all carries the same counts, a why and ONE action per bill (the same number, three screens)
 * Pure and offline (the in-memory books). Run: node tests/books-needs.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const H = require('./support/books-harness.cjs');
const Needs = require(path.join(H.API, 'lib', 'books-needs'));
const Evidence = require(path.join(H.API, 'lib', 'books-evidence'));

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const SHOP = '11111111-1111-4111-8111-111111111111', RAVI = '77777777-7777-4777-8777-777777777777', MEERA = '88888888-8888-4888-8888-888888888888';
const owner = { identity_id: SHOP, identity_type: 'entity', display_name: 'Shop' };
const auth = Object.assign((req, res, next) => { req.identity = owner; next(); }, { entityOf: (req) => req.identity.identity_id, requireScope: () => (req, res, next) => next() });
let attempt = 0;
const call = (port, method, p, body) => new Promise((done) => {
  const b = body ? JSON.stringify(body) : '';
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b), 'Idempotency-Key': 'n-' + ++attempt } },
    (res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});
const bill = (X, party, day, no, amount) => X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: day, currency: 'INR', party, source_chit_id: 'c0000000-0000-4000-8000-0000000000' + no, source_ref: 'chit:' + no, by_rate: [{ rate: 0, taxable: amount, cgst: 0, sgst: 0, igst: 0 }], paid: {}, round_off: 0 });

(async () => {
  /* ── the pure part ── */
  const base = { owed_minor: 5000, disputed: false, no_terms: false, days_overdue: null, evidence_flag: null, mark: null };
  ok('reasons: a clean bill has none', same(Needs.reasonsOf(base), []));
  ok('reasons: a paid bill has none whatever it carries', same(Needs.reasonsOf(Object.assign({}, base, { owed_minor: 0, days_overdue: 30, disputed: true })), []));
  ok('reasons: late, no terms, flag, query, dispute, in the order they matter', same(Needs.reasonsOf(Object.assign({}, base, { days_overdue: 9, overdue: true, no_terms: true, evidence_flag: 'no_tax_invoice', disputed: true, mark: { class: 'open' } })), ['disputed', 'query', 'no_tax_invoice', 'no_terms', 'overdue']));
  /* ACC-412: no terms = no due date = never overdue, whatever age the band carries; both the flag and the days-only caller agree */
  ok('ACC-412 reasons: a no-terms bill is no_terms only, never overdue (flag false)', same(Needs.reasonsOf(Object.assign({}, base, { no_terms: true, overdue: false, days_overdue: null })), ['no_terms']));
  ok('ACC-412 reasons: a no-terms bill with days but no flag is still never overdue', same(Needs.reasonsOf(Object.assign({}, base, { no_terms: true, days_overdue: 40 })), ['no_terms']));
  ok('ACC-412 reasons: a bill past its real due date (overdue true) is overdue', same(Needs.reasonsOf(Object.assign({}, base, { overdue: true, days_overdue: 3 })), ['overdue']));
  ok('reasons: a hold WITH the flag keeps both, held first so Release is offered', same(Needs.reasonsOf(Object.assign({}, base, { evidence_flag: 'no_tax_invoice', mark: { class: 'hold' } })), ['held', 'no_tax_invoice']) && Needs.ACTION[Needs.reasonsOf(Object.assign({}, base, { evidence_flag: 'no_tax_invoice', mark: { class: 'hold' } }))[0]] === 'release');
  ok('reasons: hostile bill, a hold + the flag + a dispute + late all kept in order', same(Needs.reasonsOf(Object.assign({}, base, { days_overdue: 4, disputed: true, evidence_flag: 'no_tax_invoice', mark: { kind: 'on_hold' } })), ['disputed', 'held', 'no_tax_invoice', 'overdue']));
  ok('reasons: a query + the flag keeps both', same(Needs.reasonsOf(Object.assign({}, base, { evidence_flag: 'no_tax_invoice', mark: { class: 'open' } })), ['query', 'no_tax_invoice']));
  ok('reasons: a hold with no flag is "held" (Release)', same(Needs.reasonsOf(Object.assign({}, base, { mark: { class: 'hold' } })), ['held']) && Needs.ACTION.held === 'release');
  ok('reasons: due today is not late', same(Needs.reasonsOf(Object.assign({}, base, { days_overdue: 0 })), []));
  ok('actions: attach, release, answer, terms, pay', Needs.ACTION.no_tax_invoice === 'attach' && Needs.ACTION.query === 'answer' && Needs.ACTION.disputed === 'answer' && Needs.ACTION.no_terms === 'terms' && Needs.ACTION.overdue === 'pay');

  const queries = [], fakeH = { query: async (sql) => { queries.push(sql); return { rows: [] }; } };
  const asked = [];
  const realFlag = Evidence.flaggedAmong, realMarks = Needs.openMarks;
  Evidence.flaggedAmong = async (h, e, ctx, ids) => { asked.push(ids.slice()); return ids.filter((id) => id === 'e1' || id === 'e2'); };
  Needs.openMarks = async () => [{ subject_id: 'e2', class: 'hold' }, { subject_id: 'e3', class: 'open' }, { subject_id: 'e9', class: 'open' }];
  const bills = [
    { ref: 'B1', party: 'P1', entry_id: 'e1', owed_minor: 1000, days_overdue: 20 },
    { ref: 'B2', party: 'P1', entry_id: 'e2', owed_minor: 2000, days_overdue: null },
    { ref: 'B3', party: 'P1', entry_id: 'e3', owed_minor: 3000, days_overdue: 5 },
    { ref: 'B4', party: 'P2', entry_id: 'e4', owed_minor: 4000, days_overdue: null },
    { ref: 'B5', party: 'P2', entry_id: null, owed_minor: 500, no_terms: true }
  ];
  const got = await Needs.partyNeeds(fakeH, 'shop', {}, { pack: {}, cur: 'AUD', supplier: true }, bills);
  ok('partyNeeds: the flag is asked of THESE entries only, once', asked.length === 1 && same(asked[0], ['e1', 'e2', 'e3', 'e4']), JSON.stringify(asked));
  ok('partyNeeds: B1 flag + late, B2 flag + hold (both kept, held first), B3 query + late, B4 nothing, B5 no terms', same(got.reasons.get('B1'), ['no_tax_invoice', 'overdue']) && same(got.reasons.get('B2'), ['held', 'no_tax_invoice']) && same(got.reasons.get('B3'), ['query', 'overdue']) && same(got.reasons.get('B4'), []) && same(got.reasons.get('B5'), ['no_terms']), JSON.stringify([...got.reasons]));
  const p1 = got.by_party.get('P1');
  ok('partyNeeds: P1 = 3 bills need it: 2 tax invoices, 1 query, 2 late worth 40.00', p1.bills === 3 && p1.no_tax_invoice === 2 && p1.query === 1 && p1.overdue === 2 && p1.overdue_minor === 4000, JSON.stringify(p1));
  ok('partyNeeds: P2 = only the bill with no terms; B4 (clean) leaves no row of its own', got.by_party.get('P2').bills === 1 && got.by_party.get('P2').no_terms === 1 && !got.by_party.get('P2').overdue);
  const sum = Needs.sumNeeds([{ needs: Object.assign(Needs.empty(), p1) }, { needs: Object.assign(Needs.empty(), got.by_party.get('P2')) }, { needs: Needs.empty() }]);
  ok('sumNeeds: 2 parties need you, 4 bills, 2 tax invoices, 1 without terms, 40.00 late', sum.parties === 2 && sum.bills === 4 && sum.no_tax_invoice === 2 && sum.no_terms === 1 && sum.overdue_minor === 4000, JSON.stringify(sum));
  asked.length = 0;
  await Needs.partyNeeds(fakeH, 'shop', {}, { pack: {}, cur: 'AUD', supplier: false }, bills);
  ok('partyNeeds: a customer side never asks for the tax-invoice flag (a purchase-side fact)', asked.length === 0);
  Evidence.flaggedAmong = async () => { throw new Error('the flag read failed'); };
  const down = await Needs.partyNeeds(fakeH, 'shop', {}, { pack: {}, cur: 'AUD', supplier: true }, bills);
  ok('partyNeeds: a flag read that fails is rolled back to its savepoint and logged; the other reasons still count, the list still answers', same(down.reasons.get('B3'), ['query', 'overdue']) && same(down.reasons.get('B1'), ['overdue']) && queries.some((q) => /ROLLBACK TO SAVEPOINT needs_flag/.test(q)));
  Evidence.flaggedAmong = realFlag; Needs.openMarks = realMarks;

  /* a walk-in day has no chit of its own but is SOURCED (the counter bills it covers): evidence.doc carries it, so it is never "no source" */
  const day = { item: {}, chit_id: null, source: { chit_id: null, count: 7 } }, none = { item: {}, chit_id: null, source: null }, one = { item: {}, chit_id: 'c1', ref: 'S-1', source: { chit_id: 'c1', count: null } };
  await Evidence.attach({ query: async () => ({ rows: [] }) }, [day, none, one].filter((x) => !x.chit_id), { flag: false });
  ok('walk-in day: the source is carried (covers 7), not null', day.item.evidence.doc && day.item.evidence.doc.covers === 7 && day.item.evidence.doc.chit_id === null, JSON.stringify(day.item.evidence));
  ok('no chit and no source: still no source (doc null)', none.item.evidence.doc === null);

  /* ── the routes ── */
  if (!H.enginesSrc().dir) { console.log('SKIP: ' + H.enginesSrc().why); process.exit(1); }
  const X = H.load({ auth });
  X.T.parties.push({ owner: SHOP, party_id: RAVI, party_no: 'P-00001', name: 'Ravi', customer: true, credit_days: 30, credit_limit_minor: null, terms: {} });
  X.T.parties.push({ owner: SHOP, party_id: MEERA, party_no: 'P-00002', name: 'Meera', customer: true, credit_days: 30, credit_limit_minor: null, terms: {} });
  const express = require('express'), app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0), port = srv.address().port, q = (m, p, b) => call(port, m, '/api/books' + p, b);
  require(path.join(H.API, 'lib', 'bill-checks')).attach = async (h, e, req, prop) => { prop.proposal.forEach((r) => Object.assign(r, { entry_id: null, chit_id: null, mark: null, evidence_flag: null })); return { mark_actions: null }; };
  require(path.join(H.API, 'lib', 'shop-clock')).set('2026-11-16T06:00:00Z');
  try {
    await q('POST', '/enable', {});
    await bill(X, RAVI, '2026-07-10', '01', 1000); /* 30 days credit: due 9 Aug, 99 days late */
    await bill(X, RAVI, '2026-08-10', '02', 2000); /* due 9 Sep, 68 days late */
    await bill(X, RAVI, '2026-11-10', '03', 4000); /* not due */
    await bill(X, MEERA, '2026-11-12', '04', 500); /* not due: Meera needs nothing */
    const dues = await q('GET', '/dues?side=customer');
    const ravi = (dues.body.parties || []).find((p) => p.party_id === RAVI), meera = (dues.body.parties || []).find((p) => p.party_id === MEERA);
    ok('dues: Ravi carries needs, 2 late bills worth 30.00 of his 3', ravi && ravi.needs && ravi.needs.bills === 2 && ravi.needs.overdue === 2 && ravi.needs.overdue_minor === 300000, JSON.stringify(ravi && ravi.needs));
    ok('dues: Meera, nothing late, carries a zero needs (never absent)', meera && meera.needs && meera.needs.bills === 0 && meera.needs.overdue_minor === 0, JSON.stringify(meera && meera.needs));
    ok('dues: the answer says how many parties need you, by side (1 customer)', dues.body.needs && dues.body.needs.customer.parties === 1 && dues.body.needs.customer.overdue_minor === 300000 && dues.body.needs.supplier === null, JSON.stringify(dues.body.needs));

    const tabs = {};
    for (const tab of ['needs', 'open', 'all']) tabs[tab] = (await q('GET', '/party/' + RAVI + '/bills?side=customer&tab=' + tab)).body;
    ok('tabs: counts come from the server: needs 2, open 3, all 3, 1 in order', tabs.needs.counts.needs === 2 && tabs.needs.counts.open === 3 && tabs.needs.counts.all === 3 && tabs.needs.counts.in_order === 1, JSON.stringify(tabs.needs.counts));
    ok('tabs: the count of the filter = the rows it returns = the party row\'s needs (one number)', tabs.needs.total === 2 && tabs.needs.bills.length === 2 && tabs.needs.counts.needs === ravi.needs.bills);
    ok('tabs: Needs you is most days late first (99, then 68), each with a why and ONE action', same(tabs.needs.bills.map((b) => b.days_overdue), [99, 68]) && tabs.needs.bills.every((b) => b.why === 'overdue' && b.action === 'pay' && Array.isArray(b.reasons)), JSON.stringify(tabs.needs.bills));
    ok('tabs: Open holds all three, the clean one with no why', tabs.open.total === 3 && tabs.open.bills.filter((b) => !b.why).length === 1, JSON.stringify(tabs.open.bills.map((b) => b.why)));
    ok('tabs: All holds the bills too, tab echoed', tabs.all.tab === 'all' && tabs.all.total === 3);
    const why = (await q('GET', '/party/' + RAVI + '/bills?side=customer&tab=open&why=overdue')).body;
    ok('why: a chip on the party row filters to the bills with THAT reason (overdue: 2 of 3; held: none)', why.total === 2 && (await q('GET', '/party/' + RAVI + '/bills?side=customer&why=held')).body.total === 0);
    const none = (await q('GET', '/party/' + MEERA + '/bills?side=customer&tab=needs')).body;
    ok('tabs: a party with nothing wrong has an empty Needs you and its one clean bill folded', none.total === 0 && none.counts.in_order === 1, JSON.stringify(none.counts));
    const old = (await q('GET', '/party/' + RAVI + '/bills?side=customer')).body;
    ok('compat: no tab asked = the open bills as before', old.total === 3 && old.tab === null);

    /* GET /attention needs real SQL (journal_entry): its needs count and the walk-in day source are proved on a real database by e2e/needsyou-live.cjs */
  } finally {
    srv.close();
  }
  console.log('\n  ' + (fail ? '✗' : '✓') + ' ' + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
