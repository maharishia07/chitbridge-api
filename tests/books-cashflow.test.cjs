/**
 * books-cashflow.test.cjs — CB FINANCE · CASH POSITION (F3): lib/books-cashflow.project() over fixture dues items + balances + held cheques + GST,
 * a SHORTFALL case and a NO-SHORTFALL case, then GET /cashflow and the cheques' pdc_reminders through the real router over the in-memory books.
 * Pure: every figure is checked to the minor unit. Needs the books engines (../chitbridge-engines/src). Run: node tests/books-cashflow.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111', SRI = '22222222-2222-4222-8222-222222222222', MALA = '33333333-3333-4333-8333-333333333333', KUMAR = '44444444-4444-4444-8444-444444444444';
const mk = (id, extra) => Object.assign({ identity_id: id, identity_type: 'entity', display_name: 'Shop' }, extra || {});
let WHO = null;
const authFor = (who) => Object.assign((req, res, next) => { req.identity = WHO || who; next(); }, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (req, res, next) => next() });
const call = (port, method, p, body) => new Promise((done) => {
  const b = body ? JSON.stringify(body) : '';
  const r = http.request({ host: '127.0.0.1', port, path: p, method: method || 'GET', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});

/* ── fixtures: the party items as CBReceivables writes them (bill +amount against itself; a payment −amount against itself) ── */
const bill = (ref, party, side, amount_minor, date, due) => ({ item_id: 'i-' + ref, party, side, ref_kind: 'bill', kind: 'sale', ref, against_ref: ref, amount_minor, currency: 'INR', date, due_date: due });
const names = new Map([[SRI, { name: 'Sri Traders', party_no: 'P-00001' }], [MALA, { name: 'Mala Stores', party_no: 'P-00002' }], [KUMAR, { name: 'Kumar Wholesale', party_no: 'P-00003' }]]);
const ASOF = '2026-10-12';

(async () => {
  console.log('\n══ CB FINANCE · CASH POSITION — lib/books-cashflow.project ══');
  if (!H.enginesSrc().dir) { console.log('\n   SKIP: ' + H.enginesSrc().why + '\n\n  ✓ 0 passed · 0 checks\n'); process.exit(1); }
  const X = H.load({ auth: authFor(mk(SHOP)) });
  const CF = require(path.join(H.API, 'lib', 'books-cashflow'));

  /* ── 1 · a SHORTFALL: ₹50,000 in hand; Mala pays ₹20,000 on the 14th; Kumar's ₹60,000 is due on the 15th; Sri's ₹30,000 is overdue with NO promise (not counted) ── */
  const base = {
    asOf: ASOF, days: 7, currency: 'INR',
    opening: [{ role: 'cash', code: '1400', name: 'Cash', balance_minor: 1000000 }, { role: 'bank', code: '1500', name: 'Bank', balance_minor: 4000000 }],
    receivable_items: [bill('SB-1', SRI, 'receivable', 3000000, '2026-09-01', '2026-09-30'), bill('SB-2', MALA, 'receivable', 2000000, '2026-10-04', '2026-10-14')],
    payable_items: [bill('PB-1', KUMAR, 'payable', 6000000, '2026-09-15', '2026-10-15')],
    cheques: [], promises: [], gst: { payable_minor: 500000, form: 'GSTR-3B', short: 'GST', due_date: '2026-11-20', why: null }, names,
  };
  const GST_OCT20 = { payable_minor: 500000, form: 'GSTR-3B', short: 'GST', due_date: '2026-10-20', why: null };   /* the words and the date are read()'s (returnDueFor): project() dates nothing itself */
  const r1 = CF.project(base);
  ok('opening = cash + bank, every row today first, 7 rows', r1.opening_minor === 5000000 && r1.series.length === 7 && r1.series[0].date === ASOF && r1.to === '2026-10-18', JSON.stringify([r1.opening_minor, r1.series.length, r1.to]));
  /* WALK2 W32: two named figures — the cash drawer and the bank/UPI side — that add up to the one opening */
  ok('W32: drawer ₹10,000 (role cash) · bank ₹40,000, summing to the opening', r1.drawer_minor === 1000000 && r1.bank_minor === 4000000 && r1.drawer_minor + r1.bank_minor === r1.opening_minor, JSON.stringify([r1.drawer_minor, r1.bank_minor]));
  const rU = CF.project(Object.assign({}, base, { opening: base.opening.concat([{ role: 'upi', code: '1510', name: 'UPI', balance_minor: 72000 }]) }));
  ok('W32: UPI counts on the bank side, never in the drawer', rU.drawer_minor === 1000000 && rU.bank_minor === 4072000, JSON.stringify([rU.drawer_minor, rU.bank_minor]));
  const d14 = r1.series.find((d) => d.date === '2026-10-14'), d15 = r1.series.find((d) => d.date === '2026-10-15');
  ok('Mala\'s ₹20,000 comes in on its due date; the balance there is ₹70,000', d14.in_minor === 2000000 && d14.balance_minor === 7000000, JSON.stringify(d14));
  ok('Kumar\'s ₹60,000 goes out on the 15th → ₹10,000 left — no shortfall yet', d15.out_minor === 6000000 && d15.balance_minor === 1000000 && !r1.shortfall, JSON.stringify([d15.balance_minor, r1.shortfall]));
  ok('Sri\'s overdue ₹30,000 with no promise is NOT counted — named in uncounted, in words', r1.uncounted.overdue_in_minor === 3000000 && r1.uncounted.overdue_parties === 1 && r1.in_minor === 2000000
    && r1.uncounted.words === '₹30,000 overdue from 1 party is not counted until it is promised or paid.', JSON.stringify(r1.uncounted));
  ok('GST due 20 Nov is beyond a 7-day horizon: known, not counted', r1.gst && r1.gst.payable_minor === 500000 && r1.gst.counted === false && !r1.series.some((d) => d.items.some((i) => i.kind === 'gst')), JSON.stringify(r1.gst));
  ok('no-shortfall words name the lowest day', r1.words === 'You stay above zero for the next 7 days. Lowest ₹10,000 on 15 Oct 2026.' && r1.lowest.date === '2026-10-15', r1.words);

  /* the same shop with a thinner bank: ₹12,400 short on the 15th, and the sentence names Kumar's bill */
  const r2 = CF.project(Object.assign({}, base, { opening: [{ role: 'cash', code: '1400', name: 'Cash', balance_minor: 760000 }, { role: 'bank', code: '1500', name: 'Bank', balance_minor: 2000000 }] }));
  ok('SHORTFALL: the FIRST day below zero is the 15th, ₹12,400 short', r2.shortfall && r2.shortfall.date === '2026-10-15' && r2.shortfall.short_minor === 1240000 && r2.shortfall.balance_minor === -1240000, JSON.stringify(r2.shortfall));
  ok('the shortfall sentence, in shopkeeper words, names the bill due that day', r2.words === 'On 15 Oct 2026 you will be ₹12,400 short — Kumar Wholesale’s ₹60,000 is due that day.' && r2.shortfall.driver.ref === 'PB-1', r2.words);
  ok('closing = opening + in − out', r2.closing_minor === 2760000 + 2000000 - 6000000 && r2.closing_minor === r2.series[6].balance_minor, String(r2.closing_minor));

  /* ── 2 · promises, cheques, GST within 30 days ── */
  const r3 = CF.project(Object.assign({}, base, { days: 30, gst: GST_OCT20,   /* a 30-day run from 12 Oct ends 10 Nov: the challan inside it is October's 20th */
    promises: [{ party_id: SRI, due_day: '2026-10-20' }],                                        /* Sri promised the 20th → counted that day */
    cheques: [{ payment_id: 'c1', party_id: MALA, direction: 'in', amount_minor: 1500000, cheque_no: '000777', cheque_date: '2026-10-13', status: 'received' },   /* covers Mala's bill in part */
      { payment_id: 'c2', party_id: KUMAR, direction: 'out', amount_minor: 2500000, cheque_no: '000123', cheque_date: '2026-10-25', status: 'received' }] }));  /* our post-dated cheque to Kumar */
  const d20 = r3.series.find((d) => d.date === '2026-10-20'), d13 = r3.series.find((d) => d.date === '2026-10-13'), d14b = r3.series.find((d) => d.date === '2026-10-14'), d25 = r3.series.find((d) => d.date === '2026-10-25'), d15b = r3.series.find((d) => d.date === '2026-10-15'), dG = d20;
  ok('a promised overdue bill is counted on the promise day, flagged promised', d20.in_minor === 3000000 && d20.items.find((i) => i.kind === 'due_in').promised === true && r3.uncounted.overdue_in_minor === 0, JSON.stringify(d20));
  ok('a cheque in hand counts on ITS date (C3) and covers the bill oldest-due-first — the bill\'s rest stays on its due date (no double count)', d13.in_minor === 1500000 && d13.items[0].kind === 'cheque_in' && d13.items[0].cheque_no === '000777' && d14b.in_minor === 500000, JSON.stringify([d13.in_minor, d14b.in_minor]));
  ok('our post-dated cheque OUT counts on its date and covers that much of the supplier\'s bill', d25.out_minor === 2500000 && d25.items[0].kind === 'cheque_out' && d15b.out_minor === 3500000, JSON.stringify([d25.out_minor, d15b.out_minor]));
  ok('GST ₹5,000 is counted on its 20th inside the 30 days', dG && dG.out_minor === 500000 && dG.items.some((i) => i.kind === 'gst') && r3.gst.counted === true, JSON.stringify(dG));
  ok('30 rows; in and out add up across the series', r3.series.length === 30 && r3.in_minor === 1500000 + 500000 + 3000000 && r3.out_minor === 3500000 + 2500000 + 500000, JSON.stringify([r3.series.length, r3.in_minor, r3.out_minor]));

  /* ── 3 · a disputed bill is frozen (C4); an overdue PAYABLE is counted today; a GST shortfall names GST ── */
  const r4 = CF.project(Object.assign({}, base, { days: 30, opening: [{ role: 'bank', code: '1500', name: 'Bank', balance_minor: 6300000 }], gst: GST_OCT20,
    receivable_items: base.receivable_items.concat([{ item_id: 'i-s', party: MALA, side: 'receivable', ref_kind: 'status', ref: 'SB-2', against_ref: 'SB-2', amount_minor: 0, currency: 'INR', date: '2026-10-05', status: 'disputed' }]),
    payable_items: [bill('PB-9', KUMAR, 'payable', 6000000, '2026-08-15', '2026-09-15')] }));
  ok('a disputed receivable is not counted (C4) and is named', r4.uncounted.disputed_in_minor === 2000000 && r4.in_minor === 0, JSON.stringify(r4.uncounted));
  ok('an overdue payable is counted TODAY (you owe it now)', r4.series[0].out_minor === 6000000 && r4.series[0].items[0].overdue === true, JSON.stringify(r4.series[0]));
  ok('the GST challan tips it below zero: the sentence names GST', r4.shortfall && r4.shortfall.date === '2026-10-20' && r4.words === 'On 20 Oct 2026 you will be ₹2,000 short — GST of ₹5,000 is due that day.', r4.words);
  const r5 = CF.project(Object.assign({}, base, { opening: [] }));
  ok('nothing in the cash ledgers → ₹0 opening, "Today you are … short" when the first day is below zero', r5.opening_minor === 0 && (CF.project(Object.assign({}, base, { opening: [], payable_items: [bill('PB-2', KUMAR, 'payable', 100, '2026-10-01', '2026-10-01')] })).words === 'Today you are ₹1 short — Kumar Wholesale’s ₹1 is due that day.'), r5.words);
  /* ── 3b · W1-FIN FIN-R4: the return's due date is the PACK's calendar (gst-returns), never the 20th for every country ── */
  const REG = require(path.join(H.API, 'lib', 'regulation')), dueOf = (c, d, o) => CF.returnDueFor(REG.packFor(c), d, o);
  ok('IN: GSTR-3B, the 20th of the month after (Dec → Jan) — gst-returns.dueDate', JSON.stringify(dueOf('IN', '2026-10-12')) === JSON.stringify({ form: 'GSTR-3B', short: 'GST', due_date: '2026-11-20', why: null }) && dueOf('IN', '2026-12-31').due_date === '2027-01-20', JSON.stringify(dueOf('IN', '2026-10-12')));
  ok('AU: the BAS quarter that holds the day — Q1 (Jul–Sep) due 28 Oct, Q2 due 28 Feb; monthly the 21st', dueOf('AU', '2026-09-30').due_date === '2026-10-28' && dueOf('AU', '2026-10-12').due_date === '2027-02-28' && dueOf('AU', '2026-10-12').short === 'BAS'
    && dueOf('AU', '2027-01-05', { frequency: 'monthly' }).due_date === '2027-02-21', JSON.stringify([dueOf('AU', '2026-09-30'), dueOf('AU', '2026-10-12')]));
  ok('AE: no stagger stored → NO date (never guessed) and the sentence; with the stagger, the 28th after the period (Nov–Jan → 28 Feb)', dueOf('AE', '2026-10-12').due_date === null && /picked under Returns/.test(dueOf('AE', '2026-10-12').why) && dueOf('AE', '2026-10-12').short === 'VAT return'
    && dueOf('AE', '2027-01-15', { stagger: 1 }).due_date === '2027-02-28', JSON.stringify([dueOf('AE', '2026-10-12'), dueOf('AE', '2027-01-15', { stagger: 1 })]));
  ok('no pack → no date, said in words; a pack without a return → the same honesty', dueOf(null, '2026-10-12').due_date === null && /no country pack/.test(dueOf(null, '2026-10-12').why) && CF.returnDueFor({ id: 'ZZ' }, '2026-10-12').why === 'No return is built for the ZZ pack yet.');
  const rAU = CF.project(Object.assign({}, base, { days: 30, currency: 'AUD', opening: [{ role: 'bank', code: '1500', name: 'Bank', balance_minor: 6300000 }], receivable_items: [], payable_items: [],
    gst: Object.assign({ payable_minor: 6500000 }, dueOf('AU', '2026-09-30'), { why: null }), asOf: '2026-10-12' }));
  const dAU = rAU.series.find((d) => d.date === '2026-10-28');
  ok('AU: the BAS is counted on ITS 28th, named by the pack’s word — the shortfall sentence says BAS, not GST', rAU.gst.form === 'BAS' && rAU.gst.counted === true && dAU.items[0].name === 'BAS' && dAU.items[0].kind === 'gst'
    && rAU.words === 'On 28 Oct 2026 you will be AUD 2,000 short — BAS of AUD 65,000 is due that day.', rAU.words + ' ' + JSON.stringify(rAU.gst));
  const rAE = CF.project(Object.assign({}, base, { days: 30, currency: 'AED', receivable_items: [], payable_items: [], gst: Object.assign({ payable_minor: 500000 }, dueOf('AE', '2026-10-12')) }));
  ok('AE: payable known, date unknown → not counted, no series item, the sentence carried in why', rAE.gst.payable_minor === 500000 && rAE.gst.due_date === null && rAE.gst.counted === false && !rAE.series.some((d) => d.items.some((i) => i.kind === 'gst')) && /picked under Returns/.test(rAE.gst.why), JSON.stringify(rAE.gst));

  /* ── 4 · the route over the in-memory books: a sale, a purchase, a received cheque; owner only; 404 while off ── */
  console.log('\n══ GET /api/books/cashflow · /cheques pdc_reminders ══');
  X.T.parties.push({ owner: SHOP, party_id: SRI, party_no: 'P-00001', name: 'Sri Traders', customer: true, credit_days: 10 },
    { owner: SHOP, party_id: KUMAR, party_no: 'P-00003', name: 'Kumar Wholesale', supplier: true, credit_days: 5 });
  const express = require('express'), app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port, q = (m, p, b) => call(port, m, '/api/books' + p, b);
  const off = await q('GET', '/cashflow?days=7');
  ok('the ledger off → the quiet 404 every books read gives', off.status === 404, String(off.status));
  await q('POST', '/enable', {});
  const CLOCK = require(path.join(H.API, 'lib', 'shop-clock')); CLOCK.set('2026-10-12T06:00:00Z');
  try {
    await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-10-08', currency: 'INR', party: SRI, source_chit_id: 'c0000000-0000-4000-8000-00000000000a', source_ref: 'chit:a',
      by_rate: [{ rate: 5, taxable: 20000, cgst: 500, sgst: 500, igst: 0 }], paid: {}, round_off: 0 });                 /* ₹21,000 due 18 Oct */
    await X.B.postEntry(X.db, SHOP, { type: 'purchase_bill', date: '2026-10-10', currency: 'INR', party: KUMAR, source_chit_id: 'c0000000-0000-4000-8000-00000000000b', source_ref: 'chit:b',
      by_rate: [{ rate: 5, taxable: 10000, cgst: 250, sgst: 250, igst: 0 }], paid: {}, round_off: 0 });                 /* ₹10,500 due 15 Oct */
    const chq = await q('POST', '/payments', { party_id: SRI, direction: 'in', amount_minor: 500000, currency: 'INR', mode: 'cheque', cheque: { number: '000777', bank: 'SBI', date: '2026-10-14' }, received_at: '2026-10-12', allocate: 'none', acknowledge: ['nothing_owed'], client_ref: 'chq-f3' });
    ok('a post-dated cheque is held (C3)', chq.status === 200 && chq.body.payment && chq.body.payment.status === 'cheque_received', chq.status + ' ' + JSON.stringify(chq.body).slice(0, 200));
    const r = await q('GET', '/cashflow?days=7');
    ok('200 with the shape: 7 rows from today, currency, opening rows, words', r.status === 200 && r.body.days === 7 && r.body.series.length === 7 && r.body.asOf === '2026-10-12' && r.body.currency === 'INR' && typeof r.body.words === 'string' && Array.isArray(r.body.opening), r.status + ' ' + JSON.stringify(r.body).slice(0, 300));
    const byDate = {}; (r.body.series || []).forEach((d) => { byDate[d.date] = d; });
    ok('the cheque comes in on 14 Oct and covers ₹5,000 of Sri\'s bill; the bill\'s ₹16,000 rest on its due date 18 Oct', byDate['2026-10-14'] && byDate['2026-10-14'].in_minor === 500000 && byDate['2026-10-18'] && byDate['2026-10-18'].in_minor === 1600000, JSON.stringify([byDate['2026-10-14'], byDate['2026-10-18']]));
    ok('Kumar\'s bill goes out on 15 Oct, named', byDate['2026-10-15'] && byDate['2026-10-15'].out_minor === 1050000 && byDate['2026-10-15'].items[0].name === 'Kumar Wholesale', JSON.stringify(byDate['2026-10-15']));
    ok('no cash was ever received: opening ₹0, the shortfall is the 15th, in words', r.body.opening_minor === 0 && r.body.shortfall && r.body.shortfall.date === '2026-10-15' && /^On 15 Oct 2026 you will be ₹5,500 short — Kumar Wholesale/.test(r.body.words), r.body.words);
    ok('GST from the posted ledgers: output 1,000 less input 500 → ₹500 due 20 Nov (the IN pack\'s GSTR-3B calendar, form + short sent), not inside 7 days', r.body.gst && r.body.gst.payable_minor === 50000 && r.body.gst.due_date === '2026-11-20' && r.body.gst.counted === false && r.body.gst.form === 'GSTR-3B' && r.body.gst.short === 'GST', JSON.stringify(r.body.gst));
    const r30 = await q('GET', '/cashflow?days=30');
    ok('days=30 → 30 rows to 10 Nov; the 20 Nov challan is still beyond it (known, not counted)', r30.status === 200 && r30.body.series.length === 30 && r30.body.to === '2026-11-10' && r30.body.gst.counted === false, JSON.stringify([r30.body.to, r30.body.gst]));
    CLOCK.set('2026-10-25T06:00:00Z');
    const r25 = await q('GET', '/cashflow?days=30');
    ok('from 25 Oct a 30-day run reaches 20 Nov: the challan is counted that day', r25.status === 200 && r25.body.gst.counted === true && r25.body.series.find((d) => d.date === '2026-11-20').out_minor === 50000, JSON.stringify(r25.body.gst));
    CLOCK.set('2026-10-12T06:00:00Z');
    ok('a read posts nothing', X.T.items.filter((i) => i.ref_kind !== 'status').length === 2, String(X.T.items.length));
    const ch = await q('GET', '/cheques');
    ok('/cheques carries pdc_reminders: the post-dated cheque, dated the 14th, not_yet (within the week)', ch.status === 200 && Array.isArray(ch.body.pdc_reminders) && ch.body.pdc_reminders.length === 1
      && ch.body.pdc_reminders[0].state === 'not_yet' && ch.body.pdc_reminders[0].cheque_no === '000777' && ch.body.pdc_reminders[0].amount_minor === 500000 && ch.body.pdc_reminders[0].cheque_date === '2026-10-14', JSON.stringify(ch.body.pdc_reminders));
    CLOCK.set('2026-10-14T06:00:00Z');
    const ch2 = await q('GET', '/cheques');
    ok('on its date the reminder says deposit_today', ch2.body.pdc_reminders[0].state === 'deposit_today', JSON.stringify(ch2.body.pdc_reminders));
    CLOCK.set('2026-10-16T06:00:00Z');
    const ch3 = await q('GET', '/cheques');
    ok('two days later: overdue_for_deposit; the cheques list itself is unchanged (one held cheque with its next steps)', ch3.body.pdc_reminders[0].state === 'overdue_for_deposit' && ch3.body.cheques.length === 1 && Array.isArray(ch3.body.cheques[0].next), JSON.stringify(ch3.body));
    WHO = mk('99999999-9999-4999-8999-999999999999', { parent_entity_id: SHOP });
    const den = await q('GET', '/cashflow');
    ok('not the owner → 403 with the sentence', den.status === 403 && den.body.message === 'Only the owner may see the cash position.', den.status + ' ' + JSON.stringify(den.body));
  } finally { CLOCK.reset(); srv.close(); }

  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log(e && e.stack || e); process.exit(1); });
