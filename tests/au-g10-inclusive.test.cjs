/**
 * au-g10-inclusive.test.cjs — AP-F-09 (ACC-351), decided by Athi 22 Nov 2026: the AU full BAS reports G10 (capital) and G11 (non-capital) GST-INCLUSIVE, per ATO BAS Step 3, for periods from 2027-01-01.
 * Hand figures (cents): one capital purchase 1,100.00 incl. GST and one non-capital 220.00 incl. GST → G10 110000, G11 22000, 1B 12000. The same bills in Oct-Dec 2026 keep the exclusive figures (100000 / 20000).
 * Needs the books engines with the AU pack row returns.g10_g11 (BOOKS_ENGINES_SRC) and the api's adopted reg-au / gst-returns at that version. Run: node tests/au-g10-inclusive.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const BASIS = 'Basis: non-cash (accrual): GST in the period of the invoice or the payment, whichever comes first';
const AU = 'aaaaaaaa-1111-4111-8111-111111111111', AE = 'eeeeeeee-1111-4111-8111-111111111111', IN = '11111111-1111-4111-8111-111111111111';
const owner = (id, name) => ({ identity_id: id, identity_type: 'entity', display_name: name });
let WHO = owner(AU, 'Bondi Grocer');
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

(async () => {
  console.log('AP-F-09 · AU BAS G10 / G11 are GST-INCLUSIVE from 2026-10-01 (ATO BAS Step 3; Athi 22 Nov 2026)');
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  const IDS = { [AU]: { identity_id: AU, gstn: null, display_name: 'Bondi Grocer', country: 'AU', policy_flags: {} } };
  const q0 = X.dbStub.query;
  X.dbStub.query = async (t, p) => /FROM identities WHERE identity_id = ANY/.test(String(t)) ? { rows: p[0].map((id) => IDS[id]).filter(Boolean) } : q0(t, p);
  for (const m of ['tax-copy', 'bill-use']) delete require.cache[require.resolve(path.join(H.API, 'lib', m))];
  require.cache[require.resolve(path.join(H.API, 'lib', 'storage-object'))] = { exports: { available: async () => false } };
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);
  const realDay = K.dayOf;
  K.dayOf = (ts, c) => (ts instanceof Date && Math.abs(ts.getTime() - Date.now()) < 5000 ? '2026-11-20' : realDay(ts, c));
  const box = (r, code) => (r.body.boxes || []).find((b) => b.code === String(code)) || {};
  const SUPP = '99999999-1111-4111-8111-111111111111';
  const buy = (date, taxable, tax, ref, extra) => X.B.postEntry(X.db, AU, Object.assign({ type: 'purchase_bill', ref, date, currency: 'AUD', party: SUPP, by_rate: [{ rate: 10, taxable, gst: tax }], paid: {}, round_off: 0, source_ref: 'pur:' + ref }, extra || {}));

  await X.store.saveSetting(X.db, AU, { enabled: false, country: 'AU' });
  const en = await q('POST', '/enable', {});
  ok('AU: the ledger is on', en.status === 200 && en.body.ok, JSON.stringify(en.body));
  /* hand figures, cents: capital 1,000.00 + 100.00 GST = 1,100.00 incl.; non-capital 200.00 + 20.00 GST = 220.00 incl.; 1B = 120.00. Q2 FY27 (Oct-Dec 2026); the same bills in Aug 2026 (Q1) stay exclusive */
  await buy('2026-11-15', 1000, 100, 'C1', { accept: 'asset', asset_class: 'plant' });
  await buy('2026-11-16', 200, 20, 'N1', { accept: 'use', class: 'repairs' });
  await buy('2026-08-15', 1000, 100, 'C0', { accept: 'asset', asset_class: 'plant' });
  await buy('2026-08-16', 200, 20, 'N0', { accept: 'use', class: 'repairs' });

  let r = await q('GET', '/returns?period=2026-Q2&simpler=0');
  ok('Q2 FY27: G10 = 1,100.00 (capital incl. GST)', box(r, 'G10').amount_minor === 110000, JSON.stringify([r.status, box(r, 'G10'), r.body.error]));
  ok('Q2 FY27: G11 = 220.00 (non-capital incl. GST)', box(r, 'G11').amount_minor === 22000, JSON.stringify(box(r, 'G11')));
  ok('Q2 FY27: 1B = 120.00, the GST on both, unchanged', box(r, '1B').amount_minor === 12000, JSON.stringify(box(r, '1B')));
  ok('Q2 FY27: the answer says GST-inclusive', (r.body.notes || []).some((n) => /GST-inclusive/.test(n)) && !(r.body.notes || []).some((n) => /GST-exclusive/.test(n)), JSON.stringify(r.body.notes));
  ok('Q2 FY27: the ledgers behind G10 and G11 add to the box (split_ok)', box(r, 'G10').split_ok === true && box(r, 'G11').split_ok === true, JSON.stringify([box(r, 'G10').split_ok, box(r, 'G11').split_ok]));
  r = await q('GET', '/returns?period=2026-Q1&simpler=0');
  ok('Q1 FY27 (Jul-Sep 2026, a return already shown): G10 stays 1,000.00 exclusive, G11 200.00', box(r, 'G10').amount_minor === 100000 && box(r, 'G11').amount_minor === 20000, JSON.stringify([box(r, 'G10'), box(r, 'G11')]));
  ok('Q1 FY27 still says GST-exclusive', (r.body.notes || []).some((n) => /GST-exclusive/.test(n)), JSON.stringify(r.body.notes));
  srv.close();
  console.log(pass + ' checks, ' + fail + ' not met');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
