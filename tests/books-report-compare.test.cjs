/**
 * books-report-compare.test.cjs — ACC-357 (W15-118 / W15-119): the P&L and the Balance sheet beside the same range last year, the picker's presets from the pack's year, net assets first.
 * Proves: the presets (This year to date · Last month · Quarter · Last year) and their ‹ › steps from the pack's financial-year start · any range vs the same days a year earlier (29 Feb safe) ·
 * a change and a share are CARRIED as basis points by the server (the page works out nothing) · /pl carries prior_minor / change_bp / share_bp on every ledger and head, and the profit's own share of income ·
 * /bs carries the prior month AND the prior year on every ledger, net assets = what is owned less what is owed = the owners' side (net_assets_ok, two carried totals compared).
 * Run: node tests/books-report-compare.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const R = require('../lib/books-report-period');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

/* ── the pure part: dates and basis points ── */
const T = '2026-11-16';
eq('This year to date (AU, year from July): 1 Jul → today', [R.periodOf({ preset: 'ytd' }, T, 7).from, R.periodOf({ preset: 'ytd' }, T, 7).to], ['2026-07-01', T]);
eq('Last month: October, whole', [R.periodOf({ preset: 'month' }, T, 7).from, R.periodOf({ preset: 'month' }, T, 7).to], ['2026-10-01', '2026-10-31']);
eq('Quarter: the pack\'s quarter of the day (Oct–Dec for a July year) to today; ‹ once = Jul–Sep whole', [R.periodOf({ preset: 'quarter' }, T, 7).from, R.periodOf({ preset: 'quarter', step: -1 }, T, 7).from, R.periodOf({ preset: 'quarter', step: -1 }, T, 7).to], ['2026-10-01', '2026-07-01', '2026-09-30']);
eq('Last year: the whole financial year before this one', [R.periodOf({ preset: 'year' }, T, 7).from, R.periodOf({ preset: 'year' }, T, 7).to], ['2025-07-01', '2026-06-30']);
eq('the same presets follow another pack\'s year (April): This year to date starts 1 Apr', R.periodOf({ preset: 'ytd' }, T, 4).from, '2026-04-01');
eq('January year (AE): Quarter is Oct–Dec', R.periodOf({ preset: 'quarter' }, T, 1).from, '2026-10-01');
ok('› is not offered at the running period (can_next false); ‹ makes it so', R.periodOf({ preset: 'month' }, T, 7).can_next === false && R.periodOf({ preset: 'month', step: -1 }, T, 7).can_next === true);
eq('any range vs the same days last year (29 Feb safe)', [R.priorOf({ from: '2028-02-29', to: '2028-03-31' }, 'year'), R.priorOf({ from: '2026-07-01', to: '2026-09-30' }, 'period')], [{ from: '2027-02-28', to: '2027-03-31' }, { from: '2026-03-31', to: '2026-06-30' }]);
eq('as at: month end · year end · stepped', [R.asAtOf({ kind: 'month' }, T, 7).as_at, R.asAtOf({ kind: 'year' }, T, 7).as_at, R.asAtOf({ kind: 'month', step: -1 }, T, 7).as_at], ['2026-10-31', '2026-06-30', '2026-09-30']);
eq('prior month of a month end stays a month end; prior year keeps the day', [R.monthsBefore('2026-03-31', 1), R.yearBefore('2026-11-16')], ['2026-02-28', '2025-11-16']);
eq('change in basis points of the earlier figure (+20.00%), none against nothing; share of income (12.50%)', [R.changeOf(12000, 10000), R.changeOf(5, 0), R.shareOf(2500, 20000)], [2000, null, 1250]);
eq('half away from zero, both signs', [R.changeOf(10001, 30000), R.changeOf(-10001, 30000)], [-6666, -13334]);

const AU = 'aaaaaaaa-1111-4111-8111-111111111111';
const WHO = { identity_id: AU, identity_type: 'entity', display_name: 'Bondi Grocer' };
const authStub = Object.assign((req, res, next) => { req.identity = WHO; next(); }, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (req, res, next) => next() });
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
  await X.store.saveSetting(X.db, AU, { enabled: false, country: 'AU' });
  await call(port, '/api/books/enable', 'POST');
  const day = (date, taxable, tax, ref) => X.B.postEntry(X.db, AU, { type: 'walkin_day', ref, date, currency: 'AUD', modes: { cash: taxable + tax }, by_rate: [{ rate: 10, taxable, gst: tax }], round_off: 0, source_ref: 'walkin:C1:' + date });
  DAY = '2026-11-16';
  await day('2026-08-10', 2000, 200, 'T1'); /* this year: 20.00 sales (+100%) */

  const pl = await get('/pl?preset=ytd');
  ok('GET /pl?preset=ytd → 200, the period says what was asked (1 Jul → the shop day) and the presets are the pack\'s four', pl.status === 200 && pl.body.period.preset === 'ytd' && pl.body.period.from === '2026-07-01' && pl.body.period.to === '2026-11-16' && pl.body.presets.length === 4, JSON.stringify(pl.body.period) + pl.status);
  eq('the comparison is the same days one year earlier; the books began 1 Jul 2026, so last year holds nothing and says so (income 0, no percent)', [pl.body.compare.from, pl.body.compare.to, pl.body.compare.total_income_minor, pl.body.compare.income_change_bp], ['2025-07-01', '2025-11-16', 0, null]);
  const head = pl.body.by_line.income.find((x) => x.accounts.some((a) => a.amount_minor === 200000));
  ok('the sales ledger carries this year 2,000.00, last year 0, no percent against nothing, 100.00% of income (10000 bp) — all the servers own', head && head.accounts[0].prior_minor === 0 && head.accounts[0].change_bp === null && head.accounts[0].share_bp === 10000, JSON.stringify(head));
  ok('every head carries prior_minor · change_bp · share_bp, and the profit its share of income', pl.body.by_line.income.every((x) => 'prior_minor' in x && 'change_bp' in x && 'share_bp' in x) && pl.body.profit_share_bp === 10000, JSON.stringify([pl.body.profit_share_bp, pl.body.compare]));
  /* the matching of a ledger to its earlier figure, by code, with hand figures (a ledger new since then reads 0) */
  const lines = R.compareLines([{ line: 'revenue', amount_minor: 3000, accounts: [{ code: '4000', amount_minor: 2000 }, { code: '4010', amount_minor: 1000 }] }], [{ line: 'revenue', amount_minor: 1600, accounts: [{ code: '4000', amount_minor: 1600 }] }], 3000, 1600);
  eq('compareLines: 4000 was 16.00 → +25.00% and 66.67% of income; 4010 is new → 0, no percent; the head +87.50%', [lines[0].accounts[0].prior_minor, lines[0].accounts[0].change_bp, lines[0].accounts[0].share_bp, lines[0].accounts[1].prior_minor, lines[0].accounts[1].change_bp, lines[0].change_bp], [1600, 2500, 6667, 0, null, 8750]);
  const none = await get('/pl?preset=ytd&compare=none');
  ok('?compare=none → no comparison, the figures unchanged', none.body.compare === null && none.body.total_income_minor === pl.body.total_income_minor);
  const plain = await get('/pl?from=2026-07-01&to=2026-09-30');
  ok('the old call (from · to) still answers: custom, with last year\'s same range beside it', plain.status === 200 && plain.body.period.preset === 'custom' && plain.body.compare.from === '2025-07-01', JSON.stringify(plain.body.period));

  const bs = await get('/bs?kind=today');
  ok('GET /bs?kind=today → as_at, the prior month and the prior year on the same view', bs.status === 200 && bs.body.as_at.kind === 'today' && bs.body.compare.month.as_at === '2026-10-16' && bs.body.compare.year.as_at === '2025-11-16', JSON.stringify(bs.body.as_at) + JSON.stringify(bs.body.compare));
  ok('net assets lead: owned less owed = the owners\' side (two carried totals compared, net_assets_ok)', bs.body.net_assets_ok === true && bs.body.net_assets_minor === bs.body.total_equity_minor, JSON.stringify([bs.body.net_assets_minor, bs.body.total_equity_minor, bs.body.net_assets_ok]));
  const cash = bs.body.assets.find((x) => x.amount_minor === 220000);
  ok('a ledger carries its figure a month ago and a year ago, and the pack\'s heading it sits under', cash && cash.prior_year_minor === 0 && cash.prior_month_minor === 220000 && cash.group && cash.group.name, JSON.stringify(cash));
  const end = await get('/bs?kind=month&step=-1');
  ok('as at the end of last month, stepped back once: 30 Sep 2026', end.body.as_at.as_at === '2026-09-30' && end.body.as_at.can_next === true, JSON.stringify(end.body.as_at));
  srv.close();
  console.log('\n   ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
