/**
 * acc414-dispute-ref.test.cjs - ACC-414 (AU business run round 2, 27 Nov 2026): POST /api/books/parties/:id/dispute holds a REAL bill of that party, named by its number or its id.
 * Before: any non-empty ref answered 200 "Held" and a bill was flagged only when the ref was its chit id (the shop believed a bill held, nothing was).
 * Hand figures (INR, three bills of Kumar Traders): KT-0007 1,000.00 + 12% = 1,120.00 · KT-0008 560.00 · KT-0010 1,050.00.
 *   KT-0007 by its NUMBER  -> 200, the status row is on that bill's id, the answer names that id
 *   KT-0010 by its ID      -> 200, the status row is on that id
 *   NO-SUCH-BILL           -> 404 NOT_FOUND in the one error shape, NO status row written
 *   a bill of another party -> 404 (a bill is one party's)
 *   a bill returned in full (0.00 open) -> 400 BOOKS_BAD_REQUEST on hold; releasing it is allowed
 * Run: node tests/acc414-dispute-ref.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const SHOP = '11111111-1111-4111-8111-111111111111', SUPP = '33333333-3333-4333-8333-333333333333', OTHER = '44444444-4444-4444-8444-444444444444';
const authStub = Object.assign((req, res, next) => { req.identity = { identity_id: SHOP, identity_type: 'entity', display_name: 'Chola Auto Care' }; next(); }, { entityOf: (req) => req.identity.identity_id, requireScope: () => (req, res, next) => next() });
let attempts = 0;
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b), 'Idempotency-Key': 'a414-' + ++attempts } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});
const BILL = (n) => 'c0000000-0000-4000-8000-00000000000' + n;
(async () => {
  if (!H.enginesSrc().dir) { console.log('   SKIP: ' + H.enginesSrc().why); return; }
  const X = H.load({ auth: authStub });
  const realQuery = X.db.query;
  X.db.query = async (text, v) => (/SELECT can_see_costs FROM identities/.test(String(text)) ? { rows: [{ can_see_costs: true }] } : realQuery(text, v));
  X.T.parties.push({ owner: SHOP, party_id: SUPP, party_no: 'P-00002', name: 'Kumar Traders', supplier: true, credit_days: 30 }, { owner: SHOP, party_id: OTHER, party_no: 'P-00003', name: 'Velan Steels', supplier: true, credit_days: 30 });
  const express = require('express');
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);
  await q('POST', '/enable', {});
  const bills = [['a', '2026-09-01', { rate: 12, taxable: 1000, cgst: 60, sgst: 60, igst: 0 }, 'KT-0007', SUPP], ['b', '2026-09-05', { rate: 12, taxable: 500, cgst: 30, sgst: 30, igst: 0 }, 'KT-0008', SUPP], ['c', '2026-09-10', { rate: 5, taxable: 1000, cgst: 25, sgst: 25, igst: 0 }, 'KT-0010', SUPP], ['d', '2026-09-11', { rate: 5, taxable: 200, cgst: 5, sgst: 5, igst: 0 }, 'VS-0001', OTHER]];
  for (const [n, date, rate, no, party] of bills) {
    await X.B.postEntry(X.db, SHOP, { type: 'purchase_bill', date, currency: 'INR', party, source_chit_id: BILL(n), source_ref: 'chit:' + n, by_rate: [rate], paid: {}, round_off: 0 });
    X.T.chits.push({ chit_id: BILL(n), bill_no: no, entity_id: SHOP, purpose: 'order', business_json: { bill_no: no } });
  }
  const statusRows = () => X.T.items.filter((i) => i.ref_kind === 'status').map((i) => [i.ref, i.status]);
  const dispute = (ref, extra) => q('POST', '/parties/' + SUPP + '/dispute', Object.assign({ against_ref: ref, side: 'supplier' }, extra || {}));

  const byNo = await dispute('KT-0007');
  eq('by the bill NUMBER: 200, the answer names the bill id, one status row on it', [byNo.status, byNo.body.against_ref, statusRows()], [200, BILL('a'), [[BILL('a'), 'disputed']]]);
  const byId = await dispute(BILL('c'));
  eq('by the bill ID: 200, a status row on that id', [byId.status, byId.body.against_ref, statusRows().length], [200, BILL('c'), 2]);
  const none = await dispute('NO-SUCH-BILL');
  ok('an unknown ref: 404 NOT_FOUND in the one error shape (type, title, status, detail), no row written', none.status === 404 && none.body.status === 404 && /NO-SUCH-BILL/.test(String(none.body.detail || none.body.message || '')) && statusRows().length === 2, JSON.stringify(none.body));
  const foreign = await dispute('VS-0001');
  ok("another party's bill number: 404, nothing written", foreign.status === 404 && statusRows().length === 2, JSON.stringify(foreign.body));
  const foreignId = await dispute(BILL('d'));
  ok("another party's bill id: 404, nothing written", foreignId.status === 404 && statusRows().length === 2, JSON.stringify(foreignId.body));
  const release = await dispute('KT-0007', { disputed: false });
  eq('releasing by number: 200, status undisputed on the bill id', [release.status, release.body.status, statusRows()[2]], [200, 'undisputed', [BILL('a'), 'undisputed']]);

  /* a bill returned in full has 0.00 open: nothing to hold (hold refused 400), the release is still allowed */
  await X.B.postEntry(X.db, SHOP, { type: 'purchase_return', date: '2026-09-20', currency: 'INR', party: SUPP, against_ref: BILL('b'), source_ref: 'ret:b', by_rate: [{ rate: 12, taxable: 500, cgst: 30, sgst: 30, igst: 0 }] });
  const before = statusRows().length;
  const settled = await dispute('KT-0008');
  ok('a bill with nothing open: 400 BOOKS_BAD_REQUEST, nothing written', settled.status === 400 && statusRows().length === before, JSON.stringify(settled.body));
  const relSettled = await dispute('KT-0008', { disputed: false });
  eq('releasing a settled bill is allowed (a hold must be removable)', relSettled.status, 200);
  srv.close();
  console.log('\n   ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   CRASH ' + (e && e.stack)); process.exit(1); });
