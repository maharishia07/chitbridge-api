/**
 * fin-books-doors-strict.test.cjs — MONEY WAVE 1 · M6 (FIN-54 · FIN-60 · FIN-79 · FIN-82 · FIN-83 · FIN-84 · FIN-86): the books' payment and opening doors read money and dates STRICTLY.
 * Through the real router over the in-memory store (no database). INR (2 decimals): 1000 minor = Rs 10.00.
 * Hand expectations (written before the code):
 *   amount_minor true -> 400 (it was read as 1) · 100.5 -> 400 (it was rounded to 101) · "1e3" -> 400 (it was 1000) · 1000 -> 200 and posts 1000 minor = Rs 10.00
 *   direction "both" -> 400 (it was read as in) · "out" -> recorded out · direction left out stays in
 *   cheque.date 2026-02-30 -> 400 DATE_INVALID (it was dropped to no date) · the same payment with 2026-03-02 -> 200 cheque_received
 *   opening due_date 2026-13-01 -> 400 DATE_INVALID naming rows[0].due_date (it was dropped) · 2026-03-31 -> 200
 *   terms party_id "x" -> 400 "Which party?" on GET and POST (it reached the database)
 *   a supplier paid Rs 10.00 then Rs 24.00 ahead (no bills) -> /dues row balance_minor 3400 and balance_words "they owe you Rs 34.00", the payment outcome's own words
 * Needs the books engines (BOOKS_ENGINES_SRC, else the sibling ../chitbridge-engines/src). Run: node tests/fin-books-doors-strict.test.cjs
 * CARD      16-finance/payments
 */
'use strict';
const path = require('path');
const http = require('http');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111', SUPP = '33333333-3333-4333-8333-333333333333', MALA = '22222222-2222-4222-8222-222222222222';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Chola Auto Care' };
const authStub = Object.assign((req, res, next) => { req.identity = OWNER; next(); }, {
  entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id,
  requireScope: () => (req, res, next) => next(),
});
let attempts = 0;
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b), 'Idempotency-Key': 'attempt-' + (++attempts) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});
const serve = () => {
  const express = require('express');
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books'))); app.use('/api/books', require(path.join(H.API, 'routes', 'books-money')));
  const srv = app.listen(0); const port = srv.address().port;
  return { srv, q: (m, p, b) => call(port, m, '/api/books' + p, b) };
};

(async () => {
  console.log('\n══ M6 · books doors strict: minor units, direction, dates, party ids, balance words ══');
  if (!H.enginesSrc().dir) { console.log('\n   SKIP: ' + H.enginesSrc().why + '\n\n  ✓ 0 passed · 0 checks\n'); process.exit(1); }
  const X = H.load({ auth: authStub });
  const realQuery = X.db.query;
  X.db.query = async (text, v) => (/SELECT can_see_costs FROM identities/.test(String(text)) ? { rows: [{ can_see_costs: true }] } : realQuery(text, v));
  X.T.parties.push({ owner: SHOP, party_id: MALA, party_no: 'P-00001', name: 'Mala', customer: true, credit_days: 10 },
    { owner: SHOP, party_id: SUPP, party_no: 'P-00002', name: 'Kumar Traders', supplier: true, credit_days: 30 });
  const { srv, q } = serve();
  await q('POST', '/enable', {});
  const PAY = { party_id: SUPP, direction: 'out', currency: 'INR', mode: 'cash', received_at: '2026-10-05' };
  try {
    for (const [label, sent] of [['true', true], ['100.5', 100.5], ['"1e3"', '1e3']]) {
      const r = await q('POST', '/payments', Object.assign({}, PAY, { amount_minor: sent }));
      ok('amount_minor ' + label + ' -> 400, nothing recorded', r.status === 400 && X.T.payments.length === 0, r.status + ' ' + JSON.stringify(r.body));
    }
    const preview = await q('POST', '/payments/preview', { party_id: SUPP, direction: 'out', currency: 'INR', amount_minor: true });
    ok('the preview refuses amount_minor true too (one question for both doors)', preview.status === 400, preview.status + ' ' + JSON.stringify(preview.body));
    const good = await q('POST', '/payments', Object.assign({}, PAY, { amount_minor: 1000 }));
    ok('amount_minor 1000 -> 200 and one payment of 1000 minor (Rs 10.00)', good.status === 200 && X.T.payments.length === 1 && Number(X.T.payments[0].amount_minor) === 1000, good.status + ' ' + JSON.stringify(good.body));
    ok('...recorded OUT, as sent', X.T.payments[0] && X.T.payments[0].direction === 'out', JSON.stringify(X.T.payments[0]));

    const both = await q('POST', '/payments', Object.assign({}, PAY, { direction: 'both', amount_minor: 1000 }));
    ok('direction "both" -> 400, nothing more recorded', both.status === 400 && X.T.payments.length === 1, both.status + ' ' + JSON.stringify(both.body));
    const noDir = await q('POST', '/payments', { party_id: MALA, currency: 'INR', mode: 'cash', received_at: '2026-10-05', amount_minor: 500 });
    ok('direction left out keeps the old reading: in', noDir.status === 200 && X.T.payments[1] && X.T.payments[1].direction === 'in', noDir.status + ' ' + JSON.stringify(noDir.body));

    const chequeBody = (date) => Object.assign({}, PAY, { party_id: MALA, direction: 'in', mode: 'cheque', amount_minor: 700, cheque: { number: '000123', bank: 'SBI', date } });
    const bad = await q('POST', '/payments', chequeBody('2026-02-30'));
    ok('cheque.date 2026-02-30 -> 400 DATE_INVALID', bad.status === 400 && bad.body.code === 'DATE_INVALID', bad.status + ' ' + JSON.stringify(bad.body));
    const fine = await q('POST', '/payments', chequeBody('2026-03-02'));
    ok('cheque.date 2026-03-02 -> 200 cheque_received', fine.status === 200 && fine.body.payment && fine.body.payment.status === 'cheque_received', fine.status + ' ' + JSON.stringify(fine.body));

    const opening = (due) => q('POST', '/opening', { date: '2026-04-01', rows: [{ code: '1300', party_no: 'P-00001', dr_minor: 100, bill_ref: 'OLD-1', due_date: due }, { code: '3000', cr_minor: 100 }] });
    const badDue = await opening('2026-13-01');
    ok('opening due_date 2026-13-01 -> 400 DATE_INVALID naming the row', badDue.status === 400 && badDue.body.code === 'DATE_INVALID' && /due_date/.test(JSON.stringify(badDue.body)), badDue.status + ' ' + JSON.stringify(badDue.body));
    const okDue = await opening('2026-03-31');
    ok('opening due_date 2026-03-31 -> 200', okDue.status === 200, okDue.status + ' ' + JSON.stringify(okDue.body));

    const getBad = await q('GET', '/terms?party_id=x');
    ok('GET /terms party_id "x" -> 400 "Which party?"', getBad.status === 400 && getBad.body.error === 'Which party?', getBad.status + ' ' + JSON.stringify(getBad.body));
    const postBad = await q('POST', '/terms', { party_id: 'x', credit_days: 10 });
    ok('POST /terms party_id "x" -> 400 "Which party?"', postBad.status === 400 && postBad.body.error === 'Which party?', postBad.status + ' ' + JSON.stringify(postBad.body));

    const adv = await q('POST', '/payments', Object.assign({}, PAY, { amount_minor: 2400, received_at: '2026-10-06' }));
    ok('a supplier advance of Rs 24.00 recorded', adv.status === 200, adv.status + ' ' + JSON.stringify(adv.body));
    const dues = await q('GET', '/dues?side=supplier');
    const row = (dues.body.parties || []).find((party) => party.party_id === SUPP);
    ok('/dues supplier row: Rs 10.00 + Rs 24.00 ahead = balance_minor 3400', row && row.balance_minor === 3400, JSON.stringify(row));
    ok('...with balance_words from owesWords (the payment outcome words): they owe you Rs 34', row && row.balance_words === 'they owe you ₹34', JSON.stringify(row));
    const wo = await q('POST', '/write-off', { party_id: MALA, amount_minor: true, reason: 'bad debt' });
    ok('write-off amount_minor true -> 400 "How much?" (the same reader; it was 1)', wo.status === 400 && wo.body.error === 'How much?', wo.status + ' ' + JSON.stringify(wo.body));
    const DV = require('../lib/dues-view');
    const seen = DV.blindDuesRow({ party_id: 's', side: 'supplier', balance_minor: 3400, balance_words: 'they owe you ₹34', disputed_minor: 0, buckets: {} });
    ok('a cost-blind reader gets balance_words null on a supplier row (the words carry the money)', seen.balance_words === null && seen.balance_minor === null, JSON.stringify(seen));
    const mine = DV.blindDuesRow({ party_id: 'c', side: 'customer', balance_minor: 500, balance_words: 'they owe you ₹5', buckets: {} });
    ok('...and a customer row keeps its words', mine.balance_words === 'they owe you ₹5', JSON.stringify(mine));
  } finally { srv.close(); }
  console.log('\n  ' + (fail ? '✗' : '✓') + ' ' + pass + ' passed · ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.log('FAIL threw: ' + (err && err.stack || err)); process.exit(1); });
