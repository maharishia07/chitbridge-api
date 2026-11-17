/**
 * books-tb-compare.test.cjs — LEADER-COMPARE #2 (17 Nov 2026): the TRIAL BALANCE and the BALANCE SHEET beside the same as-at day one year earlier, the change, and the ASA 520 flag.
 * Through real Express over the in-memory ledger (an AU shop, books begin 2 Jul 2025, year from 1 Jul). Hand figures, AUD, minor units; the rule is 10% of last year AND A$1,000 (100000 minor):
 *   sale 2025-08-10: sales 10,000.00 + GST 1,000.00 = cash 11,000.00      sale 2026-08-10: sales 15,000.00 + GST 1,500.00 = cash 16,500.00     sale 2026-09-05: sales 500.00 + GST 50.00 = cash 550.00
 *   as at 2026-11-16 vs 2025-11-16 (NET = debit less credit):
 *     cash   +2,805,000 vs +1,100,000 → change +1,705,000 · +15500 bp  → OVER      sales (this FY)  -1,550,000 vs -1,000,000 → change -550,000 · -5500 bp → OVER
 *     GST    -  255,000 vs -  100,000 → change -  155,000 · -15500 bp   → OVER
 * Run: node tests/books-tb-compare.test.cjs
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
const AU = 'aaaaaaaa-8888-4111-8111-111111111111';
const authStub = Object.assign((req, res, next) => { req.identity = { identity_id: AU, identity_type: 'entity', display_name: 'Bondi Grocer' }; next(); }, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (req, res, next) => next() });
const call = (port, p) => new Promise((done) => { http.get({ host: '127.0.0.1', port, path: p }, (res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } done({ status: res.statusCode, body: j }); }); }); });

/* ── the pure part: compareTrialRows by hand (3 accounts), AUD ──
   1000 cash  now Dr 500000, was Dr 400000 → net +500000 vs +400000: change +100000, +25.00% (2500 bp), A$1,000 → OVER (both limits met exactly)
   2000 sales now Cr 90000,  was Cr 80000  → net  -90000 vs  -80000: change  -10000, -12.50% (-1250 bp), A$100 → NOT over (amount under A$1,000)
   3000 loan  now closed (nil), was Cr 700000 → net 0 vs -700000: change +700000, +100.00% of |was| (10000 bp) → OVER; listed though nil now */
const rows = [{ code: '1000', name: 'Cash', debit_minor: 500000, credit_minor: 0 }, { code: '2000', name: 'Sales', debit_minor: 0, credit_minor: 90000 }];
const was = [{ code: '1000', name: 'Cash', debit_minor: 400000, credit_minor: 0 }, { code: '2000', name: 'Sales', debit_minor: 0, credit_minor: 80000 }, { code: '3000', name: 'Loan', debit_minor: 0, credit_minor: 700000 }];
const cmp = R.compareTrialRows(rows, was, 'AUD');
eq('net now: cash +500000, sales -90000, loan 0', cmp.map((r) => r.net_minor), [500000, -90000, 0]);
eq('net last year: +400000, -80000, -700000', cmp.map((r) => r.prior_net_minor), [400000, -80000, -700000]);
eq('change: +100000, -10000, +700000', cmp.map((r) => r.change_minor), [100000, -10000, 700000]);
eq('change in basis points of |last year|: +2500, -1250, +10000', cmp.map((r) => r.change_bp), [2500, -1250, 10000]);
eq('over: cash yes (both limits met), sales no (A$100), the closed loan yes', cmp.map((r) => r.change_over), [true, false, true]);
eq('an account only last year held is listed with nothing now (debit and credit nil)', [cmp[2].code, cmp[2].debit_minor, cmp[2].credit_minor], ['3000', 0, 0]);
eq('no earlier read → the net only, no variance keys at all', Object.keys(R.compareTrialRows(rows, null, 'AUD')[0]).sort(), ['code', 'credit_minor', 'debit_minor', 'name', 'net_minor']);
eq('JPY has no decimals: the limit is 1000 yen', R.compareTrialRows([{ code: '1', debit_minor: 12000, credit_minor: 0 }], [{ code: '1', debit_minor: 10000, credit_minor: 0 }], 'JPY')[0].change_over, true);
const blind = require('../lib/dues-view').blindBooks('trial_balance', { rows: cmp, over_rule: R.overRule('AUD'), compare: { how: 'year', as_at: '2025-11-16' } });
eq('a cost-blind reader: net, prior, change, bp and over all null, never a hint of size', [blind.rows[0].net_minor, blind.rows[0].prior_net_minor, blind.rows[0].change_minor, blind.rows[0].change_bp, blind.rows[0].change_over], [null, null, null, null, null]);

(async () => {
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  X.T.identities.push({ identity_id: AU, gstn: '51824753556', display_name: 'Bondi Grocer', country: 'AU', policy_flags: { gst_registration: 'regular' } });
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const CLOCK = require(path.join(H.API, 'lib', 'shop-clock')); const setDay = (day) => CLOCK.set(day + 'T02:00:00Z');
  const sale = async (on, date, taxable, gst, ref) => { setDay(on); const r = await X.B.postEntry(X.db, AU, { type: 'walkin_day', ref, date, currency: 'AUD', modes: { cash: taxable + gst }, by_rate: [{ rate: 10, taxable, gst }] }); if (!r || r.ok === false) throw new Error('post ' + ref + ' ' + JSON.stringify(r)); };
  setDay('2025-07-02');
  await X.store.saveSetting(X.db, AU, { enabled: false, country: 'AU' });
  await new Promise((done) => http.request({ host: '127.0.0.1', port, path: '/api/books/enable', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': 2 } }, (res) => { res.resume(); res.on('end', done); }).end('{}'));
  X.T.setting.get(AU).enabled_at = '2025-07-02T02:00:00.000Z';
  await sale('2025-08-10', '2025-08-10', 10000, 1000, 'T1');
  await sale('2026-08-10', '2026-08-10', 15000, 1500, 'T2');
  await sale('2026-09-05', '2026-09-05', 500, 50, 'T3');
  setDay('2026-11-16');

  /* the first year of the books: last year's same day (before the books began) holds nothing → no comparison, said */
  const first = await call(port, '/api/books/trial-balance?asOf=2025-11-16');
  ok('the first year (as at 2025-11-16, last year before the books began): compare null, no variance on any row', first.status === 200 && first.body.compare === null && first.body.rows.every((r) => !('change_minor' in r) && 'net_minor' in r), JSON.stringify(first.body.compare));
  const tb = await call(port, '/api/books/trial-balance?asOf=2026-11-16');
  const by = (body, name) => (body.rows || []).find((r) => new RegExp(name, 'i').test(r.name));
  ok('GET /trial-balance → 200, compare names the day read (2025-11-16) and the rule is stated', tb.status === 200 && tb.body.compare && tb.body.compare.as_at === '2025-11-16' && tb.body.over_rule.min_minor === 100000, JSON.stringify([tb.status, tb.body.compare, tb.body.over_rule]));
  const cash = by(tb.body, 'cash'), sales = by(tb.body, 'sales'), gst = by(tb.body, 'gst|tax');
  eq('hand: cash net +2,805,000 vs +1,100,000 → +1,705,000, +15500 bp, OVER', cash && [cash.net_minor, cash.prior_net_minor, cash.change_minor, cash.change_bp, cash.change_over], [2805000, 1100000, 1705000, 15500, true]);
  eq('hand: sales net -1,550,000 vs -1,000,000 → -550,000, -5500 bp, OVER', sales && [sales.net_minor, sales.prior_net_minor, sales.change_minor, sales.change_bp, sales.change_over], [-1550000, -1000000, -550000, -5500, true]);
  eq('hand: GST net -255,000 vs -100,000 → -155,000, -15500 bp, OVER', gst && [gst.net_minor, gst.prior_net_minor, gst.change_minor, gst.change_bp, gst.change_over], [-255000, -100000, -155000, -15500, true]);
  eq('every row: net = dr - cr and change = net - prior (the page adds nothing)', tb.body.rows.every((r) => r.net_minor === r.dr_minor - r.cr_minor && r.change_minor === r.net_minor - r.prior_net_minor), true);
  ok('the totals still balance (debit = credit) and are the engine\'s own', tb.body.balanced === true && tb.body.total_dr_minor === tb.body.total_cr_minor, JSON.stringify([tb.body.total_dr_minor, tb.body.total_cr_minor]));

  const bs = await call(port, '/api/books/bs?asOf=2026-11-16');
  const cashBs = (bs.body.assets || []).find((x) => x.prior_year_minor === 1100000);
  eq('BS hand: cash 2,805,000 vs 1,100,000 → +1,705,000, +15500 bp, OVER (last year was already carried)', cashBs && [cashBs.amount_minor, cashBs.prior_year_minor, cashBs.change_minor, cashBs.change_bp, cashBs.change_over], [2805000, 1100000, 1705000, 15500, true]);
  ok('BS states the one rule; every line carries change_minor and change_over', bs.body.over_rule && bs.body.over_rule.pct_bp === 1000 && [].concat(bs.body.assets, bs.body.liabilities, bs.body.equity).every((x) => 'change_minor' in x && 'change_over' in x), JSON.stringify(bs.body.over_rule));
  const bsFirst = await call(port, '/api/books/bs?asOf=2025-11-16');
  ok('BS first year: no change on any line (last year held nothing), the rule still stated', bsFirst.status === 200 && [].concat(bsFirst.body.assets, bsFirst.body.liabilities, bsFirst.body.equity).every((x) => !('change_minor' in x)), JSON.stringify(bsFirst.body.compare));
  srv.close();
  console.log('\n   ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
