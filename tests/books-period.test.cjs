/**
 * books-period.test.cjs — THE PERIOD-END ROUTES (engines v1.14–v1.16) THROUGH REAL EXPRESS, with a stand-in auth, db, store and
 * asset register (no database; b280 is a DRAFT Athi runs).
 *
 * Proves, per route: the entry's lines ARE the posting engine's lines for the same event · a double tap posts once · a locked
 * month is refused (409 PERIOD_LOCKED) and leaves nothing behind · a co-assist is refused (403) · the asset routes answer 503
 * BOOKS_NOT_MIGRATED until the table exists — and the asset flow end to end: Accept "asset" on a supplier bill → PPE + a register
 * row (and the same plain queue reason while the register is missing), the depreciation run → ONE JV entry with the engine's
 * figure, the disposal.
 * Needs the books engines v1.16.0 (the sibling ../chitbridge-engines/src, or BOOKS_ENGINES_SRC).
 * Run: node tests/books-period.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222', SUPP = '33333333-3333-4333-8333-333333333333';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur Bhavan' };
const OWNER2 = { identity_id: CUST, identity_type: 'entity', display_name: 'Chola Auto Care' };
const STAFF = { identity_id: '44444444-4444-4444-8444-444444444444', parent_entity_id: SHOP, identity_type: 'actor' };
let WHO = OWNER;
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

/** an in-memory asset register with the real module's functions (b280 stood in); `migrated` is the switch the 503 test flips */
function memoryRegister() {
  const rows = []; let seq = 0; const m = { migrated: false, rows };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  m.store = {
    async exists() { return m.migrated; },
    async list(h, e) { return clone(rows.filter((r) => r.entity === e)); },
    async get(h, e, id) { const r = rows.find((x) => x.entity === e && x.asset_id === id); return r ? clone(r) : null; },
    async bySourceEntry(h, e, entry, name) { const r = rows.find((x) => x.entity === e && x.source_entry_id === entry && x.name === name); return r ? clone(r) : null; },
    async insert(h, e, a) {
      if (a.source_entry_id && rows.some((x) => x.entity === e && x.source_entry_id === a.source_entry_id && x.name === a.name)) return null;
      const r = { entity: e, asset_id: '55555555-5555-4555-8555-' + String(++seq).padStart(12, '0'), name: a.name, asset_class: a.asset_class, cost_minor: a.cost_minor, currency: a.currency || 'INR',
        put_to_use: a.put_to_use, source_entry_id: a.source_entry_id || null, source_chit_id: a.source_chit_id || null, accumulated_minor: 0, last_dep_fy: null, disposed_on: null,
        disposal_entry_id: null, proceeds_minor: null, created_by: a.by || null };
      rows.push(r); return clone(r);
    },
    async addDepreciation(h, e, id, minor, fy) { const r = rows.find((x) => x.entity === e && x.asset_id === id); if (r && r.last_dep_fy !== fy) { r.accumulated_minor += minor; r.last_dep_fy = fy; } },
    async markDisposed(h, e, id, on, entry, proceeds) { const r = rows.find((x) => x.entity === e && x.asset_id === id && !x.disposed_on); if (!r) return false; Object.assign(r, { disposed_on: on, disposal_entry_id: entry, proceeds_minor: proceeds }); return true; },
  };
  return m;
}

(async () => {
  console.log('\n══ /api/books — the period-end routes ══\n');
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  const IDS = {
    [SHOP]: { identity_id: SHOP, gstn: '33AAAAA0000A1Z5', display_name: 'Mayur Traders', country: 'IN', policy_flags: { price_includes_tax: 'no' } },
    [CUST]: { identity_id: CUST, gstn: '33BBBBB0000B1Z5', display_name: 'Chola Auto Care', country: 'IN', policy_flags: {} },
  };
  const q0 = X.dbStub.query;
  X.dbStub.query = async (t, p) => /FROM identities WHERE identity_id = ANY/.test(String(t)) ? { rows: p[0].map((id) => IDS[id]).filter(Boolean) } : q0(t, p);
  for (const m of ['tax-copy', 'bill-use']) delete require.cache[require.resolve(path.join(H.API, 'lib', m))];
  require.cache[require.resolve(path.join(H.API, 'lib', 'storage-object'))] = { exports: { available: async () => false } };
  const TC = require(path.join(H.API, 'lib', 'tax-copy')); TC.ledgerFor = async () => { throw new Error('no chits in this test'); };
  const Assets = require(path.join(H.API, 'lib', 'books-assets'));
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const reg = memoryRegister(); Assets.use(reg.store);
  const P = X.E.posting();
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);
  /* the shop's day: after the year end of 2026-27, so its depreciation can run; a test moves it back to prove the refusal */
  let DAY = '2027-04-10'; const realDay = K.dayOf;
  K.dayOf = (ts, c) => (ts instanceof Date && Math.abs(ts.getTime() - Date.now()) < 5000 ? DAY : realDay(ts, c));   /* only "now" moves; the ledger's first day stays where it was */

  await X.store.saveSetting(X.db, SHOP, { enabled: false });
  const en = await q('POST', '/enable', {});
  ok('the ledger is on for the shop', en.status === 200 && en.body.ok, JSON.stringify(en.body));
  X.T.parties.push({ owner: SHOP, party_id: CUST, party_no: 'P-00001', name: 'Ravi Stores', customer: true, credit_days: 10 },
    { owner: SHOP, party_id: SUPP, party_no: 'P-00002', name: 'Kumar Traders', supplier: true, credit_days: 30 });
  const pack = X.E.packs().packFor('IN');
  const codeOfRole = (role) => (X.T.accounts.find((a) => a.entity_id === SHOP && a.role === role) || {}).code;
  const entries = (src, e) => X.T.entries.filter((x) => x.entity_id === (e || SHOP) && x.source_ref === src);
  const stored = (entry) => X.T.lines.filter((l) => l.entry_id === entry.entry_id).map((l) => [l.code, l.dr_minor, l.cr_minor]);
  /* the lines THE ENGINE builds for an event — what the route must have stored, never re-derived by the route */
  const engine = (ev) => { const r = P.post(ev, { pack }); if (!r.ok) throw new Error('engine: ' + r.why); return r.lines.map((l) => [l.code || codeOfRole(l.account), l.dr_minor, l.cr_minor]); };
  const seriesOf = (en2) => String(en2.entry_no).split('/')[0];

  /* the books have a sale and a purchase in September, to give the GST heads something to set off */
  await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-09-05', currency: 'INR', party: CUST, source_chit_id: 'c0000000-0000-4000-8000-00000000000a', source_ref: 'chit:a',
    by_rate: [{ rate: 18, taxable: 1000, cgst: 90, sgst: 90, igst: 0 }], paid: {}, round_off: 0 });
  await X.B.postEntry(X.db, SHOP, { type: 'purchase_bill', date: '2026-09-06', currency: 'INR', party: SUPP, source_chit_id: 'c0000000-0000-4000-8000-00000000000b', source_ref: 'chit:b',
    by_rate: [{ rate: 18, taxable: 500, cgst: 45, sgst: 45, igst: 0 }], paid: {}, round_off: 0 });

  /* ── owner-only: a co-assist is refused on every route ── */
  const ID1 = '55555555-5555-4555-8555-000000000001';
  const ROUTES = [['GET', '/assets'], ['POST', '/assets'], ['POST', '/assets/' + ID1 + '/dispose'], ['POST', '/depreciation/run'], ['POST', '/closing-stock'], ['POST', '/gst/close'],
    ['POST', '/gst/pay'], ['POST', '/loans'], ['POST', '/loans/LN-1/emi'], ['POST', '/accruals'], ['POST', '/accruals/A-1/reverse'], ['POST', '/contra']];
  WHO = STAFF;
  const notRefused = [];
  for (const [m, p] of ROUTES) { const r = await q(m, p, {}); if (r.status !== 403) notRefused.push(m + ' ' + p + ' → ' + r.status); }
  WHO = OWNER;
  ok('OWNER-ONLY: all ' + ROUTES.length + ' routes refuse a co-assist (403)', notRefused.length === 0, notRefused.join(' · '));
  const before = X.T.entries.length;

  /* ── 503 until b280 is run ── */
  const a503 = [];
  for (const [m, p, b] of [['GET', '/assets'], ['POST', '/assets', { name: 'Laptop', class: 'computers', cost: 42000, date: '2026-04-18', how: 'bank' }], ['POST', '/assets/' + ID1 + '/dispose', { date: '2026-05-01' }],
    ['POST', '/depreciation/run', { fy: '2026-27' }]]) {
    const r = await q(m, p, b); if (r.status !== 503 || r.body.code !== 'BOOKS_NOT_MIGRATED') a503.push(m + ' ' + p + ' → ' + r.status + ' ' + JSON.stringify(r.body));
  }
  ok('BEFORE b280: the four asset routes answer 503 BOOKS_NOT_MIGRATED, and nothing posted', a503.length === 0 && X.T.entries.length === before, a503.join(' · '));
  reg.migrated = true;

  /* ── POST /assets ── */
  const body = { name: 'Laptop', class: 'computers', cost: 42000, date: '2026-04-18', how: 'bank', client_ref: 'lap-1' };
  const a1 = await q('POST', '/assets', body);
  const e1 = entries('asset:lap-1')[0];
  ok('POST /assets → the purchase entry and the register row', a1.status === 200 && a1.body.ok && e1 && a1.body.asset && a1.body.asset.cost_minor === 4200000 && a1.body.asset.wdv_minor === 4200000, JSON.stringify(a1.body));
  eq('…its lines are the ENGINE\'s: Dr 1060 Computers 42,000 · Cr Bank (purchase_bill, accept asset)',
    e1 && stored(e1), engine({ type: 'purchase_bill', accept: 'asset', asset_class: 'computers', date: '2026-04-18', currency: 'INR', by_rate: [{ rate: 0, taxable: 42000, cgst: 0, sgst: 0, igst: 0 }], paid: { bank: 42000 } }));
  ok('…a person made it: series MJ, voucher type Purchase', e1 && seriesOf(e1) === 'MJ' && e1.voucher_type === 'Purchase', e1 && e1.entry_no + ' ' + e1.voucher_type);
  const a1b = await q('POST', '/assets', body);
  ok('…a double tap posts once (duplicate: true) and the register has ONE row', a1b.status === 200 && a1b.body.duplicate === true && entries('asset:lap-1').length === 1 && reg.rows.length === 1, JSON.stringify(a1b.body));
  eq('…a bad class is a plain question (400)', (await q('POST', '/assets', { name: 'X', class: 'spaceship', cost: 1, how: 'cash' })).status, 400);
  const g1 = await q('GET', '/assets?asOf=2026-09-30');
  const nb = g1.body.net_block && g1.body.net_block[0];
  ok('GET /assets → the register with WDV, and the books\' own cost beside it (agrees)', g1.status === 200 && g1.body.assets.length === 1 && g1.body.assets[0].wdv_minor === 4200000 && nb && nb.asset_class === 'computers'
    && nb.ledger_cost_minor === 4200000 && nb.agrees === true && g1.body.total_wdv_minor === 4200000, JSON.stringify(g1.body).slice(0, 400));

  /* ── a locked month refuses (asset add, closing stock) and leaves nothing ── */
  await q('POST', '/periods/2026-27/2/lock', { reason: 'GSTR-1 filed' });
  const n0 = X.T.entries.length, r0 = reg.rows.length;
  const al = await q('POST', '/assets', { name: 'Printer', class: 'office', cost: 9000, date: '2026-05-10', how: 'cash', client_ref: 'prn-1' });
  ok('POST /assets in a locked month → 409 PERIOD_LOCKED, no entry, no register row', al.status === 409 && al.body.code === 'PERIOD_LOCKED' && X.T.entries.length === n0 && reg.rows.length === r0, JSON.stringify(al.body));
  await q('POST', '/periods/2026-27/2/unlock', { reason: 'test' });

  /* ── depreciation ── */
  DAY = '2026-10-03';
  const early = await q('POST', '/depreciation/run', { fy: '2026-27' });
  ok('POST /depreciation/run before the year has ended → refused in words (422), nothing posted', early.status === 422 && /year has not ended/.test(early.body.message), JSON.stringify(early.body));
  DAY = '2027-04-10';
  const want = P.depreciationFor({ entity: 'proprietor', fiscal_year: '2026-27', date: '2027-03-31', ref: 'DEP-2026-27', assets: [{ id: 'x', class: 'computers', cost: 42000, put_to_use: '2026-04-18' }], pack });
  const d1 = await q('POST', '/depreciation/run', { fy: '2026-27' });
  const de = entries('depreciation:2026-27')[0];
  ok('POST /depreciation/run → ONE entry at the year end with the engine\'s figure (computers 40% WDV = 16,800)', d1.status === 200 && d1.body.ok && de && String(de.posting_date).slice(0, 10) === '2027-03-31'
    && want.by_class[0].amount === 16800 && d1.body.by_class[0].amount === want.by_class[0].amount, JSON.stringify(d1.body).slice(0, 400));
  eq('…its lines: Dr 6200 Depreciation · Cr 1061 Accumulated depreciation — computers', de && stored(de), engine(want.event));
  ok('…the system computed it: series JV; the answer says the entity basis was ASSUMED (proprietor), never read from the PAN', de && seriesOf(de) === 'JV' && d1.body.entity_basis === 'proprietor' && d1.body.basis_assumed === true && /books\.entity_basis/.test(d1.body.entity_note || ''), JSON.stringify(d1.body.entity_note));
  const d2 = await q('POST', '/depreciation/run', { fy: '2026-27' });
  ok('…run twice: posts once (duplicate), and the register\'s accumulated moved once', d2.body.duplicate === true && X.T.entries.filter((x) => x.source_ref === 'depreciation:2026-27').length === 1 && reg.rows[0].accumulated_minor === 1680000, JSON.stringify([d2.body, reg.rows[0].accumulated_minor]));
  const g2 = await q('GET', '/assets?asOf=2027-03-31');
  ok('…GET /assets now shows WDV 25,200 and the ledger agrees', g2.body.assets[0].wdv_minor === 2520000 && g2.body.net_block[0].agrees === true && g2.body.net_block[0].ledger_wdv_minor === 2520000, JSON.stringify(g2.body.net_block));
  await q('POST', '/periods/2026-27/12/lock', { reason: 'year end' });
  const dl = await q('POST', '/depreciation/run', { fy: '2025-26' });
  ok('depreciation for a year with no assets says so (nothing to post), no entry', dl.status === 200 && dl.body.nothing_to_post === true, JSON.stringify(dl.body));
  await q('POST', '/periods/2026-27/12/unlock', { reason: 'test' });

  /* ── dispose ── */
  const ASSET = reg.rows[0].asset_id;
  const dsB = { date: '2027-04-05', proceeds_minor: 2000000, into: 'bank', client_ref: 'sell-1' };
  const ds = await q('POST', '/assets/' + ASSET + '/dispose', dsB);
  const dse = entries('asset-dispose:' + ASSET)[0];
  ok('POST /assets/:id/dispose → the disposal entry, the row marked disposed', ds.status === 200 && ds.body.ok && dse && reg.rows[0].disposed_on === '2027-04-05' && reg.rows[0].disposal_entry_id === dse.entry_id, JSON.stringify(ds.body).slice(0, 300));
  eq('…its lines are the engine\'s asset_disposal: Dr bank 20,000 · Dr accumulated 16,800 · Cr cost 42,000 · loss 5,200 (WDV 25,200 sold for 20,000)', dse && stored(dse),
    engine({ type: 'asset_disposal', asset_class: 'computers', cost: 42000, accumulated: 16800, proceeds: 20000, into: 'bank', date: '2027-04-05', currency: 'INR' }));
  ok('…a person made it: MJ', dse && seriesOf(dse) === 'MJ');
  const ds2 = await q('POST', '/assets/' + ASSET + '/dispose', dsB);
  ok('…a double tap answers the first (duplicate), one entry', ds2.body.duplicate === true && X.T.entries.filter((x) => x.source_ref === 'asset-dispose:' + ASSET).length === 1);
  eq('…an unknown asset is a 404', (await q('POST', '/assets/55555555-5555-4555-8555-0000000000ff/dispose', dsB)).status, 404);

  /* ── closing stock ── */
  /* M158: a chart with no 5050 gets the ledger on first use from the template — never a refusal in machine words */
  const gone5050 = X.T.accounts.findIndex((a) => a.code === '5050'); const had5050 = gone5050 >= 0 ? X.T.accounts.splice(gone5050, 1)[0] : null;
  const cs = await q('POST', '/closing-stock', { date: '2026-09-30', value_minor: 5000000, method: 'manual', client_ref: 'cs-sep' });
  const cse = entries('stock:cs-sep')[0];
  ok('POST /closing-stock → the difference from the books (book 0 → 50,000)', cs.status === 200 && cs.body.ok && cse && cs.body.book_minor === 0, JSON.stringify(cs.body));
  eq('…lines are the engine\'s: Dr 1200 Stock · Cr 5050 Changes in inventories', cse && stored(cse), engine({ type: 'closing_stock', mode: 'manual', book: 0, amount: 50000, date: '2026-09-30', currency: 'INR' }));
  { const back = X.T.accounts.find((a) => a.code === '5050'); ok('M158: the missing 5050 was added on first use under its group', !!had5050 && back && back.role === 'changes_in_inventories' && !!back.parent_id); }
  ok('…system-computed: series JV', cse && seriesOf(cse) === 'JV');
  const cs2 = await q('POST', '/closing-stock', { date: '2026-09-30', value_minor: 5000000, method: 'manual', client_ref: 'cs-sep' });
  ok('…a double tap posts once', cs2.body.duplicate === true && X.T.entries.filter((x) => x.source_ref === 'stock:cs-sep').length === 1);
  const cs3 = await q('POST', '/closing-stock', { date: '2026-09-30', value_minor: 5000000, method: 'manual' });
  ok('…the same value again (no client_ref): nothing to post, said in words (422)', cs3.status === 422 && /already equals/.test(cs3.body.message), JSON.stringify(cs3.body));
  const cs4 = await q('POST', '/closing-stock', { date: '2026-10-31', value_minor: 6000000, nrv_minor: 5500000, method: 'manual', client_ref: 'cs-oct' });
  const cse4 = entries('stock:cs-oct')[0];
  eq('…cost 60,000 but NRV 55,000: the LOWER is valued (AS 2) — only 5,000 more than the books', cse4 && stored(cse4), engine({ type: 'closing_stock', mode: 'manual', book: 50000, cost: 60000, nrv: 55000, date: '2026-10-31', currency: 'INR' }));
  const cs5 = await q('POST', '/closing-stock', { date: '2026-10-31', value_minor: 7000000, method: 'automatic' });
  ok('\'automatic\' answers the engine\'s refusal in plain words (no quantities yet)', cs5.status === 422 && /quantities/.test(cs5.body.message), JSON.stringify(cs5.body));
  await q('POST', '/periods/2026-27/7/lock', { reason: 'x' });
  const n1 = X.T.entries.length;
  const csl = await q('POST', '/closing-stock', { date: '2026-10-31', value_minor: 1000000, method: 'manual', client_ref: 'cs-late' });
  ok('…in a locked month → 409 PERIOD_LOCKED, nothing posted', csl.status === 409 && csl.body.code === 'PERIOD_LOCKED' && X.T.entries.length === n1, JSON.stringify(csl.body));
  await q('POST', '/periods/2026-27/7/unlock', { reason: 'test' });

  /* ── GST month close and the challan ── */
  const so = P.gstSetOff({ date: '2026-09-30', output: { cgst: 90, sgst: 90, igst: 0 }, input: { cgst: 45, sgst: 45, igst: 0 } });
  const gc = await q('POST', '/gst/close', { fy: '2026-27', period: 6 });
  const gce = entries('gstclose:2026-27:6')[0];
  ok('POST /gst/close → utilised (CGST←CGST, SGST←SGST 45 each), payable 45 + 45 by challan', gc.status === 200 && gc.body.ok && gce && gc.body.utilised.length === 2 && gc.body.payable_minor.cgst_minor === 4500
    && gc.body.payable_minor.sgst_minor === 4500 && gc.body.pay_total_minor === 9000 && so.utilised.length === 2, JSON.stringify(gc.body));
  eq('…the set-off entry\'s lines are the engine\'s gst_setoff', gce && stored(gce), engine(so.event));
  ok('…system-computed: series JV', gce && seriesOf(gce) === 'JV');
  const gc2 = await q('POST', '/gst/close', { fy: '2026-27', period: 6 });
  ok('…a double tap: posts once; the answer still says what is left to pay', gc2.body.duplicate === true && X.T.entries.filter((x) => x.source_ref === 'gstclose:2026-27:6').length === 1 && gc2.body.pay_total_minor === 9000, JSON.stringify(gc2.body));
  eq('…a month that has not ended is refused in words', await (async () => { DAY = '2026-09-20'; const r = await q('POST', '/gst/close', { fy: '2026-27', period: 6 }); DAY = '2027-04-10'; return [r.status, /ends on 2026-09-30/.test(r.body.message)]; })(), [422, true]);
  const gp = await q('POST', '/gst/pay', { fy: '2026-27', period: 6, amounts: { cgst_minor: 4500, sgst_minor: 4500 }, bank: 'bank', challan_no: 'CPIN24100001', date: '2026-10-02' });
  const gpe = entries('gstpay:CPIN24100001')[0];
  ok('POST /gst/pay → the challan entry', gp.status === 200 && gp.body.ok && gpe, JSON.stringify(gp.body));
  eq('…lines are the engine\'s gst_payment: Dr output CGST 45 · Dr output SGST 45 · Cr bank 90', gpe && stored(gpe), engine({ type: 'gst_payment', mode: 'bank', heads: { cgst: 45, sgst: 45 }, date: '2026-10-02', currency: 'INR' }));
  ok('…a person keyed it: series MJ, voucher type Payment', gpe && seriesOf(gpe) === 'MJ' && gpe.voucher_type === 'Payment');
  const gp2 = await q('POST', '/gst/pay', { fy: '2026-27', period: 6, amounts: { cgst_minor: 4500, sgst_minor: 4500 }, bank: 'bank', challan_no: 'CPIN24100001', date: '2026-10-02' });
  ok('…the same challan twice: posts once', gp2.body.duplicate === true && X.T.entries.filter((x) => x.source_ref === 'gstpay:CPIN24100001').length === 1);
  const gp3 = await q('POST', '/gst/pay', { fy: '2026-27', period: 6, amounts: { cgst_minor: 450000 }, bank: 'bank', challan_no: 'CPIN24100002', date: '2026-10-02' });
  ok('…paying more than is owed (a slipped decimal) is refused, against the books (422)', gp3.status === 422 && /more than the tax owed/.test(gp3.body.message) && !entries('gstpay:CPIN24100002').length, JSON.stringify(gp3.body));
  eq('…no challan number is a plain question (400)', (await q('POST', '/gst/pay', { fy: '2026-27', period: 6, amounts: { cgst_minor: 1 }, bank: 'bank' })).status, 400);
  await q('POST', '/periods/2026-27/6/lock', { reason: 'GSTR-3B filed' });
  const n2 = X.T.entries.length;
  const gl = await q('POST', '/gst/close', { fy: '2026-27', period: 6 });
  const gl2 = await q('POST', '/gst/pay', { fy: '2026-27', period: 6, amounts: { cgst_minor: 1 }, bank: 'bank', challan_no: 'CPIN24100003', date: '2026-09-30' });
  ok('GST close and pay in a locked month → 409 PERIOD_LOCKED, nothing posted', gl.status === 409 && gl.body.code === 'PERIOD_LOCKED' && gl2.status === 409 && gl2.body.code === 'PERIOD_LOCKED' && X.T.entries.length === n2, JSON.stringify([gl.body, gl2.body]));
  await q('POST', '/periods/2026-27/6/unlock', { reason: 'test' });

  /* ── loans ── */
  const lnB = { ref: 'LN-1', lender: 'State Bank', amount_minor: 10000000, into: 'bank', rate: 9.5, kind: 'secured', date: '2026-06-10' };
  const ln = await q('POST', '/loans', lnB);
  const lne = entries('loan:LN-1')[0];
  ok('POST /loans → the loan entry', ln.status === 200 && ln.body.ok && lne && /State Bank at 9.5%/.test(lne.narration), JSON.stringify(ln.body));
  eq('…lines are the engine\'s loan_taken: Dr bank 1,00,000 · Cr 2000 Secured loans', lne && stored(lne), engine({ type: 'loan_taken', loan: 'secured_loan', into: 'bank', amount: 100000, date: '2026-06-10', currency: 'INR' }));
  ok('…keyed by a person: MJ, voucher type Receipt', lne && seriesOf(lne) === 'MJ' && lne.voucher_type === 'Receipt');
  ok('…a double tap posts once', (await q('POST', '/loans', lnB)).body.duplicate === true && X.T.entries.filter((x) => x.source_ref === 'loan:LN-1').length === 1);
  const emiB = { principal_minor: 800000, interest_minor: 100000, from: 'bank', date: '2026-07-10', client_ref: 'jul' };
  const em = await q('POST', '/loans/LN-1/emi', emiB);
  const eme = entries('emi:LN-1:jul')[0];
  ok('POST /loans/:ref/emi → the instalment, split as the bank gave it', em.status === 200 && em.body.ok && eme, JSON.stringify(em.body));
  eq('…lines are the engine\'s loan_repaid: Dr 2000 8,000 · Dr 6150 Interest 1,000 · Cr bank 9,000', eme && stored(eme), engine({ type: 'loan_repaid', loan: 'secured_loan', principal: 8000, interest: 1000, from: 'bank', date: '2026-07-10', currency: 'INR' }));
  ok('…keyed by a person: MJ, voucher type Payment', eme && seriesOf(eme) === 'MJ' && eme.voucher_type === 'Payment');
  ok('…a double tap posts once', (await q('POST', '/loans/LN-1/emi', emiB)).body.duplicate === true && X.T.entries.filter((x) => x.source_ref === 'emi:LN-1:jul').length === 1);
  eq('…an unknown loan is a 404', (await q('POST', '/loans/NOPE/emi', emiB)).status, 404);
  eq('…an instalment without a reference is a plain question (400)', (await q('POST', '/loans/LN-1/emi', { principal_minor: 1 })).status, 400);
  await q('POST', '/periods/2026-27/3/lock', { reason: 'x' });
  const n3 = X.T.entries.length;
  const lnl = await q('POST', '/loans', { ref: 'LN-2', lender: 'X', amount_minor: 100, into: 'bank', date: '2026-06-15' });
  const eml = await q('POST', '/loans/LN-1/emi', { principal_minor: 100, from: 'bank', date: '2026-06-20', client_ref: 'late' });
  ok('a loan and an instalment in a locked month → 409 PERIOD_LOCKED, nothing posted', lnl.status === 409 && eml.status === 409 && lnl.body.code === 'PERIOD_LOCKED' && X.T.entries.length === n3, JSON.stringify([lnl.body, eml.body]));
  await q('POST', '/periods/2026-27/3/unlock', { reason: 'test' });

  /* ── accruals ── */
  const acB = { ref: 'ELEC-9', kind: 'outstanding', class: 'electricity', amount_minor: 120000, date: '2026-09-30' };
  const ac = await q('POST', '/accruals', acB);
  const ace = entries('accrual:ELEC-9')[0];
  ok('POST /accruals → the accrual, with the day it turns back (the first day of the next month)', ac.status === 200 && ac.body.ok && ace && ac.body.reverses_on === '2026-10-01', JSON.stringify(ac.body));
  eq('…lines are the engine\'s accrual: Dr 6030 Electricity · Cr 2410 Outstanding expenses', ace && stored(ace), engine({ type: 'accrual', kind: 'outstanding', class: 'electricity', amount: 1200, date: '2026-09-30', currency: 'INR' }));
  ok('…keyed by a person: MJ', ace && seriesOf(ace) === 'MJ');
  ok('…a double tap posts once', (await q('POST', '/accruals', acB)).body.duplicate === true && X.T.entries.filter((x) => x.source_ref === 'accrual:ELEC-9').length === 1);
  const pre = await (async () => { DAY = '2026-09-30'; const r = await q('POST', '/accruals/ELEC-9/reverse', {}); DAY = '2027-04-10'; return r; })();
  ok('…its reversal is refused before the first day of the next month', pre.status === 422 && /not due yet/.test(pre.body.message) && !entries('accrual-rev:ELEC-9').length, JSON.stringify(pre.body));
  const rv = await q('POST', '/accruals/ELEC-9/reverse', {});
  const rve = entries('accrual-rev:ELEC-9')[0];
  ok('POST /accruals/:ref/reverse → on the first day of the next month', rv.status === 200 && rv.body.ok && rve && String(rve.posting_date).slice(0, 10) === '2026-10-01', JSON.stringify(rv.body));
  eq('…lines are the engine\'s reversal (every side swapped)', rve && stored(rve), engine({ type: 'accrual', kind: 'outstanding', class: 'electricity', amount: 1200, date: '2026-10-01', currency: 'INR', reverse: true, reverses: 'ELEC-9' }));
  ok('…the system turns it back: JV; and a double tap posts once', rve && seriesOf(rve) === 'JV' && (await q('POST', '/accruals/ELEC-9/reverse', {})).body.duplicate === true && X.T.entries.filter((x) => x.source_ref === 'accrual-rev:ELEC-9').length === 1);
  const pp = await q('POST', '/accruals', { ref: 'INS-1', kind: 'prepaid', class: 'rent', amount_minor: 600000, date: '2026-09-30' });
  const ppe = entries('accrual:INS-1')[0];
  eq('…a prepaid expense: Dr 1810 Prepaid · Cr the expense', ppe && stored(ppe), engine({ type: 'accrual', kind: 'prepaid', class: 'rent', amount: 6000, date: '2026-09-30', currency: 'INR' }));
  await q('POST', '/periods/2026-27/7/lock', { reason: 'x' });
  const n4 = X.T.entries.length;
  const acl = await q('POST', '/accruals', { ref: 'LATE-1', kind: 'outstanding', class: 'electricity', amount_minor: 100, date: '2026-10-31' });
  ok('an accrual in a locked month → 409 PERIOD_LOCKED, nothing posted', acl.status === 409 && acl.body.code === 'PERIOD_LOCKED' && X.T.entries.length === n4, JSON.stringify(acl.body));
  await q('POST', '/periods/2026-27/7/unlock', { reason: 'test' });

  /* ── contra ── */
  const ctB = { from: 'cash', to: 'bank', amount_minor: 500000, date: '2026-09-15', client_ref: 'dep-1' };
  const ct = await q('POST', '/contra', ctB);
  const cte = entries('contra:dep-1')[0];
  ok('POST /contra → cash into the bank', ct.status === 200 && ct.body.ok && cte, JSON.stringify(ct.body));
  eq('…lines are the engine\'s contra: Dr bank 5,000 · Cr cash', cte && stored(cte), engine({ type: 'contra', from: 'cash', to: 'bank', amount: 5000, date: '2026-09-15', currency: 'INR' }));
  ok('…keyed by a person: series MJ with the voucher type the engine gives {manual:true} — Contra', cte && seriesOf(cte) === 'MJ' && cte.voucher_type === 'Contra' && P.voucherTypeOf({ type: 'contra' }, { manual: true }).type === 'Contra', cte && cte.voucher_type);
  ok('…a double tap posts once', (await q('POST', '/contra', ctB)).body.duplicate === true && X.T.entries.filter((x) => x.source_ref === 'contra:dep-1').length === 1);
  const cs6 = await q('POST', '/contra', { from: 'bank', to: 'bank', amount_minor: 100, date: '2026-09-15' });
  ok('…the same account on both sides is the engine\'s refusal (422)', cs6.status === 422 && /different accounts/.test(cs6.body.message), JSON.stringify(cs6.body));
  await q('POST', '/periods/2026-27/6/lock', { reason: 'x' });
  const n5 = X.T.entries.length;
  const ctl = await q('POST', '/contra', { from: 'cash', to: 'upi', amount_minor: 100, date: '2026-09-16', client_ref: 'late' });
  ok('…in a locked month → 409 PERIOD_LOCKED, nothing posted', ctl.status === 409 && ctl.body.code === 'PERIOD_LOCKED' && X.T.entries.length === n5, JSON.stringify(ctl.body));
  await q('POST', '/periods/2026-27/6/unlock', { reason: 'test' });

  /* ═══ THE ASSET FLOW FROM A SUPPLIER BILL: Accept "asset" → PPE + a register row → depreciation → disposal (shop CUST) ═══ */
  console.log('\n── Accept "asset" on a supplier bill ──\n');
  const BU = require(path.join(H.API, 'lib', 'bill-use'));
  BU.catalogueOf = async () => ({ items: [], variantsOf: {} });
  const LAPTOP = { line_id: 'l1', particulars: 'Laptop', quantity: 1, unit: 'piece', price: 100, total: 100, gst_rate: 18 };
  const COPIES = {};
  const recips = [{ entity_id: SHOP, role: 'sender' }, { entity_id: SHOP, role: 'receiver' }, { entity_id: CUST, role: 'receiver' }];
  const bill = (id, use) => { COPIES[id] = { chit_id: id, sender_entity_id: SHOP, all_recipients: recips, purpose: 'invoice', current_status: 'accepted',
    business_json: Object.assign({ counter_bill: true, customer: { name: 'Chola Auto Care', identity_id: CUST, entity_id: CUST }, till: { id: 'C1' }, bill_no: 'B/' + id,
      billed_at: '2026-10-01T05:00:00.000Z', payment: { parts: [{ how: 'On credit', amount: 118 }] } }, { use }),
    summary_json: {}, sent_at: '2026-10-01T05:00:01.000Z', created_at: '2026-10-01T05:00:01.000Z', line_items: [LAPTOP], currency_code: 'INR' }; };
  TC.copyOf = async (chit_id) => COPIES[chit_id] || null;
  await X.store.saveSetting(X.db, CUST, { enabled: true }); await X.B.enable(X.db, CUST, { by: CUST, today: '2026-10-01' }); K.forget(CUST);
  X.T.parties.push({ owner: CUST, party_id: SHOP, name: 'Mayur Traders', supplier: true, credit_days: 15 });
  const ent = (src) => entries(src, CUST);
  const codeOf2 = (role) => (X.T.accounts.find((a) => a.entity_id === CUST && a.role === role) || {}).code;
  const regRows = () => reg.rows.filter((r) => r.entity === CUST);

  reg.migrated = false;
  bill('as0', { bill: 'asset', asset_class: 'computers', put_to_use: '2026-10-01' });
  const w0 = await K.afterChit(CUST, 'as0', CUST);
  const wo0 = X.T.outbox.filter((o) => o.entity_id === CUST && o.source_chit_id === 'as0' && !o.done_at)[0];
  ok('REGISTER MISSING (b280 not run): the Accept still queues, with the same plain reason, nothing posted',
    w0.queued && !ent('chit:as0').length && wo0 && wo0.why === 'An asset purchase needs the asset ledger — not posted yet (bill B/as0 from Mayur Traders).', JSON.stringify([w0, wo0 && wo0.why]));
  reg.migrated = true;
  bill('as1', { bill: 'asset' });
  const w1 = await K.afterChit(CUST, 'as1', CUST);
  ok('REGISTER THERE, no kind chosen: it waits and asks "Which kind of asset…"', w1.queued && /Which kind of asset is bill B\/as1/.test(w1.why) && !ent('chit:as1').length, JSON.stringify(w1));
  bill('as2', { bill: 'asset', asset_class: 'computers', put_to_use: '2026-10-01' });
  const w2 = await K.afterChit(CUST, 'as2', CUST);
  const ae = ent('chit:as2')[0];
  const lines2 = ae ? X.T.lines.filter((l) => l.entry_id === ae.entry_id).map((l) => [l.code, l.dr_minor, l.cr_minor]) : [];
  eq('ACCEPT AS ASSET: purchase_bill with accept asset — Dr 1060 Computers 100 · Dr input GST 9 + 9 · Cr Creditors 118',
    lines2, P.post({ type: 'purchase_bill', accept: 'asset', asset_class: 'computers', party: SHOP, date: '2026-10-01', currency: 'INR', by_rate: [{ rate: 18, taxable: 100, cgst: 9, sgst: 9, igst: 0 }], paid: {} }, { pack }).lines
      .map((l) => [l.code || codeOf2(l.account), l.dr_minor, l.cr_minor]));
  ok('…the cost went to the PPE ledger 1060, never to Purchases 5000', lines2.some((l) => l[0] === '1060' && l[1] === 10000) && !lines2.some((l) => l[0] === '5000'), JSON.stringify(lines2));
  ok('…and a register row was made: Laptop, computers, cost 100.00, put to use 2026-10-01, from this bill and this entry',
    regRows().length === 1 && regRows()[0].name === 'Laptop' && regRows()[0].asset_class === 'computers' && regRows()[0].cost_minor === 10000 && regRows()[0].put_to_use === '2026-10-01'
    && regRows()[0].source_chit_id === 'as2' && regRows()[0].source_entry_id === (ae && ae.entry_id), JSON.stringify([w2, regRows()]));
  const w3 = await K.afterChit(CUST, 'as2', CUST);
  ok('…accepted again (Intake and goods-in both fire): a duplicate; one entry, ONE register row', w3.duplicate === true && ent('chit:as2').length === 1 && regRows().length === 1, JSON.stringify(w3));

  WHO = OWNER2;
  const cd = await q('POST', '/depreciation/run', { fy: '2026-27' });
  const cwant = P.depreciationFor({ entity: 'proprietor', fiscal_year: '2026-27', date: '2027-03-31', assets: [{ id: 'x', class: 'computers', cost: 100, put_to_use: '2026-10-01' }], pack });
  const cde = ent('depreciation:2026-27')[0];
  const clines = cde ? X.T.lines.filter((l) => l.entry_id === cde.entry_id).map((l) => [l.code, l.dr_minor, l.cr_minor]) : [];
  ok('DEPRECIATION RUN from the register: ONE entry (JV) with the engine\'s figure — put to use 182 days before the year end, so the full 40% = 40.00',
    cd.status === 200 && cde && seriesOf(cde) === 'JV' && cwant.by_class[0].amount === 40 && cd.body.by_class[0].amount === 40 && regRows()[0].accumulated_minor === 4000, JSON.stringify([cd.body, regRows()[0]]));
  eq('…lines: Dr 6200 · Cr 1061', clines, P.post(cwant.event, { pack }).lines.map((l) => [l.code || codeOf2(l.account), l.dr_minor, l.cr_minor]));
  const cdsp = await q('POST', '/assets/' + regRows()[0].asset_id + '/dispose', { date: '2027-04-05', proceeds_minor: 5000, into: 'cash', client_ref: 'sell' });
  ok('DISPOSE: sold for 50.00 against a WDV of 60.00 — a loss of 10.00 posts (6210), the row is closed', cdsp.status === 200 && cdsp.body.ok && regRows()[0].disposed_on === '2027-04-05'
    && X.T.lines.filter((l) => l.entry_id === cdsp.body.entry_id).some((l) => l.code === codeOf2('loss_on_disposal') && l.dr_minor === 1000), JSON.stringify(cdsp.body).slice(0, 300));
  WHO = OWNER;

  /* ── the register's REAL SQL (b280), inspected: binds = placeholders, the shop is $1, a missing table is the one refusal ── */
  const seen = [], dbq = { query: async (text, params) => { const ph = (text.match(/\$(\d+)/g) || []).map((s) => Number(s.slice(1))); seen.push({ n: (params || []).length, max: ph.length ? Math.max.apply(null, ph) : 0, first: (params || [])[0] }); return { rows: [] }; } };
  await Assets.sql.exists(dbq, SHOP); await Assets.sql.list(dbq, SHOP); await Assets.sql.get(dbq, SHOP, ID1); await Assets.sql.bySourceEntry(dbq, SHOP, ID1, 'x');
  await Assets.sql.insert(dbq, SHOP, { name: 'x', asset_class: 'computers', cost_minor: 1, put_to_use: '2026-04-01' }); await Assets.sql.addDepreciation(dbq, SHOP, ID1, 1, '2026-27'); await Assets.sql.markDisposed(dbq, SHOP, ID1, '2027-04-05', ID1, 0);
  ok('the register SQL: ' + seen.length + ' statements, binds match placeholders, the shop is $1 in each', seen.length === 7 && seen.every((s) => s.n === s.max && s.first === SHOP), JSON.stringify(seen));
  Assets.use(null);
  const gone = await Assets.exists({ query: async () => { const e = new Error('relation "fixed_asset" does not exist'); e.code = '42P01'; throw e; } }, SHOP);
  let refused = null; try { await Assets.list({ query: async () => { const e = new Error('no table'); e.code = '42P01'; throw e; } }, SHOP); } catch (e) { refused = e; }
  ok('…a missing table: exists() says false, any other call is BOOKS_NOT_MIGRATED', gone === false && refused && refused.code === 'BOOKS_NOT_MIGRATED');
  Assets.use(reg.store);

  srv.close();
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
