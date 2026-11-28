'use strict';
/**
 * tests/bb-p1-1.realstack.cjs — BB-P1-1 on REAL Postgres (api as cb_app, RLS on): a dishonoured cheque and a loan repayment of the opening balances, AU shop, the bank reconciliation at 0.00.
 * Hand figures (AUD, minor units, written before any run; the hand table of PM/bank-books/STATE-2026-11-28.md lines 15 and 20):
 *   CHQ-1  cheque 300.00 received 12 Oct 2026, deposited and cleared 12 Oct: Dr 1500 bank 30000 / Cr 1300 debtors 30000 (party); the real bank ledger line says event_type payment_received, names the party
 *   CHQ-2  returned 20 Oct: POST /entries/:id/reverse { date 2026-10-20 }: posting_date 2026-10-20, books net 0 on 1500 and 1300 (Dr 1300 30000 / Cr 1500 30000), GET /cheques reads the cheque bounced
 *   CHQ-3  a second reverse: 409 ALREADY_REVERSED with posting_date 2026-10-20
 *   LOAN-1 opening balances 1 Jul 2026: Dr 1500 500000 / Cr 2000 300000 (a loan of 3,000.00) / Cr 3000 200000; GET /loans lists ref acct:2000 owing 300000; instalment 640.00 on 26 Oct = principal 60000 + interest 4000:
 *          Dr 2000 60000 / Dr 6150 4000 / Cr 1500 64000, no 2210 (interest input-taxed, principal out of scope); owing 240000; principal 250000 refused 422; after the instalment is reversed owing 300000 again
 *   LOAN-3 an opening reversed and posted again leaves no phantom row (the reversal copies is_opening); a taken loan may not be named acct:...
 *   BRS    the engine's matcher (window 3 days): statement deposit 300.00 12/10, return 300.00 20/10, loan 640.00 26/10 against the bank ledger lines: 0 unmatched on both sides (0.00)
 * Run on a SIT box only (the harness refuses anything else): sh toolset/sit-realstack.sh <box> bb-p1-1.realstack.cjs
 * CARD 16-finance/bank-reconciliation-and-bank-rail
 */
const path = require('path');
const H = require('./lib/truth-harness.cjs');
const { j, ok, kase, expect, freshShop, finish } = H;
const RUN = 'bb' + (Date.now() % 1e9).toString(36).padStart(6, '0');
const AU = { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: true, number: '51824753556', scheme: 'regular' } };
const ENG = path.join(path.resolve(process.env.CB_ENGINES_DIR || process.env.CB_ENG_DIR || path.join(__dirname, '..', '..', 'chitbridge-engines')), 'src');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const say = (r) => r.status + ' ' + JSON.stringify(r.b).slice(0, 300);
async function tb(shop) {
  const r = ok(await j('/api/books/trial-balance?asOf=2026-12-31', { token: shop.token }), 'trial balance').b, out = {};
  (r.rows || []).forEach((row) => { const net = (Number(row.dr_minor) || 0) - (Number(row.cr_minor) || 0); if (net) out[row.code] = net; });
  return out;
}
const delta = (a, b) => { const o = {}; new Set([...Object.keys(a), ...Object.keys(b)]).forEach((k) => { const d = (b[k] || 0) - (a[k] || 0); if (d) o[k] = d; }); return o; };
const bankLines = async (shop) => ok(await j('/api/books/ledger/1500?from=2026-10-01&to=2026-10-31', { token: shop.token }), 'bank ledger').b.lines || [];

(async () => {
  console.log('\n== BB-P1-1 · returned cheque and opening-balance loan · AU · run ' + RUN + ' ==');
  ok(await j('/health'), 'health');
  const S = await freshShop(RUN, 'Bluegum', AU);
  ok(await j('/api/books/enable', { method: 'POST', token: S.token }), 'books on');
  ok(await j('/api/books/opening', { method: 'POST', token: S.token, body: { date: '2026-07-01', client_ref: RUN + 'open', rows: [{ code: '1500', dr_minor: 500000 }, { code: '2000', cr_minor: 300000 }, { code: '3000', cr_minor: 200000 }] } }), 'opening balances');
  const made = ok(await j('/api/relationships/customers', { method: 'POST', token: S.token, body: { name: 'Ravi Stores ' + RUN, phone: '98400' + String(Date.now()).slice(-5) } }), 'customer').b;
  const party = made.customer_identity_id || (made.customer && (made.customer.customer_entity_id || made.customer.identity_id)) || made.identity_id || made.id;
  expect(!!party, 'no party id in ' + JSON.stringify(made).slice(0, 200));
  let payId = null, receipt = null, reversal = null;
  const before = await tb(S);

  await kase('CHQ-1', 'cheque 300.00 cleared: Dr 1500 30000 / Cr 1300 30000; the real ledger line carries event_type payment_received and the party', async () => {
    const rec = ok(await j('/api/books/payments', { method: 'POST', token: S.token, body: { party_id: party, direction: 'in', amount_minor: 30000, currency: 'AUD', mode: 'cheque', cheque_no: '000123', received_at: '2026-10-12', allocate: 'none', client_ref: RUN + 'c1' } }), 'record').b;
    payId = rec.payment && rec.payment.payment_id;
    ok(await j('/api/books/cheques/' + payId + '/status', { method: 'POST', token: S.token, body: { status: 'deposited', date: '2026-10-12' } }), 'deposited');
    const clr = ok(await j('/api/books/cheques/' + payId + '/status', { method: 'POST', token: S.token, body: { status: 'cleared', date: '2026-10-12' } }), 'cleared').b;
    receipt = clr.posted && clr.posted.entry_id;
    expect(!!receipt, 'no entry ' + JSON.stringify(clr).slice(0, 200));
    expect(same(delta(before, await tb(S)), { 1300: -30000, 1500: 30000 }), 'books ' + JSON.stringify(delta(before, await tb(S))));
    const line = (await bankLines(S)).find((l) => l.entry_id === receipt);
    expect(line && line.event_type === 'payment_received' && line.party_id === party && Number(line.dr_minor) === 30000, 'ledger line ' + JSON.stringify(line));
  });

  await kase('CHQ-2', 'returned 20 Oct: reversal dated 2026-10-20, books net 0, the cheque reads bounced', async () => {
    const r = await j('/api/books/entries/' + receipt + '/reverse', { method: 'POST', token: S.token, body: { reason: 'Cheque 000123 returned by the bank', date: '2026-10-20' } });
    expect(r.status === 200 && r.b.ok && r.b.posting_date === '2026-10-20', say(r));
    reversal = r.b.entry_id;
    expect(same(delta(before, await tb(S)), {}), 'books not back to nil: ' + JSON.stringify(delta(before, await tb(S))));
    const list = ok(await j('/api/books/cheques?all=1', { token: S.token }), 'cheques').b;
    const mine = (list.cheques || []).find((c) => String(c.payment_id || c.id) === String(payId));
    expect(mine && mine.status === 'bounced', 'cheque status ' + JSON.stringify(mine));
  });

  await kase('CHQ-3', 'a second reverse is 409 ALREADY_REVERSED and names 2026-10-20', async () => {
    const r = await j('/api/books/entries/' + receipt + '/reverse', { method: 'POST', token: S.token, body: { reason: 'again', date: '2026-10-20' } });
    expect(r.status === 409 && r.b.code === 'ALREADY_REVERSED' && r.b.posting_date === '2026-10-20', say(r));
  });

  let emiEntry = null;
  await kase('LOAN-1', 'opening loan 3,000.00: listed as acct:2000; instalment 640.00 = 600.00 + 40.00: Dr 2000 60000 / Dr 6150 4000 / Cr 1500 64000, no tax; owing 240000; 250000 refused', async () => {
    const list = ok(await j('/api/books/loans', { token: S.token }), 'loans').b.loans || [];
    const one = list.find((l) => l.ref === 'acct:2000');
    expect(one && Number(one.outstanding_minor) === 300000 && /Secured loans/.test(one.lender), 'listed ' + JSON.stringify(list));
    const mid = await tb(S);
    const emi = await j('/api/books/loans/' + encodeURIComponent('acct:2000') + '/emi', { method: 'POST', token: S.token, body: { principal_minor: 60000, interest_minor: 4000, from: 'bank', date: '2026-10-26', client_ref: RUN + 'e1' } });
    expect(emi.status === 200 && emi.b.ok, say(emi));
    emiEntry = emi.b.entry_id;
    expect(same(delta(mid, await tb(S)), { 1500: -64000, 2000: 60000, 6150: 4000 }), 'books ' + JSON.stringify(delta(mid, await tb(S))));
    const after = ok(await j('/api/books/loans', { token: S.token }), 'loans').b.loans.find((l) => l.ref === 'acct:2000');
    expect(Number(after.outstanding_minor) === 240000, 'owing ' + JSON.stringify(after));
    const over = await j('/api/books/loans/' + encodeURIComponent('acct:2000') + '/emi', { method: 'POST', token: S.token, body: { principal_minor: 250000, from: 'bank', date: '2026-10-27', client_ref: RUN + 'e2' } });
    expect(over.status === 422 && /more than the loan still owes/.test(JSON.stringify(over.b)), say(over));
  });

  await kase('LOAN-2', 'the instalment reversed: owing 300000 again, books back', async () => {
    const r = await j('/api/books/entries/' + emiEntry + '/reverse', { method: 'POST', token: S.token, body: { reason: 'wrong split' } });
    expect(r.status === 200, say(r));
    const loan = ok(await j('/api/books/loans', { token: S.token }), 'loans').b.loans.find((l) => l.ref === 'acct:2000');
    expect(Number(loan.outstanding_minor) === 300000, 'owing ' + JSON.stringify(loan));
    const again = await j('/api/books/loans/' + encodeURIComponent('acct:2000') + '/emi', { method: 'POST', token: S.token, body: { principal_minor: 60000, interest_minor: 4000, from: 'bank', date: '2026-10-26', client_ref: RUN + 'e3' } });
    expect(again.status === 200, say(again));
    emiEntry = again.b.entry_id;
  });

  await kase('BRS', 'the statement (deposit 300.00, return 300.00, loan 640.00) against the bank ledger: 0 unmatched on both sides (0.00)', async () => {
    const BR = require(path.join(ENG, 'bank-recon'));
    const mine = new Set([receipt, reversal, emiEntry]);
    const books = (await bankLines(S)).filter((l) => mine.has(l.entry_id)).map((l) => ({ id: l.entry_id, date: l.date, dr_minor: l.dr_minor, cr_minor: l.cr_minor, ref: null, narration: l.what }));
    const stmt = [{ date: '2026-10-12', credit_minor: 30000, debit_minor: 0, narration: 'CHEQUE DEPOSIT 000123' }, { date: '2026-10-20', credit_minor: 0, debit_minor: 30000, narration: 'DISHONOURED CHEQUE 000123' }, { date: '2026-10-26', credit_minor: 0, debit_minor: 64000, narration: 'LOAN REPAYMENT CBA 8812' }];
    const found = BR.match(stmt.map((l, i) => Object.assign({ i }, l)), books, { window_days: 3 });
    expect(found.unmatched_stmt.length === 0 && found.unmatched_ledger.length === 0, 'unmatched ' + JSON.stringify(found).slice(0, 400));
    const sug = BR.suggest(Object.assign({}, stmt[1]), { country: 'AU', receipts: [{ ref: receipt, party, amount_minor: 30000 }] });
    expect(sug.event && sug.event.type === 'cheque_dishonoured' && sug.event.reverses === receipt && sug.event.party === party, 'engine proposal ' + JSON.stringify(sug.event));
    expect(same((sug.entry.lines || []).map((l) => [l.code, l.dr_minor, l.cr_minor]), [['1300', 30000, 0], ['1500', 0, 30000]]), 'engine journal ' + JSON.stringify(sug.entry.lines));
  });
  await kase('LOAN-3', 'an opening reversed and posted again (the reversal copies is_opening): no phantom negative loan row; ONE acct:2000 row owing 300000', async () => {
    const T = await freshShop(RUN + 'r', 'Redgum', AU);
    ok(await j('/api/books/enable', { method: 'POST', token: T.token }), 'books on');
    const rows = [{ code: '1500', dr_minor: 500000 }, { code: '2000', cr_minor: 300000 }, { code: '3000', cr_minor: 200000 }];
    const first = ok(await j('/api/books/opening', { method: 'POST', token: T.token, body: { date: '2026-07-01', client_ref: RUN + 'ro1', rows } }), 'opening').b;
    const rev = await j('/api/books/entries/' + first.entry_id + '/reverse', { method: 'POST', token: T.token, body: { reason: 'wrong opening' } });
    expect(rev.status === 200, say(rev));
    const none = ok(await j('/api/books/loans', { token: T.token }), 'loans').b.loans || [];
    expect(none.length === 0, 'a reversed opening left rows ' + JSON.stringify(none));
    ok(await j('/api/books/opening', { method: 'POST', token: T.token, body: { date: '2026-07-01', client_ref: RUN + 'ro2', rows } }), 'opening again');
    const again = ok(await j('/api/books/loans', { token: T.token }), 'loans').b.loans || [];
    expect(again.length === 1 && again[0].ref === 'acct:2000' && Number(again[0].outstanding_minor) === 300000, 'listed ' + JSON.stringify(again));
    const taken = await j('/api/books/loans', { method: 'POST', token: T.token, body: { ref: 'acct:2000', lender: 'X', amount_minor: 100, into: 'bank', date: '2026-10-28' } });
    expect(taken.status >= 400 && /acct:/.test(JSON.stringify(taken.b)), 'a taken loan named acct: was accepted ' + say(taken));
  });

  finish('bb-p1-1');
})().catch((e) => { console.error('threw', e && e.stack || e); process.exitCode = 1; });
