/**
 * p1-7-bas-basis.test.cjs — P1-7 · CTRY-87 (b): the BAS says the basis it is READ on, first among its notes: "Basis: non-cash (accrual): GST in the period of the invoice or the payment, whichever comes first".
 *
 * An Australian shop (hand figures): a walk-in sale on 20 Sep 2026 of A$100.00 + A$10.00 GST, cash; another on 5 Oct of A$200.00 + A$20.00 GST.
 *   BAS 2026-Q1 (Jul-Sep): 1A = 10.00 (the September invoice, at its invoice date), and the October one is NOT in it.
 *   BAS 2026-Q2 (Oct-Dec): 1A = 20.00. A cash-basis return would put a payment received in October into Q2; this return does not, and says so.
 * The note is on the full BAS too, comes first (the Simpler BAS note follows), is the same on every call, and appears nowhere on a UAE VAT201 or India's answer.
 * Needs the books engines (BOOKS_ENGINES_SRC or the sibling chitbridge-engines/src). Run: node tests/p1-7-bas-basis.test.cjs
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
  console.log('\n══ P1-7 · the BAS prints the basis it is read on ══\n');
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  const IDS = {
    [AU]: { identity_id: AU, gstn: null, display_name: 'Bondi Grocer', country: 'AU', policy_flags: {} },
    [AE]: { identity_id: AE, gstn: null, display_name: 'Deira Stores', country: 'AE', policy_flags: {} },
    [IN]: { identity_id: IN, gstn: '33AAAAA0000A1Z5', display_name: 'Mayur Traders', country: 'IN', policy_flags: {} },
  };
  const q0 = X.dbStub.query;
  X.dbStub.query = async (t, p) => /FROM identities WHERE identity_id = ANY/.test(String(t)) ? { rows: p[0].map((id) => IDS[id]).filter(Boolean) } : q0(t, p);
  for (const m of ['tax-copy', 'bill-use']) delete require.cache[require.resolve(path.join(H.API, 'lib', m))];
  require.cache[require.resolve(path.join(H.API, 'lib', 'storage-object'))] = { exports: { available: async () => false } };
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);
  const realDay = K.dayOf;
  K.dayOf = (ts, c) => (ts instanceof Date && Math.abs(ts.getTime() - Date.now()) < 5000 ? '2026-10-20' : realDay(ts, c));
  const box = (r, code) => (r.body.boxes || []).find((b) => b.code === String(code)) || {};
  const day = (shop, cur, date, taxable, tax, head, ref, rate) => X.B.postEntry(X.db, shop, { type: 'walkin_day', ref, date, currency: cur, modes: { cash: taxable + tax }, by_rate: [Object.assign({ rate, taxable }, { [head]: tax })], round_off: 0 });

  await X.store.saveSetting(X.db, AU, { enabled: false, country: 'AU' });
  const en = await q('POST', '/enable', {});
  ok('AU: the ledger is on', en.status === 200 && en.body.ok, JSON.stringify(en.body));
  await day(AU, 'AUD', '2026-09-20', 100, 10, 'gst', 'S1', 10);
  await day(AU, 'AUD', '2026-10-05', 200, 20, 'gst', 'S2', 10);

  let r = await q('GET', '/returns?period=2026-Q1');
  ok('Q1 (Jul-Sep): 1A = 10.00 at the September invoice date; the October sale is not in it', r.status === 200 && box(r, '1A').amount_minor === 1000, JSON.stringify(box(r, '1A')));
  ok('the Basis line is the FIRST note, word for word', r.body.notes[0] === BASIS, JSON.stringify(r.body.notes));
  ok('the Simpler BAS note still follows it', r.body.notes.length >= 2 && /Simpler BAS/.test(r.body.notes[1]), JSON.stringify(r.body.notes));
  ok('the basis line is said exactly once', r.body.notes.filter((n) => /^Basis:/.test(n)).length === 1);
  r = await q('GET', '/returns?period=2026-Q2');
  ok('Q2 (Oct-Dec): 1A = 20.00, the basis line is there too', box(r, '1A').amount_minor === 2000 && r.body.notes[0] === BASIS, JSON.stringify([box(r, '1A'), r.body.notes]));
  r = await q('GET', '/returns?period=2026-Q1&simpler=0');
  ok('the full BAS (G2 G3 G10 G11) says the basis first, then the G10 / G11 basis', r.body.notes[0] === BASIS && r.body.notes.some((n) => /GST-exclusive/.test(n)), JSON.stringify(r.body.notes));

  WHO = owner(AE, 'Deira Stores');
  await X.store.saveSetting(X.db, AE, { enabled: false, country: 'AE' });
  await q('POST', '/enable', {});
  r = await q('GET', '/returns?stagger=1');
  ok('a UAE VAT201 carries no BAS basis line', r.status === 200 && r.body.form === 'VAT201' && !r.body.notes.some((n) => /^Basis:/.test(n)), JSON.stringify(r.body.notes));
  WHO = owner(IN, 'Mayur Traders');
  await X.store.saveSetting(X.db, IN, { enabled: false });
  await q('POST', '/enable', {});
  r = await q('GET', '/returns');
  ok('India: form null, from the rail, no basis line', r.status === 200 && r.body.form === null && !JSON.stringify(r.body).includes('Basis:'), JSON.stringify(r.body));

  srv.close();
  console.log('\n' + pass + ' checks, ' + fail + ' not met\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
