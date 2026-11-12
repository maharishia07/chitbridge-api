/**
 * fin-ledger-guards.test.cjs — MONEY WAVE 2 · M7b (FIN-88 · FIN-92 · FIN-100 · CAT-127): the ledger guards against double booking and over-repay.
 * Through the real router over the in-memory store (no database). INR (2 decimals): 5000000 minor = Rs 50,000.00 · 1000000 minor = Rs 10,000.00.
 * Hand expectations (written before the code):
 *   FIN-88  two opening rows for one customer both naming bill X1 -> 400 naming row 2 and row 1 (it posted both: the bill was owed twice)
 *           Rs 50,000.00 bill OB-1 opened, then a DIFFERENT opening naming OB-1 again for that customer -> 409 BOOKS_CONFLICT "Bill OB-1 ... ₹50,000 INR still due"
 *           the same bill ref for ANOTHER customer stays the engine's own 422 "belongs to one party" (already refused; unchanged)
 *   FIN-100 opening OB-1 Rs 50,000.00 sent twice with no client_ref -> the second answers 200 duplicate:true with the FIRST entry_no, ONE opening entry in the books
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
    ok('FIN-100: Rs 50,000.00 opening OB-1 sent twice with no client_ref -> the second is 200 duplicate:true with the first entry_no',
      one.status === 200 && again.status === 200 && again.body.duplicate === true && again.body.entry_no === one.body.entry_no && openingEntries().length === entriesBefore, one.status + ' ' + said(one) + ' / ' + again.status + ' ' + said(again));
    const changed = await q('POST', '/opening', { date: '2026-04-01', rows: [bill('P-00001', 'OB-2', 2000000), equity(2000000)] });
    ok('FIN-100: an opening with different rows on the same date (OB-2 Rs 20,000.00) is NOT a replay: a new entry',
      changed.status === 200 && !changed.body.duplicate && changed.body.entry_no !== one.body.entry_no && openingEntries().length === entriesBefore + 1, changed.status + ' ' + said(changed));
    const keyed = openingEntries().map((x) => String(x.source_ref));
    ok('FIN-100: the content key has its own prefix (opening-rows:) and a client_ref one keeps opening:',
      keyed.filter((x) => /^opening-rows:[0-9a-f]{40}$/.test(x)).length === keyed.length, keyed.join(' '));
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
