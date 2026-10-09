/**
 * tests/support/contract-books.cjs — the CB Accounts routes the web reads, called THROUGH REAL EXPRESS over the in-memory books (the same rig the
 * books-* tests use), each answer kept under the key "METHOD /api/books/<route pattern>". Used by tests/web-api-contract.test.cjs, which holds each
 * answer to docs/contracts/web-api.json. Needs the books engines (../chitbridge-engines/src); returns null when they are not there.
 *
 * The scenario is the books-period / books-todo / books-recurring tests' own: a shop with the ledger on, a customer and a supplier, a September sale and
 * purchase, an asset, depreciation, closing stock, a GST close and challan, an accrual and its reversal, a repeating entry, and a closed year.
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./books-harness.cjs');

const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222', SUPP = '33333333-3333-4333-8333-333333333333';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur Bhavan' };
const authStub = Object.assign((req, res, next) => { req.identity = OWNER; next(); }, {
  entityOf: (req) => req.identity.identity_id,
  requireScope: () => (req, res, next) => next(),
});
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});
const clone = (x) => JSON.parse(JSON.stringify(x));
/** an in-memory asset register with the real module's store functions (b280 stood in) */
function memoryRegister() {
  const rows = []; let seq = 0;
  return { async exists() { return true; }, async list(h, e) { return clone(rows.filter((r) => r.entity === e)); }, async get(h, e, id) { const r = rows.find((x) => x.entity === e && x.asset_id === id); return r ? clone(r) : null; },
    async bySourceEntry(h, e, entry, name) { const r = rows.find((x) => x.entity === e && x.source_entry_id === entry && x.name === name); return r ? clone(r) : null; },
    async insert(h, e, a) {
      const r = { entity: e, asset_id: '55555555-5555-4555-8555-' + String(++seq).padStart(12, '0'), name: a.name, asset_class: a.asset_class, cost_minor: a.cost_minor, currency: a.currency || 'INR',
        put_to_use: a.put_to_use, source_entry_id: a.source_entry_id || null, source_chit_id: a.source_chit_id || null, accumulated_minor: 0, last_dep_fy: null, disposed_on: null,
        disposal_entry_id: null, proceeds_minor: null, created_by: a.by || null };
      rows.push(r); return clone(r);
    },
    async addDepreciation(h, e, id, minor, fy) { const r = rows.find((x) => x.entity === e && x.asset_id === id); if (r && r.last_dep_fy !== fy) { r.accumulated_minor += minor; r.last_dep_fy = fy; } },
    async markDisposed(h, e, id, on, entry, proceeds) { const r = rows.find((x) => x.entity === e && x.asset_id === id && !x.disposed_on); if (!r) return false; Object.assign(r, { disposed_on: on, disposal_entry_id: entry, proceeds_minor: proceeds }); return true; } };
}
/** an in-memory template table with the real module's store functions (b281 stood in) */
function memoryTemplates() {
  const rows = []; let seq = 0;
  return { async exists() { return true; }, async list(h, e) { return clone(rows.filter((r) => r.entity === e)); },
    async get(h, e, id) { const r = rows.find((x) => x.entity === e && x.recurring_id === id); return r ? clone(r) : null; },
    async insert(h, e, t) { const r = { entity: e, recurring_id: '66666666-6666-4666-8666-' + String(++seq).padStart(12, '0'), name: t.name, event: clone(t.event), frequency: t.frequency, next_on: t.next_on,
      anchor_day: t.anchor_day, end_on: t.end_on || null, auto: !!t.auto, active: t.active !== false, last_done_on: null, created_by: t.created_by || null }; rows.push(r); return clone(r); },
    async update(h, e, id, p) { const r = rows.find((x) => x.entity === e && x.recurring_id === id); if (!r) return null; Object.assign(r, clone(p)); return clone(r); } };
}

async function captureBooks() {
  const X = H.load({ auth: authStub });
  if (!X.src.dir) return { skipped: X.src.why };
  const IDS = { [SHOP]: { identity_id: SHOP, gstn: '33AAAAA0000A1Z5', display_name: 'Mayur Traders', country: 'IN', policy_flags: { price_includes_tax: 'no' } } };
  const q0 = X.dbStub.query;
  X.dbStub.query = async (t, p) => /FROM identities WHERE identity_id = ANY/.test(String(t)) ? { rows: p[0].map((id) => IDS[id]).filter(Boolean) } : q0(t, p);
  for (const m of ['tax-copy', 'bill-use']) delete require.cache[require.resolve(path.join(H.API, 'lib', m))];
  require.cache[require.resolve(path.join(H.API, 'lib', 'storage-object'))] = { exports: { available: async () => false } };
  const TC = require(path.join(H.API, 'lib', 'tax-copy')); TC.ledgerFor = async () => { throw new Error('no chits in this test'); };
  const Assets = require(path.join(H.API, 'lib', 'books-assets')); Assets.use(memoryRegister());
  const R = require(path.join(H.API, 'lib', 'books-recurring')); R.use(memoryTemplates());
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  let DAY = '2027-04-10'; const realDay = K.dayOf;
  K.dayOf = (ts, c) => (ts instanceof Date && Math.abs(ts.getTime() - Date.now()) < 5000 ? DAY : realDay(ts, c));
  const got = {};
  /** call the route; keep the answer under its route pattern - answers with the same status are MERGED into one example (a refusal beside a success),
   *  an answer with another status gets its own entry ("#409") */
  const q = async (m, p, b, key) => {
    const r = await call(port, m, '/api/books' + p, b);
    if (key) { let k = m + ' /api/books' + key; if (got[k] && got[k].status !== r.status) k += ' #' + r.status; got[k] = got[k] || { status: r.status, bodies: [] }; got[k].bodies.push(r.body); }
    return r;
  };
  try {
    await X.store.saveSetting(X.db, SHOP, { enabled: false });
    await q('POST', '/enable', {}, '/enable');
    /* M30: the supplier is ON the rail (the advice can be sent — the richest shape); the customer is off it (share) */
    X.T.parties.push({ owner: SHOP, party_id: CUST, party_no: 'P-00001', name: 'Ravi Stores', nickname: 'Ravi', customer: true, credit_days: 10 },
      { owner: SHOP, party_id: SUPP, party_no: 'P-00002', name: 'Kumar Traders', supplier: true, credit_days: 30, on_rail: true });
    await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-09-05', currency: 'INR', party: CUST, source_chit_id: 'c0000000-0000-4000-8000-00000000000a', source_ref: 'chit:a',
      by_rate: [{ rate: 18, taxable: 1000, cgst: 90, sgst: 90, igst: 0 }], paid: {}, round_off: 0 });
    await X.B.postEntry(X.db, SHOP, { type: 'purchase_bill', date: '2026-09-06', currency: 'INR', party: SUPP, source_chit_id: 'c0000000-0000-4000-8000-00000000000b', source_ref: 'chit:b',
      by_rate: [{ rate: 18, taxable: 500, cgst: 45, sgst: 45, igst: 0 }], paid: {}, round_off: 0 });

    /* ── the To-do on a day when every kind of thing is waiting (the books-todo test's own day): a supplier bill to accept, months open, no closing stock,
          GST to pay, a repeating entry due, an accrual to turn back ── */
    DAY = '2026-11-05';
    await X.store.queue(X.db, SHOP, { source_chit_id: null, source_ref: 'chit:bill1', event: { job: 'chit', chit_id: 'bill1', waiting: 'acceptance' }, why: 'Waiting for you to confirm the goods (bill 7 from Kumar Traders)' });
    await q('GET', '/health', null, '/health');      /* …now with a post waiting for the owner */
    await q('POST', '/accruals', { ref: 'ELEC-8', kind: 'outstanding', class: 'electricity', amount_minor: 120000, date: '2026-09-30', client_ref: 'acc-early' }, '/accruals');
    await q('POST', '/recurring', { name: 'Early rent', event: { kind: 'expense', class: 'rent', amount_minor: 500000, paid_from: 'bank' }, frequency: 'monthly', next_on: '2026-11-01' }, '/recurring');
    await q('GET', '/todo', null, '/todo');
    DAY = '2027-04-10';

    /* ── the entry builder: the grid, a preview, a save, a reversal ── */
    await q('GET', '/health', null, '/health');
    await q('GET', '/accounts', null, '/accounts');
    await q('GET', '/events', null, '/events');
    const evB = { event: 'expense', class: 'rent', amount_minor: 500000, paid_from: 'bank', date: '2026-10-02' };
    await q('POST', '/preview', evB, '/preview');
    await q('POST', '/preview', { event: 'nothing' }, '/preview');
    const ev = await q('POST', '/events', Object.assign({ client_ref: 'contract-1' }, evB), '/events');
    if (ev.body && ev.body.entry_id) await q('POST', '/entries/' + ev.body.entry_id + '/reverse', { client_ref: 'contract-rev', reason: 'Posted by mistake' }, '/entries/:id/reverse');

    /* ── the books' reads ── */
    await q('GET', '/daybook?from=2026-09-01&to=2026-10-31', null, '/daybook');
    await q('GET', '/ledger/1300?from=2026-04-01&to=2027-03-31', null, '/ledger/:account');
    await q('GET', '/ledger/bank?from=2026-04-01&to=2027-03-31', null, '/ledger/:account');
    await q('GET', '/dues', null, '/dues');
    await q('GET', '/trial-balance?asOf=2027-03-31', null, '/trial-balance');
    await q('GET', '/pl?from=2026-04-01&to=2027-03-31', null, '/pl');
    await q('GET', '/bs?asOf=2027-03-31', null, '/bs');
    await q('GET', '/party/' + CUST + '/statement', null, '/party/:id/statement');
    await q('GET', '/periods', null, '/periods');

    /* ── the period end ── */
    await q('POST', '/closing-stock', { date: '2026-09-30', value_minor: 5000000, method: 'manual', client_ref: 'cs-sep' }, '/closing-stock');
    await q('GET', '/ledger/stock?from=2026-04-01&to=2027-03-31', null, '/ledger/:account');
    await q('POST', '/assets', { name: 'Laptop', class: 'computers', cost_minor: 4200000, date: '2026-04-18', how: 'bank', client_ref: 'lap-1' }, '/assets');
    await q('GET', '/assets?asOf=2026-09-30', null, '/assets');
    await q('POST', '/depreciation/run', { fy: '2025-26' }, '/depreciation/run');
    await q('POST', '/depreciation/run', { fy: '2026-27', client_ref: 'dep-27' }, '/depreciation/run');
    const asset = ((await call(port, 'GET', '/api/books/assets?asOf=2027-03-31')).body.assets || [])[0];
    if (asset) await q('POST', '/assets/' + asset.asset_id + '/dispose', { date: '2027-04-05', proceeds_minor: 2000000, into: 'bank', client_ref: 'sell-1' }, '/assets/:id/dispose');
    await q('POST', '/gst/close', { fy: '2026-27', period: 6, client_ref: 'gc-6' }, '/gst/close');
    await q('POST', '/gst/pay', { fy: '2026-27', period: 6, amounts: { cgst_minor: 4500, sgst_minor: 4500 }, bank: 'bank', challan_no: 'CPIN24100001', date: '2026-10-02' }, '/gst/pay');
    /* the same taps again: each answers the first entry with duplicate: true */
    await q('POST', '/gst/close', { fy: '2026-27', period: 6, client_ref: 'gc-6' }, '/gst/close');
    await q('POST', '/depreciation/run', { fy: '2026-27', client_ref: 'dep-27' }, '/depreciation/run');
    await q('POST', '/closing-stock', { date: '2026-09-30', value_minor: 5000000, method: 'manual', client_ref: 'cs-sep' }, '/closing-stock');
    await q('POST', '/assets', { name: 'Laptop', class: 'computers', cost_minor: 4200000, date: '2026-04-18', how: 'bank', client_ref: 'lap-1' }, '/assets');
    /* a month with a purchase under REVERSE CHARGE: the close answers rcm_minor and cash_minor too, and the challan takes the RCM amounts */
    const rcmPost = await X.B.postEntry(X.db, SHOP, { type: 'purchase_bill', date: '2026-10-10', currency: 'INR', party: SUPP, source_chit_id: 'c0000000-0000-4000-8000-0000000000aa', source_ref: 'chit:rcm1',
      by_rate: [{ rate: 0, taxable: 10000, cgst: 0, sgst: 0, igst: 0 }], rcm: [{ rate: 5, itc: false, taxable: 10000, cgst: 250, sgst: 250, igst: 0 }], paid: {} });
    if (!rcmPost.ok) throw new Error('the reverse-charge purchase did not post: ' + JSON.stringify(rcmPost));
    await q('POST', '/gst/close', { fy: '2026-27', period: 7, client_ref: 'gc-7' }, '/gst/close');
    await q('POST', '/gst/pay', { fy: '2026-27', period: 7, amounts: {}, rcm: { cgst_minor: 25000, sgst_minor: 25000 }, bank: 'bank', challan_no: 'CPIN-RCM', date: '2026-11-02' }, '/gst/pay');
    await q('POST', '/accruals', { ref: 'ELEC-9', kind: 'outstanding', class: 'electricity', amount_minor: 120000, date: '2026-09-30' }, '/accruals');
    await q('POST', '/accruals/ELEC-9/reverse', {}, '/accruals/:ref/reverse');

    /* ── M26 payments: preview, one-call record, then more than Ravi owes (W2 excess → 409 ALREADY_PAID; W2 needs no clock) ── */
    const PAY = { party_id: SUPP, direction: 'out', amount_minor: 20000, currency: 'INR', mode: 'bank', received_at: '2026-10-12', allocate: 'oldest_first' };
    await q('POST', '/payments/preview', { party_id: SUPP, direction: 'out', amount_minor: 20000, currency: 'INR', allocate: 'oldest_first' }, '/payments/preview');
    const p1 = await q('POST', '/payments', Object.assign({ client_ref: 'pay-1' }, PAY), '/payments');
    const p2 = await q('POST', '/payments', { party_id: CUST, direction: 'in', amount_minor: 500000, currency: 'INR', mode: 'cash', received_at: '2026-10-12', allocate: 'oldest_first', client_ref: 'pay-2' }, '/payments');
    /* ── M30 advice OUT: the read (on rail → the chit body; off rail → share), PATCH advice_chit_id (200 · the same again 200 · a different one 409), PATCH advice_shared_at ── */
    const pid1 = p1.body && p1.body.payment && p1.body.payment.payment_id, pid2 = p2.body && p2.body.payment && p2.body.payment.payment_id;
    const p3 = await q('POST', '/payments', { party_id: CUST, direction: 'in', amount_minor: 1000, currency: 'INR', mode: 'cash', received_at: '2026-10-12', allocate: 'none', client_ref: 'pay-3', acknowledge: ['nothing_owed', 'excess', 'same_again', 'just_settled'] }, '/payments');   /* M30: an off-rail record, so the contract lists both may shapes */
    const pid3 = p3.body && p3.body.payment && p3.body.payment.payment_id;
    if (pid1 && pid3) {
      await q('GET', '/payments/' + pid1 + '/advice', null, '/payments/:id/advice');
      await q('GET', '/payments/' + pid3 + '/advice', null, '/payments/:id/advice');
      await q('PATCH', '/payments/' + pid1, { advice_chit_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, '/payments/:id');
      X.T.chits.push({ chit_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', entity_id: SHOP, purpose: 'general', status: 'delivered', business_json: { kind: 'payment_advice' } });
      await q('PATCH', '/payments/' + pid1, { advice_chit_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2' }, '/payments/:id');
      await q('PATCH', '/payments/' + pid3, { advice_shared_at: true }, '/payments/:id');
      await q('GET', '/payments/' + pid1 + '/advice', null, '/payments/:id/advice');
    }
    /* ── M29 reverse from the row: the statement's payment line (entry_id · payment_id · advice state), the reversal that reopens the bill, the line after, a second Reverse → 409 ── */
    const st = await q('GET', '/party/' + SUPP + '/statement?from=2026-04-01&to=2027-03-31', null, '/party/:id/statement');
    const payLine = ((st.body && st.body.lines) || []).find((l) => l.payment_id);
    if (payLine) {
      await q('POST', '/entries/' + payLine.entry_id + '/reverse', { reason: 'Paid twice' }, '/entries/:id/reverse');
      await q('GET', '/party/' + SUPP + '/statement?from=2026-04-01&to=2027-03-31', null, '/party/:id/statement');
      await q('POST', '/entries/' + payLine.entry_id + '/reverse', { reason: 'Paid twice' }, '/entries/:id/reverse');
    }

    /* ── repeating entries ── */
    const rec = await q('POST', '/recurring', { name: 'Shop rent', event: { kind: 'expense', class: 'rent', amount_minor: 500000, paid_from: 'bank' }, frequency: 'monthly', next_on: '2027-04-01' }, '/recurring');
    const rid = rec.body && rec.body.recurring_id;
    await q('GET', '/recurring', null, '/recurring');
    await q('PATCH', '/recurring/' + rid, { auto: true }, '/recurring/:id');
    await q('GET', '/todo', null, '/todo');
    await q('POST', '/recurring/' + rid + '/post', {}, '/recurring/:id/post');
    const rec2 = await q('POST', '/recurring', { name: 'Insurance', event: { kind: 'expense', class: 'insurance', amount_minor: 90000, paid_from: 'bank' }, frequency: 'yearly', next_on: '2027-04-01' });
    await q('POST', '/recurring/' + rec2.body.recurring_id + '/skip', {}, '/recurring/:id/skip');
    await q('DELETE', '/recurring/' + rec2.body.recurring_id, null, '/recurring/:id');

    /* ── the year: first refused (months still open), then closed ── */
    await q('GET', '/year/2026-27/status', null, '/year/:fy/status');
    await q('POST', '/year/2026-27/close', {}, '/year/:fy/close');
    for (let p = 1; p <= 12; p++) await q('POST', '/periods/2026-27/' + p + '/lock', { reason: 'done' }, p === 1 ? '/periods/:fy/:p/lock' : null);
    await q('POST', '/closing-stock', { date: '2026-10-31', value_minor: 100, method: 'manual', client_ref: 'cs-locked' }, '/closing-stock');
    await q('POST', '/payments', { party_id: SUPP, direction: 'out', amount_minor: 1000, currency: 'INR', mode: 'cash', received_at: '2026-10-20', allocate: 'none',
      client_ref: 'pay-locked', acknowledge: ['nothing_owed', 'excess', 'same_again', 'just_settled'] }, '/payments #locked');
    await q('GET', '/year/2026-27/status', null, '/year/:fy/status');
    await q('GET', '/todo', null, '/todo');
    await q('POST', '/year/2026-27/close', {}, '/year/:fy/close');
    await q('POST', '/year/2026-27/close', {}, '/year/:fy/close');
  } finally { srv.close(); }
  return got;
}
module.exports = { captureBooks };
