/**
 * bb-p1-1-cheque-return-loan.test.cjs — BB-P1-1 (28 Nov 2026): a dishonoured cheque and a loan repayment can be posted from the Bank page's doors.
 * Held here, through the real router over the in-memory store (no database; the SQL of GET /loans is proved on real Postgres, SIT):
 *   1. POST /entries/:id/reverse { reason, date }: the mirror lands on the day the bank returned the cheque (inside the engine's 3-day match window of the statement line),
 *      Dr party control / Cr bank for the receipt's amount; a day before the original, or ahead of the shop's tomorrow, is refused in words; no date = the original's day (unchanged).
 *   2. the cheque reads 'bounced' (ONE status row) after the owner's reversal of its cleared receipt; the bounce STEP (before clearing) keeps writing its single row.
 *   3. a second reverse is 409 ALREADY_REVERSED and now names the reversal's posting_date (the web counts it done only inside the match window).
 *   4. POST /loans/acct:<code>/emi: a loan of the opening balances takes an instalment (Dr loan principal + Dr interest · Cr bank, the split as given; no tax line), is capped at what the account
 *      still owes, an instalment's reversal restores the balance, a non-loan account is 404.
 * Run: node tests/bb-p1-1-cheque-return-loan.test.cjs   CARD 16-finance/bank-reconciliation-and-bank-rail
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur Bhavan' };
const authStub = Object.assign((req, res, next) => { req.identity = OWNER; next(); }, { entityOf: (req) => req.identity.identity_id, requireScope: () => (req, res, next) => next() });
let attempts = 0;
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b), 'Idempotency-Key': 'attempt-' + ++attempts } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { /* not json */ } done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});
(async () => {
  console.log('\n== BB-P1-1: a returned cheque and a loan of the opening balances ==\n');
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  const IDS = { [SHOP]: { identity_id: SHOP, display_name: 'Mayur Traders', country: 'IN', policy_flags: {} } };
  const q0 = X.dbStub.query;
  X.dbStub.query = async (t, p) => /FROM identities WHERE identity_id = ANY/.test(String(t)) ? { rows: p[0].map((id) => IDS[id]).filter(Boolean) } : q0(t, p);
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const realDay = K.dayOf; const DAY = '2026-10-28';
  K.dayOf = (ts, c) => (ts instanceof Date && Math.abs(ts.getTime() - Date.now()) < 5000 ? DAY : realDay(ts, c));
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);
  await X.store.saveSetting(X.db, SHOP, { enabled: false });
  ok('the ledger is on', (await q('POST', '/enable', {})).status === 200);
  X.T.parties.push({ owner: SHOP, party_id: CUST, party_no: 'P-00001', name: 'Ravi Stores', customer: true, credit_days: 10 });
  const acct = (role) => X.T.accounts.find((a) => a.entity_id === SHOP && a.role === role);
  const roleOf = (id) => (X.T.accounts.find((a) => a.account_id === id) || {}).role;
  const linesOf = (entryId) => X.T.lines.filter((l) => l.entry_id === entryId).map((l) => [roleOf(l.account_id), Number(l.dr_minor), Number(l.cr_minor)]);
  const statusRows = (id, status) => X.T.items.filter((i) => i.ref === 'pay:' + id && i.ref_kind === 'status' && (!status || i.status === status));

  /* ── 1-3 · a cheque of 300.00 received 12 Oct, cleared the same day, returned by the bank 20 Oct ── */
  const rec = await q('POST', '/payments', { party_id: CUST, direction: 'in', amount_minor: 30000, currency: 'INR', mode: 'cheque', cheque_no: '000123', received_at: '2026-10-12' });
  const payId = rec.body.payment && rec.body.payment.payment_id;
  ok('the cheque is recorded (held, nothing posted yet)', rec.status === 200 && !!payId, JSON.stringify(rec.body));
  await q('POST', '/cheques/' + payId + '/status', { status: 'deposited', date: '2026-10-12' });
  const clr = await q('POST', '/cheques/' + payId + '/status', { status: 'cleared', date: '2026-10-12' });
  ok('the cheque clears: the receipt posts', clr.status === 200 && clr.body.posted && clr.body.posted.entry_id, JSON.stringify(clr.body));
  const receiptId = clr.body.posted.entry_id;
  const receiptLines = linesOf(receiptId);
  const before = statusRows(payId).length;
  const early = await q('POST', '/entries/' + receiptId + '/reverse', { reason: 'Cheque returned', date: '2026-10-01' });
  ok('a reversal dated before the receipt is refused in words, nothing written', early.status >= 400 && /before the entry it reverses/.test(JSON.stringify(early.body)) && !X.T.entries.some((h) => h.reverses_entry_id === receiptId), JSON.stringify(early.body));
  const ahead = await q('POST', '/entries/' + receiptId + '/reverse', { reason: 'Cheque returned', date: '2027-02-01' });
  ok('a reversal dated ahead of the shop tomorrow is refused, nothing written', ahead.status >= 400 && !X.T.entries.some((h) => h.reverses_entry_id === receiptId), JSON.stringify(ahead.body));
  const rev = await q('POST', '/entries/' + receiptId + '/reverse', { reason: 'Cheque 000123 returned by the bank', date: '2026-10-20' });
  ok('the reversal posts on the day the bank returned the cheque', rev.status === 200 && rev.body.ok && rev.body.posting_date === '2026-10-20', JSON.stringify(rev.body));
  eq('the mirror is the receipt turned over: Dr the customers control 300.00 · Cr bank 300.00', linesOf(rev.body.entry_id), receiptLines.map((l) => [l[0], l[2], l[1]]));
  ok('the cheque now reads bounced: ONE new status row', statusRows(payId, 'bounced').length === 1 && statusRows(payId).length === before + 1, JSON.stringify(statusRows(payId)));
  const twice = await q('POST', '/entries/' + receiptId + '/reverse', { reason: 'again', date: '2026-10-20' });
  ok('a second reverse is 409 ALREADY_REVERSED naming the day it was reversed on', twice.status === 409 && twice.body.code === 'ALREADY_REVERSED' && twice.body.posting_date === '2026-10-20', JSON.stringify(twice.body));
  ok('…and nothing more was written', X.T.entries.filter((h) => h.reverses_entry_id === receiptId).length === 1 && statusRows(payId, 'bounced').length === 1);
  /* no date: the original's day, as before */
  const rec2 = await q('POST', '/payments', { party_id: CUST, direction: 'in', amount_minor: 5000, currency: 'INR', mode: 'cheque', cheque_no: '000124', received_at: '2026-10-13' });
  await q('POST', '/cheques/' + rec2.body.payment.payment_id + '/status', { status: 'deposited', date: '2026-10-13' });
  const clr2 = await q('POST', '/cheques/' + rec2.body.payment.payment_id + '/status', { status: 'cleared', date: '2026-10-13' });
  const rev2 = await q('POST', '/entries/' + clr2.body.posted.entry_id + '/reverse', { reason: 'no day given' });
  ok('no date given: the reversal keeps the original day (unchanged behaviour)', rev2.status === 200 && rev2.body.posting_date === '2026-10-13', JSON.stringify(rev2.body));
  /* the bounce STEP (a cheque that never cleared) keeps its own single row and writes no entry */
  const rec3 = await q('POST', '/payments', { party_id: CUST, direction: 'in', amount_minor: 7000, currency: 'INR', mode: 'cheque', cheque_no: '000125', received_at: '2026-10-14' });
  const id3 = rec3.body.payment.payment_id;
  await q('POST', '/cheques/' + id3 + '/status', { status: 'deposited', date: '2026-10-14' });
  const b3 = await q('POST', '/cheques/' + id3 + '/status', { status: 'bounced', date: '2026-10-15' });
  ok('the bounce step before clearing: one bounced row, no entry reversed', b3.status === 200 && statusRows(id3, 'bounced').length === 1 && !b3.body.reversed, JSON.stringify(b3.body));

  /* ── 4 · a loan of the opening balances: acct:<code> ── */
  const loanAcct = acct('secured_loan'), bank = acct('bank');
  const OPEN = 'a0000000-0000-4000-8000-000000000001';
  X.T.entries.push({ entry_id: OPEN, entity_id: SHOP, entry_no: 'OB/1', posting_date: '2026-04-01', is_opening: true, source_ref: 'opening:2026', event_type: 'opening', fiscal_year: '2026-27', currency: 'INR' });
  X.T.lines.push({ entry_id: OPEN, entity_id: SHOP, account_id: loanAcct.account_id, code: loanAcct.code, dr_minor: 0, cr_minor: 500000, currency: 'INR' },
    { entry_id: OPEN, entity_id: SHOP, account_id: bank.account_id, code: bank.code, dr_minor: 500000, cr_minor: 0, currency: 'INR' });
  const ref = 'acct:' + loanAcct.code;
  const door = '/loans/' + encodeURIComponent(ref) + '/emi';
  const emi = await q('POST', door, { principal_minor: 60000, interest_minor: 4000, from: 'bank', date: '2026-10-26', client_ref: 'oct' });
  ok('the instalment of an opening loan posts', emi.status === 200 && emi.body.ok, JSON.stringify(emi.body));
  const emiEntry = X.T.entries.find((x) => x.source_ref === 'emi:' + ref + ':oct');
  eq('Dr the loan 600.00 · Dr interest 40.00 · Cr bank 640.00, no tax line', emiEntry && linesOf(emiEntry.entry_id), [['secured_loan', 60000, 0], ['interest_paid', 4000, 0], ['bank', 0, 64000]]);
  ok('a double tap posts once', (await q('POST', door, { principal_minor: 60000, interest_minor: 4000, from: 'bank', date: '2026-10-26', client_ref: 'oct' })).body.duplicate === true);
  const over = await q('POST', door, { principal_minor: 450000, from: 'bank', date: '2026-10-27', client_ref: 'big' });
  ok('a principal above what the account still owes (5,000.00 less 600.00) is refused in words', over.status === 422 && /more than the loan still owes/.test(JSON.stringify(over.body)), JSON.stringify(over.body));
  const rest = await q('POST', door, { principal_minor: 440000, from: 'bank', date: '2026-10-28', client_ref: 'rest' });
  ok('exactly the remainder (4,400.00) is accepted', rest.status === 200, JSON.stringify(rest.body));
  await q('POST', '/entries/' + rest.body.entry_id + '/reverse', { reason: 'wrong loan' });
  const again = await q('POST', door, { principal_minor: 440000, from: 'bank', date: '2026-10-28', client_ref: 'rest2' });
  ok('after that instalment is reversed the balance is back: the same 4,400.00 is accepted again', again.status === 200, JSON.stringify(again.body));
  eq('an account that is not a loan account is 404', (await q('POST', '/loans/' + encodeURIComponent('acct:' + bank.code) + '/emi', { principal_minor: 100, from: 'bank', date: '2026-10-28', client_ref: 'x' })).status, 404);
  /* ── the bank reconciliation reaches 0.00: the engine's own matcher (window 3 days) over the statement lines of the hand table and the books' bank lines these doors posted ── */
  const Recon = require(path.join(X.src.dir, 'bank-recon.js'));
  const led = await q('GET', '/ledger/' + encodeURIComponent(bank.code) + '?from=2026-10-01&to=2026-10-31');
  const mine = new Set([receiptId, rev.body.entry_id, emiEntry.entry_id]);
  const bookLines = (led.body.lines || []).filter((l) => mine.has(l.entry_id)).map((l) => ({ id: l.entry_id, date: l.date, dr_minor: l.dr_minor, cr_minor: l.cr_minor, ref: null, narration: l.what }));
  const stmt = [{ date: '2026-10-12', credit_minor: 30000, debit_minor: 0, narration: 'CHEQUE DEPOSIT 000123' }, { date: '2026-10-20', credit_minor: 0, debit_minor: 30000, narration: 'DISHONOURED CHEQUE 000123' }, { date: '2026-10-26', credit_minor: 0, debit_minor: 64000, narration: 'LOAN REPAYMENT CBA 8812' }];
  const found = Recon.match(stmt.map((l, i) => Object.assign({ i }, l)), bookLines, { window_days: 3 });
  eq('the cheque deposit, its return and the loan repayment all match the books: 0.00 left (hand: 0.00)', [found.unmatched_stmt.length, found.unmatched_ledger.length], [0, 0]);
  const old = await Recon.match([{ i: 0, date: '2026-10-20', credit_minor: 0, debit_minor: 5000, narration: 'DISHONOURED CHEQUE 000124' }], (await q('GET', '/ledger/' + encodeURIComponent(bank.code) + '?from=2026-10-13&to=2026-10-13')).body.lines.filter((l) => Number(l.cr_minor) === 5000).map((l) => ({ id: l.entry_id, date: l.date, dr_minor: l.dr_minor, cr_minor: l.cr_minor })), { window_days: 3 });
  ok('control: a reversal left on the original day (no date) is 7 days from the bank line and does NOT match (why the date is passed)', old.unmatched_stmt.length === 1, JSON.stringify(old));
  /* the module's own rules, alone: a day only for a person's reversal, refused in words before the receipt; a non-cheque source writes nothing */
  const Returned = require(path.join(H.API, 'lib', 'books-cheque-return'));
  const helpers = { isoDay: (d) => String(d).slice(0, 10), typedDate: () => {}, refuse: (words) => new Error(words), S: {}, E: {} };
  const orig = { posting_date: '2026-10-12', source_ref: 'bill:1' };
  eq('givenDay: no day given, or not a person reversal, is null (the original month)', [Returned.givenDay(helpers, {}, {}, orig, { owner: true }), Returned.givenDay(helpers, {}, {}, orig, { returned_on: '2026-10-20' })], [null, null]);
  eq('givenDay: a person reversal on 20 Oct is that day', Returned.givenDay(helpers, {}, {}, orig, { owner: true, returned_on: '2026-10-20' }), '2026-10-20');
  let said = ''; try { Returned.givenDay(helpers, {}, {}, orig, { owner: true, returned_on: '2026-10-01' }); } catch (e) { said = e.message; }
  ok('givenDay: a day before the entry is refused in words', /before the entry it reverses \(2026-10-12\)/.test(said), said);
  eq('markReturned: a receipt that is not a payment writes nothing', await Returned.markReturned(helpers, {}, SHOP, orig, '2026-10-20', null), 0);
  const taken = await q('POST', '/loans', { ref: 'acct:9999', lender: 'X', amount_minor: 100, into: 'bank', date: '2026-10-28' });
  ok('a taken loan cannot be named acct:... (it would collide with an opening loan)', taken.status >= 400 && /acct:/.test(JSON.stringify(taken.body)), JSON.stringify(taken.body));
  srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('threw: ' + (e && e.stack || e)); process.exit(1); });
