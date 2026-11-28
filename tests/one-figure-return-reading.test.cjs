/**
 * one-figure-return-reading.test.cjs — ONE-FIGURE RC1 (Athi 28 Nov 2026, batch 1141): the BAS / VAT201 box, its per-ledger drill and the Ledger page read the SAME ledger the SAME way.
 * The return leaves out the period's own set-off and tax-payment entries (books-period-taxed.settledOf); GET /ledger/:account?reading=return says so as ONE labelled line, so
 * ledger movement - that line = the box's figure for the ledger. Two carried totals compared (the ledger's, the return's), AU (BAS 1A/1B) and AE (VAT201 box 1/13); a mutation must go red.
 * Run: node tests/one-figure-return-reading.test.cjs
 * OWNER cb-accounting · CALLS lib/books-period-taxed.returnReading · routes/books.js GET /ledger/:account
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const AU = 'aaaaaaaa-1111-4111-8111-111111111111', AE = 'eeeeeeee-1111-4111-8111-111111111111', SUPP = '33333333-3333-4333-8333-333333333333';
const owner = (id, name) => ({ identity_id: id, identity_type: 'entity', display_name: name });
let WHO = owner(AU, 'Bondi Grocer');
const authStub = Object.assign((req, res, next) => { req.identity = WHO; next(); }, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (req, res, next) => next() });
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});
(async () => {
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  const IDS = { [AU]: { identity_id: AU, gstn: null, display_name: 'Bondi Grocer', country: 'AU', policy_flags: {} }, [AE]: { identity_id: AE, gstn: null, display_name: 'Deira Stores', country: 'AE', policy_flags: {} } };
  const q0 = X.dbStub.query;
  X.dbStub.query = async (t, p) => /FROM identities WHERE identity_id = ANY/.test(String(t)) ? { rows: p[0].map((id) => IDS[id]).filter(Boolean) } : q0(t, p);
  for (const m of ['tax-copy', 'bill-use']) delete require.cache[require.resolve(path.join(H.API, 'lib', m))];
  require.cache[require.resolve(path.join(H.API, 'lib', 'storage-object'))] = { exports: { available: async () => false } };
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);
  let DAY = '2026-10-20'; const realDay = K.dayOf;
  K.dayOf = (ts, c) => (ts instanceof Date && Math.abs(ts.getTime() - Date.now()) < 5000 ? DAY : realDay(ts, c));
  const box = (r, code) => (r.body.boxes || []).find((b) => b.code === String(code)) || {};
  const day = (shop, cur, date, taxable, tax, head, ref) => X.B.postEntry(X.db, shop, { type: 'walkin_day', ref, date, currency: cur, modes: { cash: taxable + tax }, by_rate: [Object.assign({ rate: cur === 'AUD' ? 10 : 5, taxable }, { [head]: tax })], round_off: 0, source_ref: 'walkin:C1:' + date });
  const buy = (shop, cur, date, taxable, tax, head, ref) => X.B.postEntry(X.db, shop, { type: 'purchase_bill', ref, date, currency: cur, party: SUPP, by_rate: [Object.assign({ rate: cur === 'AUD' ? 10 : 5, taxable }, { [head]: tax })], paid: {}, round_off: 0, source_ref: 'pur:' + ref });
  const accRow = (r, boxCode, code) => (box(r, boxCode).accounts || []).find((x) => x.code === code) || {};
  /** the whole check for one ledger: the box's drill amount for it (one carried total) against the Ledger page's reading (the other) */
  const tie = async (label, boxCode, code, from, to, ret, side, key) => {
    const l = await q('GET', '/ledger/' + code + '?reading=return&from=' + from + '&to=' + to);
    const rr = l.body.return_reading;
    ok(label + ': the Ledger page carries the reading', l.status === 200 && rr && rr.tie === 'plain', JSON.stringify(l.body).slice(0, 300));
    if (!rr) return null;
    const row = accRow(ret, boxCode, code), figure = row[key || 'amount_minor'];
    const drill = side === 'cr' ? -rr.return_minor : rr.return_minor;
    ok(label + ': the return\'s reading of the ledger = the box\'s drill amount (' + drill + ')', drill === figure, 'reading ' + drill + ' box ' + figure);
    ok(label + ': ledger movement - the labelled left-out line = the return\'s figure', rr.tie_ok === true && rr.ledger_minor - rr.left_out_minor === rr.return_minor, JSON.stringify(rr));
    return rr;
  };
  /* AU: a sale, a purchase, then the quarter's own set-off */
  await X.store.saveSetting(X.db, AU, { enabled: false, country: 'AU' });
  await q('POST', '/enable', {});
  X.T.parties.push({ owner: AU, party_id: SUPP, party_no: 'P-00001', name: 'Metcash', supplier: true, credit_days: 30 });
  await day(AU, 'AUD', '2026-07-01', 100, 10, 'gst', 'D1');
  await day(AU, 'AUD', '2026-08-15', 200, 20, 'gst', 'D2');
  await buy(AU, 'AUD', '2026-09-06', 500, 50, 'gst', 'P1');
  let ret = await q('GET', '/returns?period=2026-Q1');
  const before1A = box(ret, '1A').amount_minor, before1B = box(ret, '1B').amount_minor;
  let rr = await tie('AU before the set-off', '1A', '2200', '2026-07-01', '2026-09-30', ret, 'cr');
  ok('AU before the set-off: nothing left out', rr && rr.left_out.entries_n === 0 && rr.left_out_minor === 0);
  const closed = await q('POST', '/gst/close', { fy: '2026-27', period: '2026-Q1' });
  ok('AU: the quarter is closed (the set-off entry is posted)', closed.status === 200, JSON.stringify(closed.body).slice(0, 200));
  ret = await q('GET', '/returns?period=2026-Q1');
  eq('AU: the set-off does not move the boxes (1A, 1B as before)', [box(ret, '1A').amount_minor, box(ret, '1B').amount_minor], [before1A, before1B]);
  rr = await tie('AU 1A / 2200 after the set-off', '1A', '2200', '2026-07-01', '2026-09-30', ret, 'cr');
  ok('AU: the Ledger page names the set-off as ONE labelled line (entries counted, Dr and Cr)', rr && rr.left_out.entries_n >= 1 && rr.left_out.dr_minor > 0, JSON.stringify(rr && rr.left_out));
  ok('AU: the raw ledger and the return DIFFER by exactly that line (the 2200 case, now explained, not silent)', rr && rr.ledger_minor !== rr.return_minor && rr.ledger_minor - rr.left_out_minor === rr.return_minor);
  const gp = box(ret, '1B').accounts[0].code;
  await tie('AU 1B / ' + gp + ' after the set-off', '1B', gp, '2026-07-01', '2026-09-30', ret, 'dr');
  const mid = await q('GET', '/ledger/2200?reading=return&from=2026-07-05&to=2026-09-30');
  ok('a range that cuts a month has no reading (the return reads whole months): null, never a wrong tie', mid.status === 200 && mid.body.return_reading === null, JSON.stringify(mid.body).slice(0, 200));
  const plain = await q('GET', '/ledger/2200?from=2026-07-01&to=2026-09-30');
  ok('a normal read carries no reading (no extra cost)', plain.status === 200 && plain.body.return_reading === undefined);
  /* mutation: the set-off no longer read by the one reader, the tie must go RED */
  const realStore = require(path.join(H.API, 'lib', 'books-store')), realTEL = realStore.taxEntryLines;
  realStore.taxEntryLines = async () => [];
  const m = await q('GET', '/ledger/2200?reading=return&from=2026-07-01&to=2026-09-30');
  const mr = await q('GET', '/returns?period=2026-Q1');
  ok('MUTATION (the one reader of the set-off stops reading it): the box moves off its figure, so the "set-off does not move the boxes" check above goes RED', box(mr, '1A').amount_minor !== before1A && m.status === 200, '1A ' + box(mr, '1A').amount_minor + ' vs ' + before1A);
  realStore.taxEntryLines = realTEL;
  /* RC2: a lodged period's net is the stored close; a posting dated inside the period but made after the close is SAID, never merged into the stored net */
  const Taxed = require(path.join(H.API, 'lib', 'books-period-taxed')), B0 = require(path.join(H.API, 'lib', 'books'));
  const pack = (await B0.ledgerCtx(X.db, AU)).pack, item = { start: '2026-07-01', end: '2026-09-30' };
  const LATE = require(path.join(H.API, 'lib', 'books-store-late')); /* the in-memory version of the one SQL read: the entries dated in the span, created after the close, with a tax line and a non-settlement line */
  LATE.lateTaxEntries = async (db, e, from, to, after, taxRoles, settleRoles) => {
    const day = (x) => String(x.posting_date).slice(0, 10), roleOf = (l) => (X.T.accounts.find((a) => a.account_id === l.account_id) || {}).role;
    return X.T.entries.filter((x) => x.entity_id === e && day(x) >= from && day(x) <= to && !x.is_opening && String(x.created_at) > String(after)).map((h) => ({ h, ls: X.T.lines.filter((l) => l.entry_id === h.entry_id) }))
      .filter(({ ls }) => ls.some((l) => taxRoles.indexOf(roleOf(l)) >= 0) && !ls.every((l) => settleRoles.indexOf(roleOf(l)) >= 0))
      .map(({ h, ls }) => { const tl = ls.filter((l) => taxRoles.indexOf(roleOf(l)) >= 0); return { entry_id: h.entry_id, dr_minor: tl.reduce((t, l) => t + Number(l.dr_minor || 0), 0), cr_minor: tl.reduce((t, l) => t + Number(l.cr_minor || 0), 0) }; });
  };
  const closeRow = X.T.entries.find((x) => x.entity_id === AU && /^gstclose/.test(String(x.source_ref)));
  ok('RC2: the close entry is found (its created_at is the "closed at")', !!closeRow, JSON.stringify(X.T.entries.filter((x) => x.entity_id === AU).map((x) => x.source_ref)));
  const nothing = await Taxed.changedSinceClose(X.db, AU, pack, item, closeRow.created_at);
  ok('RC2: nothing posted after the close -> no "changed since close"', nothing === null, JSON.stringify(nothing));
  await new Promise((done) => setTimeout(done, 15));
  await day(AU, 'AUD', '2026-09-20', 100, 10, 'gst', 'LATE1');
  const lateRow = X.T.entries.find((x) => x.entity_id === AU && x.source_ref === 'walkin:C1:2026-09-20'); /* the close LOCKS its months: the books move a new posting to 1 Oct; this puts one back inside the period (a dated import or manual journal) so the reader is proven */
  ok('RC2: the closed period is locked: a new posting is moved out of it (the lock is the first defence)', lateRow.posting_date === '2026-10-01', lateRow.posting_date);
  lateRow.posting_date = '2026-09-20';
  const late = await Taxed.changedSinceClose(X.db, AU, pack, item, closeRow.created_at);
  ok('RC2: a sale dated 20 Sep but posted after the close is said: 1 entry, +10.00 on the tax ledgers, in words', late && late.entries_n === 1 && late.tax_moved_minor === 1000 && /posted after it was closed/.test(late.note), JSON.stringify(late));
  const realLate = LATE.lateTaxEntries; LATE.lateTaxEntries = async () => [];
  const blind = await Taxed.changedSinceClose(X.db, AU, pack, item, closeRow.created_at);
  ok('RC2 MUTATION (the late-posting reader stops reading): the check above would go RED', blind === null);
  LATE.lateTaxEntries = realLate;
  /* AE: a VAT201 with its own set-off */
  WHO = owner(AE, 'Deira Stores'); DAY = '2026-06-10';
  await X.store.saveSetting(X.db, AE, { enabled: false, country: 'AE' });
  await q('POST', '/enable', {});
  X.T.parties.push({ owner: AE, party_id: SUPP, party_no: 'P-00001', name: 'Al Maya', supplier: true, credit_days: 30 });
  await day(AE, 'AED', '2026-03-01', 100, 5, 'vat', 'D1');
  await buy(AE, 'AED', '2026-03-10', 400, 20, 'vat', 'P1');
  const pq = '?stagger=monthly&emirate=Dubai&period=2026-03';
  ret = await q('GET', '/returns' + pq);
  const b1 = box(ret, 1).tax_minor, b13 = box(ret, 13).tax_minor;
  const c2 = await q('POST', '/gst/close', { period: '2026-03', stagger: 'monthly', client_ref: 'ae-1' });
  console.log('   info AE close: ' + c2.status + ' ' + JSON.stringify(c2.body).slice(0, 120));
  ret = await q('GET', '/returns' + pq);
  eq('AE: the set-off does not move box 1 or 13', [box(ret, 1).tax_minor, box(ret, 13).tax_minor], [b1, b13]);
  await tie('AE box 1 / 2200', '1', '2200', '2026-03-01', '2026-03-31', ret, 'cr', 'tax_minor');
  await tie('AE box 13 / 2210', '13', '2210', '2026-03-01', '2026-03-31', ret, 'dr', 'tax_minor');
  srv.close();
  console.log('\n' + (pass + fail) + ' checks, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
