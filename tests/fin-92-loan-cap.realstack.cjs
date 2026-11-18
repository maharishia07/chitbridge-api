'use strict';
/**
 * tests/fin-92-loan-cap.realstack.cjs — FIN-92 (loan instalment cap) on REAL Postgres, the api running as cb_app: the loanOutstanding SQL and the per-loan advisory lock.
 *
 * owns: the proof the in-memory stand-in cannot give — the SQL of lib/books-store loanOutstanding (LIKE escape, the tail-colon rule, reversal skip, currency) and the lock `loan|<ref>`
 *       (lockLoan, taken by lib/books-period refuseRepaymentAboveOutstanding). The offline twin (tests/fin-ledger-guards.test.cjs) proves the rule.
 * FLOW  fresh IN shop, books on → POST /api/books/loans, /loans/:ref/emi (each its own Idempotency-Key); the journal read back with SELECT. HAND values (INR, minor units):
 *   LC-1  loan 1,000,000 (Rs 10,000.00); principal 2,000,000 -> 422 "outstanding ₹10,000"; no emi entry
 *   LC-2  600,000 -> 200; 600,000 again (other ref) -> 422 "outstanding ₹4,000"; 400,000 -> 200; 1 more -> 422 "outstanding ₹0"
 *   LC-3  loan "P" (700,000) repaid 700,000 while loan "P:2" (500,000) stays open: 1 more on P -> 422 (P:2's rows are never counted for P)
 *   LC-4  loan "50%_x" (300,000): "%" and "_" are matched literally: 300,001 -> 422 "outstanding ₹3,000", 300,000 -> 200
 *   LC-5  two instalments of 600,000 at once on a 1,000,000 loan wait while another transaction holds loan|ref; after release ONE is 200, one 422; the journal holds 600,000 repaid
 *   LC-6  a loan whose lines disagree on currency is refused as a mismatch (CUR-1), nothing converted, nothing posted
 *   LC-11 loan 1,000,000, instalment 300,000 + 20,000 interest: reversing the loan is refused (700,000 / bank 680,000 / interest 20,000); instalment then loan reversed: all 0
 *   LC-12 a reversed loan takes no instalment, interest-only included · LC-13 reversal and instalment queued together on loan|ref: never both
 * CARD 16-finance/xact-lock
 * Run: API_BASE=http://127.0.0.1:<port> TRUTH_DB=<owner url> node tests/fin-92-loan-cap.realstack.cjs   ⚠️ LOCAL ONLY (the harness refuses anything else)
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { LOCK_SQL } = require('../lib/xact-lock');
const { DB, j, ok, kase, pause, expect, freshShop, finish } = H;

const RUN = 'l92' + (Date.now() % 1e10).toString(36).padStart(6, '0');
const NOT_REGISTERED = { tax: { registered: false } };
const said = (reply) => JSON.stringify([reply.status, reply.b]);
const loan = (shop, ref, amount) => j('/api/books/loans', { method: 'POST', token: shop.token, body: { ref, lender: 'Bank ' + ref, amount_minor: amount, into: 'bank', date: '2026-04-02' } });
const emi = (shop, ref, principal, cref) => j('/api/books/loans/' + encodeURIComponent(ref) + '/emi', { method: 'POST', token: shop.token, body: { principal_minor: principal, interest_minor: 0, client_ref: cref, date: '2026-05-02' } });
const likeEscaped = (ref) => ref.replace(/[\\%_]/g, '\\$&');
const repaid = async (pg, shop, ref) => Number((await pg.query(
  "SELECT COALESCE(SUM(l.dr_minor), 0)::bigint AS n FROM journal_entry x JOIN journal_line l ON l.entry_id = x.entry_id AND l.entity_id = x.entity_id JOIN ledger_account a ON a.account_id = l.account_id AND a.entity_id = l.entity_id WHERE x.entity_id = $1 AND a.role IN ('secured_loan','unsecured_loan','bank_od') AND x.source_ref = ANY($2::text[])",
  [shop.entity, (await pg.query("SELECT source_ref FROM journal_entry WHERE entity_id = $1 AND source_ref LIKE $2", [shop.entity, 'emi:' + likeEscaped(ref) + ':%'])).rows.map((r) => r.source_ref)])).rows[0].n);
const freshBooks = async (tag, name) => {
  const shop = await freshShop(RUN + tag, name, NOT_REGISTERED);
  ok(await j('/api/books/enable', { method: 'POST', token: shop.token }), 'books on');
  return shop;
};

(async () => {
  console.log('\n══ FIN-92 · loan instalment cap on real Postgres · ' + RUN + ' ══\n');
  const pg = new Client({ connectionString: DB });
  await pg.connect();
  const lock = new Client({ connectionString: DB });
  await lock.connect();
  try {
    const shop = await freshBooks('a', 'Loan Cap');

    await kase('LC-1', 'loan Rs 10,000.00, principal Rs 20,000.00 -> 422 outstanding ₹10,000, nothing posted', async () => {
      ok(await loan(shop, 'L1', 1000000), 'loan');
      const over = await emi(shop, 'L1', 2000000, 'a1');
      expect(over.status === 422 && over.b.code === 'BOOKS_REFUSED' && /outstanding ₹10,000/.test(said(over)), said(over));
      expect((await repaid(pg, shop, 'L1')) === 0, 'an instalment was posted');
      return said(over);
    });

    await kase('LC-2', 'partial repay: 6,000 ok, 6,000 again 422 (₹4,000 left), 4,000 ok, 1 more 422 (₹0)', async () => {
      const first = await emi(shop, 'L1', 600000, 'b1');
      const second = await emi(shop, 'L1', 600000, 'b2');
      const third = await emi(shop, 'L1', 400000, 'b3');
      const extra = await emi(shop, 'L1', 1, 'b4');
      expect(first.status === 200 && second.status === 422 && /outstanding ₹4,000/.test(said(second)) && third.status === 200 && extra.status === 422 && /outstanding ₹0/.test(said(extra)), [first, second, third, extra].map(said).join(' / '));
      expect((await repaid(pg, shop, 'L1')) === 1000000, 'repaid ' + (await repaid(pg, shop, 'L1')));
      return said(extra);
    });

    await kase('LC-3', 'loan P repaid in full while loan "P:2" stays open: 1 more on P is refused (P:2 rows are not the rows of P)', async () => {
      ok(await loan(shop, 'P', 700000), 'loan P');
      ok(await loan(shop, 'P:2', 500000), 'loan P:2');
      ok(await emi(shop, 'P', 700000, 'c1'), 'repay P');
      const more = await emi(shop, 'P', 1, 'c2');
      const rest = await emi(shop, 'P:2', 500000, 'c1');
      expect(more.status === 422 && /outstanding ₹0/.test(said(more)) && rest.status === 200, said(more) + ' / ' + said(rest));
      return said(more);
    });

    await kase('LC-4', 'a ref with % and _ is matched literally: loan "50%_x" 3,000 -> 3,000.01 refused, 3,000.00 ok', async () => {
      ok(await loan(shop, '50%_x', 300000), 'loan');
      const over = await emi(shop, '50%_x', 300001, 'd1');
      const exact = await emi(shop, '50%_x', 300000, 'd2');
      expect(over.status === 422 && /outstanding ₹3,000/.test(said(over)) && exact.status === 200, said(over) + ' / ' + said(exact));
      return said(over);
    });

    await kase('LC-5', 'two instalments of 6,000 at once on a 10,000 loan wait on loan|ref; then one 200 and one 422; 6,000 repaid', async () => {
      const racers = await freshBooks('b', 'Loan Race');
      ok(await loan(racers, 'R1', 1000000), 'loan');
      await lock.query('BEGIN');
      await lock.query(LOCK_SQL, [racers.entity, 'loan|R1']);
      let released = false;
      const early = [];
      const waiting = ['x', 'y'].map((cref) => emi(racers, 'R1', 600000, cref).then((reply) => { if (!released) early.push(said(reply)); return reply; }));
      await pause(900);
      const written = await repaid(pg, racers, 'R1');
      released = true;
      await lock.query('COMMIT');
      const replies = await Promise.all(waiting);
      expect(!early.length && written === 0, 'while loan|R1 was held: ' + written + ' written; answered early: ' + early.join(' | '));
      const statuses = replies.map((r) => r.status).sort();
      expect(statuses[0] === 200 && statuses[1] === 422 && replies.some((r) => /outstanding ₹4,000/.test(said(r))), JSON.stringify(replies.map((r) => [r.status, r.b])));
      expect((await repaid(pg, racers, 'R1')) === 600000, 'repaid ' + (await repaid(pg, racers, 'R1')));
      ok(await loan(racers, 'R2', 1000000), 'loan R2'); /* nobody holding the key: a genuine pair fired together still ends 200 + 422 */
      const pair = await Promise.all(['x', 'y'].map((cref) => emi(racers, 'R2', 600000, cref)));
      const pairStatuses = pair.map((r) => r.status).sort();
      expect(pairStatuses[0] === 200 && pairStatuses[1] === 422 && (await repaid(pg, racers, 'R2')) === 600000, JSON.stringify(pair.map((r) => [r.status, r.b])));
      return JSON.stringify(statuses) + ' ' + JSON.stringify(pairStatuses);
    });

    await kase('LC-6', 'a loan whose lines read two currencies: the instalment is refused as a mismatch, nothing posted (CUR-1)', async () => {
      const odd = await freshBooks('c', 'Loan Cur');
      ok(await loan(odd, 'U1', 500000), 'loan');
      await pg.query('BEGIN'); await pg.query("SET LOCAL session_replication_role = 'replica'"); /* ARM: the books are insert-only, so the throwaway database is told to skip its triggers for this one retag (a loan entered in a foreign currency cannot be posted through the routes) */
      const done = await pg.query("UPDATE journal_line SET currency = 'USD' WHERE entity_id = $1 AND cr_minor > 0 AND entry_id = (SELECT entry_id FROM journal_entry WHERE entity_id = $1 AND source_ref = 'loan:U1')", [odd.entity]);
      await pg.query('COMMIT');
      expect(done.rowCount === 1, 'could not retag the loan line (' + done.rowCount + ')');
      const wrong = await emi(odd, 'U1', 100, 'u1');
      expect(wrong.status === 422 && /not converted/.test(said(wrong)) && (await repaid(pg, odd, 'U1')) === 0, said(wrong));
      return said(wrong);
    });

    const get = (s, q) => j('/api/books/loans' + (q || ''), { token: s.token });
    const entryOf = async (s, sourceRef) => (await pg.query('SELECT entry_id FROM journal_entry WHERE entity_id = $1 AND source_ref = $2', [s.entity, sourceRef])).rows[0].entry_id;
    const reverse = (s, id) => j('/api/books/entries/' + id + '/reverse', { method: 'POST', token: s.token, body: { reason: 'entered by mistake' } });
    const loanNet = async (s) => Number((await pg.query("SELECT COALESCE(SUM(l.cr_minor - l.dr_minor), 0)::bigint AS n FROM journal_line l JOIN ledger_account a ON a.account_id = l.account_id AND a.entity_id = l.entity_id WHERE l.entity_id = $1 AND a.role IN ('secured_loan','unsecured_loan','bank_od')", [s.entity])).rows[0].n);

    await kase('LC-7', 'GET /loans on real Postgres: opening, owed, taken_on, lender, one currency, a page', async () => {
      const r = await freshBooks('r', 'Loan Read');
      ok(await loan(r, 'A', 1000000), 'A'); ok(await loan(r, 'B', 500000), 'B');
      ok(await emi(r, 'A', 250000, 'm1'), 'emi A');
      const all = await get(r);
      const byRef = {}; (all.b.loans || []).forEach((l) => { byRef[l.ref] = l; });
      expect(all.status === 200 && all.b.total === 2 && byRef.A && byRef.B, said(all));
      expect(byRef.A.opening_minor === 1000000 && byRef.A.outstanding_minor === 750000 && byRef.B.opening_minor === 500000 && byRef.B.outstanding_minor === 500000, said(all));
      expect(/^2026-04-02$/.test(byRef.A.taken_on) && byRef.A.currency === 'INR' && byRef.A.lender === 'Bank A', said(all));
      const p = await get(r, '?limit=1&page=2');
      expect(p.b.loans.length === 1 && p.b.total === 2 && p.b.page === 2 && p.b.limit === 1, said(p));
      return said(all);
    });

    await kase('LC-8', 'a loan whose instalments are still live cannot be reversed: 409 ENTRY_HAS_REPAYMENTS "This loan has instalments. Reverse its instalments first.", nothing posted, the loan stays listed (the old run left a stray -300,000 debit)', async () => {
      const v = await freshBooks('v', 'Loan Void');
      ok(await loan(v, 'V1', 1000000), 'V1'); ok(await emi(v, 'V1', 300000, 'v1'), 'emi');
      const before = await loanNet(v);
      const rev = await reverse(v, await entryOf(v, 'loan:V1'));
      expect(rev.status === 409 && rev.b && rev.b.code === 'ENTRY_HAS_REPAYMENTS' && /This loan has instalments. Reverse its instalments first./.test(said(rev)), 'reverse ' + said(rev));
      expect((await loanNet(v)) === before && before === 700000, 'loan account net ' + (await loanNet(v)) + ' before ' + before);
      const listed = await get(v);
      expect(listed.status === 200 && listed.b.total === 1 && listed.b.loans[0].outstanding_minor === 700000, 'listed ' + said(listed));
      return said(rev);
    });

    await kase('LC-9', 'an instalment that was itself reversed is not counted: owed returns to the full loan', async () => {
      const w = await freshBooks('w', 'Loan Emi Rev');
      ok(await loan(w, 'W1', 800000), 'W1'); ok(await emi(w, 'W1', 300000, 'w1'), 'emi');
      expect((await get(w)).b.loans[0].outstanding_minor === 500000, 'owed after emi');
      ok(await reverse(w, await entryOf(w, 'emi:W1:w1')), 'reverse emi');
      const l = (await get(w)).b.loans[0];
      expect(l.outstanding_minor === 800000 && l.opening_minor === 800000, said({ status: 200, b: l }));
      return said({ status: 200, b: l });
    });

    await kase('LC-10', 'the instalments reversed first, then the loan reverses cleanly: loan account net 0, nothing stray, the loan void (not listed, takes no instalment)', async () => {
      const x = await freshBooks('x', 'Loan Void Clean');
      ok(await loan(x, 'X1', 1000000), 'X1'); ok(await emi(x, 'X1', 300000, 'x1'), 'emi 1'); ok(await emi(x, 'X1', 200000, 'x2'), 'emi 2');
      expect((await reverse(x, await entryOf(x, 'loan:X1'))).status === 409, 'loan refused while two instalments live');
      ok(await reverse(x, await entryOf(x, 'emi:X1:x1')), 'reverse emi 1');
      expect((await reverse(x, await entryOf(x, 'loan:X1'))).status === 409, 'loan still refused with one instalment live');
      ok(await reverse(x, await entryOf(x, 'emi:X1:x2')), 'reverse emi 2');
      const rev = await reverse(x, await entryOf(x, 'loan:X1'));
      expect(rev.status === 200 || rev.status === 201, 'reverse loan ' + said(rev));
      expect((await loanNet(x)) === 0, 'loan account net ' + (await loanNet(x)));
      const listed = await get(x);
      expect(listed.status === 200 && listed.b.total === 0, 'listed ' + said(listed));
      const more = await emi(x, 'X1', 100000, 'x3');
      expect(more.status === 422 && /That loan was reversed, so it takes no instalment/.test(said(more)), 'more ' + said(more)); /* LOANREV: a NEW instalment on a reversed loan is refused in its own words (LC-12); the reversals above are allowed */
      return said(rev);
    });

    /* LOANREV: the hand-computed case of docs/critique/LOAN-REVERSAL-2026-11-18-PLAN.md (minor units, INR): loan 1,000,000 in; instalment jan = 300,000 principal + 20,000 interest out */
    const emiWith = (s, ref, principal, interest, cref) => j('/api/books/loans/' + encodeURIComponent(ref) + '/emi', { method: 'POST', token: s.token, body: { principal_minor: principal, interest_minor: interest, client_ref: cref, date: '2026-05-02' } });
    const net = async (s, roles) => Number((await pg.query("SELECT COALESCE(SUM(l.dr_minor - l.cr_minor), 0)::bigint AS n FROM journal_line l JOIN ledger_account a ON a.account_id = l.account_id AND a.entity_id = l.entity_id WHERE l.entity_id = $1 AND a.role = ANY($2::text[])", [s.entity, roles])).rows[0].n);
    const three = async (s) => [await loanNet(s), await net(s, ['bank']), await net(s, ['interest_paid'])]; /* loan (Cr-Dr) · bank (Dr-Cr) · interest (Dr) */

    await kase('LC-11', 'loan 1,000,000, instalment 300,000 + 20,000 interest: the loan reversal is refused and leaves 700,000 / 680,000 / 20,000; instalment then loan reversed leaves 0 / 0 / 0', async () => {
      const y = await freshBooks('y', 'Loan Rev Hand');
      ok(await loan(y, 'Y1', 1000000), 'Y1'); ok(await emiWith(y, 'Y1', 300000, 20000, 'jan'), 'jan');
      expect((await three(y)).join() === '700000,680000,20000', 'after the instalment ' + (await three(y)).join());
      const refused = await reverse(y, await entryOf(y, 'loan:Y1'));
      expect(refused.status === 409 && refused.b.code === 'ENTRY_HAS_REPAYMENTS' && /This loan has instalments. Reverse its instalments first./.test(said(refused)), said(refused));
      expect((await three(y)).join() === '700000,680000,20000' && (await get(y)).b.loans[0].outstanding_minor === 700000, 'a refused reversal changed the books: ' + (await three(y)).join());
      ok(await reverse(y, await entryOf(y, 'emi:Y1:jan')), 'reverse jan');
      expect((await three(y)).join() === '1000000,1000000,0', 'instalment reversed ' + (await three(y)).join());
      const done = await reverse(y, await entryOf(y, 'loan:Y1'));
      expect(done.status === 200 || done.status === 201, said(done));
      expect((await three(y)).join() === '0,0,0' && (await get(y)).b.total === 0, 'all three accounts ' + (await three(y)).join());
      const again = await reverse(y, await entryOf(y, 'loan:Y1'));
      expect(again.status === 409 && again.b.code === 'ALREADY_REVERSED', said(again));
      return (await three(y)).join();
    });

    await kase('LC-12', 'a reversed loan takes no instalment, interest-only included (words, 422): nothing posted', async () => {
      const z = await freshBooks('z', 'Loan Rev Interest');
      ok(await loan(z, 'Z1', 1000000), 'Z1'); ok(await reverse(z, await entryOf(z, 'loan:Z1')), 'reverse loan');
      const interestOnly = await emiWith(z, 'Z1', 0, 20000, 'jan'), principal = await emiWith(z, 'Z1', 300000, 20000, 'feb');
      expect(interestOnly.status === 422 && /That loan was reversed/.test(said(interestOnly)) && principal.status === 422 && /That loan was reversed/.test(said(principal)), said(interestOnly) + ' / ' + said(principal));
      expect((await three(z)).join() === '0,0,0', 'stray ' + (await three(z)).join());
      return said(interestOnly);
    });

    await kase('LC-13', 'a reversal of the loan and a new instalment at the same moment, both queued on loan|ref: never both - the loan account ends 0 (reversed, instalment refused) or the reversal is refused (700,000 owed)', async () => {
      const w2 = await freshBooks('w2', 'Loan Rev Race');
      ok(await loan(w2, 'W1', 1000000), 'W1');
      const id = await entryOf(w2, 'loan:W1');
      await lock.query('BEGIN');
      await lock.query(LOCK_SQL, [w2.entity, 'loan|W1']);
      const both = [reverse(w2, id), emiWith(w2, 'W1', 300000, 0, 'r1')];
      await pause(900);
      await lock.query('COMMIT');
      const [rev, inst] = await Promise.all(both);
      const [loanAcct] = await three(w2);
      expect((rev.status === 200 && inst.status === 422 && loanAcct === 0) || (rev.status === 409 && inst.status === 200 && loanAcct === 700000), 'reverse ' + said(rev) + ' / emi ' + said(inst) + ' / loan account ' + loanAcct);
      return said(rev) + ' / ' + said(inst);
    });
  } finally {
    await lock.end();
    await pg.end();
  }
  finish('FIN-92 loan cap');
})().catch((e) => { console.error(e); process.exit(2); });
