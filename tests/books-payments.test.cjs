/**
 * books-payments.test.cjs — M26 · PAYMENTS, ONE CALL, HONEST (SPEC-payments-2026-10-05 §2.4, §4.1, §4.2; MASTER-BUILD row 25).
 *
 * What went wrong on 2026-10-04: the popup recorded a payment the moment it opened a three-step, nothing asked "is anything
 * owed?", and a fresh client_ref per open meant the idempotency key caught nothing — PY/…/000001 and 000002 for one ₹5,000.
 * Held here, through the real router over the in-memory store (no database):
 *   1. POST /payments/preview — W1 nothing_owed · W2 excess · W3 same_again (names the entry_no) · W4 just_settled (names it);
 *      PAY D5 as written: a 24-hour window — the same rows two days old raise neither W3 nor W4.
 *   2. POST /payments with a warning not acknowledged → 409 ALREADY_PAID in words, nothing written; acknowledged → 200 and
 *      outcome.words is the exact sentence.
 *   3. ONE TRANSACTION: a refused allocation (confirmItems) leaves no books_payment row, no entry, no item, no number taken.
 *   4. The same client_ref twice → one payment, one entry, one allocation; the replay says duplicate: true and is answered
 *      BEFORE the duplicate rule looks at the new body.
 *   7. M30 · advice OUT (SPEC §3 · §4.3 · §4.7; api tests 10–11): party.on_rail on the preview · the record answer carries the ready chit body
 *      and MAY (send on rail · share off rail · the level's refusal in the rail engine's words) · PATCH /payments/:id is a merge-patch of the named
 *      fields, first-wins (the same chit again → 200; a different one → 409 ADVICE_EXISTS) · the statement line's advice state none → sent →
 *      delivered → disputed / shared · To-do advices_to_send counts and words · reversed / held cheque / not posted refuse · b285 not run → "not
 *      available yet", never a 500 · one transaction, no per-row read.
 * Needs the books engines (BOOKS_ENGINES_SRC, else the sibling ../chitbridge-engines/src). Run: node tests/books-payments.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
async function section(title, fn) {
  console.log('\n── ' + title + ' ──');
  try { await fn(); } catch (e) { fail++; console.log('   FAIL threw: ' + (e && e.stack || e)); }
}

const SHOP = '11111111-1111-4111-8111-111111111111', MALA = '22222222-2222-4222-8222-222222222222', SUPP = '33333333-3333-4333-8333-333333333333';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Chola Auto Care' };
let WHO = OWNER;   /* section 7 swaps in a viewer */
const authStub = Object.assign((req, res, next) => { req.identity = WHO; next(); }, {
  entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id,
  requireScope: () => (req, res, next) => next(),
});
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});
/** the routes on a port the OS chose, against a fresh in-memory shop */
function serve(X) {
  const express = require('express');
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  return { srv, q: (m, p, b) => call(port, m, '/api/books' + p, b) };
}
/**
 * ⭐ a TRANSACTION over the in-memory tables: what fn wrote is kept on success and taken back on a throw — the only way a
 * store with no database can tell "refused inside the transaction" (nothing stays) from "refused after a commit" (a row stays).
 */
function transactional(X) {
  const T = X.T, ARR = ['accounts', 'periods', 'entries', 'lines', 'items', 'payments', 'outbox', 'changes', 'parties', 'packs', 'chits'];
  X.dbStub.withEntity = async (e, fn) => {
    const snap = { arr: {}, counters: new Map(T.counters), balances: new Map(Array.from(T.balances.entries()).map(([k, v]) => [k, Object.assign({}, v)])), setting: new Map(T.setting) };
    ARR.forEach((k) => { snap.arr[k] = T[k].slice(); });
    try { return await fn(X.db); }
    catch (err) { ARR.forEach((k) => { T[k].length = 0; Array.prototype.push.apply(T[k], snap.arr[k]); }); T.counters = snap.counters; T.balances = snap.balances; T.setting = snap.setting; throw err; }
  };
}
const BILL = (n) => 'c0000000-0000-4000-8000-00000000000' + n;
/** four purchase bills from Kumar Traders, oldest due first: 1,120.00 · 560.00 · 1,050.00 · 990.12 = 3,720.12 (the spec's figures) */
async function supplierBills(X) {
  const bills = [['a', '2026-09-01', { rate: 12, taxable: 1000, cgst: 60, sgst: 60, igst: 0 }, 'KT-0007'], ['b', '2026-09-05', { rate: 12, taxable: 500, cgst: 30, sgst: 30, igst: 0 }, 'KT-0008'],
    ['c', '2026-09-10', { rate: 5, taxable: 1000, cgst: 25, sgst: 25, igst: 0 }, 'KT-0010'], ['d', '2026-09-12', { rate: 5, taxable: 943, cgst: 23.56, sgst: 23.56, igst: 0 }, 'KT-0011']];
  for (const [n, date, rate, no] of bills) {
    await X.B.postEntry(X.db, SHOP, { type: 'purchase_bill', date, currency: 'INR', party: SUPP, source_chit_id: BILL(n), source_ref: 'chit:' + n, by_rate: [rate], paid: {}, round_off: 0 });
    X.T.chits.push({ chit_id: BILL(n), bill_no: no, entity_id: SHOP, purpose: 'order', business_json: { bill_no: no } });
  }
}
const counts = (X) => ({ payments: X.T.payments.length, entries: X.T.entries.length, items: X.T.items.length, nos: Array.from(X.T.counters.values()).reduce((t, n) => t + n, 0) });
/** move every recorded moment: the duplicate rule reads created_at against the real clock (PAY D5: 24 hours) */
const stamp = (X, iso) => { X.T.payments.forEach((p) => { p.created_at = iso; }); X.T.items.forEach((i) => { i.created_at = iso; }); };
const NOW = () => new Date().toISOString(), AGO_2D = () => new Date(Date.now() - 2 * 86400000).toISOString();
const codes = (r) => (r.body.warnings || []).map((w) => w.code).sort();

(async () => {
  console.log('\n══ M26 · payments: preview, one-call record, the duplicate rule (PAY D5), outcome words ══');
  if (!H.enginesSrc().dir) { console.log('\n   SKIP: ' + H.enginesSrc().why + '\n\n  ✓ 0 passed · 0 checks\n'); process.exit(1); }

  const X = H.load({ auth: authStub }); transactional(X);
  X.T.parties.push({ owner: SHOP, party_id: MALA, party_no: 'P-00001', name: 'Mala', customer: true, credit_days: 10 },
    { owner: SHOP, party_id: SUPP, party_no: 'P-00002', name: 'Kumar Traders', supplier: true, credit_days: 30 });
  const { srv, q } = serve(X);
  await q('POST', '/enable', {});
  const PAY = { party_id: SUPP, direction: 'out', currency: 'INR', mode: 'cash', received_at: '2026-10-05' };
  let first = null;

  /* ═══ 1 · preview ═══ */
  await section('1 · POST /payments/preview — the proposal and W1–W4, each in words', async () => {
    const w0 = await q('POST', '/payments/preview', { party_id: SUPP, direction: 'out', amount_minor: 500000, currency: 'INR' });
    ok('nothing owed, no bills being settled → W1 stays silent (Athi 2026-10-08: W1 only with an allocation); the whole amount is an advance',
      w0.status === 200 && codes(w0).join() === '' && w0.body.on_account_minor === 500000, JSON.stringify(w0.body.warnings));
    const w1 = await q('POST', '/payments/preview', { party_id: SUPP, direction: 'out', amount_minor: 500000, currency: 'INR', allocate: 'oldest_first' });
    ok('nothing owed yet → W1 nothing_owed, in words; nothing proposed; the whole amount would be an advance', w1.status === 200 && codes(w1).join() === 'nothing_owed'
      && w1.body.warnings[0].words === 'Nothing is owed to Kumar Traders.' && w1.body.proposal.length === 0 && w1.body.on_account_minor === 500000 && w1.body.open_minor === 0, JSON.stringify(w1.body));
    ok('…the party is named from the shop\'s list; the preview wrote nothing', w1.body.party && w1.body.party.name === 'Kumar Traders' && X.T.payments.length === 0 && X.T.items.length === 0);
    const bad = await q('POST', '/payments/preview', { direction: 'out', amount_minor: 1 });
    ok('no party → 400 "Which party?"', bad.status === 400 && bad.body.error === 'Which party?', JSON.stringify(bad.body));

    await supplierBills(X);
    const w2 = await q('POST', '/payments/preview', { party_id: SUPP, direction: 'out', amount_minor: 500000, currency: 'INR' });
    ok('₹5,000 against ₹3,720.12 open → W2 excess only (W1 silent: something IS owed)', w2.status === 200 && codes(w2).join() === 'excess', JSON.stringify(w2.body.warnings));
    eq('…the proposal is oldest due first, each bill taken in full, bill numbers from the chit', w2.body.proposal.map((p) => [p.bill_no, p.due_date, p.open_minor, p.apply_minor, p.disputed]),
      [['KT-0007', '2026-10-01', 112000, 112000, false], ['KT-0008', '2026-10-05', 56000, 56000, false], ['KT-0010', '2026-10-10', 105000, 105000, false], ['KT-0011', '2026-10-12', 99012, 99012, false]]);
    eq('…open · applied · on account, and the line under the table', [w2.body.open_minor, w2.body.apply_minor, w2.body.on_account_minor, w2.body.words],
      [372012, 372012, 127988, '₹3,720.12 settles 4 bills · ₹1,279.88 stays with Kumar Traders as an advance']);
    ok('…W2\'s words name the figures', w2.body.warnings[0].words === '₹5,000 is more than the ₹3,720.12 open — ₹1,279.88 would stay with Kumar Traders as an advance.', w2.body.warnings[0].words);
    const none = await q('POST', '/payments/preview', { party_id: SUPP, direction: 'out', amount_minor: 500000, currency: 'INR', allocate: 'none' });
    ok('allocate: "none" (keep as advance, on purpose) → W2 is not raised', none.status === 200 && codes(none).length === 0, JSON.stringify(none.body.warnings));
    const part = await q('POST', '/payments/preview', { party_id: SUPP, direction: 'out', amount_minor: 200000, currency: 'INR' });
    eq('₹2,000 → two bills whole, the third in part, the fourth untouched; no warning', [codes(part), part.body.proposal.map((p) => p.apply_minor), part.body.on_account_minor, part.body.words],
      [[], [112000, 56000, 32000, 0], 0, '₹2,000 settles 3 bills']);

    /* record ₹2,000 the one-call way, then ask again at once */
    const rec = await q('POST', '/payments', Object.assign({}, PAY, { amount_minor: 200000, allocate: 'oldest_first', client_ref: 'open-1' }));
    first = rec.body;
    ok('record ₹2,000 oldest-first → 200, posted, 3 bills settled in the same call', rec.status === 200 && rec.body.posted && rec.body.posted.ok && rec.body.allocation && rec.body.allocation.settled.length === 3
      && rec.body.allocation.allocated_minor === 200000, JSON.stringify(rec.body));
    stamp(X, NOW());
    const w34 = await q('POST', '/payments/preview', { party_id: SUPP, direction: 'out', amount_minor: 200000, currency: 'INR' });
    const w3 = (w34.body.warnings || []).find((w) => w.code === 'same_again'), w4 = (w34.body.warnings || []).find((w) => w.code === 'just_settled');
    ok('the same ₹2,000 again within 24 h → W3 same_again names the entry', !!w3 && w3.entry_no === first.posted.entry_no && w3.words === 'The same ₹2,000 was paid to Kumar Traders today (' + first.posted.entry_no + ').', JSON.stringify(w34.body.warnings));
    ok('…and W4 just_settled names the bills now at 0 and the entry that settled them', !!w4 && w4.entry_no === first.posted.entry_no && w4.words === 'The last 2 bills (KT-0007, KT-0008) were settled by ' + first.posted.entry_no + ' today.', JSON.stringify(w4));
    ok('…W1 and W2 stay silent: ₹1,720.12 is still open and ₹2,000 > that is W2', codes(w34).join() === 'excess,just_settled,same_again', codes(w34).join());
    const diff = await q('POST', '/payments/preview', { party_id: SUPP, direction: 'out', amount_minor: 100000, currency: 'INR' });
    ok('a different amount → no W3 (W4 still: the bills were just settled)', codes(diff).join() === 'just_settled', codes(diff).join());
    stamp(X, AGO_2D());
    const old = await q('POST', '/payments/preview', { party_id: SUPP, direction: 'out', amount_minor: 200000, currency: 'INR' });
    ok('PAY D5: the same rows two days old → neither W3 nor W4 (a 24-hour window, as written)', codes(old).join() === 'excess', codes(old).join());
  });

  /* ═══ 2 · acknowledge ═══ */
  await section('2 · POST /payments — a warning not acknowledged is a 409 in words; acknowledged, it records and says what happened', async () => {
    const c0 = counts(X);
    const no = await q('POST', '/payments', Object.assign({}, PAY, { amount_minor: 500000, allocate: 'oldest_first', client_ref: 'open-2' }));
    ok('₹5,000 with ₹1,720.12 open, no acknowledge → 409 ALREADY_PAID', no.status === 409 && no.body.code === 'ALREADY_PAID' && no.body.error === 'Already paid?' && codes(no).join() === 'excess', JSON.stringify(no.body));
    eq('…the message is the whole sentence a shopkeeper reads (no error.message)', no.body.message,
      'Already paid? ₹5,000 is more than the ₹1,720.12 open — ₹3,279.88 would stay with Kumar Traders as an advance. Pay ₹5,000 again as an advance?');
    eq('…and nothing was written: no payment, no entry, no item, no number taken', counts(X), c0);
    const wrong = await q('POST', '/payments', Object.assign({}, PAY, { amount_minor: 500000, allocate: 'oldest_first', client_ref: 'open-2', acknowledge: ['nothing_owed'] }));
    ok('acknowledging a different code is not acknowledging this one → still 409', wrong.status === 409 && JSON.stringify(counts(X)) === JSON.stringify(c0), wrong.status);
    const yes = await q('POST', '/payments', Object.assign({}, PAY, { amount_minor: 500000, allocate: 'oldest_first', client_ref: 'open-2', acknowledge: ['excess'] }));
    ok('acknowledge: ["excess"] → 200, posted, the two open bills settled, the rest on account', yes.status === 200 && yes.body.posted && yes.body.posted.ok && yes.body.allocation.settled.length === 2, JSON.stringify(yes.body));
    eq('outcome.words — the exact sentence', yes.body.outcome && yes.body.outcome.words,
      'Paid ₹5,000 cash to Kumar Traders. Settled 2 bills (₹1,720.12). ₹3,279.88 left with Kumar Traders as an advance — they owe you this.');
    eq('outcome: the bills by number, the figures, the balance in words (never a minus)',
      [yes.body.outcome.settled.map((s) => [s.bill_no, s.amount_minor]), yes.body.outcome.applied_minor, yes.body.outcome.on_account_minor, yes.body.outcome.balance_minor, yes.body.outcome.balance_words],
      [[['KT-0010', 73000], ['KT-0011', 99012]], 172012, 327988, 327988, 'they owe you ₹3,279.88']);
    ok('…the entry number follows the first payment\'s with no gap', yes.body.posted.entry_no.slice(0, -6) === first.posted.entry_no.slice(0, -6) && Number(yes.body.posted.entry_no.slice(-6)) === Number(first.posted.entry_no.slice(-6)) + 1, yes.body.posted.entry_no + ' after ' + first.posted.entry_no);
    const chq = await q('POST', '/payments', Object.assign({}, PAY, { amount_minor: 10000, mode: 'cheque', cheque: { number: '000777' }, allocations: [{ against_ref: BILL('a'), amount_minor: 10000 }], acknowledge: ['nothing_owed'], client_ref: 'chq-1' }));
    ok('a cheque with a bills list → refused in words (it settles bills when it clears); nothing recorded', chq.status === 422 && /cheque settles bills when it clears/.test(chq.body.error) && !X.T.payments.some((p) => p.client_ref === 'chq-1'), JSON.stringify(chq.body));
    const chq2 = await q('POST', '/payments', Object.assign({}, PAY, { amount_minor: 10000, mode: 'cheque', cheque: { number: '000777' }, allocate: 'oldest_first', acknowledge: ['nothing_owed'], client_ref: 'chq-2' }));
    ok('a cheque oldest-first → held, and the outcome SAYS the bills wait for clearing (no silent drop)', chq2.status === 200 && chq2.body.payment.status === 'cheque_received' && chq2.body.allocation === null
      && chq2.body.outcome.words === 'Paid ₹100 by cheque to Kumar Traders. Held until it clears — the bills are chosen then.', JSON.stringify(chq2.body));
  });

  /* ═══ 3 · one transaction ═══ */
  await section('3 · ONE TRANSACTION — a refused allocation takes the payment and its entry back with it', async () => {
    const c0 = counts(X);
    const r = await q('POST', '/payments', Object.assign({}, PAY, { amount_minor: 100000, allocations: [{ against_ref: BILL('a'), amount_minor: 100000 }], acknowledge: ['nothing_owed', 'excess'], client_ref: 'open-3' }));
    ok('allocating ₹1,000 to a bill that owes nothing → 422 in words (confirmItems refused)', r.status === 422 && typeof r.body.error === 'string' && /owes|bill/.test(r.body.error), JSON.stringify(r.body));
    eq('…and NO books_payment row, NO entry, NO item remains — and no voucher number was taken', counts(X), c0);
    ok('…the client_ref is free again: nothing answers "duplicate" for it', !(await X.store.paymentByRef(X.db, SHOP, 'open-3')));
    /* the shape that makes it so: one handle from the route, and recordPayment settles on that same handle */
    const bsrc = fs.readFileSync(path.join(H.API, 'lib', 'books.js'), 'utf8');
    const recP = bsrc.slice(bsrc.indexOf('async function recordPayment('), bsrc.indexOf('/** the payment\'s journal event'));
    ok('recordPayment settles the bills on the handle it was given (settleBills(h, …)); it opens no transaction of its own', /settleBills\(h, entity, row, pay\.payment_id\)/.test(recP) && !/withEntity/.test(recP));
    const rsrc = fs.readFileSync(path.join(H.API, 'routes', 'books.js'), 'utf8');
    const route = rsrc.slice(rsrc.indexOf("router.post('/payments', "), rsrc.indexOf("router.post('/payments/:id/propose'"));
    const tx = route.slice(route.indexOf('await withEntity(e, async (h) => {'), route.indexOf('return rec;'));
    ok('the route records (warn: the duplicate rule, asked inside recordPayment AFTER its gates) and reads the outcome inside ONE withEntity',
      /B\.recordPayment\(h, e,[\s\S]*?warn: \{ acknowledge: ack/.test(tx) && /B\.paymentOutcome\(h, e,/.test(tx) && !/withEntity/.test(tx.slice(10))
      && recP.indexOf('S.partyOn(h, entity') < recP.indexOf('duplicateWarnings(h, entity') && recP.indexOf('duplicateWarnings(h, entity') < recP.indexOf('S.insertPayment(h, entity'));
    ok('proposeFor is ONE function: preview, record (oldest_first) and /propose all call it; the old proposal body is gone from the route',
      (rsrc.match(/B\.proposeFor\(h, e,/g) || []).length === 2 && !/R\.proposeItems|R\.propose\(/.test(rsrc) && (bsrc.match(/async function proposeFor\(/g) || []).length === 1
      && /proposeFor\(h, entity,/.test(recP) && /proposeFor\(h, entity,/.test(bsrc.slice(bsrc.indexOf('async function settleBills('), bsrc.indexOf('async function firstPayment('))) && (bsrc.match(/R\.propose(Items)?\(/g) || []).length === 2);
  });

  /* ═══ 4 · client_ref ═══ */
  await section('4 · the same client_ref twice → one payment; the replay is answered before the duplicate rule looks', async () => {
    await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-09-20', currency: 'INR', party: MALA, source_chit_id: BILL('e'), source_ref: 'chit:e',
      by_rate: [{ rate: 5, taxable: 1000, cgst: 25, sgst: 25, igst: 0 }], paid: {}, round_off: 0 });
    X.T.chits.push({ chit_id: BILL('e'), bill_no: 'C1-0042', entity_id: SHOP, purpose: 'order', business_json: { bill_no: 'C1-0042' } });
    const c0 = counts(X);
    const body = { party_id: MALA, direction: 'in', amount_minor: 60000, currency: 'INR', mode: 'upi', received_at: '2026-10-05', client_ref: 'tap-9', allocate: 'oldest_first' };
    const p1 = await q('POST', '/payments', body);
    stamp(X, NOW());
    const p2 = await q('POST', '/payments', body);
    ok('first tap: recorded and allocated; second tap: 200, the SAME payment and entry, duplicate: true', p1.status === 200 && p1.body.payment.duplicate === false && p1.body.allocation.settled.length === 1
      && p2.status === 200 && p2.body.payment.duplicate === true && p2.body.payment.payment_id === p1.body.payment.payment_id && p2.body.posted.entry_no === p1.body.posted.entry_no, JSON.stringify([p1.body, p2.body]));
    eq('…one payment, one entry, one allocation pair (+ the payment\'s own row) — never twice', [counts(X).payments - c0.payments, counts(X).entries - c0.entries, X.T.items.filter((i) => i.ref === 'pay:' + p1.body.payment.payment_id).length], [1, 1, 3]);
    ok('…the replay was not judged by the rule: the same ₹600 within 24 h would be W3, yet no 409 and no acknowledge was needed', p2.status === 200);
    eq('the receive side reads in its own words', p1.body.outcome.words, 'Received ₹600 by UPI from Mala. Settled 1 bill (₹600).');
    eq('…balance: Mala still owes the rest of the bill', [p1.body.outcome.balance_minor, p1.body.outcome.balance_words], [45000, 'they owe you ₹450']);
    const p3 = await q('POST', '/payments', Object.assign({}, body, { amount_minor: 60000, client_ref: 'tap-10' }));
    const w3b = (p3.body.warnings || []).find((w) => w.code === 'same_again');
    ok('a NEW ref for the same ₹600 within the hour → 409: W3 same_again naming ' + p1.body.posted.entry_no + ' (and W2: only ₹450 is open now)', p3.status === 409 && codes(p3).join() === 'excess,same_again' && w3b && w3b.entry_no === p1.body.posted.entry_no, JSON.stringify(p3.body));
  });

  /* ═══ 5 · drift D1: POST /chits/:id/payment is a DOOR into recordPayment (Athi, 2026-10-08: "Q4 redirect in M26") ═══ */
  await section('5 · "Mark paid" on a chit records through the ONE path — one payment, one entry, the chit\'s bill allocated; a replay posts nothing', async () => {
    const K = require(path.join(H.API, 'lib', 'books-hooks'));
    const TCp = require(path.join(H.API, 'lib', 'tax-copy')); const wasEntryFor = TCp.entryFor;
    /* the chit's parties, as tax-copy names them for an order the shop received (the shop sells; Mala sent it) */
    TCp.entryFor = async () => ({ sells: true, buyer: { entity_id: MALA }, seller: { entity_id: SHOP }, me: { entity_id: SHOP } });
    const door = (copy, o) => X.dbStub.withEntity(SHOP, (db) => K.chitPaid(db, SHOP, copy, Object.assign({ by: SHOP, acknowledge: [], name: 'Mala' }, o || {})));
    const AT = '2026-10-05T06:00:00Z';
    const chitOf = (n, pay, more) => Object.assign({ chit_id: BILL(n), purpose: 'order', sender_entity_id: MALA, created_at: AT, currency_code: 'INR', summary_json: { total_value: 1180 },
      business_json: { payment: Object.assign({ method: 'upi', ref: 'UPI-TXN-' + n, amount: null, note: null, at: AT, by: SHOP }, pay || {}) } }, more || {});
    try {
      stamp(X, AGO_2D());
      /* the bill the chit IS, posted by the hook earlier: ₹1,180 open from Mala */
      await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-09-25', currency: 'INR', party: MALA, source_chit_id: BILL('f'), source_ref: 'chit:f',
        by_rate: [{ rate: 18, taxable: 1000, cgst: 90, sgst: 90, igst: 0 }], paid: {}, round_off: 0 });
      X.T.chits.push({ chit_id: BILL('f'), bill_no: 'C1-0050', entity_id: SHOP, purpose: 'order', business_json: { bill_no: 'C1-0050' } });
      const c0 = counts(X);
      const r1 = await door(chitOf('f'));
      ok('the door records: one payment row, one entry (payment_received), the chit itself allocated in full — through recordPayment, not a mark',
        r1.payment && r1.payment.duplicate === false && r1.posted && r1.posted.ok === true && r1.allocation && JSON.stringify(r1.allocation.settled) === JSON.stringify([{ against_ref: BILL('f'), amount_minor: 118000 }])
        && counts(X).payments - c0.payments === 1 && counts(X).entries - c0.entries === 1, JSON.stringify(r1));
      const row = X.T.payments.find((p) => p.payment_id === r1.payment.payment_id);
      eq('…the payment row is the chit\'s: client_ref chitpay:<chit_id>, the quoted total (no amount typed) in minor units, UPI, money IN, the chit\'s day',
        [row.client_ref, row.amount_minor, row.mode, row.direction, row.party_id, row.received_at, row.reference], ['chitpay:' + BILL('f'), 118000, 'upi', 'in', MALA, '2026-10-05', 'UPI-TXN-f']);
      eq('…the outcome in words: settled, nothing left over', [r1.outcome.words, r1.outcome.on_account_minor], ['Received ₹1,180 by UPI from Mala. Settled 1 bill (₹1,180).', 0]);
      const c1 = counts(X);
      const r2 = await door(chitOf('f'));
      ok('the same chit marked paid again (a replay, a double tap) → the FIRST payment, duplicate: true; nothing posted twice; the rule never asked (same amount within the hour would be W3)',
        r2.payment && r2.payment.duplicate === true && r2.payment.payment_id === r1.payment.payment_id && r2.posted && r2.posted.entry_no === r1.posted.entry_no
        && counts(X).payments === c1.payments && counts(X).entries === c1.entries && counts(X).items === c1.items, JSON.stringify(r2));

      /* an order the books do not hold yet (no bill posted): on account — W1 stays silent because nothing is being allocated */
      X.T.chits.push({ chit_id: BILL('g'), bill_no: null, entity_id: SHOP, purpose: 'order', business_json: {} });
      stamp(X, AGO_2D());
      const r3 = await door(chitOf('g', { amount: 500 }));
      ok('an order not yet in the books → recorded as an advance from Mala (allocation null, no W1 — the chit is the allocation only when its bill is open)',
        r3.payment && r3.payment.duplicate === false && r3.allocation === null && r3.outcome.on_account_minor === 50000 && /kept as an advance from Mala/.test(r3.outcome.words), JSON.stringify(r3));

      /* the duplicate rule at the door: a different chit, the same ₹500 within the hour → ALREADY_PAID (W3), nothing written; acknowledged → recorded */
      X.T.chits.push({ chit_id: BILL('h'), bill_no: null, entity_id: SHOP, purpose: 'order', business_json: {} });
      stamp(X, NOW());
      const c3 = counts(X);
      let thrown = null;
      try { await door(chitOf('h', { amount: 500 })); } catch (e) { thrown = e; }
      ok('W3 same_again at the door: 409 ALREADY_PAID in words naming ' + (r3.posted && r3.posted.entry_no) + '; the transaction wrote nothing',
        thrown && thrown.code === 'ALREADY_PAID' && thrown.status === 409 && (thrown.warnings || []).some((w) => w.code === 'same_again' && w.entry_no === r3.posted.entry_no)
        && counts(X).payments === c3.payments && counts(X).entries === c3.entries, thrown && (thrown.message + ' ' + JSON.stringify(thrown.warnings)));
      const r4 = await door(chitOf('h', { amount: 500 }), { acknowledge: ['same_again', 'just_settled'] });
      ok('…acknowledged (the web\'s "Pay as advance") → recorded', r4.payment && r4.payment.duplicate === false && counts(X).payments - c3.payments === 1, JSON.stringify(r4));

      /* what the door cannot post says so — never a silent mark */
      const c4 = counts(X);
      const q1 = await door(chitOf('i', { method: 'other' }));
      const q2 = await door(chitOf('j', { amount: 0 }, { summary_json: {} }));
      TCp.entryFor = async () => ({ sells: true, buyer: {}, me: { entity_id: SHOP } });
      const q3 = await door(chitOf('k'));
      ok('"other" has no ledger · no amount and no quoted total · a payer the shop does not know → { queued, why } in words, nothing written (the route parks it, named)',
        q1.queued === true && /no ledger yet/.test(q1.why) && q2.queued === true && /no amount/.test(q2.why) && q3.queued === true && /nobody the shop knows/.test(q3.why)
        && counts(X).payments === c4.payments && counts(X).entries === c4.entries, JSON.stringify([q1, q2, q3]));
      const off = await X.dbStub.withEntity(SUPP, (db) => K.chitPaid(db, SUPP, chitOf('f'), { by: SUPP }));
      eq('a shop with no ledger → { off: true } (the copy still says paid, as the counter\'s money chit does; nothing to post into)', off, { off: true });
    } finally { TCp.entryFor = wasEntryFor; }

    /* the shape that makes it so: the chit route reads the copy, calls the door and marks the copy on ONE handle; no state_log row, no second "paid" */
    const csrc = fs.readFileSync(path.join(H.API, 'routes', 'chits.js'), 'utf8');
    const route = csrc.slice(csrc.indexOf("router.post('/:chit_id/payment'"), csrc.indexOf("router.delete('/:chit_id/payment'"));
    const tx = route.slice(route.indexOf('await withEntity(entity_id, async (db) => {'), route.indexOf('if (!out) return res.status(404)'));
    ok('POST /chits/:id/payment: taxCopy.copyOn(db…) → hooks.chitPaid(db…) → UPDATE chit_header … payment, inside ONE withEntity; the books first (a refusal marks nothing)',
      /taxCopy\.copyOn\(db, chit_id, entity_id\)/.test(tx) && /hooks\.chitPaid\(db, entity_id,/.test(tx) && tx.indexOf('hooks.chitPaid(') < tx.indexOf("jsonb_build_object('payment'")
      && !/withEntity/.test(tx.slice(10)) && !/state_log/.test(route) && /ALREADY_PAID/.test(route) && /hooks\.park\(entity_id/.test(route), tx.slice(0, 200));
    ok('the hook\'s own payment branch (the counter\'s money chit) and the door share recordChitPayment — one call site into recordPayment outside lib/books.js',
      (fs.readFileSync(path.join(H.API, 'lib', 'books-hooks.js'), 'utf8').match(/B\.recordPayment\(/g) || []).length === 1);
    /* ⭐ THE GUARD: nothing in routes/ or lib/ but lib/books.js writes "paid" — a line that pairs a SQL write with the literal 'paid', or a state_log 'paid' row */
    const offenders = [];
    for (const dir of ['routes', 'lib']) for (const f of fs.readdirSync(path.join(H.API, dir)).filter((x) => /\.js$/.test(x))) {
      if (dir === 'lib' && f === 'books.js') continue;
      fs.readFileSync(path.join(H.API, dir, f), 'utf8').split('\n').forEach((line, i) => {
        if (/(INSERT|UPDATE)[\s\S]*'paid'|'paid'[\s\S]*(INSERT|UPDATE)|state_log[\s\S]*'paid'/.test(line)) offenders.push(dir + '/' + f + ':' + (i + 1));
      });
    }
    eq('no code path outside lib/books.js writes "paid" (routes/*.js, lib/*.js)', offenders, []);
  });

  /* ═══ 6 · spec test 5 (M29): reverse from the row — the statement line names its entry; the reversal mirrors, never edits; the bills reopen in the SAME transaction ═══ */
  await section('6 · M29 reverse from the row: statement lines carry entry ids + advice state; POST /entries/:id/reverse reopens exactly the bills it had settled', async () => {
    const SUPP2 = '44444444-4444-4444-8444-444444444444';
    X.T.parties.push({ owner: SHOP, party_id: SUPP2, party_no: 'P-00003', name: 'Velan Steels', supplier: true, credit_days: 30 });
    for (const [n, date, rate, no] of [['m', '2026-09-02', { rate: 12, taxable: 1000, cgst: 60, sgst: 60, igst: 0 }, 'VS-0020'], ['n', '2026-09-06', { rate: 5, taxable: 500, cgst: 12.5, sgst: 12.5, igst: 0 }, 'VS-0021']]) {
      await X.B.postEntry(X.db, SHOP, { type: 'purchase_bill', date, currency: 'INR', party: SUPP2, source_chit_id: BILL(n), source_ref: 'chit:' + n, by_rate: [rate], paid: {}, round_off: 0 });
      X.T.chits.push({ chit_id: BILL(n), bill_no: no, entity_id: SHOP, purpose: 'order', business_json: { bill_no: no } });
    }
    stamp(X, AGO_2D());
    const rec = await q('POST', '/payments', { party_id: SUPP2, direction: 'out', currency: 'INR', mode: 'cash', received_at: '2026-10-06', amount_minor: 150000, allocate: 'oldest_first', client_ref: 'vs-1' });
    ok('₹1,500 oldest first settles VS-0020 whole and part of VS-0021', rec.status === 200 && rec.body.allocation.settled.length === 2 && rec.body.outcome.on_account_minor === 0, JSON.stringify(rec.body));
    const payNo = rec.body.posted.entry_no, payId = rec.body.payment.payment_id, entryId = rec.body.posted.entry_id;
    /* the statement: the payment line names its entry and its payment, says it is not reversed, carries the advice state */
    const st0 = await q('GET', '/party/' + SUPP2 + '/statement?from=2026-04-01&to=2027-03-31');
    const pl0 = (st0.body.lines || []).find((l) => l.entry_no === payNo);
    ok('each line carries entry_id · entry_no · event_type; the payment line its payment_id and unapplied_minor 0', !!pl0 && pl0.entry_id === entryId && pl0.event_type === 'payment_made' && pl0.payment_id === payId && pl0.unapplied_minor === 0
      && st0.body.lines.every((l) => l.entry_id && l.entry_no && l.event_type), JSON.stringify(st0.body.lines));
    eq('…not reversed yet: reversed_by / reversed_why null; the advice state is the shape PR 6 fills (none until the columns land)', [pl0 && pl0.reversed_by, pl0 && pl0.reversed_why, pl0 && pl0.advice], [null, null, { chit_id: null, state: 'none', shared_at: null }]);
    ok('…a bill line is no payment: payment_id, unapplied_minor and advice are null', st0.body.lines.filter((l) => l.event_type === 'purchase_bill').every((l) => l.payment_id === null && l.unapplied_minor === null && l.advice === null));
    const before = JSON.stringify(await X.store.entry(X.db, SHOP, entryId));
    /* ⭐ ONE TRANSACTION: the party rows fail → no mirror entry, no number taken, the bills stay settled */
    const c0 = counts(X), wasInsert = X.store.insertItems;
    X.store.insertItems = async () => { throw new Error('disk full'); };
    const broken = await q('POST', '/entries/' + entryId + '/reverse', { reason: 'Paid twice' });
    X.store.insertItems = wasInsert;
    ok('the reversal and the reopening commit together or not at all: a failed item write leaves NO mirror entry, NO number taken', broken.status >= 500 && JSON.stringify(counts(X)) === JSON.stringify(c0), broken.status + ' ' + JSON.stringify(counts(X)) + ' vs ' + JSON.stringify(c0));
    const no = await q('POST', '/entries/' + entryId + '/reverse', {});
    ok('no reason → 422 "A reversal needs a reason."', no.status === 422 && no.body.error === 'A reversal needs a reason.', JSON.stringify(no.body));
    /* the trips the route makes, counted on the store (the harness has no X-DB-Trips: the in-memory store answers no SQL) */
    const trips = []; const wrapped = {};
    Object.keys(X.store).forEach((k) => { if (typeof X.store[k] === 'function') { wrapped[k] = X.store[k]; X.store[k] = function () { trips.push(k); return wrapped[k].apply(this, arguments); }; } });
    const rev = await q('POST', '/entries/' + entryId + '/reverse', { reason: 'Paid twice' });
    Object.keys(wrapped).forEach((k) => { X.store[k] = wrapped[k]; });
    ok('200: the mirror entry, naming what it reverses and the bills it reopened by number', rev.status === 200 && rev.body.ok === true && rev.body.reverses === payNo && rev.body.reverses_entry_id === entryId && /^MJ\//.test(rev.body.entry_no)
      && JSON.stringify(rev.body.reopened) === JSON.stringify([{ against_ref: BILL('m'), bill_no: 'VS-0020' }, { against_ref: BILL('n'), bill_no: 'VS-0021' }]), JSON.stringify(rev.body));
    eq('…the words a screen paints', rev.body.words, 'Reversed ' + payNo + ' — ₹1,500 — by ' + rev.body.entry_no + '. Reopened 2 bills (VS-0020, VS-0021).');
    console.log('          store calls for POST /entries/:id/reverse: ' + trips.length + ' (' + trips.join(' ') + ')');
    ok('the reverse route runs in ONE withEntity (one transaction) and never a per-row read: ≤ 14 store calls for a 2-bill payment', trips.length <= 14 && trips.filter((k) => k === 'items').length <= 1, trips.length + ': ' + trips.join(' '));
    /* ⭐ never edited, only mirrored */
    ok('the original entry is byte-for-byte what it was', JSON.stringify(await X.store.entry(X.db, SHOP, entryId)) === before);
    const mirror = await X.store.entry(X.db, SHOP, rev.body.entry_id), orig = JSON.parse(before);
    ok('the mirror points at it and swaps every line (Dr ↔ Cr), same accounts, same party', mirror.reverses_entry_id === entryId && mirror.lines.length === orig.lines.length
      && mirror.lines.every((l, i) => l.account_id === orig.lines[i].account_id && l.party_id === orig.lines[i].party_id && Number(l.dr_minor) === Number(orig.lines[i].cr_minor) && Number(l.cr_minor) === Number(orig.lines[i].dr_minor)), JSON.stringify(mirror.lines));
    /* ⭐ exactly the allocations it closed, reopened: outstanding back to the bill amounts; nothing of the payment left on account */
    const o = X.E.receivables().outstanding(await X.B.partyItems(X.db, SHOP, SUPP2, null));
    eq('VS-0020 and VS-0021 owe their full amounts again; the payment nets to nothing', [o.by_ref[BILL('m')].outstanding_minor, o.by_ref[BILL('n')].outstanding_minor, o.by_ref['pay:' + payId].outstanding_minor], [112000, 52500, 0]);
    ok('every reversal row names the row it reverses and hangs on the mirror entry', X.T.items.filter((i) => i.ref === 'pay:' + payId && i.ref_kind === 'reversal').every((i) => i.reverses != null && i.entry_id === rev.body.entry_id) && X.T.items.filter((i) => i.ref === 'pay:' + payId && i.ref_kind === 'reversal').length === 5);
    /* the statement line now says so */
    const st1 = await q('GET', '/party/' + SUPP2 + '/statement?from=2026-04-01&to=2027-03-31');
    const pl1 = st1.body.lines.find((l) => l.entry_no === payNo), ml = st1.body.lines.find((l) => l.entry_no === rev.body.entry_no);
    eq('the payment line: reversed_by names the mirror, reversed_why the reason; the mirror line names what it reverses; the payment has nothing unapplied', [pl1.reversed_by, pl1.reversed_why, ml.reverses_entry_id, ml.event_type, pl1.unapplied_minor], [rev.body.entry_no, 'Paid twice', entryId, 'reversal', 0]);
    ok('the statement is one read per table: lines (with their reversal in the same query), sources, items once — never a query per row', (() => { const t = []; const w = {}; Object.keys(X.store).forEach((k) => { if (typeof X.store[k] === 'function') { w[k] = X.store[k]; X.store[k] = function () { t.push(k); return w[k].apply(this, arguments); }; } });
      return q('GET', '/party/' + SUPP2 + '/statement?from=2026-04-01&to=2027-03-31').then(() => { Object.keys(w).forEach((k) => { X.store[k] = w[k]; }); console.log('          store calls for GET /party/:id/statement: ' + t.length + ' (' + t.join(' ') + ')'); return t.filter((k) => k === 'items').length === 1 && t.filter((k) => k === 'ledgerLines').length <= 2 && t.length <= 12; }); })());
    const again = await q('POST', '/entries/' + entryId + '/reverse', { reason: 'Paid twice' });
    ok('a second Reverse → 409 ALREADY_REVERSED naming ' + rev.body.entry_no + '; nothing written', again.status === 409 && again.body.code === 'ALREADY_REVERSED' && again.body.message === 'This entry was already reversed by ' + rev.body.entry_no + '.'
      && X.T.entries.filter((h) => h.reverses_entry_id === entryId).length === 1, JSON.stringify(again.body));
    const twice = await q('POST', '/entries/' + rev.body.entry_id + '/reverse', { reason: 'oops' });
    ok('reversing the mirror itself is refused in words', twice.status === 422 && /itself a reversal/.test(twice.body.error), JSON.stringify(twice.body));
  });

  /* ═══ 7 · M30 advice OUT ═══ */
  await section('7 · M30 advice OUT: on_rail, the ready body + may, PATCH first-wins, the statement state, To-do advices_to_send, the refusals, b285 not run', async () => {
    const TT = '66666666-6666-4666-8666-666666666666', CH1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', CH2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    X.T.parties.push({ owner: SHOP, party_id: TT, party_no: 'P-00009', name: 'Tally Test', supplier: true, credit_days: 30, on_rail: true });
    X.T.identities.push({ identity_id: SHOP, display_name: 'Chola Auto Care' });
    require(path.join(H.API, 'lib', 'books-recurring')).use(require('./support/books-recurring-memory.cjs').memoryTemplates().store);   /* /todo reads the repeating entries too */
    for (const [n, date, rate, no] of [['t', '2026-09-20', { rate: 12, taxable: 1000, cgst: 60, sgst: 60, igst: 0 }, 'TT-0001'], ['u', '2026-09-22', { rate: 12, taxable: 500, cgst: 30, sgst: 30, igst: 0 }, 'TT-0002']]) {
      await X.B.postEntry(X.db, SHOP, { type: 'purchase_bill', date, currency: 'INR', party: TT, source_chit_id: BILL(n), source_ref: 'chit:' + n, by_rate: [rate], paid: {}, round_off: 0 });
      X.T.chits.push({ chit_id: BILL(n), bill_no: no, entity_id: SHOP, purpose: 'order', business_json: { bill_no: no } });
    }
    stamp(X, AGO_2D());
    const ACK = ['nothing_owed', 'excess', 'same_again', 'just_settled'];
    /* ── on_rail on the preview ── */
    const pv = await q('POST', '/payments/preview', { party_id: TT, direction: 'out', amount_minor: 200000, currency: 'INR', allocate: 'oldest_first' });
    const pv2 = await q('POST', '/payments/preview', { party_id: SUPP, direction: 'out', amount_minor: 100, currency: 'INR' });
    eq('preview: party.on_rail — Tally Test can receive a chit, Kumar Traders (no handle) cannot', [pv.body.party.on_rail, pv2.body.party.on_rail], [true, false]);
    /* ── the record answer carries the advice ── */
    const rec = await q('POST', '/payments', { party_id: TT, direction: 'out', amount_minor: 200000, currency: 'INR', mode: 'cash', received_at: '2026-10-05', allocate: 'oldest_first', client_ref: 'adv-1', acknowledge: ACK });
    const payId = rec.body.payment && rec.body.payment.payment_id, A = rec.body.advice;
    ok('record ₹2,000 to Tally Test → 200 with an advice block', rec.status === 200 && A && A.payment_id === payId, JSON.stringify(rec.body).slice(0, 400));
    eq('…may: the owner may SEND (on rail); Share is for a party off the rail — refused with its sentence', [A.may.send_advice, A.may.share_advice],
      [{ ok: true }, { ok: false, why: 'on_rail', say: 'Tally Test is on ChitBridge — send the advice instead.' }]);
    eq('…the words a person reads (and the payee\'s To-do will show)', A.words, 'Chola Auto Care paid you ₹2,000 cash on 5 Oct 2026 for bills TT-0001, TT-0002 (₹1,680) · ₹320 as an advance.');
    const bj = A.body && A.body.business_json, pa = bj && bj.payment_advice;
    eq('…the chit send body (§3.2): to the payee, purpose general, kind payment_advice, client_ref advice:pay:<id>', [A.body.recipients, A.body.purpose, bj.kind, A.body.client_ref, A.body.manual_subject],
      [[{ entity_id: TT, role: 'to' }], 'general', 'payment_advice', 'advice:pay:' + payId, 'Payment advice ' + rec.body.posted.entry_no]);
    eq('…payment_advice: action paid, the adviser\'s payment and entry, minor-unit integers as the source, major beside them, the day, nothing of M31/M32 yet',
      [pa.action, pa.adviser_payment_id, pa.adviser_entry_no, pa.amount_minor, pa.amount, pa.currency, pa.mode, pa.paid_on, pa.applied_minor, pa.on_account_minor, pa.on_account, pa.collected_by, pa.reverses_advice_chit_id, pa.words === A.words],
      ['paid', payId, rec.body.posted.entry_no, 200000, 2000, 'INR', 'cash', '2026-10-05', 168000, 32000, 320, null, null, true]);
    eq('…line_items = the bills settled, by the bill\'s own chit_id (the same id on both copies — what lets the payee settle the same bills)',
      A.body.line_items.map((l) => [l.ref_chit_id, l.bill_no, l.applied_minor, l.applied, l.currency]), [[BILL('t'), 'TT-0001', 112000, 1120, 'INR'], [BILL('u'), 'TT-0002', 56000, 560, 'INR']]);
    ok('…share is null on rail (never a chit to nowhere, never a copy-text for a party who can receive)', A.share === null && A.body !== null);
    eq('…advice state before any send: none, no chit', A.advice, { chit_id: null, state: 'none', shared_at: null });
    const rep = await q('POST', '/payments', { party_id: TT, direction: 'out', amount_minor: 200000, currency: 'INR', mode: 'cash', received_at: '2026-10-05', allocate: 'oldest_first', client_ref: 'adv-1', acknowledge: ACK });
    ok('a replay (same client_ref) carries no advice block — its row already answers', rep.body.payment.duplicate === true && rep.body.advice === null);
    /* ── the read ── */
    const trips = []; const wrapped = {};
    const wrap = () => { Object.keys(X.store).forEach((k) => { if (typeof X.store[k] === 'function') { wrapped[k] = X.store[k]; X.store[k] = function () { trips.push(k); return wrapped[k].apply(this, arguments); }; } }); };
    const unwrap = () => { Object.keys(wrapped).forEach((k) => { X.store[k] = wrapped[k]; }); trips.length = 0; };
    wrap(); const g0 = await q('GET', '/payments/' + payId + '/advice'); const t0 = trips.slice(); unwrap();
    console.log('          store calls for GET /payments/:id/advice: ' + t0.length + ' (' + t0.join(' ') + ')');
    ok('GET /payments/:id/advice answers the same block (party · may · words · body) in ONE withEntity, never a per-row read: ≤ 12 store calls, items once',
      g0.status === 200 && g0.body.party.on_rail === true && g0.body.words === A.words && JSON.stringify(g0.body.body) === JSON.stringify(A.body) && JSON.stringify(g0.body.may) === JSON.stringify(A.may)
      && t0.length <= 12 && t0.filter((k) => k === 'items').length <= 1, g0.status + ' ' + JSON.stringify(g0.body).slice(0, 300));
    ok('…an unknown payment is a 404 in words', (await q('GET', '/payments/' + CH2 + '/advice')).status === 404);
    /* ── To-do: the advice not yet sent (test 10) ── */
    const td0 = (await q('GET', '/todo')).body.find((x) => x.kind === 'advices_to_send');
    ok('To-do advices_to_send: 1 payment, named in words, the action is the PATCH, the item names the payment', td0 && td0.count === 1 && td0.words === '1 payment has no advice yet — Tally Test does not know you paid.'
      && td0.action.call === 'PATCH /api/books/payments/:id' && td0.items[0].payment_id === payId && td0.items[0].amount_minor === 200000, JSON.stringify(td0));
    /* ── PATCH (test 11) ── */
    const st0 = (await q('GET', '/party/' + TT + '/statement?from=2026-04-01&to=2027-03-31')).body.lines.find((l) => l.payment_id === payId);
    eq('the statement line before the send: advice none', st0.advice, { chit_id: null, state: 'none', shared_at: null });
    wrap(); const p1 = await q('PATCH', '/payments/' + payId, { advice_chit_id: CH1 }); const t1 = trips.slice(); unwrap();
    console.log('          store calls for PATCH /payments/:id: ' + t1.length + ' (' + t1.join(' ') + ')');
    eq('PATCH { advice_chit_id } → 200, state sent (my copy not readable yet), one transaction (≤ 12 store calls)', [p1.status, p1.body.ok, p1.body.advice, t1.length <= 12], [200, true, { chit_id: CH1, state: 'sent', shared_at: null }, true]);
    X.T.chits.push({ chit_id: CH1, entity_id: SHOP, purpose: 'general', status: 'delivered', business_json: { kind: 'payment_advice' } });
    const st1 = (await q('GET', '/party/' + TT + '/statement?from=2026-04-01&to=2027-03-31')).body.lines.find((l) => l.payment_id === payId);
    eq('…the statement line now: advice delivered (my sent copy stands at delivered), the chit named', st1.advice, { chit_id: CH1, state: 'delivered', shared_at: null });
    const g1 = await q('GET', '/payments/' + payId + '/advice');
    eq('…the read after the send: may.send_advice refused (already sent), no body', [g1.body.may.send_advice, g1.body.body, g1.body.advice.state], [{ ok: false, why: 'already_sent', say: 'An advice is already sent for this payment.' }, null, 'delivered']);
    ok('…To-do: advices_to_send is gone', !(await q('GET', '/todo')).body.some((x) => x.kind === 'advices_to_send'));
    const p2 = await q('PATCH', '/payments/' + payId, { advice_chit_id: CH1 });
    ok('the same advice_chit_id again → 200 (a retry, first-wins; nothing changes)', p2.status === 200 && p2.body.advice.chit_id === CH1, JSON.stringify(p2.body));
    const p3 = await q('PATCH', '/payments/' + payId, { advice_chit_id: CH2 });
    eq('a DIFFERENT advice_chit_id → 409 ADVICE_EXISTS in words; the row keeps the first', [p3.status, p3.body.code, p3.body.message, X.T.payments.find((p) => p.payment_id === payId).advice_chit_id],
      [409, 'ADVICE_EXISTS', 'An advice is already recorded for this payment.', CH1]);
    const p4 = await q('PATCH', '/payments/' + payId, {});
    /* ── M30-2 (Athi's black-box, 2026-10-09): the record step answered 500 on live — books_payment is insert-only (b273), b285 never opened the advice columns ── */
    { const real = X.store.setAdvice, elog = console.error, logged = [];
      X.store.setAdvice = async () => { const er = new Error('permission denied for table books_payment'); er.code = '42501'; throw er; };
      console.error = (...a) => { logged.push(a.join(' ')); };
      const pd = await q('PATCH', '/payments/' + payId, { advice_chit_id: CH1 });
      X.store.setAdvice = async () => { throw new Error('boom'); };
      const pb = await q('PATCH', '/payments/' + payId, { advice_chit_id: CH1 });
      console.error = elog; X.store.setAdvice = real;
      ok('an UPDATE the database refuses (insert-only, no grant) → 503 in words, logged, never a bare 500', pd.status === 503 && pd.body.code === 'BOOKS_NOT_MIGRATED' && /b295/.test(pd.body.message) && logged.some((l) => /refused by the database/.test(l)), JSON.stringify(pd.body));
      ok('any other failure → 500 with the text, and the error is LOGGED (it logged nothing before)', pb.status === 500 && /boom/.test(pb.body.message) && logged.some((l) => /boom/.test(l)), JSON.stringify(pb.body) + ' ' + logged.join('|')); }
    { const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'b295_books_payment_advice_update.sql'), 'utf8');
      ok('b295 opens ONLY the two advice columns (column-level GRANT), keeps DELETE and every other column insert-only', /GRANT UPDATE \(advice_chit_id, advice_shared_at\) ON books_payment TO cb_app/.test(sql) && /TG_OP = 'UPDATE'/.test(sql) && /to_jsonb\(NEW\) - 'advice_chit_id' - 'advice_shared_at'/.test(sql) && !/GRANT UPDATE ON/.test(sql)); }
    ok('an empty patch → 400 "Nothing to change"', p4.status === 400 && /Nothing to change/.test(p4.body.error), JSON.stringify(p4.body));
    ok('a patch of a field not named (note, amount) changes nothing', (await q('PATCH', '/payments/' + payId, { amount_minor: 1 })).status === 400 && X.T.payments.find((p) => p.payment_id === payId).amount_minor === 200000);
    X.T.disputes.push({ entity_id: SHOP, chit_id: CH1, status: 'open' });
    const st2 = (await q('GET', '/party/' + TT + '/statement?from=2026-04-01&to=2027-03-31')).body.lines.find((l) => l.payment_id === payId);
    ok('a dispute open on the advice → the line reads disputed (co-held; the payer never reads the payee\'s accept)', st2.advice.state === 'disputed', JSON.stringify(st2.advice));
    /* ── off rail: Share, never a chit ── */
    const off = await q('POST', '/payments', { party_id: SUPP, direction: 'out', amount_minor: 50000, currency: 'INR', mode: 'upi', reference: 'UPI-77', received_at: '2026-10-05', allocate: 'none', client_ref: 'adv-off', acknowledge: ACK });
    const O = off.body.advice, offId = off.body.payment.payment_id;
    eq('off rail (Kumar Traders): send refused with its sentence, share allowed; no chit body, the share texts carry the words', [O.may.send_advice, O.may.share_advice, O.body, O.words],
      [{ ok: false, why: 'off_rail', say: 'Kumar Traders is not on ChitBridge — share the advice instead.' }, { ok: true }, null, 'Chola Auto Care paid you ₹500 by UPI on 5 Oct 2026 · ₹500 as an advance. Ref UPI-77.']);
    ok('…share: text = the words; wa.me and mailto carry them encoded', O.share.text === O.words && O.share.wa === 'https://wa.me/?text=' + encodeURIComponent(O.words) && /^mailto:\?subject=.*&body=/.test(O.share.mailto) && O.share.mailto.indexOf(encodeURIComponent(O.words)) > 0, JSON.stringify(O.share));
    const o1 = await q('PATCH', '/payments/' + offId, { advice_chit_id: CH2 });
    eq('…PATCH advice_chit_id for an off-rail party → 409 OFF_RAIL (the server refuses what the read greyed)', [o1.status, o1.body.code, o1.body.why], [409, 'OFF_RAIL', 'off_rail']);
    const o2 = await q('PATCH', '/payments/' + offId, { advice_shared_at: true });
    ok('…PATCH { advice_shared_at: true } → 200, state shared, the moment stamped', o2.status === 200 && o2.body.advice.state === 'shared' && /^\d{4}-\d{2}-\d{2}T/.test(o2.body.advice.shared_at) && o2.body.advice.chit_id === null, JSON.stringify(o2.body));
    const sh = o2.body.advice.shared_at;
    const o3 = await q('PATCH', '/payments/' + offId, { advice_shared_at: '2027-01-01T00:00:00.000Z' });
    ok('…shared again keeps the FIRST moment', o3.status === 200 && o3.body.advice.shared_at === sh);
    ok('…the statement line reads shared', (await q('GET', '/party/' + SUPP + '/statement?from=2026-04-01&to=2027-03-31')).body.lines.find((l) => l.payment_id === offId).advice.state === 'shared');
    ok('…To-do never counted an off-rail payment', !(await q('GET', '/todo')).body.some((x) => x.kind === 'advices_to_send'));
    /* ── a reversed payment, a held cheque: nothing to advise ── */
    const r3 = await q('POST', '/payments', { party_id: TT, direction: 'out', amount_minor: 10000, currency: 'INR', mode: 'cash', received_at: '2026-10-06', allocate: 'none', client_ref: 'adv-rev', acknowledge: ACK });
    ok('a second payment to Tally Test → To-do counts it', (await q('GET', '/todo')).body.find((x) => x.kind === 'advices_to_send').count === 1);
    await q('POST', '/entries/' + r3.body.posted.entry_id + '/reverse', { reason: 'Paid by mistake' });
    const g3 = await q('GET', '/payments/' + r3.body.payment.payment_id + '/advice');
    eq('reversed → may refused "This payment was reversed." (send and share alike), no body; To-do drops it', [g3.body.may.send_advice.why, g3.body.may.send_advice.say, g3.body.may.share_advice.why, g3.body.body, (await q('GET', '/todo')).body.some((x) => x.kind === 'advices_to_send')],
      ['reversed', 'This payment was reversed.', 'reversed', null, false]);
    const r4 = await q('POST', '/payments', { party_id: TT, direction: 'out', amount_minor: 30000, currency: 'INR', mode: 'cheque', cheque: { number: '000123', bank: 'SBI' }, received_at: '2026-10-06', client_ref: 'adv-chq', acknowledge: ACK });
    eq('a held cheque → "A cheque is advised when it clears." — nothing to send until then; To-do does not count it', [r4.status, r4.body.advice.may.send_advice.why, r4.body.advice.may.send_advice.say, (await q('GET', '/todo')).body.some((x) => x.kind === 'advices_to_send')],
      [200, 'cheque_held', 'A cheque is advised when it clears.', false]);
    const c1 = await q('PATCH', '/payments/' + r4.body.payment.payment_id, { advice_chit_id: CH2 });
    ok('…and the PATCH refuses the same way (409 CHEQUE_HELD)', c1.status === 409 && c1.body.code === 'CHEQUE_HELD', JSON.stringify(c1.body));
    /* ── who may: a viewer reads, says nothing (the rail engine's ladder) ── */
    WHO = { identity_id: '55555555-5555-4555-8555-555555555555', identity_type: 'actor', parent_entity_id: SHOP, access_level: 'viewer', display_name: 'Auditor' };
    const gv = await q('GET', '/payments/' + payId + '/advice');
    const RAIL = require(path.join(H.API, 'lib', 'rail'));
    eq('a viewer: may.send_advice / share_advice refused read_only, in the rail engine\'s own sentence; the words still name the shop (not the person)', [gv.status, gv.body.may.send_advice, gv.body.may.share_advice.why, /^Chola Auto Care paid you/.test(gv.body.words)],
      [200, { ok: false, why: 'read_only', say: RAIL.say('read_only') }, 'read_only', true]);
    const pvw = await q('PATCH', '/payments/' + offId, { advice_shared_at: true });
    eq('…and the PATCH says 403 with the same word', [pvw.status, pvw.body.why, pvw.body.message], [403, 'read_only', RAIL.say('read_only')]);
    WHO = { identity_id: '55555555-5555-4555-8555-555555555555', identity_type: 'actor', parent_entity_id: SHOP, access_level: 'editor', display_name: 'Ramesh' };
    ok('an editor co-assist may (as record is allowed to a co-assist)', (await q('GET', '/payments/' + payId + '/advice')).body.may.send_advice.why === 'already_sent' && (await q('GET', '/payments/' + offId + '/advice')).body.may.share_advice.ok === true);
    WHO = OWNER;
    /* ── b285 not run yet: words, never a 500 ── */
    X.T.adviceReady = false;
    const na = await q('GET', '/payments/' + payId + '/advice');
    eq('before b285: the read answers state none and may.*.why not_available with its words (no 42703, no 500)', [na.status, na.body.advice, na.body.may.send_advice.why, na.body.may.send_advice.say, na.body.body],
      [200, { chit_id: null, state: 'none', shared_at: null }, 'not_available', 'Advice not available yet — the books need an update (b285).', null]);
    const nb = await q('PATCH', '/payments/' + payId, { advice_chit_id: CH1 });
    eq('…the PATCH answers 503 BOOKS_NOT_MIGRATED in the same words', [nb.status, nb.body.code, nb.body.message], [503, 'BOOKS_NOT_MIGRATED', 'Advice not available yet — the books need an update (b285).']);
    const ns = (await q('GET', '/party/' + TT + '/statement?from=2026-04-01&to=2027-03-31')).body.lines.filter((l) => l.payment_id);
    ok('…every statement payment line reads advice none (the shape is kept)', ns.length >= 2 && ns.every((l) => l.advice && l.advice.state === 'none' && l.advice.chit_id === null), JSON.stringify(ns.map((l) => l.advice)));
    const nr = await q('POST', '/payments', { party_id: TT, direction: 'out', amount_minor: 100, currency: 'INR', mode: 'cash', received_at: '2026-10-06', allocate: 'none', client_ref: 'adv-na', acknowledge: ACK });
    ok('…a payment still records; its advice block says not_available', nr.status === 200 && nr.body.advice && nr.body.advice.may.send_advice.why === 'not_available', JSON.stringify(nr.body.advice && nr.body.advice.may));
    ok('…and the To-do leaves the kind out rather than guess', !(await q('GET', '/todo')).body.some((x) => x.kind === 'advices_to_send'));
    X.T.adviceReady = true;
  });

  srv.close();
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();
