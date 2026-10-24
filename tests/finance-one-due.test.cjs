/**
 * finance-one-due.test.cjs — CB FINANCE · THE ONE DUE FIGURE (walk 24 Oct, R73 · R75 · R76). Venkat's bill ₹8,370; a cash receipt ₹3,880 allocated
 * to it; a cheque ₹4,000 received, cleared early and left ON ACCOUNT. He owes ₹490 — and Remind said ₹4,490, the Cash view counted ₹4,490 coming in,
 * the age bucket held ₹4,490: the cheque was netted in the party's balance, never against the bill.
 *   1. the ONE READER, pure: books-engines.netOpen / dues over fixture party items — the bill's due ₹490, aged not_due, every figure to the paisa;
 *   2. the three consumers, through the real router over the in-memory books: /dues?finance=1 (the bucket), /payments/preview (Remind's due_minor),
 *      /cashflow (coming in) — ALL ₹490; plus R75: `lowest` agrees with its day's row, the rent template is in the 30-day view and not the 7-day;
 *   3. R76: the early-pay offer in rupees (books-engines.earlyOffer — CBReceivables.earlyDiscount on what is owed), and Payables' same figures.
 * Pure and offline. Needs the books engines (../chitbridge-engines/src). Run: node tests/finance-one-due.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const H = require('./support/books-harness.cjs');
const { memoryTemplates } = require('./support/books-recurring-memory.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111', VENKAT = '77777777-7777-4777-8777-777777777777';
const mk = (id, extra) => Object.assign({ identity_id: id, identity_type: 'entity', display_name: 'Shop' }, extra || {});
const authFor = (who) => Object.assign((req, res, next) => { req.identity = who; next(); }, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (req, res, next) => next() });
const call = (port, method, p, body) => new Promise((done) => {
  const b = body ? JSON.stringify(body) : '';
  const r = http.request({ host: '127.0.0.1', port, path: p, method: method || 'GET', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});

/* ── the walk's rows, as CBReceivables writes them (minor units; item_id as the database gives it) ── */
const ASOF = '2026-10-24', BILL = 'bill:venkat-3', CASH = 'pay:rv-1', CHQ = 'pay:rv-2';
let seq = 0;
const row = (o) => Object.assign({ item_id: 'i-' + (++seq), party: VENKAT, side: 'receivable', currency: 'INR', kind: undefined, status: undefined }, o);
const ITEMS = [
  row({ ref_kind: 'bill', kind: 'sale', ref: BILL, against_ref: BILL, amount_minor: 837000, date: '2026-10-09', due_date: '2026-10-24' }),
  row({ ref_kind: 'advance', kind: 'payment', ref: CASH, against_ref: CASH, amount_minor: -388000, date: '2026-10-10' }),
  row({ ref_kind: 'allocation', kind: 'payment', ref: CASH, against_ref: BILL, amount_minor: -388000, date: '2026-10-10' }),
  row({ ref_kind: 'allocation', kind: 'payment', ref: CASH, against_ref: CASH, amount_minor: 388000, date: '2026-10-10' }),
  row({ ref_kind: 'status', kind: 'payment', ref: CHQ, against_ref: CHQ, amount_minor: 0, status: 'received', pending_minor: -400000, date: '2026-10-10' }),
  row({ ref_kind: 'status', kind: 'payment', ref: CHQ, against_ref: CHQ, amount_minor: 0, status: 'cleared', date: '2026-10-12' }),
  row({ ref_kind: 'advance', kind: 'payment', ref: CHQ, against_ref: CHQ, amount_minor: -400000, date: '2026-10-12' })
];

(async () => {
  console.log('\n══ CB FINANCE · THE ONE DUE FIGURE — books-engines.netOpen · dues ══');
  if (!H.enginesSrc().dir) { console.log('\n   SKIP: ' + H.enginesSrc().why + '\n\n  ✓ 0 passed · 0 checks\n'); process.exit(1); }
  const X = H.load({ auth: authFor(mk(SHOP)) });
  const E = require(path.join(H.API, 'lib', 'books-engines'));
  const CF = require(path.join(H.API, 'lib', 'books-cashflow'));

  /* ── 1 · the one reader ── */
  const n = E.netOpen(ITEMS);
  ok('the bill is due ₹490.00: ₹8,370 − ₹3,880 allocated − ₹4,000 on account (covered, oldest due first)', n.by_ref[BILL] && n.by_ref[BILL].outstanding_minor === 49000 && n.by_ref[BILL].covered_minor === 400000, JSON.stringify(n.by_ref));
  ok('nothing stays on account once the bill is covered; only bills are open documents', Object.keys(n.unapplied_by_party).length === 0 && Object.keys(n.by_ref).join() === BILL, JSON.stringify(n));
  ok('the view carries the virtual allocation for a caller proposing a cheque on top', n.view.allocations.some((a) => a.credit === 'unapplied:' + VENKAT && a.debit === BILL && a.amount === 4000), JSON.stringify(n.view.allocations));
  const d = E.dues(ITEMS, ASOF, 'receivable');
  ok('the party balance is the engine\'s ₹490 (the Collections list was right)', d.outstanding.by_party[VENKAT] === 49000, JSON.stringify(d.outstanding.by_party));
  const ag = d.ageing.by_party[VENKAT];
  ok('the age bucket is ₹490 · not_due (due today, the edge stays in the lower bucket), total ₹490', ag && ag.undisputed.not_due === 49000 && ag.total_minor === 49000 && d.ageing.total_minor === 49000, JSON.stringify(d.ageing));
  ok('/dues reads the netted open documents from `open`', d.open.by_ref[BILL].outstanding_minor === 49000, JSON.stringify(d.open.by_ref));
  /* a receipt larger than every bill: the rest is an advance, aged as unapplied, never a due */
  const big = ITEMS.concat([row({ ref_kind: 'advance', kind: 'payment', ref: 'pay:rv-9', against_ref: 'pay:rv-9', amount_minor: -100000, date: '2026-10-20' })]);
  const nb = E.netOpen(big), db = E.dues(big, ASOF, 'receivable');
  ok('a receipt beyond the bills: the bill is covered (₹0 due) and ₹510 stays on account (unapplied_minor), no bucket', Object.keys(nb.by_ref).length === 1 && nb.by_ref[BILL].outstanding_minor === 0 && nb.unapplied_by_party[VENKAT] === 51000 && db.ageing.total_minor === 0 && db.ageing.unapplied_minor === -51000, JSON.stringify([nb.unapplied_by_party, db.ageing.total_minor, db.ageing.unapplied_minor]));
  /* a disputed receipt may not reduce a bill (C4); an uncleared cheque pays nothing (C3) */
  const disputed = ITEMS.concat([row({ ref_kind: 'status', ref: CHQ, against_ref: CHQ, amount_minor: 0, status: 'disputed', date: '2026-10-13' })]);
  ok('a DISPUTED receipt nets nothing: the bill stays ₹4,490 due', E.netOpen(disputed).by_ref[BILL].outstanding_minor === 449000, JSON.stringify(E.netOpen(disputed).by_ref));
  const held = ITEMS.slice(0, 5);
  ok('a cheque still in hand (received, not cleared) nets nothing: ₹4,490 due', E.netOpen(held).by_ref[BILL].outstanding_minor === 449000, JSON.stringify(E.netOpen(held).by_ref));
  ok('no rows → empty, never a throw', Object.keys(E.netOpen([]).by_ref).length === 0 && E.dues([], ASOF, 'receivable').open.view.allocations.length === 0);

  /* ── 2 · the three consumers, pure first: the Cash view ── */
  const names = new Map([[VENKAT, { name: 'Venkat Traders', party_no: 'P-00007' }]]);
  const base = { asOf: ASOF, days: 7, currency: 'INR', opening: [{ role: 'cash', code: '1400', name: 'Cash', balance_minor: 701000 }], receivable_items: ITEMS, payable_items: [], cheques: [], promises: [], gst: null, names };
  const r1 = CF.project(base);
  ok('Cash: Venkat\'s ₹490 comes in today (due today), not ₹4,490', r1.series[0].in_minor === 49000 && r1.in_minor === 49000 && r1.series[0].items[0].amount_minor === 49000 && r1.series[0].items[0].name === 'Venkat Traders', JSON.stringify(r1.series[0]));
  const lowRow = r1.series.find((x) => x.date === r1.lowest.date);
  ok('R75: "Lowest" is a day\'s closing figure — ₹7,500 on 24 Oct, the same as that day\'s row (it named the ₹7,010 opening before)', r1.lowest.balance_minor === 750000 && r1.lowest.date === ASOF && lowRow && lowRow.balance_minor === r1.lowest.balance_minor, JSON.stringify([r1.lowest, lowRow && lowRow.balance_minor]));
  ok('the sentence agrees', r1.words === 'You stay above zero for the next 7 days. Lowest ₹7,500 on 24 Oct 2026.', r1.words);
  const rent = { recurring_id: 'r-rent', name: 'Shop rent', direction: 'out', amount_minor: 2500000, next_on: '2026-11-01', frequency: 'monthly', anchor_day: 1, end_on: null };
  const r30 = CF.project(Object.assign({}, base, { days: 30, recurring: [rent] })), r7 = CF.project(Object.assign({}, base, { recurring: [rent] }));
  const nov1 = r30.series.find((x) => x.date === '2026-11-01');
  ok('R75: the monthly rent ₹25,000 due 1 Nov is in the 30-day view (kind recurring_out, named), once', nov1 && nov1.out_minor === 2500000 && nov1.items.length === 1 && nov1.items[0].kind === 'recurring_out' && nov1.items[0].name === 'Shop rent' && nov1.items[0].ref === 'rec:r-rent' && r30.out_minor === 2500000, JSON.stringify(nov1));
  ok('…and the 30-day shortfall names it: ₹7,500 + nothing − ₹25,000 → short on 1 Nov', r30.shortfall && r30.shortfall.date === '2026-11-01' && r30.shortfall.short_minor === 1750000 && r30.shortfall.driver.name === 'Shop rent', JSON.stringify(r30.shortfall));
  ok('the 7-day view does not reach 1 Nov: no rent, nothing out', r7.out_minor === 0 && !r7.series.some((x) => x.items.some((i) => /^recurring/.test(i.kind))), JSON.stringify(r7.out_minor));
  const weekly = CF.project(Object.assign({}, base, { days: 30, recurring: [{ recurring_id: 'r-w', name: 'Water can', direction: 'out', amount_minor: 10000, next_on: '2026-10-20', frequency: 'monthly', anchor_day: 20, end_on: '2026-11-25' }] }));
  const w = weekly.series.filter((x) => x.items.some((i) => i.ref === 'rec:r-w'));
  const wi = w.length ? w[0].items.find((i) => i.ref === 'rec:r-w') : null;
  ok('a next_on already past (the sweep has not run) is expected TODAY; the next one on its day; end_on stops it', w.length === 2 && w[0].date === ASOF && wi && wi.due_date === '2026-10-20' && w[1].date === '2026-11-20', JSON.stringify(w.map((x) => x.date)));
  const eo = CF.project(Object.assign({}, base, { days: 30, recurring: [Object.assign({}, rent, { end_on: '2026-10-31' })] }));
  ok('a template that ended before its next day counts nothing', eo.out_minor === 0, String(eo.out_minor));
  ok('a template with no amount or an unknown way is left out, never a NaN', CF.project(Object.assign({}, base, { recurring: [{ recurring_id: 'x', name: 'x', direction: 'out', amount_minor: 0, next_on: ASOF, frequency: 'monthly' }, { recurring_id: 'y', name: 'y', direction: 'sideways', amount_minor: 100, next_on: ASOF, frequency: 'monthly' }] })).out_minor === 0);

  /* ── 3 · R76 · the early-pay offer in rupees, the one helper ── */
  const early = E.earlyOffer({ date: '2026-10-24', open_minor: 49000 }, ASOF, 'INR', { pct: 2, within_days: 7 });
  ok('2% within 7 days on ₹490 due: pay ₹480.20 by 31 Oct 2026, save ₹9.80 — to the paisa', early && early.valid && early.by === '2026-10-31' && early.save_minor === 980 && early.pay_minor === 48020 && early.pct === 2, JSON.stringify(early));
  const late = E.earlyOffer({ date: '2026-10-09', open_minor: 49000 }, ASOF, 'INR', { pct: 2, within_days: 7 });
  ok('past the window: not valid, nothing saved, the whole ₹490 to pay', late && !late.valid && late.save_minor === 0 && late.pay_minor === 49000 && late.by === '2026-10-16', JSON.stringify(late));
  ok('no offer in the terms → null (the screen says nothing)', E.earlyOffer({ date: ASOF, open_minor: 49000 }, ASOF, 'INR', null) === null && E.earlyOffer({ date: ASOF, open_minor: 49000 }, ASOF, 'INR', { pct: 0, within_days: 7 }) === null);

  /* ── 4 · the three screens through the real router over the in-memory books ── */
  console.log('\n══ GET /dues?finance=1 · POST /payments/preview · GET /cashflow — all ₹490 ══');
  X.T.parties.push({ owner: SHOP, party_id: VENKAT, party_no: 'P-00007', name: 'Venkat Traders', customer: true, credit_days: 15, credit_limit_minor: null, terms: { early: { pct: 2, within_days: 7 } } });
  const R = require(path.join(H.API, 'lib', 'books-recurring')), mem = memoryTemplates(); mem.migrated = true; R.use(mem.store);
  const express = require('express'), app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port, q = (m, p, b) => call(port, m, '/api/books' + p, b);
  const CLOCK = require(path.join(H.API, 'lib', 'shop-clock')); CLOCK.set('2026-10-24T06:00:00Z');
  try {
    await q('POST', '/enable', {});
    const sale = await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-10-09', currency: 'INR', party: VENKAT, source_chit_id: 'c0000000-0000-4000-8000-00000000000e', source_ref: 'chit:e',
      by_rate: [{ rate: 0, taxable: 8370, cgst: 0, sgst: 0, igst: 0 }], paid: {}, round_off: 0 });
    ok('the bill: ₹8,370 dated 9 Oct, 15 credit days → due 24 Oct', sale && sale.ok !== false, JSON.stringify(sale).slice(0, 200));
    const cash = await q('POST', '/payments', { party_id: VENKAT, direction: 'in', amount_minor: 388000, currency: 'INR', mode: 'cash', received_at: '2026-10-10', allocate: 'oldest_first', client_ref: 'rv-1' });
    ok('the cash receipt ₹3,880 is allocated to the bill', cash.status === 200 && cash.body.allocation && cash.body.allocation.allocated_minor === 388000, cash.status + ' ' + JSON.stringify(cash.body).slice(0, 300));
    const chq = await q('POST', '/payments', { party_id: VENKAT, direction: 'in', amount_minor: 400000, currency: 'INR', mode: 'cheque', cheque: { number: '000002', bank: 'SBI', date: '2026-10-10' }, received_at: '2026-10-10', allocate: 'none', client_ref: 'rv-2' });
    ok('the cheque ₹4,000 is held, not allocated', chq.status === 200 && chq.body.payment && chq.body.payment.status === 'cheque_received', chq.status + ' ' + JSON.stringify(chq.body).slice(0, 300));
    const pid = chq.body.payment && chq.body.payment.payment_id;
    const dep = await q('POST', '/cheques/' + pid + '/status', { status: 'deposited', date: '2026-10-11' });
    const clr = await q('POST', '/cheques/' + pid + '/status', { status: 'cleared', date: '2026-10-12' });
    ok('…deposited, then cleared early (12 Oct): its money is on account', dep.status === 200 && clr.status === 200 && clr.body.status === 'cleared', dep.status + ' ' + clr.status + ' ' + JSON.stringify(clr.body).slice(0, 200));

    const dues = await q('GET', '/dues?finance=1&side=customer');
    const v = ((dues.body || {}).parties || []).find((p) => p.party_id === VENKAT);
    ok('Collections: Venkat ₹490 · oldest due 24 Oct · the age bucket is ₹490 not_due (it held ₹4,490)', dues.status === 200 && v && v.balance_minor === 49000 && v.oldest_due === '2026-10-24' && v.buckets.not_due === 49000 && Object.keys(v.buckets).every((k) => k === 'not_due' || v.buckets[k] === 0), JSON.stringify(v));
    ok('R76: the early-pay offer on the row — the bill of 9 Oct is past its 7 days, so none is offered (null), never a stale figure', v && v.early === null, JSON.stringify(v && v.early));
    const prev = await q('POST', '/payments/preview', { party_id: VENKAT, direction: 'in', amount_minor: 1, currency: 'INR', allocate: 'oldest_first' });
    const bill = (prev.body.proposal || [])[0];
    ok('Remind (payments/preview): the oldest open bill\'s due_minor is ₹490; open_minor keeps the ₹4,490 a payment may still be allocated to', prev.status === 200 && bill && bill.due_minor === 49000 && bill.open_minor === 449000 && bill.due_date === '2026-10-24', JSON.stringify(prev.body).slice(0, 400));
    const cf = await q('GET', '/cashflow?days=7');
    ok('Cash: ₹490 coming in today, not ₹4,490', cf.status === 200 && cf.body.series[0].in_minor === 49000 && cf.body.in_minor === 49000, JSON.stringify(cf.body.series && cf.body.series[0]));
    const lr = (cf.body.series || []).find((x) => x.date === cf.body.lowest.date);
    ok('the header\'s Lowest is that day\'s row', lr && lr.balance_minor === cf.body.lowest.balance_minor, JSON.stringify([cf.body.lowest, lr]));
    await mem.store.insert(null, SHOP, { name: 'Shop rent', event: { kind: 'expense', class: 'rent', amount_minor: 2500000, how: 'bank' }, frequency: 'monthly', next_on: '2026-11-01', anchor_day: 1, auto: false });
    await mem.store.insert(null, SHOP, { name: 'Stock on credit', event: { kind: 'expense', class: 'purchases', amount_minor: 900000, supplier: '88888888-8888-4888-8888-888888888888' }, frequency: 'monthly', next_on: '2026-11-02', anchor_day: 2, auto: false });
    const cf30 = await q('GET', '/cashflow?days=30');
    const n1 = (cf30.body.series || []).find((x) => x.date === '2026-11-01'), n2 = (cf30.body.series || []).find((x) => x.date === '2026-11-02');
    ok('R75: the rent template ₹25,000 on 1 Nov is in the 30-day view from the recurring table; an expense on credit is not cash that day', cf30.status === 200 && n1 && n1.out_minor === 2500000 && n1.items[0].kind === 'recurring_out' && n1.items[0].name === 'Shop rent' && n2 && n2.out_minor === 0, JSON.stringify([n1, n2]));
    const cf7 = await q('GET', '/cashflow?days=7');
    ok('the 7-day view is unchanged by it', cf7.body.out_minor === 0, String(cf7.body.out_minor));
    mem.migrated = false;
    const cfx = await q('GET', '/cashflow?days=30');
    ok('before b281 runs (no table) the view answers without the templates — never a 500', cfx.status === 200 && cfx.body.out_minor === 0, cfx.status + ' ' + String(cfx.body.out_minor));
  } finally { CLOCK.reset(); R.use(null); srv.close(); }

  console.log('\n  ' + (fail ? '✗ ' + fail + ' failed' : '✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
