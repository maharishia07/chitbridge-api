/**
 * books-payables.test.cjs — CB FINANCE · PAYABLES (F4): lib/books-payables.view over fixture payable items — the ageing buckets (0-30 · 31-45 · 46-60 · 60+),
 * MSME day 45 (incl. agreed days under 45), the 7-day risk window, the early-pay offer valid and expired, the India-only gate — then the ONE-CALCULATION
 * check (Payables total = F3's outgoing dues), then GET /dues?side=supplier&finance=1 and the discount journal (POST /entries + against_ref) through the
 * real router over the in-memory books. Every figure to the minor unit. Needs the books engines (../chitbridge-engines/src). Run: node tests/books-payables.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111', KUMAR = '44444444-4444-4444-8444-444444444444', SRI = '22222222-2222-4222-8222-222222222222',
  MALA = '33333333-3333-4333-8333-333333333333', RAVI = '55555555-5555-4555-8555-555555555555';
const mk = (id, extra) => Object.assign({ identity_id: id, identity_type: 'entity', display_name: 'Shop' }, extra || {});
let WHO = null;
const authFor = (who) => Object.assign((req, res, next) => { req.identity = WHO || who; next(); }, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (req, res, next) => next() });
const call = (port, method, p, body) => new Promise((done) => {
  const b = body ? JSON.stringify(body) : '';
  const r = http.request({ host: '127.0.0.1', port, path: p, method: method || 'GET', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});
/* a payable bill as CBReceivables writes it (+amount against itself) */
const bill = (ref, party, amount_minor, date, due) => ({ item_id: 'i-' + ref, party, side: 'payable', ref_kind: 'bill', kind: 'purchase', ref, against_ref: ref, amount_minor, currency: 'INR', date, due_date: due });
const names = new Map([[KUMAR, { name: 'Kumar Wholesale' }], [SRI, { name: 'Sri Traders' }], [MALA, { name: 'Mala Mills' }], [RAVI, { name: 'Ravi Agencies' }]]);
const CHART = [{ code: '2100', role: 'creditors' }, { code: '4230', role: 'discount_received' }];
const ASOF = '2026-10-12';

(async () => {
  console.log('\n══ CB FINANCE · PAYABLES — lib/books-payables.view ══');
  if (!H.enginesSrc().dir) { console.log('\n   SKIP: ' + H.enginesSrc().why + '\n\n  ✓ 0 passed · 0 checks\n'); process.exit(1); }
  const X = H.load({ auth: authFor(mk(SHOP)) });
  const P = require(path.join(H.API, 'lib', 'books-payables')), CF = require(path.join(H.API, 'lib', 'books-cashflow'));

  const items = [
    bill('K1', KUMAR, 3000000, '2026-08-20', '2026-09-19'),   /* 30-day terms: agreed 30 < 45 → day 45 is 19 Sep — past */
    bill('K2', KUMAR, 5000000, '2026-09-01', '2026-11-30'),   /* 90-day terms: capped at 45 → 16 Oct, 4 days left */
    bill('K3', KUMAR, 2000000, '2026-10-05', '2026-10-25'),   /* 20-day terms → 25 Oct, 13 days left — no risk */
    bill('S1', SRI, 1000000, '2026-07-01', '2026-07-31'),     /* not MSME, 103 days old */
    bill('M1', MALA, 3000000, '2026-10-05', '2026-11-04'),    /* Mala offers 2% within 10 days: by 15 Oct — valid */
    bill('M2', MALA, 1000000, '2026-09-20', '2026-10-20'),    /* …by 30 Sep — expired */
    bill('R1', RAVI, 400000, '2026-10-01', '2026-10-15'),     /* due in 3 days */
  ];
  const base = { asOf: ASOF, currency: 'INR', country: 'IN', payable_items: items, cheques: [], names, msme: new Set([KUMAR]), chart: CHART,
    terms: new Map([[MALA, { credit_days: 30, terms: { early: { pct: 2, within_days: 10 } } }], [KUMAR, { credit_days: 30, terms: {} }]]) };
  const v = P.view(base), K = v.by_party[KUMAR], S = v.by_party[SRI], M = v.by_party[MALA], R = v.by_party[RAVI];
  const kb = (ref) => K.bills.find((b) => b.ref === ref);

  /* ── ageing ── */
  ok('bucket edges: 0→0_30 · 30→0_30 · 31→31_45 · 45→31_45 · 46→46_60 · 60→46_60 · 61→60_plus', [0, 30, 31, 45, 46, 60, 61].map(P.bucket).join() === '0_30,0_30,31_45,31_45,46_60,46_60,60_plus');
  ok('Kumar ages bill by bill: K1 53 days (46-60) · K2 41 (31-45) · K3 7 (0-30)', kb('K1').age_days === 53 && kb('K1').bucket === '46_60' && kb('K2').bucket === '31_45' && kb('K3').bucket === '0_30'
    && K.buckets['46_60'] === 3000000 && K.buckets['31_45'] === 5000000 && K.buckets['0_30'] === 2000000 && K.buckets['60_plus'] === 0, JSON.stringify(K.buckets));
  ok('Sri\'s 103-day bill is 60+', S.buckets['60_plus'] === 1000000 && S.bills[0].age_days === 103, JSON.stringify(S.buckets));
  ok('total = every open bill: ₹1,54,000', v.total_minor === 15400000 && K.total_minor === 10000000, String(v.total_minor));

  /* ── MSME day 45 ── */
  ok('agreed 30 days (< 45): day 45 is the bill date + 30 = 19 Sep, past → at risk, said as such', kb('K1').msme_day45 === '2026-09-19' && kb('K1').msme_days_left === -23 && kb('K1').msme_risk
    && kb('K1').msme_words === 'Day 45 was 19 Sep 2026 — this bill is an expense only in the year you pay it (Income-tax s.43B(h)).', JSON.stringify(kb('K1')));
  ok('agreed 90 days: capped at 45 → 16 Oct, 4 days left → at risk, "Pay by 16 Oct 2026 — …"', kb('K2').msme_day45 === '2026-10-16' && kb('K2').msme_days_left === 4 && kb('K2').msme_risk
    && kb('K2').msme_words === 'Pay by 16 Oct 2026 — after that this bill cannot be claimed as an expense this year (Income-tax s.43B(h)).', JSON.stringify(kb('K2')));
  ok('13 days left is outside the 7-day window: day 45 shown, no risk', kb('K3').msme_day45 === '2026-10-25' && kb('K3').msme_days_left === 13 && !kb('K3').msme_risk, JSON.stringify(kb('K3')));
  const edge = P.view(Object.assign({}, base, { payable_items: [bill('E7', KUMAR, 100, '2026-09-04', '2026-10-19'), bill('E8', KUMAR, 100, '2026-09-05', '2026-10-20')] })).by_party[KUMAR].bills;
  ok('the window edge: 7 days left is at risk, 8 is not', edge.find((b) => b.ref === 'E7').msme_days_left === 7 && edge.find((b) => b.ref === 'E7').msme_risk && edge.find((b) => b.ref === 'E8').msme_days_left === 8 && !edge.find((b) => b.ref === 'E8').msme_risk, JSON.stringify(edge));
  ok('Kumar is MSME and at risk → group "msme", the earliest risk sentence on the row, pay_by the earliest day 45', K.msme && K.msme_risk && K.group === 'msme' && K.pay_by === '2026-09-19' && /^Day 45 was 19 Sep/.test(K.msme_words), JSON.stringify([K.group, K.pay_by]));
  ok('a supplier with no Udyam number has no day 45', !S.msme && S.bills[0].msme_day45 === null && !S.msme_risk && S.group === 'overdue', JSON.stringify([S.msme, S.group]));
  const au = P.view(Object.assign({}, base, { country: 'AU' })), zz = P.view(Object.assign({}, base, { country: 'ZZ' }));
  ok('India only: an Australian shop gets no MSME flag (its pack has no such check)', !au.by_party[KUMAR].msme && au.by_party[KUMAR].bills.every((b) => b.msme_day45 === null), JSON.stringify(au.by_party[KUMAR].group));
  ok('a country with no pack (falls back to India in lookup) gets NO MSME flag — never a guess', !zz.by_party[KUMAR].msme && !zz.by_party[KUMAR].msme_risk, JSON.stringify(zz.by_party[KUMAR].group));

  /* ── groups ── */
  ok('groups: Kumar msme · Sri overdue · Ravi due this week · Mala later', K.group === 'msme' && S.group === 'overdue' && R.group === 'week' && M.group === 'later', [K.group, S.group, R.group, M.group].join());

  /* ── early pay ── */
  const m1 = M.bills.find((b) => b.ref === 'M1'), m2 = M.bills.find((b) => b.ref === 'M2');
  ok('early-pay VALID: 2% of ₹30,000 by 15 Oct — saves ₹600, pay ₹29,400', m1.early && m1.early.valid && m1.early.by === '2026-10-15' && m1.early.save_minor === 60000 && m1.early.pay_minor === 2940000
    && m1.early.words === '2% off if paid by 15 Oct 2026 — saves ₹600', JSON.stringify(m1.early));
  ok('early-pay EXPIRED: by 30 Sep → not valid, nothing saved, said plainly', m2.early && !m2.early.valid && m2.early.save_minor === 0 && m2.early.pay_minor === 1000000 && m2.early.words === 'Early-pay ended on 30 Sep 2026' && m2.early.record === null, JSON.stringify(m2.early));
  ok('the row carries the best valid offer', M.early && M.early.ref === 'M1' && M.early.save_minor === 60000, JSON.stringify(M.early));
  ok('the discount is a READY owner journal: Dr 2100 Mala against M1 · Cr 4230 Discount received ₹600, one client_ref', m1.early.record.ok && m1.early.record.body.against_ref === 'M1' && m1.early.record.body.client_ref === 'early:M1'
    && JSON.stringify(m1.early.record.body.lines) === JSON.stringify([{ account: '2100', party: MALA, dr_minor: 60000, cr_minor: 0 }, { account: '4230', dr_minor: 0, cr_minor: 60000 }]), JSON.stringify(m1.early.record));
  ok('the GST credit note is never automatic: the owner confirms, in a sentence', m1.early.gst_note && m1.early.gst_note.ok === false && m1.early.gst_note.why === 'owner_confirms' && m1.early.gst_note.say === 'Ask Mala Mills for a GST credit note. You confirm it when it comes.', JSON.stringify(m1.early.gst_note));
  ok('no Discount received ledger in the chart → the record is refused in words', P.view(Object.assign({}, base, { chart: [CHART[0]] })).by_party[MALA].bills.find((b) => b.ref === 'M1').early.record.why === 'no_ledger');
  ok('the shop default is not a supplier\'s offer: no own terms → no early-pay', K.bills.every((b) => b.early === null) && S.bills[0].early === null);

  /* ── disputed and cheques written: F3's rules, not a second copy ── */
  const disputed = { item_id: 'i-s1d', party: SRI, side: 'payable', ref_kind: 'status', ref: 'S1', against_ref: 'S1', amount_minor: 0, currency: 'INR', date: '2026-08-01', status: 'disputed' };
  const vd = P.view(Object.assign({}, base, { payable_items: items.concat([disputed]) }));
  const held = vd.by_party[SRI].bills.filter((b) => b.disputed), liveOnly = P.view(Object.assign({}, base, { payable_items: items.filter((b) => b.ref !== 'S1') }));
  ok('a disputed bill is frozen (C4): listed with disputed:true and the books words, but in no total', held.length === 1 && held[0].ref === 'S1' && held[0].open_minor === 1000000
    && held[0].held_words === 'Held — in dispute with you' && vd.total_minor === 15400000 - 1000000 && vd.by_party[SRI].total_minor === 0, JSON.stringify(vd.by_party[SRI]));
  ok('R106 · column 13: with the held row listed, every total, bucket and group is what it was without it', vd.total_minor === liveOnly.total_minor && Object.keys(liveOnly.by_party).every((pid) => JSON.stringify(Object.assign({}, vd.by_party[pid], { bills: null })) === JSON.stringify(Object.assign({}, liveOnly.by_party[pid], { bills: null }))), JSON.stringify([vd.total_minor, liveOnly.total_minor]));
  const lone = P.view(Object.assign({}, base, { payable_items: [bill('H1', RAVI, 70000, '2026-10-01', '2026-10-30'), Object.assign({}, disputed, { party: RAVI, ref: 'H1', against_ref: 'H1' })] }));
  ok('a supplier whose only bill is held still has a row (zero owed, the bill on it) so Release has somewhere to sit', lone.total_minor === 0 && lone.by_party[RAVI].total_minor === 0 && lone.by_party[RAVI].bills.length === 1 && lone.by_party[RAVI].bills[0].disputed === true, JSON.stringify(lone));
  const chq = { payment_id: 'p1', party_id: RAVI, direction: 'out', amount_minor: 150000, cheque_no: '000123', cheque_date: '2026-10-14', status: 'received' };
  const vc = P.view(Object.assign({}, base, { cheques: [chq] }));
  ok('a cheque written to Ravi covers ₹1,500 of R1: ₹2,500 left to pay', vc.by_party[RAVI].total_minor === 250000 && vc.total_minor === 15400000 - 150000, String(vc.by_party[RAVI].total_minor));

  /* ── ONE CALCULATION: Payables total = F3's outgoing ── */
  console.log('\n══ one calculation: Payables = the cash view\'s outgoing ══');
  const inside = items.filter((b) => b.due_date <= '2026-11-10');   /* every bill due inside a 30-day run from 12 Oct (overdue ones count today) */
  const f3 = CF.project({ asOf: ASOF, days: 30, currency: 'INR', opening: [], receivable_items: [], payable_items: inside, cheques: [chq], promises: [], gst: null, names });
  const sum = (kind) => f3.series.reduce((t, d) => t + d.items.filter((i) => i.kind === kind).reduce((a, i) => a + i.amount_minor, 0), 0);
  const pv = P.view(Object.assign({}, base, { payable_items: inside, cheques: [chq] }));
  ok('Payables total = F3\'s bills to pay (due_out) over the same bills and cheques', pv.total_minor === sum('due_out') && pv.total_minor > 0, pv.total_minor + ' vs ' + sum('due_out'));
  ok('Payables total + cheques written = F3\'s whole outgoing (out_minor)', pv.total_minor + sum('cheque_out') === f3.out_minor, (pv.total_minor + sum('cheque_out')) + ' vs ' + f3.out_minor);
  const f7 = CF.project({ asOf: ASOF, days: 7, currency: 'INR', opening: [], receivable_items: [], payable_items: items, cheques: [], promises: [], gst: null, names });
  const weekly = Object.keys(v.by_party).reduce((t, pid) => t + v.by_party[pid].bills.filter((b) => b.due_date <= f7.to).reduce((a, b) => a + b.open_minor, 0), 0);
  ok('7 days: the bills Payables shows due by ' + f7.to + ' are exactly F3\'s 7-day outgoing', weekly === f7.out_minor, weekly + ' vs ' + f7.out_minor);

  /* ── the route over the in-memory books ── */
  console.log('\n══ GET /api/books/dues?side=supplier&finance=1 · POST /entries against_ref ══');
  X.T.parties.push({ owner: SHOP, party_id: KUMAR, party_no: 'P-00003', name: 'Kumar Wholesale', supplier: true, credit_days: 30 },
    { owner: SHOP, party_id: MALA, party_no: 'P-00004', name: 'Mala Mills', supplier: true, credit_days: 30 },
    { owner: SHOP, party_id: SRI, party_no: 'P-00001', name: 'Sri Traders', customer: true, credit_days: 10 });
  /* the two reads the in-memory store has no table for: Udyam ids (party_tax_id) and the suppliers' own terms (supplier_list) */
  const q0 = X.db.query;
  X.db.query = async (t, p) => {
    if (/FROM party_tax_id WHERE owner_entity_id = \$1 AND scheme = 'UDYAM'/.test(String(t))) return { rows: [{ party_id: KUMAR }] };
    if (/FROM supplier_list WHERE owner_entity_id = \$1/.test(String(t))) return { rows: [{ party_id: KUMAR, credit_days: 30 }, { party_id: MALA, credit_days: 30, terms: { early: { pct: 2, within_days: 10 } } }] };
    return q0(t, p);
  };
  const express = require('express'), app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port, q = (m, p, b) => call(port, m, '/api/books' + p, b);
  await q('POST', '/enable', {});
  const CLOCK = require(path.join(H.API, 'lib', 'shop-clock')); CLOCK.set('2026-10-12T06:00:00Z');
  try {
    await X.B.postEntry(X.db, SHOP, { type: 'purchase_bill', date: '2026-09-01', currency: 'INR', party: KUMAR, source_chit_id: 'c0000000-0000-4000-8000-00000000000b', source_ref: 'chit:k',
      by_rate: [{ rate: 5, taxable: 20000, cgst: 500, sgst: 500, igst: 0 }], paid: {}, round_off: 0 });   /* ₹21,000, 30 days → day 45 = 1 Oct, past */
    await X.B.postEntry(X.db, SHOP, { type: 'purchase_bill', date: '2026-10-05', currency: 'INR', party: MALA, source_chit_id: 'c0000000-0000-4000-8000-00000000000c', source_ref: 'chit:m',
      by_rate: [{ rate: 0, taxable: 30000, cgst: 0, sgst: 0, igst: 0 }], paid: {}, round_off: 0 });     /* ₹30,000, 2% if paid by 15 Oct */
    const r = await q('GET', '/dues?side=supplier&finance=1');
    const rk = (r.body.parties || []).find((p) => p.party_id === KUMAR), rm = (r.body.parties || []).find((p) => p.party_id === MALA);
    ok('200: each supplier row carries `payable`; `payables.total_minor` = ₹51,000', r.status === 200 && rk && rk.payable && rm && rm.payable && r.body.payables && r.body.payables.total_minor === 5100000, r.status + ' ' + JSON.stringify(r.body).slice(0, 400));
    ok('Kumar (Udyam): day 45 is 1 Oct, past → MSME at risk', rk.payable.msme && rk.payable.group === 'msme' && rk.payable.bills[0].msme_day45 === '2026-10-01' && rk.payable.bills[0].bucket === '31_45', JSON.stringify(rk.payable).slice(0, 300));
    ok('the Payables total agrees with the dues balance the route already sends (−₹51,000 owed)', r.body.total_minor === -5100000, String(r.body.total_minor));
    const off = rm.payable.early;
    ok('Mala\'s offer from HER terms: saves ₹600, the ready journal on the 4230 ledger', off && off.valid && off.save_minor === 60000 && off.record.ok && off.record.body.lines[1].cr_minor === 60000, JSON.stringify(off).slice(0, 300));
    const c = await q('GET', '/dues?side=customer&finance=1');
    ok('Collections is untouched: a customer read carries no `payable` and no `payables`', c.status === 200 && !('payables' in c.body) && (c.body.parties || []).every((p) => !('payable' in p)), JSON.stringify(c.body).slice(0, 200));
    /* the owner presses "Record discount" — the body is sent as the server made it */
    const j = await q('POST', '/entries', Object.assign({ date: '2026-10-12' }, off.record.body));
    ok('POST /entries with against_ref posts the discount journal', j.status === 200 && (j.body.ok !== false), j.status + ' ' + JSON.stringify(j.body).slice(0, 300));
    const r2 = await q('GET', '/dues?side=supplier&finance=1');
    const rm2 = (r2.body.parties || []).find((p) => p.party_id === MALA);
    ok('the discount settled ₹600 of Mala\'s bill: ₹29,400 left on it', rm2 && rm2.payable && rm2.payable.total_minor === 2940000 && r2.body.payables.total_minor === 5040000, JSON.stringify(rm2 && rm2.payable && rm2.payable.bills));
    const again = await q('POST', '/entries', Object.assign({ date: '2026-10-12' }, off.record.body));
    const r3 = await q('GET', '/dues?side=supplier&finance=1');
    ok('the same press twice is ONE journal (client_ref)', again.status === 200 && r3.body.payables.total_minor === 5040000, String(r3.body.payables && r3.body.payables.total_minor));
    WHO = mk('99999999-9999-4999-8999-999999999999', { parent_entity_id: SHOP });
    const den = await q('GET', '/dues?side=supplier&finance=1');
    ok('not the owner → 403 with the Payables sentence', den.status === 403 && den.body.message === 'Only the owner may see what you owe.', den.status + ' ' + JSON.stringify(den.body));
    const den2 = await q('GET', '/dues?finance=1');
    ok('…and Collections keeps its own sentence', den2.status === 403 && den2.body.message === 'Only the owner may see collections.', JSON.stringify(den2.body));
    WHO = null;
  } finally { CLOCK.reset(); srv.close(); }

  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log(e && e.stack || e); process.exit(1); });
