/**
 * books-close-country.test.cjs — W2-BOOKS (2026-10-15): POST /api/books/gst/close and /gst/pay are COUNTRY-FIRST — an Australian shop closes and pays its
 * BAS period, a UAE shop its VAT201 period, through real Express over the in-memory ledger (no database). India is proved unchanged by books-rcm.test.cjs.
 *
 * Proves: the period is the RETURN's (the same ids GET /returns answers; a month number is refused with the list) · a period not yet ended is refused with
 * PERIOD_NOT_ENDED · the set-off is the pack's (gst_paid against gst_collected; Input VAT against Output VAT) and posts Dr output · Cr input · the answer carries
 * the pack's heads and words (ref_label — never "challan" for AU/AE) · the payment needs the pack's reference (its own question), refuses more than owed, posts
 * Dr output · Cr bank under the pack's narration, and replays as the same entry · a second close is the same entry (duplicate) · AE with reverse charge owed and
 * recoverable > due is refused RCM_NETTING_NOT_BUILT (never India's cash figure) · a co-assist is refused.
 * Needs the books engines (the sibling ../chitbridge-engines/src at v1.48.1+, or BOOKS_ENGINES_SRC). Run: node tests/books-close-country.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const AU = 'aaaaaaaa-2222-4111-8111-111111111111', AE = 'eeeeeeee-2222-4111-8111-111111111111', SUPP = '33333333-3333-4333-8333-333333333333';
const owner = (id, name) => ({ identity_id: id, identity_type: 'entity', display_name: name });
const STAFF = { identity_id: '44444444-4444-4444-8444-444444444444', parent_entity_id: AU, identity_type: 'actor' };
let WHO = owner(AU, 'Bondi Grocer');
const authStub = Object.assign((req, res, next) => { req.identity = WHO; next(); }, {
  entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id,
  requireScope: () => (req, res, next) => next(),
});
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});

(async () => {
  console.log('\n══ POST /api/books/gst/close · /gst/pay — the BAS period (AU) and the VAT201 period (AE), closed and paid in the app ══\n');
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  const IDS = {
    [AU]: { identity_id: AU, gstn: null, display_name: 'Bondi Grocer', country: 'AU', policy_flags: {} },
    [AE]: { identity_id: AE, gstn: null, display_name: 'Deira Stores', country: 'AE', policy_flags: {} },
  };
  const q0 = X.dbStub.query;
  X.dbStub.query = async (t, p) => /FROM identities WHERE identity_id = ANY/.test(String(t)) ? { rows: p[0].map((id) => IDS[id]).filter(Boolean) } : q0(t, p);
  for (const m of ['tax-copy', 'bill-use']) delete require.cache[require.resolve(path.join(H.API, 'lib', m))];
  require.cache[require.resolve(path.join(H.API, 'lib', 'storage-object'))] = { exports: { available: async () => false } };
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);
  let DAY = '2026-10-20'; const realDay = K.dayOf;
  K.dayOf = (ts, c) => (ts instanceof Date && Math.abs(ts.getTime() - Date.now()) < 5000 ? DAY : realDay(ts, c));   /* only "now" moves */

  const codeOfRole = (shop, role) => (X.T.accounts.find((a) => a.entity_id === shop && a.role === role) || {}).code;
  const linesOf = (shop, entry_id) => X.T.lines.filter((l) => l.entity_id === shop && l.entry_id === entry_id).map((l) => [l.code, Number(l.dr_minor), Number(l.cr_minor)]);
  const entryOf = (shop, entry_id) => X.T.entries.find((x) => x.entity_id === shop && x.entry_id === entry_id) || {};
  const day = (shop, cur, date, taxable, tax, head, ref) => X.B.postEntry(X.db, shop, { type: 'walkin_day', ref, date, currency: cur, modes: { cash: taxable + tax }, by_rate: [Object.assign({ rate: cur === 'AUD' ? 10 : 5, taxable }, { [head]: tax })] });
  const buy = (shop, cur, date, taxable, tax, head, ref, rcm) => X.B.postEntry(X.db, shop, Object.assign({ type: 'purchase_bill', ref, date, currency: cur, party: SUPP, by_rate: [Object.assign({ rate: cur === 'AUD' ? 10 : 5, taxable }, { [head]: tax })], paid: 0 }, rcm ? { rcm } : {}));

  /* ── an Australian shop: Q1 (Jul–Sep 2026) sells 1,000 + GST 100 and buys 300 + GST 30 → 70.00 payable at 9 ── */
  await X.store.saveSetting(X.db, AU, { enabled: false, country: 'AU' });
  const en = await q('POST', '/enable', {});
  ok('AU: the ledger is on under the AU pack (2200 GST collected · GST paid)', en.status === 200 && codeOfRole(AU, 'gst_collected') === '2200' && !!codeOfRole(AU, 'gst_paid'), JSON.stringify(en.body));
  X.T.parties.push({ owner: AU, party_id: SUPP, party_no: 'P-00001', name: 'Metcash', supplier: true, credit_days: 30 });
  await day(AU, 'AUD', '2026-07-10', 1000, 100, 'gst', 'D1');
  await buy(AU, 'AUD', '2026-08-06', 300, 30, 'gst', 'P1');

  let r = await q('POST', '/gst/close', { fy: '2026-27', period: 2 });
  ok('a MONTH number is not how a BAS shop closes: 400 asking which BAS period, naming the pack\'s own ids', r.status === 400 && /Which BAS period\? One of .*\(2026-Q1\)/.test(r.body.message), JSON.stringify(r.body));
  r = await q('POST', '/gst/close', { period: '2026-Q2' });
  ok('a period that has not ended (Q2, Oct–Dec) is refused with PERIOD_NOT_ENDED and the day it ends', r.status === 422 && r.body.code === 'PERIOD_NOT_ENDED' && /2026-12-31/.test(r.body.message), JSON.stringify(r.body));
  r = await q('POST', '/gst/close', { period: '2026-Q1', client_ref: 'c1' });
  ok('Q1 closes: 200, the pack\'s set-off — GST paid 30.00 against GST collected 100.00; 70.00 payable, nothing carried', r.status === 200 && r.body.ok === true && r.body.entry_no, JSON.stringify(r.body));
  eq('…the answer: utilised · payable_minor {gst} · carried_minor {gst} · pay_total · form · heads · the return period · the pack\'s words (no "challan")',
    [r.body.utilised, r.body.payable_minor, r.body.carried_minor, r.body.pay_total_minor, r.body.form, r.body.heads, r.body.return_period && r.body.return_period.period, r.body.ref_label, r.body.period, r.body.date],
    [[{ from: 'gst', against: 'gst', amount_minor: 3000 }], { gst_minor: 7000 }, { gst_minor: 0 }, 7000, 'BAS', ['gst'], '2026-Q1', 'Payment reference number', '2026-Q1', '2026-09-30']);
  ok('…no India word anywhere in the answer', !/challan|cpin|cgst/i.test(JSON.stringify(r.body)), JSON.stringify(r.body));
  const closeId = r.body.entry_id;
  eq('…the entry: Dr 2200 GST collected 30.00 · Cr GST paid 30.00, dated the quarter end, narrated as the pack says', [linesOf(AU, closeId), String(entryOf(AU, closeId).posting_date).slice(0, 10), entryOf(AU, closeId).narration],
    [[['2200', 3000, 0], [codeOfRole(AU, 'gst_paid'), 0, 3000]], '2026-09-30', 'GST set-off 2026-27 Q1 (Jul–Sep 2026)']);
  const again = await q('POST', '/gst/close', { period: '2026-Q1', client_ref: 'c2' });
  ok('closing Q1 again is the SAME entry (duplicate: true), with the figures', again.status === 200 && again.body.duplicate === true && again.body.entry_id === closeId && again.body.pay_total_minor === 7000, JSON.stringify(again.body));

  r = await q('POST', '/gst/pay', { period: '2026-Q1', amounts: { gst_minor: 7000 }, bank: 'bank' });
  ok('a payment without the reference: 400 with the PACK\'s question (the ATO payment reference number)', r.status === 400 && /ATO payment reference number/.test(r.body.message) && !/challan/i.test(r.body.message), JSON.stringify(r.body));
  r = await q('POST', '/gst/pay', { period: '2026-Q1', amounts: { gst_minor: 700000 }, bank: 'bank', payment_ref: 'PRN-551234' });
  ok('more than the tax owed is refused in words (GST owed 70, paid 7000)', r.status === 422 && /more than the tax owed/.test(r.body.message) && /GST owed 70/.test(r.body.message), JSON.stringify(r.body));
  r = await q('POST', '/gst/pay', { period: '2026-Q1', amounts: { gst_minor: 7000 }, bank: 'bank', payment_ref: 'PRN-551234', date: '2026-10-15' });
  ok('the payment posts: 200 · payment_ref · paid_minor {gst: 7000} · an entry number', r.status === 200 && r.body.ok === true && r.body.payment_ref === 'PRN-551234' && r.body.paid_minor.gst === 7000 && r.body.entry_no, JSON.stringify(r.body));
  ok('…and names no challan (payment_ref is the one key for a BAS shop)', !('challan_no' in r.body), JSON.stringify(r.body));
  const payId = r.body.entry_id;
  eq('…the entry: Dr 2200 GST collected 70.00 · Cr the bank 70.00, narrated "BAS payment <ref>"', [linesOf(AU, payId), entryOf(AU, payId).narration],
    [[['2200', 7000, 0], [codeOfRole(AU, 'bank'), 0, 7000]], 'BAS payment PRN-551234']);
  const replay = await q('POST', '/gst/pay', { period: '2026-Q1', amounts: { gst_minor: 7000 }, bank: 'bank', payment_ref: 'PRN-551234', date: '2026-10-15' });
  ok('the same reference again is the same entry — never paid twice', replay.status === 200 && replay.body.entry_id === payId && replay.body.duplicate === true, JSON.stringify(replay.body));
  r = await q('GET', '/returns?period=2026-Q1');
  eq('the BAS itself still reads the quarter\'s movements: 1A 100.00 · 1B 30.00 · 9 = 70.00 (the close and the payment are after the quarter, and the set-off is not a sale)', [(r.body.boxes.find((b) => b.code === '1A') || {}).amount_minor, (r.body.boxes.find((b) => b.code === '1B') || {}).amount_minor, (r.body.boxes.find((b) => b.code === '9') || {}).amount_minor], [10000, 3000, 7000]);
  WHO = STAFF; r = await q('POST', '/gst/close', { period: '2026-Q1' }); WHO = owner(AU, 'Bondi Grocer');
  ok('OWNER ONLY: a co-assist is refused (403)', r.status === 403, String(r.status));

  /* ── a UAE shop, stagger 1 (Feb–Apr): sells 1,000 + VAT 50, buys 200 + VAT 10, and imports a service 400 under reverse charge (VAT 20, credit allowed) ── */
  WHO = owner(AE, 'Deira Stores'); DAY = '2026-06-10';
  await X.store.saveSetting(X.db, AE, { enabled: false, country: 'AE' });
  const en2 = await q('POST', '/enable', {});
  ok('AE: the ledger is on under the AE pack (2200 Output VAT · Input VAT · VAT due under reverse charge)', en2.status === 200 && codeOfRole(AE, 'output_vat') === '2200' && !!codeOfRole(AE, 'rcm_vat'), JSON.stringify(en2.body));
  X.T.parties.push({ owner: AE, party_id: SUPP, party_no: 'P-00001', name: 'Al Maya', supplier: true, credit_days: 30 });
  await day(AE, 'AED', '2026-03-01', 1000, 50, 'vat', 'D1');
  await buy(AE, 'AED', '2026-03-09', 200, 10, 'vat', 'P1');
  await buy(AE, 'AED', '2026-04-02', 400, 0, 'vat', 'P2', [{ rate: 5, itc: true, taxable: 400, vat: 20 }]);
  r = await q('POST', '/gst/close', { period: '2026-02/2026-04' });
  ok('without the FTA stagger: 400 with the pack\'s sentence — the Tax Period is never guessed', r.status === 400 && /FTA assigns the Tax Period/.test(r.body.message), JSON.stringify(r.body));
  r = await q('POST', '/gst/close', { period: '2026-02/2026-04', stagger: 1, client_ref: 'ae1' });
  ok('Feb–Apr closes: Input VAT 30.00 (10 + the 20 recovered on the import) against Output VAT 50.00 → 20.00 payable; the reverse-charge 20.00 beside it in cash — 40.00 in all, the form\'s Box 14',
    r.status === 200 && r.body.form === 'VAT201' && r.body.payable_minor.vat_minor === 2000 && r.body.rcm_minor.vat === 2000 && r.body.cash_minor.vat === 4000 && r.body.pay_total_minor === 4000, JSON.stringify(r.body));
  eq('…heads · words · the period · carried word (the pack\'s)', [r.body.heads, r.body.ref_label, r.body.return_period.period, r.body.carried_word], [['vat'], 'Payment reference', '2026-02/2026-04', 'VAT recoverable from the FTA']);
  const aeClose = r.body.entry_id;
  eq('…the entry: Dr 2200 Output VAT 30.00 · Cr Input VAT 30.00 — "VAT set-off" + the period', [linesOf(AE, aeClose), entryOf(AE, aeClose).narration], [[['2200', 3000, 0], [codeOfRole(AE, 'input_vat'), 0, 3000]], 'VAT set-off Feb–Apr 2026']);
  r = await q('POST', '/gst/pay', { period: '2026-02/2026-04', stagger: 1, amounts: { vat_minor: 2000 }, rcm: { vat_minor: 2000 }, bank: 'bank', payment_ref: 'GIBAN-77', date: '2026-05-20' });
  ok('the VAT payment posts: due 20.00 + reverse charge 20.00 → Dr Output VAT · Dr VAT due under reverse charge · Cr bank 40.00, "VAT payment GIBAN-77"',
    r.status === 200 && r.body.paid_minor.vat === 2000 && r.body.rcm_paid_minor.vat === 2000 && JSON.stringify(linesOf(AE, r.body.entry_id)) === JSON.stringify([['2200', 2000, 0], [codeOfRole(AE, 'rcm_vat'), 2000, 0], [codeOfRole(AE, 'bank'), 0, 4000]]) && entryOf(AE, r.body.entry_id).narration === 'VAT payment GIBAN-77',
    JSON.stringify(r.body) + ' ' + JSON.stringify(linesOf(AE, r.body.entry_id)));

  /* the one edge the engine cannot post yet: reverse charge owed AND recoverable > due (May–Jul: a big purchase, a small sale, an import) */
  await day(AE, 'AED', '2026-05-05', 100, 5, 'vat', 'D2');
  await buy(AE, 'AED', '2026-05-12', 2000, 100, 'vat', 'P3');
  await buy(AE, 'AED', '2026-06-02', 400, 0, 'vat', 'P4', [{ rate: 5, itc: true, taxable: 400, vat: 20 }]);
  DAY = '2026-08-10';
  r = await q('POST', '/gst/close', { period: '2026-05/2026-07', stagger: 1 });
  ok('May–Jul: reverse charge owed (20) and recoverable (120) above due (5) → 422 RCM_NETTING_NOT_BUILT in words — never India\'s cash figure; nothing posted',
    r.status === 422 && r.body.code === 'RCM_NETTING_NOT_BUILT' && /nets them on the form/.test(r.body.message) && !X.T.entries.some((x) => x.entity_id === AE && x.source_ref === 'gstclose:VAT201:2026-05/2026-07'), JSON.stringify(r.body));

  srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
