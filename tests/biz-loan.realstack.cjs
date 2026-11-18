'use strict';
/**
 * tests/biz-loan.realstack.cjs — BUSINESS SCENARIOS MNY-LOAN-* on REAL Postgres (api as cb_app, RLS on). Each case: the HAND-COMPUTED figure first, then the inverse refusal. Hand figures in minor units (AUD cents), written before any run.
 * Source: toolset/sitfull/biz-money-expected.json (branch test/scenarios-money-1118). Doors: POST /api/books/loans · /loans/:ref/emi · /entries/:id/reverse · GET /loans · GET /trial-balance.
 * Loan 10,000.00 = 1000000; instalment jan: principal 3,000.00 = 300000 + interest 200.00 = 20000. Loan liability = codes 2000/2010/2020 (Cr negative); interest 6150; bank 1500; GST paid 2210.
 *   MNY-LOAN-01 take the loan · -02 first instalment, no GST on the interest · -03 reverse the loan while an instalment is live: 409 · -04 reverse the instalment, then the loan · -07 interest-only instalment · -08 instalment above the balance
 * Not covered here (own cases in tests/fin-92-loan-cap.realstack.cjs): LOAN-06 prefix names, LOAN-12 the race. LOAN-10 (bank bounces an instalment) has no door yet: see the scenario verdict.
 * CARD 16-finance/books
 */
const H = require('./lib/truth-harness.cjs');
const { j, ok, kase, expect, freshShop, finish } = H;
const { shopDayAt } = require('./lib/shop-day.cjs');
const RUN = 'bl' + (Date.now() % 1e9).toString(36).padStart(6, '0');
const AU = { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: true, number: '51824753556', scheme: 'regular' } };
const DAY = shopDayAt(-1);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const say = (r) => JSON.stringify([r.status, r.b]).slice(0, 260);
async function tb(shop) {
  const r = ok(await j('/api/books/trial-balance?asOf=' + DAY + '', { token: shop.token }), 'trial balance').b;
  const out = {};
  (r.rows || []).forEach((row) => { const v = (Number(row.dr_minor) || 0) - (Number(row.cr_minor) || 0); if (v) out[row.code] = v; });
  return out;
}
const loanSum = (t) => (t[2000] || 0) + (t[2010] || 0) + (t[2020] || 0);
const loan = (s, ref, amount) => j('/api/books/loans', { method: 'POST', token: s.token, body: { ref, lender: 'Bank ' + ref, amount_minor: amount, into: 'bank', date: DAY } });
const emi = (s, ref, principal, interest, cref) => j('/api/books/loans/' + encodeURIComponent(ref) + '/emi', { method: 'POST', token: s.token, body: { principal_minor: principal, interest_minor: interest, client_ref: cref, date: DAY } });
const reverse = (s, id, why) => j('/api/books/entries/' + id + '/reverse', { method: 'POST', token: s.token, body: { reason: why || 'scenario' } });
const outstanding = async (s, ref) => { const r = ok(await j('/api/books/loans', { token: s.token }), 'loans').b; const l = (r.loans || r.rows || []).find((x) => x.ref === ref); return l ? Number(l.outstanding_minor != null ? l.outstanding_minor : l.outstanding) : null; };
const shop = async (tag) => { const s = await freshShop(RUN + tag, 'Loan ' + tag, AU); ok(await j('/api/books/enable', { method: 'POST', token: s.token }), 'books on'); return s; };

(async () => {
  console.log('\n== MNY-LOAN scenarios · run ' + RUN + ' ==');
  ok(await j('/health'), 'health');

  await kase('MNY-LOAN-01', 'take the loan 10,000.00: Dr bank 1000000 / Cr loan 1000000, outstanding 1000000, P&L rows none; a loan booked as income is not a door (the books show no 4xxx)', async () => {
    const s = await shop('a');
    const r = await loan(s, 'L1', 1000000);
    expect(r.status === 200 || r.status === 201, 'loan ' + say(r));
    const t = await tb(s);
    expect(t[1500] === 1000000 && loanSum(t) === -1000000 && Object.keys(t).length === 2, 'books ' + JSON.stringify(t) + ', hand {1500:1000000, loan -1000000} and no 4xxx/6xxx');
    expect(await outstanding(s, 'L1') === 1000000, 'outstanding ' + (await outstanding(s, 'L1')) + ', hand 1000000');
  });

  await kase('MNY-LOAN-02', 'first instalment 3,000.00 + 200.00 interest: Dr loan 300000, Dr 6150 20000, Cr bank 320000; loan 700000, bank 680000, outstanding 700000, no GST row (2210) on the interest', async () => {
    const s = await shop('b');
    ok(await loan(s, 'L1', 1000000), 'loan');
    const r = await emi(s, 'L1', 300000, 20000, RUN + 'e2');
    expect(r.status === 200 || r.status === 201, 'emi ' + say(r));
    const t = await tb(s);
    expect(t[1500] === 680000 && loanSum(t) === -700000 && t[6150] === 20000 && t[2210] === undefined && Object.keys(t).length === 3, 'books ' + JSON.stringify(t) + ', hand {1500:680000, loan:-700000, 6150:20000}, no 2210');
    expect(await outstanding(s, 'L1') === 700000, 'outstanding ' + (await outstanding(s, 'L1')) + ', hand 700000');
    const gst = await j('/api/books/loans/L1/emi', { method: 'POST', token: s.token, body: { principal_minor: 100000, interest_minor: 20000, interest_tax_minor: 1818, client_ref: RUN + 'e2g', date: DAY } });
    expect(gst.status >= 400 && gst.status < 500, 'a GST credit of 18.18 on loan interest was accepted (input-taxed): ' + say(gst));
    expect(same(await tb(s), t), 'a refused GST claim moved the books');
  });

  await kase('MNY-LOAN-03', 'reverse the loan while an instalment is live: 409 ENTRY_HAS_REPAYMENTS, loan 700000, bank 680000 and outstanding 700000 unchanged', async () => {
    const s = await shop('c');
    const l = ok(await loan(s, 'L1', 1000000), 'loan').b;
    ok(await emi(s, 'L1', 300000, 20000, RUN + 'e3'), 'emi');
    const before = await tb(s);
    const r = await reverse(s, l.entry_id);
    expect(r.status === 409 && r.b.code === 'ENTRY_HAS_REPAYMENTS', 'expected 409 ENTRY_HAS_REPAYMENTS, got ' + say(r));
    expect(same(await tb(s), before) && await outstanding(s, 'L1') === 700000, 'books or outstanding moved after the refusal: ' + JSON.stringify(await tb(s)));
  });

  await kase('MNY-LOAN-04', 'reverse the instalment, then the loan: loan 1000000 / bank 1000000 / interest 0, then all 0 and GET /loans omits it; swapped order is 409', async () => {
    const s = await shop('d');
    const l = ok(await loan(s, 'L1', 1000000), 'loan').b;
    const e = ok(await emi(s, 'L1', 300000, 20000, RUN + 'e4'), 'emi').b;
    const eid = e.entry_id || (e.entry && e.entry.entry_id);
    expect(eid, 'the instalment answered no entry id: ' + JSON.stringify(e).slice(0, 200));
    expect((await reverse(s, l.entry_id)).status === 409, 'loan first must be 409');
    const r1 = await reverse(s, eid);
    expect(r1.status === 200, 'reverse instalment ' + say(r1));
    const t1 = await tb(s);
    expect(t1[1500] === 1000000 && loanSum(t1) === -1000000 && !t1[6150], 'after the instalment is reversed ' + JSON.stringify(t1) + ', hand {1500:1000000, loan:-1000000, 6150:0}');
    const r2 = await reverse(s, l.entry_id);
    expect(r2.status === 200, 'reverse loan ' + say(r2));
    const t2 = await tb(s);
    expect(same(t2, {}) , 'after both are reversed ' + JSON.stringify(t2) + ', hand every account 0');
    expect(await outstanding(s, 'L1') === null, 'GET /loans still lists the reversed loan');
  });

  await kase('MNY-LOAN-07', 'interest-only instalment 200.00: Dr 6150 20000 / Cr bank 20000, outstanding stays 1000000; reversing the loan is 409; after the loan was reversed (no instalment) an interest-only instalment is refused', async () => {
    const s = await shop('e');
    const l = ok(await loan(s, 'L1', 1000000), 'loan').b;
    const r = await emi(s, 'L1', 0, 20000, RUN + 'e7');
    expect(r.status === 200 || r.status === 201, 'interest only ' + say(r));
    const t = await tb(s);
    expect(t[6150] === 20000 && t[1500] === 980000 && loanSum(t) === -1000000 && await outstanding(s, 'L1') === 1000000, 'books ' + JSON.stringify(t) + ', hand {1500:980000, loan:-1000000, 6150:20000}, outstanding 1000000');
    expect((await reverse(s, l.entry_id)).status === 409, 'reversing the loan under an interest-only instalment must be 409');
    const s2 = await shop('e2');
    const l2 = ok(await loan(s2, 'L1', 1000000), 'loan').b;
    ok(await reverse(s2, l2.entry_id), 'reverse a loan with no instalment');
    const late = await emi(s2, 'L1', 0, 20000, RUN + 'e7b');
    expect(late.status >= 400 && late.status < 500, 'an interest-only instalment on a reversed loan was accepted: ' + say(late));
    expect(same(await tb(s2), {}), 'the refused instalment moved the books');
  });

  await kase('MNY-LOAN-08', 'instalment above the balance: outstanding 700000, principal 750000 is refused (500.00 over), nothing posted; 700000 is accepted and outstanding 0', async () => {
    const s = await shop('f');
    ok(await loan(s, 'L1', 1000000), 'loan');
    ok(await emi(s, 'L1', 300000, 0, RUN + 'e8a'), 'first instalment');
    const before = await tb(s);
    const over = await emi(s, 'L1', 750000, 0, RUN + 'e8b');
    expect(over.status === 422 && /outstanding/i.test(JSON.stringify(over.b)), 'expected 422 naming the outstanding amount, got ' + say(over));
    expect(same(await tb(s), before), 'the refused instalment moved the books');
    const exact = await emi(s, 'L1', 700000, 0, RUN + 'e8c');
    expect(exact.status === 200 || exact.status === 201, 'exact ' + say(exact));
    expect(await outstanding(s, 'L1') === 0 || await outstanding(s, 'L1') === null, 'outstanding after the last instalment ' + (await outstanding(s, 'L1')) + ', hand 0');
  });
  finish('biz-loan');
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });
