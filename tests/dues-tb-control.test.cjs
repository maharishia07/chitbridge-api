/**
 * dues-tb-control.test.cjs — FC-M10: GET /dues?control=1 carries `tb_control`, each side's list total beside the trial balance's debtors / creditors control
 * (ONE trial-balance calculation, books.trialBalance), the difference named. Figures signed as the rows are (a supplier's is negative). Without ?control the
 * answer has no such key (the dues golden stays byte for byte). A cost-blind reader gets the supplier half as null values. Offline. Run: node tests/dues-tb-control.test.cjs
 */
'use strict';
const path = require('path'), http = require('http');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111', RAVI = '77777777-7777-4777-8777-777777777777', ANAND = '88888888-8888-4888-8888-888888888888';
const owner = { identity_id: SHOP, identity_type: 'entity', display_name: 'Shop' };
const auth = Object.assign((req, res, next) => { req.identity = owner; next(); }, { entityOf: (req) => req.identity.identity_id, requireScope: () => (req, res, next) => next() });
const call = (port, p) => new Promise((done) => {
  http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: { 'Identity-Type': 'entity' } }, (res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => done({ status: res.statusCode, body: (() => { try { return JSON.parse(raw); } catch (_) { return null; } })() })); }).end();
});
(async () => {
  if (!H.enginesSrc().dir) { console.log('SKIP: ' + H.enginesSrc().why); process.exit(1); }
  const X = H.load({ auth });
  X.T.parties.push({ owner: SHOP, party_id: RAVI, party_no: 'P-00001', name: 'Ravi', customer: true, credit_days: 30, credit_limit_minor: null, terms: {} });
  X.T.parties.push({ owner: SHOP, party_id: ANAND, party_no: 'P-00002', name: 'Anand Mills', supplier: true, credit_days: 30, credit_limit_minor: null, terms: {} });
  const express = require('express'), app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0), port = srv.address().port;
  require(path.join(H.API, 'lib', 'bill-checks')).attach = async (h, e, req, prop) => { prop.proposal.forEach((r) => Object.assign(r, { entry_id: null, chit_id: null })); };
  require(path.join(H.API, 'lib', 'shop-clock')).set('2026-11-16T06:00:00Z');
  const cost = require(path.join(H.API, 'lib', 'cost')); let blind = false; cost.isCostBlind = async () => blind;
  try {
    await call(port, '/x');
    await new Promise((done) => { const r = http.request({ host: '127.0.0.1', port, path: '/api/books/enable', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': 2 } }, (res) => { res.resume(); res.on('end', done); }); r.end('{}'); });
    const sale = (day, no, amount) => X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: day, currency: 'INR', party: RAVI, source_chit_id: 'c0000000-0000-4000-8000-0000000000' + no, by_rate: [{ rate: 0, taxable: amount }], paid: {}, round_off: 0 });
    const buy = (day, no, amount) => X.B.postEntry(X.db, SHOP, { type: 'purchase_bill', ref: 'P' + no, date: day, currency: 'INR', party: ANAND, by_rate: [{ rate: 0, taxable: amount }], paid: {}, round_off: 0, source_ref: 'purchase:' + no });
    await sale('2026-08-10', '02', 200000); await sale('2026-11-10', '03', 400000); await buy('2026-08-01', '01', 150000);
    const plain = (await call(port, '/api/books/dues')).body;
    ok('no ?control, no tb_control (the dues answer is unchanged)', plain && plain.tb_control === undefined);
    const all = (await call(port, '/api/books/dues?control=1')).body, c = all.tb_control || {};
    ok('customers: the list total is the debtors control, difference 0', c.customer && c.customer.list_minor === 60000000 && c.customer.tb_minor === 60000000 && c.customer.differs_minor === 0, JSON.stringify(c));
    ok('suppliers: signed as the rows are (negative), difference 0', c.supplier && c.supplier.list_minor === -15000000 && c.supplier.tb_minor === -15000000 && c.supplier.differs_minor === 0, JSON.stringify(c));
    const one = (await call(port, '/api/books/dues?control=1&side=customer')).body.tb_control || {};
    ok('a side not asked for is null, never zero', one.customer && one.supplier === null, JSON.stringify(one));
    /* the books refuse a party-less debtors line, so a difference is simulated: the ONE trial balance says 70.00 more on the debtors control than the parties' list */
    const Books = require(path.join(H.API, 'lib', 'books')), realTb = Books.trialBalance;
    Books.trialBalance = async (...args) => { const tb = await realTb(...args); return Object.assign({}, tb, { rows: tb.rows.map((row) => (row.debit_minor === 60000000 ? Object.assign({}, row, { debit_minor: row.debit_minor + 7000 }) : row)) }); };
    const off = (await call(port, '/api/books/dues?control=1')).body.tb_control;
    ok('a control that differs is named: list less trial balance', off.customer.differs_minor === -7000 && off.customer.tb_minor === 60007000 && off.supplier.differs_minor === 0, JSON.stringify(off));
    Books.trialBalance = realTb; blind = true;
    const bl = (await call(port, '/api/books/dues?control=1')).body.tb_control;
    ok('a cost-blind reader: the supplier half keeps its keys with null values, customers stand', bl.supplier && bl.supplier.tb_minor === null && bl.supplier.list_minor === null && bl.supplier.differs_minor === null && bl.customer.tb_minor !== null, JSON.stringify(bl));
  } finally { srv.close(); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
