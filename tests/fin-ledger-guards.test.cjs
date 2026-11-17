/**
 * fin-ledger-guards.test.cjs — MONEY WAVE 2 · M7b (FIN-88 · FIN-92 · FIN-100 · CAT-127): the ledger guards against double booking and over-repay.
 * Through the real router over the in-memory store (no database). INR (2 decimals): 5000000 minor = Rs 50,000.00 · 1000000 minor = Rs 10,000.00.
 * Hand expectations (written before the code):
 *   FIN-88  two opening rows for one customer both naming bill X1 -> 400 naming row 2 and row 1 (it posted both: the bill was owed twice)
 *           Rs 50,000.00 bill OB-1 opened, then a DIFFERENT opening naming OB-1 again for that customer -> 409 BOOKS_CONFLICT "Bill OB-1 ... ₹50,000 INR still due"
 *           the same bill ref for ANOTHER customer stays the engine's own 422 "belongs to one party" (already refused; unchanged)
 *   FIN-100 opening OB-1 Rs 50,000.00 sent twice with no client_ref -> the second is 409 BOOKS_CONFLICT (ACC-328's refuseOpeningTwice, one implementation), ONE opening entry in the books
 *           an opening with different rows on the same date (OB-2 Rs 20,000.00) is NOT a replay: a second entry (entry count 2)
 *           the same rows with a client_ref are keyed by the client_ref (own prefix), never by the content key
 *   FIN-92  loan L-1 Rs 10,000.00, an instalment with principal Rs 20,000.00 -> 422 "outstanding ₹10,000 INR" (it posted, leaving the loan at minus Rs 10,000.00)
 *           principal Rs 10,000.00 -> 200 and the loan owes 0 · principal Rs 1.00 more -> 422 "outstanding ₹0 INR"
 *           a second loan L-2 of Rs 5,000.00 on the SAME loan account does not lend its balance to L-1 (still 422 for L-1)
 *           the same instalment sent again (same client_ref) after the loan is repaid -> 200 duplicate, never judged again
 *   CAT-127 a month pack for an OPEN month -> 409 BOOKS_CONFLICT and no pack row; after the month is locked -> 200
 * Needs the books engines (BOOKS_ENGINES_SRC, else the sibling ../chitbridge-engines/src). Run: node tests/fin-ledger-guards.test.cjs
 * CARD      16-finance/ledger-guards
 */
'use strict';
const path = require('path');
const http = require('http');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111', MALA = '22222222-2222-4222-8222-222222222222', RAVI = '33333333-3333-4333-8333-333333333333';
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
const said = (r) => JSON.stringify(r.body);

(async () => {
  console.log('\n══ M7b · ledger guards: repeated bill ref · opening replay · loan over-repay · unlocked month pack ══');
  if (!H.enginesSrc().dir) { console.log('\n   SKIP: ' + H.enginesSrc().why + '\n\n  ✓ 0 passed · 0 checks\n'); process.exit(1); }
  const X = H.load({ auth: authStub });
  const realQuery = X.db.query;
  X.db.query = async (text, v) => (/SELECT can_see_costs FROM identities/.test(String(text)) ? { rows: [{ can_see_costs: true }] } : realQuery(text, v));
  X.T.parties.push({ owner: SHOP, party_id: MALA, party_no: 'P-00001', name: 'Mala', customer: true, credit_days: 10 },
    { owner: SHOP, party_id: RAVI, party_no: 'P-00002', name: 'Ravi', customer: true, credit_days: 10 });
  const { srv, q } = serve();
  await q('POST', '/enable', {});
  const openingEntries = () => X.T.entries.filter((x) => x.entity_id === SHOP && x.event_type === 'opening');
  const bill = (partyNo, ref, minor) => ({ code: '1300', party_no: partyNo, dr_minor: minor, bill_ref: ref });
  const equity = (minor) => ({ code: '3000', cr_minor: minor });
  try {
    /* FIN-88 · a bill ref twice for one party inside one opening */
    const twice = await q('POST', '/opening', { date: '2026-04-01', rows: [bill('P-00001', 'X1', 100000), bill('P-00001', 'X1', 200000), equity(300000)] });
    ok('FIN-88: two rows naming bill X1 for one customer -> 400 naming row 2 and row 1, nothing posted',
      twice.status === 400 && /Row 2: bill X1 is already on row 1/.test(said(twice)) && openingEntries().length === 0, twice.status + ' ' + said(twice));
    const other = await q('POST', '/opening', { date: '2026-04-01', rows: [bill('P-00001', 'X1', 100000), bill('P-00002', 'X1', 200000), equity(300000)] });
    ok('FIN-88 (neighbour, unchanged): the same ref for two DIFFERENT customers stays the engines own 422 "belongs to one party"', other.status === 422 && /belongs to one party/.test(said(other)) && openingEntries().length === 0, other.status + ' ' + said(other));

    /* FIN-100 · the same opening twice with no client_ref */
    const FIRST = { date: '2026-04-01', rows: [bill('P-00001', 'OB-1', 5000000), equity(5000000)] };
    const one = await q('POST', '/opening', FIRST);
    const entriesBefore = openingEntries().length;
    const again = await q('POST', '/opening', FIRST);
    ok('FIN-100: Rs 50,000.00 opening OB-1 sent twice with no client_ref -> the second is 409 BOOKS_CONFLICT naming the first entry, ONE entry in the books',
      one.status === 200 && again.status === 409 && again.body.code === 'BOOKS_CONFLICT' && said(again).indexOf(one.body.entry_no) >= 0 && openingEntries().length === entriesBefore, one.status + ' ' + said(one) + ' / ' + again.status + ' ' + said(again));
    const changed = await q('POST', '/opening', { date: '2026-04-01', rows: [bill('P-00001', 'OB-2', 2000000), equity(2000000)] });
    ok('FIN-100: an opening with different rows on the same date (OB-2 Rs 20,000.00) is NOT a duplicate: a new entry',
      changed.status === 200 && !changed.body.duplicate && changed.body.entry_no !== one.body.entry_no && openingEntries().length === entriesBefore + 1, changed.status + ' ' + said(changed));
    const refd = { date: '2026-04-01', client_ref: 'mine-1', rows: [bill('P-00002', 'OB-9', 100000), equity(100000)] };
    const r1 = await q('POST', '/opening', refd), r2 = await q('POST', '/opening', refd);
    ok('FIN-100: with a client_ref the key is the client_ref (opening:mine-1), and its resend is a replay',
      r1.status === 200 && r2.body.duplicate === true && openingEntries().some((x) => x.source_ref === 'opening:mine-1'), r1.status + ' ' + said(r1) + ' / ' + said(r2));

    /* FIN-88 · a ref still open in the books */
    const reopened = await q('POST', '/opening', { date: '2026-04-01', rows: [bill('P-00001', 'OB-1', 100000), equity(100000)] });
    ok('FIN-88: bill OB-1 (Rs 50,000.00) still open -> a different opening naming it again is 409 BOOKS_CONFLICT, naming the amount',
      reopened.status === 409 && reopened.body.code === 'BOOKS_CONFLICT' && /Bill OB-1/.test(said(reopened)) && /50,000/.test(said(reopened)), reopened.status + ' ' + said(reopened));

    /* FIN-92 · a loan cannot be repaid past what it owes */
    const loan = await q('POST', '/loans', { ref: 'L-1', lender: 'HDFC', amount_minor: 1000000, into: 'bank', date: '2026-04-02' });
    ok('FIN-92: loan L-1 Rs 10,000.00 taken -> 200', loan.status === 200, loan.status + ' ' + said(loan));
    const over = await q('POST', '/loans/L-1/emi', { principal_minor: 2000000, interest_minor: 0, client_ref: 'm1', date: '2026-05-02' });
    ok('FIN-92: principal Rs 20,000.00 on a Rs 10,000.00 loan -> 422 "outstanding ₹10,000 INR", no instalment posted',
      over.status === 422 && /outstanding ₹10,000 INR/.test(said(over)) && !X.T.entries.some((x) => /^emi:/.test(String(x.source_ref))), over.status + ' ' + said(over));
    const loan2 = await q('POST', '/loans', { ref: 'L-2', lender: 'SBI', amount_minor: 500000, into: 'bank', date: '2026-04-03' });
    const full = await q('POST', '/loans/L-1/emi', { principal_minor: 1000000, interest_minor: 0, client_ref: 'm1', date: '2026-05-02' });
    ok('FIN-92: principal Rs 10,000.00 -> 200 (L-2 of Rs 5,000.00 on the same account is not lent to L-1)', loan2.status === 200 && full.status === 200 && !full.body.duplicate, loan2.status + ' ' + full.status + ' ' + said(full));
    const more = await q('POST', '/loans/L-1/emi', { principal_minor: 100, interest_minor: 0, client_ref: 'm2', date: '2026-06-02' });
    ok('FIN-92: Rs 1.00 more on the repaid L-1 -> 422 "outstanding ₹0 INR" though the loan account still holds L-2',
      more.status === 422 && /outstanding ₹0 INR/.test(said(more)), more.status + ' ' + said(more));
    const replay = await q('POST', '/loans/L-1/emi', { principal_minor: 1000000, interest_minor: 0, client_ref: 'm1', date: '2026-05-02' });
    ok('FIN-92: the same instalment again (client_ref m1) -> 200 duplicate, not judged against the repaid loan', replay.status === 200 && replay.body.duplicate === true, replay.status + ' ' + said(replay));
    const interestOnly = await q('POST', '/loans/L-1/emi', { principal_minor: 0, interest_minor: 5000, client_ref: 'm3', date: '2026-06-02' });
    ok('FIN-92: an interest-only instalment (principal 0) is not held to the balance -> 200', interestOnly.status === 200, interestOnly.status + ' ' + said(interestOnly));

    /* FIN-92 · a loan ref holding a colon is its own loan: L and L:2 on one account */
    await q('POST', '/loans', { ref: 'L', lender: 'A', amount_minor: 1000000, into: 'bank', date: '2026-04-04' });
    await q('POST', '/loans', { ref: 'L:2', lender: 'B', amount_minor: 700000, into: 'bank', date: '2026-04-04' });
    const lPaid = await q('POST', '/loans/L/emi', { principal_minor: 1000000, interest_minor: 0, client_ref: 'p1', date: '2026-05-04' });
    const l2Paid = await q('POST', '/loans/L:2/emi', { principal_minor: 200000, interest_minor: 0, client_ref: 'p1', date: '2026-05-04' });
    const lMore = await q('POST', '/loans/L/emi', { principal_minor: 100, interest_minor: 0, client_ref: 'p2', date: '2026-06-04' });
    ok('FIN-92: loans L and L:2 — L repaid Rs 10,000.00, Rs 1.00 more on L -> 422 outstanding ₹0 INR (the repayment of L:2 is not counted for L)', lPaid.status === 200 && l2Paid.status === 200 && lMore.status === 422 && /outstanding ₹0 INR/.test(said(lMore)), lPaid.status + ' ' + l2Paid.status + ' ' + lMore.status + ' ' + said(lMore));
    const l2Over = await q('POST', '/loans/L:2/emi', { principal_minor: 500001, interest_minor: 0, client_ref: 'p2', date: '2026-06-04' });
    const l2Rest = await q('POST', '/loans/L:2/emi', { principal_minor: 500000, interest_minor: 0, client_ref: 'p3', date: '2026-06-04' });
    ok('FIN-92: L:2 (Rs 7,000.00, Rs 2,000.00 repaid) still owes Rs 5,000.00: Rs 5,000.01 -> 422 outstanding ₹5,000 INR, Rs 5,000.00 -> 200', l2Over.status === 422 && /outstanding ₹5,000 INR/.test(said(l2Over)) && l2Rest.status === 200, l2Over.status + ' ' + said(l2Over) + ' ' + l2Rest.status);
    /* the bite of the prefix: M owes Rs 10,000.00 less Rs 8,000.00 = Rs 2,000.00 while M:2 repaid Rs 2,000.00 — a LIKE prefix would have taken that off M too and refused Rs 2,000.00 */
    await q('POST', '/loans', { ref: 'M', lender: 'A', amount_minor: 1000000, into: 'bank', date: '2026-04-04' });
    await q('POST', '/loans', { ref: 'M:2', lender: 'B', amount_minor: 700000, into: 'bank', date: '2026-04-04' });
    await q('POST', '/loans/M/emi', { principal_minor: 800000, interest_minor: 0, client_ref: 'p1', date: '2026-05-04' });
    await q('POST', '/loans/M:2/emi', { principal_minor: 200000, interest_minor: 0, client_ref: 'p1', date: '2026-05-04' });
    const mRest = await q('POST', '/loans/M/emi', { principal_minor: 200000, interest_minor: 0, client_ref: 'p2', date: '2026-06-04' });
    ok('FIN-92: M owes Rs 2,000.00 (M:2 repaid Rs 2,000.00 separately) -> principal Rs 2,000.00 on M is 200', mRest.status === 200, mRest.status + ' ' + said(mRest));
    const colon = await q('POST', '/loans/L/emi', { principal_minor: 100, interest_minor: 0, client_ref: 'a:b', date: '2026-06-05' });
    ok('FIN-92: an instalment reference holding a colon -> 400 (the loan ref is read back before the last colon)', colon.status === 400, colon.status + ' ' + said(colon));

    /* FIN-100 · the same document with its rows in another order is the same document */
    const rowsAB = [bill('P-00001', 'OB-7', 300000), bill('P-00002', 'OB-8', 400000), equity(700000)];
    const inOrder = await q('POST', '/opening', { date: '2026-04-05', rows: rowsAB });
    const reordered = await q('POST', '/opening', { date: '2026-04-05', rows: [rowsAB[2], rowsAB[1], rowsAB[0]] });
    ok('FIN-100: the same Rs 3,000.00 + Rs 4,000.00 rows sent in another order -> 409 BOOKS_CONFLICT, not a second entry (refuseOpeningTwice sorts the row tuples)',
      inOrder.status === 200 && reordered.status === 409 && reordered.body.code === 'BOOKS_CONFLICT' && openingEntries().filter((x) => x.entry_no === inOrder.body.entry_no).length === 1, inOrder.status + ' ' + said(inOrder) + ' / ' + said(reordered));

    /* FIN-92 · two instalments at once that together exceed the loan: one wins, one is refused */
    await q('POST', '/loans', { ref: 'R-1', lender: 'C', amount_minor: 1000000, into: 'bank', date: '2026-04-06' });
    const readOwed = X.store.loanOutstanding; /* latency after the read, so the loser of a race reads the same balance as the winner (a race test needs it) */
    X.store.loanOutstanding = async (...args) => { const answer = await readOwed(...args); await new Promise((resolve) => setTimeout(resolve, 20)); return answer; };
    const pair = await Promise.all(['x1', 'x2'].map((cref) => q('POST', '/loans/R-1/emi', { principal_minor: 600000, interest_minor: 0, client_ref: cref, date: '2026-05-06' })));
    const codes = pair.map((r) => r.status).sort();
    ok('FIN-92: two instalments of Rs 6,000.00 at once on a Rs 10,000.00 loan -> one 200 and one 422 "outstanding ₹4,000 INR"',
      codes[0] === 200 && codes[1] === 422 && pair.some((r) => r.status === 422 && /outstanding ₹4,000 INR/.test(said(r))), pair.map((r) => r.status + ' ' + said(r)).join(' / '));

    /* FIN-92 · CUR-1: a loan held in another currency than the instalment is a mismatch, never converted (hand: loan USD 1,000.00, an INR instalment of 1.00 -> 422 "in USD, not INR") */
    await q('POST', '/loans', { ref: 'U-1', lender: 'D', amount_minor: 100000, into: 'bank', date: '2026-04-07' });
    const usdLoan = X.T.entries.find((x) => x.entity_id === SHOP && x.source_ref === 'loan:U-1');
    X.T.lines.filter((l) => l.entry_id === usdLoan.entry_id).forEach((l) => { l.currency = 'USD'; });
    const wrongCurrency = await q('POST', '/loans/U-1/emi', { principal_minor: 100, interest_minor: 0, client_ref: 'u1', date: '2026-05-07' });
    ok('FIN-92 / CUR-1: an INR instalment on a USD loan -> 422 BOOKS_REFUSED "in USD, not INR", nothing posted',
      wrongCurrency.status === 422 && wrongCurrency.body.code === 'BOOKS_REFUSED' && /in USD, not INR/.test(said(wrongCurrency)) && !X.T.entries.some((x) => x.source_ref === 'emi:U-1:u1'), wrongCurrency.status + ' ' + said(wrongCurrency));

    /* CAT-127 · a month pack is made from a locked month */
    const openPack = await q('POST', '/packs', { kind: 'month', fiscal_year: '2026-27', period: 7 });
    ok('CAT-127: a month pack for an OPEN month -> 409 BOOKS_CONFLICT in words, no pack row',
      openPack.status === 409 && openPack.body.code === 'BOOKS_CONFLICT' && /locked/.test(said(openPack)) && (X.T.packs || []).length === 0, openPack.status + ' ' + said(openPack));
    const locked = await q('POST', '/periods/2026-27/7/lock', { reason: 'October done' });
    const goodPack = await q('POST', '/packs', { kind: 'month', fiscal_year: '2026-27', period: 7 });
    ok('CAT-127: the same month after its lock -> 200 with a sealed pack', locked.status === 200 && goodPack.status === 200 && goodPack.body.pack && goodPack.body.pack.sha256, locked.status + ' ' + goodPack.status + ' ' + said(goodPack).slice(0, 200));
  } finally { srv.close(); }
  console.log('\n  ' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
