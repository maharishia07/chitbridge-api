/**
 * drift7-bas-claim-tie.test.cjs — DRIFT 7 (walk R4 P2-5, 28 Nov 2026): the BAS 1B sentence, the entries behind "See them" and the box tie. Real Express over the in-memory ledger, the AU pack.
 * HAND (the walk's numbers, AUD, Q1 = Jul-Sep 2026): purchase E1 GST 15.00 and purchase P1 GST 60.00, neither with a tax invoice file · a purchase return of GST 30.00 in the quarter → 1B = 15 + 60 - 30 = 45.00.
 * The claim says: 75.00 claimed on 2 purchases (what "See them" adds up to), 30.00 given back, 45.00 the box's part. Two carried totals compared: gross_minor - returned_minor = tax_minor = the 1B box amount. A mutation (returns dropped) breaks the tie.
 * Run: node tests/drift7-bas-claim-tie.test.cjs   (BOOKS_ENGINES_SRC=<chitbridge-engines/src>)
 * OWNER cb-accounting · CALLS lib/books-evidence.unsupportedIn · GET /api/books/returns
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const AU = 'aaaaaaaa-1111-4111-8111-111111111111', SUPP = '33333333-3333-4333-8333-333333333333';
const WHO = { identity_id: AU, identity_type: 'entity', display_name: 'Bondi Grocer' };
const authStub = Object.assign((req, res, next) => { req.identity = WHO; next(); }, { entityOf: (req) => req.identity.identity_id, requireScope: () => (req, res, next) => next() });
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});


(async () => {
  console.log('\n══ DRIFT 7 — BAS 1B: the sentence, the entries behind "See them" and the box tie ══\n');
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
  const realDay = K.dayOf; K.dayOf = (ts, c) => (ts instanceof Date && Math.abs(ts.getTime() - Date.now()) < 5000 ? '2026-10-20' : realDay(ts, c));
  await X.store.saveSetting(X.db, AU, { enabled: false, country: 'AU' });
  const en = await q('POST', '/enable', {});
  ok('AU: the ledger is on', en.status === 200 && en.body.ok, JSON.stringify(en.body));
  X.T.parties.push({ owner: AU, party_id: SUPP, party_no: 'P-00001', name: 'Metcash', supplier: true, credit_days: 30 });
  const post = (type, date, taxable, tax, ref, more) => X.B.postEntry(X.db, AU, Object.assign({ type, ref, date, currency: 'AUD', party: SUPP, by_rate: [{ rate: 10, taxable, gst: tax }], paid: {}, round_off: 0, source_ref: 'pur:' + ref }, more || {}));
  await post('purchase_bill', '2026-08-10', 150, 15, 'E1');
  await post('purchase_bill', '2026-09-06', 600, 60, 'P1');
  await post('purchase_return', '2026-09-20', 300, 30, 'DN1', { against_ref: 'P1' });
  const r = await q('GET', '/returns?period=2026-Q1');
  const u = r.body.unsupported_input || {}, box1B = (r.body.boxes || []).find((b) => b.code === '1B') || {};
  eq('hand: 1B = 15.00 + 60.00 - 30.00 = 45.00', box1B.amount_minor, 4500);
  eq("the claim: 2 purchases, 75.00 claimed (what See them adds up to), 30.00 returned, 45.00 the box's part", [u.count, u.gross_minor, u.returned_minor, u.tax_minor], [2, 7500, 3000, 4500]);
  ok('two carried totals tie: gross - returned = the claim = box 1B', u.gross_minor - u.returned_minor === u.tax_minor && u.tax_minor === box1B.amount_minor);
  /* mutation: the returns are not read -> the sentence's 45.00 can no longer be explained by its entries (75.00): the tie breaks */
  const Ev = require(path.join(H.API, 'lib', 'books-evidence')), real = Ev.unsupportedIn;
  Ev.unsupportedIn = async (...a) => Object.assign(await real(...a), { returned_minor: 0 });
  const bad = (await q('GET', '/returns?period=2026-Q1')).body.unsupported_input || {};
  Ev.unsupportedIn = real;
  ok('mutation (returns dropped) is caught by the tie', !(bad.gross_minor - bad.returned_minor === bad.tax_minor), JSON.stringify(bad));
  srv.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
