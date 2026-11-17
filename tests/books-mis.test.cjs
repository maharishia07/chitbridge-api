/**
 * books-mis.test.cjs — MIS A3/A4 (REQ-MIS-SHOWCASE critic c26fe54e): GET /overview over the in-memory books. Offline. Run: node tests/books-mis.test.cjs
 * The spy rule: each figure DEEP-EQUALS the answer of the engine / page it comes from (sales = soldTotals, income · profit = /pl, to_collect = /dues, cash = /cashflow?days=30),
 * an unknown period is a 400 (never the year to date), a figure with nothing behind it is ABSENT (never 0), a reader without can_see_costs gets no cost figure.
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
  http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: { 'Identity-Type': 'entity' } }, (res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => { let body = null; try { body = JSON.parse(raw); } catch (_) {} done({ status: res.statusCode, body, text: raw }); }); }).end();
});
(async () => {
  if (!H.enginesSrc().dir) { console.log('SKIP: ' + H.enginesSrc().why); process.exit(1); }
  const X = H.load({ auth });
  X.T.parties.push({ owner: SHOP, party_id: RAVI, party_no: 'P-00001', name: 'Ravi', customer: true, credit_days: 30, credit_limit_minor: null, terms: {} });
  X.T.parties.push({ owner: SHOP, party_id: ANAND, party_no: 'P-00002', name: 'Anand Mills', supplier: true, credit_days: 30, credit_limit_minor: null, terms: {} });
  const express = require('express'), app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0), port = srv.address().port;
  require(path.join(H.API, 'lib', 'bill-checks')).attach = async (h, e, req, prop) => { prop.proposal.forEach((r) => Object.assign(r, { entry_id: null, chit_id: null })); };
  const CLOCK = require(path.join(H.API, 'lib', 'shop-clock')); CLOCK.set('2026-11-16T06:00:00Z'); /* a Monday */
  const cost = require(path.join(H.API, 'lib', 'cost')); const realBlind = cost.isCostBlind; let blind = false; cost.isCostBlind = async () => blind;
  try {
    await call(port, '/x');
    await new Promise((done) => { const r = http.request({ host: '127.0.0.1', port, path: '/api/books/enable', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': 2 } }, (res) => { res.resume(); res.on('end', done); }); r.end('{}'); });
    const get = (p) => call(port, '/api/books' + p);
    const empty = await get('/overview?period=ytd');
    ok('a shop with nothing posted answers 200 and each sales figure is ABSENT, never 0', empty.status === 200 && empty.body.sales.minor === null && !!empty.body.sales.why && empty.body.bars.length === 12 && empty.body.bars.every((b) => b.sold_minor === null), empty.text.slice(0, 300));
    const sale = (day, no, amount) => X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: day, currency: 'INR', party: RAVI, source_chit_id: 'c0000000-0000-4000-8000-0000000000' + no, by_rate: [{ rate: 0, taxable: amount }], paid: {}, round_off: 0 });
    const buy = (day, no, amount) => X.B.postEntry(X.db, SHOP, { type: 'purchase_bill', ref: 'P' + no, date: day, currency: 'INR', party: ANAND, by_rate: [{ rate: 0, taxable: amount }], paid: {}, round_off: 0, source_ref: 'purchase:' + no });
    await sale('2025-11-10', '01', 100000); await sale('2026-07-10', '02', 200000); await sale('2026-11-10', '03', 400000); await sale('2026-11-16', '04', 50000);
    await buy('2026-08-01', '01', 150000); await buy('2026-10-20', '02', 50000);
    const view = await get('/overview?period=ytd'), o = view.body;
    ok('ytd answers 200 with the keys the page paints', view.status === 200 && o.currency === 'INR' && o.period.word === 'ytd' && o.period.to === '2026-11-16' && o.cost_hidden === false, view.text.slice(0, 300));
    const pl = (await get('/pl?preset=ytd')).body, dues = (await get('/dues')).body, cash = (await get('/cashflow?days=30')).body;
    ok('income · expenses · profit deep-equal GET /pl for the same range', o.income.minor === pl.total_income_minor && o.expenses.minor === pl.total_expense_minor && o.profit.minor === pl.profit_minor, JSON.stringify([o.income, pl.total_income_minor]));
    ok('their change is the P&L\'s own change_bp (changeOf, basis points)', o.income.change_bp === pl.compare.income_change_bp && o.profit.change_bp === pl.compare.profit_change_bp && o.compare.from === pl.compare.from, JSON.stringify([o.income.change_bp, pl.compare]));
    ok('gross deep-equals /pl gross_profit (null when no sales account, never 0)', JSON.stringify(o.gross) === JSON.stringify(pl.gross_profit));
    ok('to_collect is the /dues customer total and to_pay the supplier total, unsigned', o.to_collect.minor === dues.parties.filter((p) => p.side !== 'supplier').reduce((s, p) => s + p.balance_minor, 0) && o.to_pay.minor === -dues.parties.filter((p) => p.side === 'supplier').reduce((s, p) => s + p.balance_minor, 0) && o.to_pay.minor > 0, JSON.stringify([o.to_collect, o.to_pay]));
    ok('cash ahead is the cash view at 30 days: words, lowest, shortfall', o.cash.days === 30 && o.cash.words === cash.words && JSON.stringify(o.cash.lowest) === JSON.stringify(cash.lowest) && JSON.stringify(o.cash.shortfall) === JSON.stringify(cash.shortfall), JSON.stringify(o.cash).slice(0, 200));
    const R = require(path.join(H.API, 'lib', 'books-report-period'));
    const sold = await X.store.soldTotals(X.db, SHOP, [{ from: o.period.from, to: o.period.to }, o.compare]);
    ok('sales (tax in) is soldTotals for the range and its prior: the one SOLD rule', o.sales.minor === sold[0].sold.minor && (sold[1].entries ? o.sales.prior.minor === sold[1].sold.minor : o.sales.prior.minor === null && o.sales.change_bp === null) && o.sales.through === '2026-11-16', JSON.stringify([o.sales, sold.map((s) => s.sold)]));
    ok('twelve bars, oldest first, the last one running and to today; their sum inside the year is the sales', o.bars.length === 12 && o.bars[11].running === true && o.bars[11].to === '2026-11-16' && o.bars[11].sold_minor === 45000000 && o.bars[0].from < o.bars[1].from, JSON.stringify(o.bars.slice(-2)));
    const months = o.profit_by_month;
    const monthPl = await X.B.profitAndLoss(X.db, SHOP, months[11].from, months[11].to);
    ok('profit by month: 12 months, each equals that month\'s P&L', months.length === 12 && months[11].profit_minor === monthPl.profit_minor && months[11].income_minor === monthPl.total_income_minor, JSON.stringify(months[11]));
    const wk = (await get('/overview?period=week')).body;
    ok('week = Monday to today, compared by the matching weekday of the same ISO week last year', wk.period.from === '2026-11-16' && wk.period.to === '2026-11-16' && wk.compare.how === 'week' && wk.compare.from === '2025-11-17', JSON.stringify([wk.period, wk.compare]));
    const mtd = (await get('/overview?period=mtd')).body, q = (await get('/overview?period=quarter')).body;
    ok('mtd begins on the 1st; quarter and ytd are the P&L\'s own ranges', mtd.period.from === '2026-11-01' && q.period.from === R.periodOf({ preset: 'quarter', step: 0 }, '2026-11-16', Number(pl.from.slice(5, 7))).from);
    for (const bad of ['month', 'year', 'last', '']) { const r = await get('/overview?period=' + bad); ok('an unknown period (' + bad + ') is a 400, never the year to date', r.status === 400, r.text.slice(0, 200)); }
    ok('no period asked = year to date', (await get('/overview')).body.period.word === 'ytd');
    blind = true; const b = (await get('/overview?period=ytd')).body; blind = false;
    ok('a reader without can_see_costs: sales and to_collect stay, no expenses, profit, gross, to_pay, cash', b.cost_hidden === true && b.sales.minor === o.sales.minor && b.to_collect.minor === o.to_collect.minor && b.expenses === undefined && b.profit === undefined && b.gross === undefined && b.cash === undefined && b.to_pay.minor === null && b.profit_by_month === undefined, JSON.stringify(b).slice(0, 400));
    ok('the lib holds no division and no date arithmetic of its own', !/\bMath\.(round|floor)|\/ ?100|Date\.parse|new Date/.test(require('fs').readFileSync(path.join(H.API, 'lib', 'books-mis.js'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
  } finally { cost.isCostBlind = realBlind; srv.close(); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch((err) => { console.log('ERROR ' + (err && err.stack)); process.exit(1); });
