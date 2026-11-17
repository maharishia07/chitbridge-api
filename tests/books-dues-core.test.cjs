/**
 * books-dues-core.test.cjs — MIS A2 (REQ-MIS-SHOWCASE critic finding 8): the dues read moved out of routes/books.js into lib/books-dues.js; /dues answers BYTE FOR BYTE as before.
 * The golden (tests/golden/books-dues-a2.json) was written by the route BEFORE the move (GOLDEN_WRITE=1 against the base routes/books.js) and is compared as text here:
 * customer, supplier, both, finance (owner), supplier finance, an old asOf, and a cost-blind reader. Offline, the in-memory books. Run: node tests/books-dues-core.test.cjs
 */
'use strict';
const path = require('path'), fs = require('fs'), http = require('http');
const H = require('./support/books-harness.cjs');
const GOLD = path.join(__dirname, 'golden', 'books-dues-a2.json');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111', RAVI = '77777777-7777-4777-8777-777777777777', ANAND = '88888888-8888-4888-8888-888888888888';
const owner = { identity_id: SHOP, identity_type: 'entity', display_name: 'Shop' };
const auth = Object.assign((req, res, next) => { req.identity = owner; next(); }, { entityOf: (req) => req.identity.identity_id, requireScope: () => (req, res, next) => next() });
const call = (port, p) => new Promise((done) => {
  http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: { 'Identity-Type': 'entity' } }, (res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => done({ status: res.statusCode, text: raw })); }).end();
});
(async () => {
  if (!H.enginesSrc().dir) { console.log('SKIP: ' + H.enginesSrc().why); process.exit(1); }
  const X = H.load({ auth });
  X.T.parties.push({ owner: SHOP, party_id: RAVI, party_no: 'P-00001', name: 'Ravi', customer: true, credit_days: 30, credit_limit_minor: null, terms: {} });
  X.T.parties.push({ owner: SHOP, party_id: ANAND, party_no: 'P-00002', name: 'Anand Mills', supplier: true, credit_days: 30, credit_limit_minor: null, terms: {} });
  const express = require('express'), app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0), port = srv.address().port;
  require(path.join(H.API, 'lib', 'bill-checks')).attach = async (h, e, req, prop) => { prop.proposal.forEach((r) => Object.assign(r, { entry_id: null, chit_id: null })); };
  const CLOCK = require(path.join(H.API, 'lib', 'shop-clock')); CLOCK.set('2026-11-16T06:00:00Z');
  const cost = require(path.join(H.API, 'lib', 'cost')); const realBlind = cost.isCostBlind; let blind = false; cost.isCostBlind = async () => blind;
  try {
    await call(port, '/x'); // warm
    const post = (p) => new Promise((done) => { const b = '{}'; const r = http.request({ host: '127.0.0.1', port, path: '/api/books' + p, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': 2 } }, (res) => { res.resume(); res.on('end', done); }); r.end(b); });
    await post('/enable');
    const sale = (day, no, amount) => X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: day, currency: 'INR', party: RAVI, source_chit_id: 'c0000000-0000-4000-8000-0000000000' + no, by_rate: [{ rate: 0, taxable: amount }], paid: {}, round_off: 0 });
    const buy = (day, no, amount) => X.B.postEntry(X.db, SHOP, { type: 'purchase_bill', ref: 'P' + no, date: day, currency: 'INR', party: ANAND, by_rate: [{ rate: 0, taxable: amount }], paid: {}, round_off: 0, source_ref: 'purchase:' + no });
    await sale('2026-07-10', '01', 100000); await sale('2026-08-10', '02', 200000); await sale('2026-11-10', '03', 400000);
    await buy('2026-08-01', '01', 150000); await buy('2026-10-20', '02', 50000);
    const urls = ['/dues', '/dues?side=customer', '/dues?side=supplier', '/dues?side=customer&finance=1', '/dues?side=supplier&finance=1', '/dues?side=customer&asOf=2026-09-30'];
    const got = {};
    for (const u of urls) { const r = await call(port, '/api/books' + u); got[u] = { status: r.status, body: r.text }; }
    blind = true; const b = await call(port, '/api/books/dues'); got['/dues (cost-blind reader)'] = { status: b.status, body: b.text }; blind = false;
    const text = JSON.stringify(got, null, 1);
    if (process.env.GOLDEN_WRITE === '1') { fs.writeFileSync(GOLD, text); console.log('golden written: ' + GOLD); }
    else {
      const gold = JSON.parse(fs.readFileSync(GOLD, 'utf8'));
      ok('there is a golden of every request', Object.keys(gold).length === Object.keys(got).length, Object.keys(gold).join());
      Object.keys(got).forEach((u) => ok(u + ' answers byte for byte as before the move', gold[u] && gold[u].status === got[u].status && gold[u].body === got[u].body, got[u].body.slice(0, 200)));
    }
    ok('the money is really there (not an empty page matching an empty golden)', JSON.parse(got['/dues'].body).parties.length === 2 && JSON.parse(got['/dues?side=customer'].body).parties[0].balance_minor > 0 && JSON.parse(got['/dues?side=supplier'].body).parties[0].balance_minor < 0 && JSON.parse(got['/dues?side=supplier'].body).parties.length === 1, got['/dues'].body.slice(0, 300));
    ok('the cost-blind reader gets no supplier money (the seat rule stays in the route)', JSON.parse(got['/dues (cost-blind reader)'].body).cost_hidden === true, got['/dues (cost-blind reader)'].body.slice(0, 200));
    const lib = require(path.join(H.API, 'lib', 'books-dues'));
    ok('the lib holds the one read, and the route calls it', typeof lib.read === 'function' && /Dues\.read\(/.test(fs.readFileSync(path.join(H.API, 'routes', 'books.js'), 'utf8')));
  } finally { cost.isCostBlind = realBlind; srv.close(); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch((err) => { console.log('ERROR ' + (err && err.stack)); process.exit(1); });
