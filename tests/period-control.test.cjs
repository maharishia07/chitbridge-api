/**
 * period-control.test.cjs — the ONE period a firm looks at (Athi 16 Nov, W14/W15/W17/W18): the year under review, each month's state, the P&L's gross profit, the trial balance at the year end.
 * Hand fixture (Australia, July year, shop day 16 Nov 2026), FY 2025-26, posted in dollars, answered in cents (minor units):
 *   sales  1,000.00 (10 Aug 2025) + 500.00 (12 Sep 2025) + 200.00 (5 Mar 2026) = 1,700.00 = 170000   (GST on top is not income)
 *   buying  600.00 (20 Sep 2025) + 100.00 (2 Apr 2026)                       =   700.00 =  70000   (cost of sales: role purchases)
 *   gross profit = 170000 - 70000 = 100000, and with no other expense the profit is the same
 *   a sale of 900.00 on 10 Aug 2026 belongs to FY 2026-27 and is in no FY 2025-26 figure
 * Proves: GET /periods names the year under review (2025-26, 1 Jul 2025 to 30 Jun 2026) · each month's `entries` · GET /pl for that year totals 170000 / 70000 with gross_profit 100000 · the trial balance at 30 Jun 2026 balances
 * and a later sale is not in it · a period with no sale account has no gross profit line (null) · the cost list is the one the practice's gross margin reads.
 * Run: node tests/period-control.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const R = require('../lib/books-report-period');
const PC = require('../lib/books-period-choices');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

/* the pure parts, hand figures */
eq('grossOf: sales 10000 less 1000 returns, cost 3000 + freight inwards 2000 (F-66: a direct cost, as the trial balance files it; wages and rent are not, batch 1126) gives 9000, 5000, 4000', R.grossOf([{ role: 'sales', amount_minor: 10000 }, { role: 'sales_returns', amount_minor: -1000 }], [{ role: 'purchases', amount_minor: 3000 }, { role: 'freight_inward', amount_minor: 2000 }, { role: 'wages', amount_minor: 900 }, { role: 'rent', amount_minor: 700 }], 'AUD'), { sales_minor: 9000, cost_of_sales_minor: 5000, gross_profit_minor: 4000 });
eq('grossOf: a purchase-returns account on the income side comes off the cost (3000 less 500)', R.grossOf([{ role: 'sales', amount_minor: 10000 }, { role: 'purchase_returns', amount_minor: 500 }], [{ role: 'purchases', amount_minor: 3000 }], 'AUD').cost_of_sales_minor, 2500);
eq('grossOf: no sales account means no gross profit line', R.grossOf([{ role: 'other_income', amount_minor: 100 }], [], 'AUD'), null);
eq('the practice gross margin reads this one list of cost-of-sales roles', R.COST_OF_SALES_ROLES, ['purchases', 'changes_in_inventories', 'purchase_returns', 'freight_inward', 'packing']);
const rows = [1, 2].map((p) => ({ fiscal_year: '2025-26', period: p, start_date: '2025-0' + (6 + p) + '-01', end_date: '2025-0' + (6 + p) + '-28', entries: 3, status: 'soft_locked' }));
eq('withChecked: a month with no read says null, never 0', PC.withChecked(rows, new Map([['2025-26|1', { checked: 3, of: 3 }]])).map((r) => [r.checked, r.of]), [[3, 3], [null, null]]);

const monthRows = [{ fiscal_year: '2025-26', period: 1, start_date: '2025-07-01', end_date: '2025-07-31', entries: 40, status: 'soft_locked', checked: 40, of: 40 }, { fiscal_year: '2025-26', period: 2, start_date: '2025-08-01', end_date: '2025-08-31', entries: 10, status: 'open', checked: 4, of: 10 }, { fiscal_year: '2025-26', period: 0, start_date: '2025-07-01', end_date: '2025-07-01', entries: 0, status: 'open' }];
eq('yearsOf: 40 + 10 entries, one of two months locked, 44 of 50 checked (hand sum); the opening row is not a month', PC.yearsOf(monthRows), [{ fy: '2025-26', from: '2025-07-01', to: '2025-08-31', months: 2, locked: 1, entries: 50, checked: 44, of: 50 }]);
eq('yearsOf: a month with entries and no read makes the year say null, never a short sum', PC.yearsOf(monthRows.map((r, i) => (i === 1 ? Object.assign({}, r, { checked: null, of: null }) : r)))[0].checked, null);

const AU = 'aaaaaaaa-1111-4111-8111-111111111111';
const WHO = { identity_id: AU, identity_type: 'entity', display_name: 'Bondi Grocer' };
const authStub = Object.assign((req, res, next) => { req.identity = WHO; next(); }, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (req, res, next) => next(), requireOwner: () => (req, res, next) => next() });
const call = (port, p, method) => new Promise((done) => {
  const r = http.request({ host: '127.0.0.1', port, path: p, method: method || 'GET', headers: { 'Content-Type': 'application/json', 'Content-Length': method === 'POST' ? 2 : 0 } }, (res) => {
    let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); });
  });
  if (method === 'POST') r.write('{}');
  r.end();
});

(async () => {
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
  const get = (p) => call(port, '/api/books' + p);
  let DAY = '2026-11-16'; const realDay = K.dayOf;
  K.dayOf = (ts, c) => (ts instanceof Date && Math.abs(ts.getTime() - Date.now()) < 5000 ? DAY : realDay(ts, c));
  DAY = '2025-07-02'; /* the books begin in FY 2025-26: its months exist, so an entry lands in its own month */
  await X.store.saveSetting(X.db, AU, { enabled: false, country: 'AU' });
  await call(port, '/api/books/enable', 'POST');
  X.store.T.setting.get(String(AU)).enabled_at = '2025-07-02T01:00:00.000Z'; /* the ledger begins on FY 2025-26's first day */
  const sale = (date, taxable, tax, ref) => X.B.postEntry(X.db, AU, { type: 'walkin_day', ref, date, currency: 'AUD', modes: { cash: taxable + tax }, by_rate: [{ rate: 10, taxable, gst: tax }], round_off: 0, source_ref: 'walkin:C1:' + date });
  const buy = (date, taxable, tax, ref) => X.B.postEntry(X.db, AU, { type: 'purchase_bill', ref, date, currency: 'AUD', party: 'Fresh Foods Pty', by_rate: [{ rate: 10, taxable, gst: tax }], paid: {}, round_off: 0, source_ref: 'pur:' + ref });
  DAY = '2025-08-10'; const r1 = await sale('2025-08-10', 1000, 100, 'S1');
  DAY = '2025-09-12'; await sale('2025-09-12', 500, 50, 'S2');
  DAY = '2025-09-20'; await buy('2025-09-20', 600, 60, 'P1');
  DAY = '2026-03-05'; await sale('2026-03-05', 200, 20, 'S3');
  DAY = '2026-04-02'; await buy('2026-04-02', 100, 10, 'P2');
  DAY = '2026-08-10'; await sale('2026-08-10', 900, 90, 'S4');
  DAY = '2026-11-16';

  const per = await get('/periods');
  eq('GET /periods names the year under review: 2025-26, 1 Jul 2025 to 30 Jun 2026 (the latest year that has ended)', per.body.under_review, { fy: '2025-26', from: '2025-07-01', to: '2026-06-30' });
  const aug = (per.body.periods || []).find((p) => p.fiscal_year === '2025-26' && String(p.start_date).startsWith('2025-08'));
  const sep = (per.body.periods || []).find((p) => p.fiscal_year === '2025-26' && String(p.start_date).startsWith('2025-09'));
  ok('each month carries its entries: Aug 2025 has the sale, Sep 2025 a sale and a purchase', aug && sep && aug.entries === 1 && sep.entries === 2, JSON.stringify([aug && aug.entries, sep && sep.entries]));
  eq('C-F-01: a month carries its profit before tax from the P&L read: Sep 2025 sold 500 and bought 600 (amounts are whole units, x100 in minor) -> -10000; Aug 2025 -> 100000', [sep && sep.profit_minor, aug && aug.profit_minor], [-10000, 100000]);
  eq('the year switch line: FY 2025-26 holds 5 entries (3 sales + 2 purchases) in its months', [per.body.years.find((y) => y.fy === '2025-26').entries, per.body.years[0].fy], [5, '2026-27']);
  const marks = await get('/periods?marks=1');
  ok('?marks=1 adds checked and of on every month (the in-memory store holds no marks: null, never a made-up 0)', (marks.body.periods || []).length > 0 && marks.body.periods.every((p) => 'checked' in p && 'of' in p), JSON.stringify(marks.body.periods && marks.body.periods[0]));

  const pl = await get('/pl?from=2025-07-01&to=2026-06-30&compare=none');
  eq('FY 2025-26 P&L: income 170000, expense 70000, profit 100000 (the 900.00 sale of Aug 2026 is not in it)', [pl.body.total_income_minor, pl.body.total_expense_minor, pl.body.profit_minor], [170000, 70000, 100000]);
  eq('the P&L carries its gross profit: sales 170000 less cost of sales 70000 is 100000', pl.body.gross_profit, { sales_minor: 170000, cost_of_sales_minor: 70000, gross_profit_minor: 100000 });
  eq('the period the P&L is for rides along', [pl.body.from, pl.body.to], ['2025-07-01', '2026-06-30']);
  const tb = await get('/trial-balance?asOf=2026-06-30');
  ok('the trial balance at 30 Jun 2026 balances, as at that day', tb.body.asOf === '2026-06-30' && tb.body.balanced === true && tb.body.total_dr_minor === tb.body.total_cr_minor, JSON.stringify([tb.body.asOf, tb.body.balanced, tb.body.total_dr_minor, tb.body.total_cr_minor]));
  const tbNow = await get('/trial-balance?asOf=2026-11-16');
  ok('as at today the later sale shows: its total differs from the year end (the date is the picker\'s, the answer follows it)', tbNow.body.total_dr_minor !== tb.body.total_dr_minor, JSON.stringify([tbNow.body.total_dr_minor, tb.body.total_dr_minor]));
  const empty = await get('/pl?from=2025-07-01&to=2025-07-31&compare=none');
  eq('a month with no trading has no gross profit line', empty.body.gross_profit, null);
  srv.close();
  console.log('\n   ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
