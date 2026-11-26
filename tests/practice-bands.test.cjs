#!/usr/bin/env node
// @type: unit
/**
 * tests/practice-bands.test.cjs — REP-73 slice 1: the year-end pipeline, the seat, the bands, withheld reasons (offline).
 * OWNS      the offline checks of yearEndOf / stageOf / bandOf bands in lib/practice-health.js and shape() in lib/books-practice.js.   CALLED BY scripts/guards.cjs.   CARD  04-network/ACC-176-AUDITOR-GRANT
 */
'use strict';
process.env.NODE_ENV = 'test';
const path = require('path');
const assert = require('assert');
const H = require(path.join(__dirname, '..', 'lib', 'practice-health.js'));
const P = require(path.join(__dirname, '..', 'lib', 'books-practice.js'));
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + String((e && e.message) || e).slice(0, 300)); } };
/* FY2026 = Jul 2025 to Jun 2026 (ended 2026-06-30); FY2027 is running on TODAY */
const months = (fy, locked, status) => Array.from({ length: 12 }, (_, i) => ({ fiscal_year: fy, period: i + 1, end_date: new Date(Date.UTC(fy - 1, 6 + i + 1, 0)).toISOString().slice(0, 10), status: i < locked ? (status || 'hard_locked') : 'open' }));
const TODAY = '2026-11-16';
const rec = (to) => ({ state: 'reconciled', reconciled_to: to });
const rows = (fy26, fy27) => months(2026, fy26).concat(months(2027, fy27));

console.log('\nREP-73 · yearEndOf (Complete)');
t('last FY = the latest whose end is before today; 12 locked and bank to the FY end is complete', () => {
  const y = H.yearEndOf(rows(12, 0), rec('2026-06-30'), TODAY);
  assert.deepStrictEqual([y.fy, y.of, y.locked, y.bank_to_end, y.complete, y.first_year], [2026, 12, 12, true, true, false]);
});
t('a text fiscal year label (2025-26) is ordered by its end date, not as a number', () => {
  const lab = (fy, from) => months(from, 12).map((m) => Object.assign({}, m, { fiscal_year: fy }));
  const y = H.yearEndOf(lab('2025-26', 2026).concat(lab('2026-27', 2027)), rec('2026-06-30'), TODAY);
  assert.deepStrictEqual([y.fy, y.of, y.complete], ['2025-26', 12, true]);
});
t('soft lock counts as locked; an open month is a months blocker', () => {
  assert.strictEqual(H.yearEndOf(months(2026, 12, 'soft_locked'), rec('2026-07-31'), TODAY).complete, true);
  const open = H.yearEndOf(rows(11, 0), rec('2026-06-30'), TODAY);
  assert.deepStrictEqual([open.complete, open.blocker, open.locked], [false, 'months', 11]);
});
t('bank reconciled before the FY end, unexplained, or none is a bank blocker', () => {
  const early = H.yearEndOf(rows(12, 0), rec('2026-05-31'), TODAY);
  assert.deepStrictEqual([early.complete, early.blocker], [false, 'bank']);
  assert.strictEqual(H.yearEndOf(rows(12, 0), { state: 'unexplained', reconciled_to: '2026-06-30' }, TODAY).blocker, 'bank');
  assert.strictEqual(H.yearEndOf(rows(12, 0), { state: 'none', reconciled_to: null }, TODAY).blocker, 'bank');
});
t('fewer than 12 month rows in the FY is first_year: not complete, no blocker; no FY ended is null', () => {
  const y = H.yearEndOf(months(2026, 12).slice(3), rec('2026-06-30'), TODAY);
  assert.deepStrictEqual([y.first_year, y.complete, y.blocker], [true, false, null]);
  assert.strictEqual(H.yearEndOf(months(2027, 12), rec('2026-06-30'), TODAY), null);
  assert.strictEqual(H.yearEndOf([], rec('2026-06-30'), TODAY), null);
});

console.log('\nREP-73 · stageOf');
const r = (o) => Object.assign({ books_on: true, year_end: null }, o);
t('books on is books_in; complete is complete; no books is null', () => {
  assert.strictEqual(H.stageOf(r({})), 'books_in');
  assert.strictEqual(H.stageOf(r({ year_end: { complete: true } })), 'complete');
  assert.strictEqual(H.stageOf(r({ books_on: false })), null);
});
t('lodged is read first and is not a subset of Ready: a lodged year with open queries is lodged', () => {
  assert.strictEqual(H.stageOf(r({ year_end: { lodged: true, complete: false }, queries: { open: 2 } })), 'lodged');
});

console.log('\nREP-73 · bandOf, seat, bands');
const row = (o) => Object.assign({ name: 'x', books_on: true, stage: 'books_in', year_end: { fy: 2026, complete: false }, bank: { state: 'none' }, health: { status: 'good', codes: [], cash_days: 90, sales_trend_pct: 1, loss_months_running: 0, receivables_over60_share_pct: 0 }, queries: { open: 0, on_us: 0, on_client: 0 }, bas: { due_in_days: null }, months_unlocked: 0, to_check: 0, checked: { n: 0, of: 0 }, grant: { ends_in_days: 200, can_see_costs: true }, action_count: 0 }, o);
const done = (extra) => row(Object.assign({ stage: 'complete', year_end: { fy: 2026, complete: true } }, extra));
const pipe = (band) => Object.fromEntries(band.pipeline.map((s) => [s.key, s.n]));
t('the pipeline counts Books in, Complete and a real-0 Lodged; Checked and Ready are absent (no coverage input), not 0', () => {
  const b = H.bandOf([row({}), done(), done()], { seat: 'auditor' });
  assert.deepStrictEqual(pipe(b), { books_in: 1, complete: 2, lodged: 0 });
});
t('Complete is hidden when no client has a year end; a real 0 is drawn when one has', () => {
  assert.deepStrictEqual(pipe(H.bandOf([row({ year_end: null })], { seat: 'auditor' })), { books_in: 1 });
  assert.deepStrictEqual(pipe(H.bandOf([row({})], { seat: 'auditor' })), { books_in: 1, complete: 0, lodged: 0 });
});
t('Checked and Ready are drawn only when a client has the FY coverage input; Lodged is drawn with a year end and is not a subset of Ready', () => {
  assert.ok(!('checked' in pipe(H.bandOf([done()], { seat: 'auditor' }))));
  const ck = (extra, q) => row({ stage: extra, queries: { open: q || 0, on_us: 0, on_client: 0 }, year_end: { fy: 2026, complete: true, checked: true } });
  const lodged = row({ stage: 'lodged', queries: { open: 3, on_us: 0, on_client: 3 }, year_end: { fy: 2026, complete: false, checked: false, lodged: true } });
  const rs = [ck('ready'), ck('checked', 1), done({ year_end: { fy: 2026, complete: true, checked: false } }), lodged, row({})];
  const p = pipe(H.bandOf(rs, { seat: 'auditor' }));
  assert.deepStrictEqual(p, { books_in: 1, complete: 1, checked: 1, ready: 1, lodged: 1 });
  assert.strictEqual(Object.values(p).reduce((a, b) => a + b, 0), rs.length, 'each client counts once: the tiles sum to the clients (W2, 16 Nov)');
  for (const k of Object.keys(p)) assert.strictEqual(rs.filter((x) => x.stage === k).length, p[k], 'the filter row.stage === tile: ' + k);
});
t('stageOf: lodged first; checked and no open query is ready; open query keeps it at checked', () => {
  const y = { complete: true, checked: true };
  assert.strictEqual(H.stageOf(r({ year_end: y, queries: { open: 0 } })), 'ready');
  assert.strictEqual(H.stageOf(r({ year_end: y, queries: { open: 2 } })), 'checked');
  assert.strictEqual(H.stageOf(r({ year_end: { complete: true, checked: false } })), 'complete');
  assert.strictEqual(H.stageOf(r({ year_end: { complete: true, checked: true, lodged: true }, queries: { open: 5 } })), 'lodged');
});
t('yearEndOf: Checked = every FY entry cleared; the 5000 cap and a shortfall are not checked; no coverage is null', () => {
  const y = (c) => H.yearEndOf(rows(12, 0), rec('2026-06-30'), TODAY, c);
  assert.strictEqual(y({ checked: 40, of: 40 }).checked, true);
  assert.strictEqual(y({ checked: 39, of: 40 }).checked, false);
  assert.strictEqual(y({ checked: 5000, of: 5000, capped: true }).checked, false);
  assert.strictEqual(y({ checked: 0, of: 0 }).checked, false);
  assert.strictEqual(y(null).checked, null);
  assert.strictEqual(y({ checked: 39, of: 40 }).blocker, 'checked');
  assert.strictEqual(y({ checked: 40, of: 40 }).start, '2025-07-01');
});
t('yearEndOf: lodged is howClosed over the FY (all 12 closed by the year close with the lodged words)', () => {
  const closed = (lodged) => months(2026, 12).map((m) => Object.assign(m, { reason: 'Year close 2026' + (lodged ? ' — returns lodged outside the books' : '') }));
  assert.strictEqual(H.yearEndOf(closed(true), rec('2026-06-30'), TODAY).lodged, true);
  assert.strictEqual(H.yearEndOf(closed(false), rec('2026-06-30'), TODAY).lodged, false);
  assert.strictEqual(H.yearEndOf(months(2026, 12), rec('2026-06-30'), TODAY).lodged, false);
});
t('queries waiting over 14 days: drawn when any client has an age; counts waiting_over_14', () => {
  const none = H.bandOf([row({})], { seat: 'accountant' }).bands.find((x) => x.key === 'on_us').tiles;
  assert.ok(!none.some((x) => x.key === 'queries_over_14'));
  const rs = [row({ queries: { open: 1, on_us: 1, on_client: 0, oldest_days: 20, waiting_over_14: true } }), row({ queries: { open: 1, on_us: 1, on_client: 0, oldest_days: 3, waiting_over_14: false } })];
  assert.strictEqual(H.bandOf(rs, { seat: 'accountant' }).bands.find((x) => x.key === 'on_us').tiles.find((x) => x.key === 'queries_over_14').n, 1);
});
t('the auditor seat opens the pipeline, the accountant seat opens On us today; same numbers', () => {
  const rs = [row({ queries: { open: 1, on_us: 1, on_client: 0 }, months_unlocked: 2, to_check: 4, bank: { state: 'unexplained' }, bas: { due_in_days: 5 } }), row({})];
  const a = H.bandOf(rs, { seat: 'auditor' }), c = H.bandOf(rs, { seat: 'accountant' });
  assert.deepStrictEqual([a.seat, c.seat], ['auditor', 'accountant']);
  assert.strictEqual(a.bands.find((x) => x.first).key, 'pipeline');
  assert.strictEqual(c.bands.find((x) => x.first).key, 'on_us');
  assert.strictEqual(a.bands.filter((x) => x.first).length, 1);
  assert.deepStrictEqual(a.bands.map((x) => x.key).sort(), c.bands.map((x) => x.key).sort());
  const tile = (b, band, key) => b.bands.find((x) => x.key === band).tiles.find((x) => x.key === key).n;
  const keys = ['queries_on_us', 'bank_unexplained', 'to_check', 'months_unlocked', 'return_due_30'];
  keys.forEach((k) => assert.strictEqual(tile(a, 'on_us', k), tile(c, 'on_us', k), k));
  assert.deepStrictEqual(keys.map((k) => tile(c, 'on_us', k)), [1, 1, 1, 1, 1]);
});
t('A3P rank 6: the entries-to-check tile counts the work (entries) beside the clients behind; clients with nothing to check add 0', () => {
  const rs = [row({ to_check: 4 }), row({ to_check: 6 }), row({ to_check: 0 }), row({})];
  const tile = H.bandOf(rs, { seat: 'accountant' }).bands.find((x) => x.key === 'on_us').tiles.find((x) => x.key === 'to_check');
  assert.deepStrictEqual([tile.n, tile.entries], [2, 10]);
  const none = H.bandOf([row({})], { seat: 'accountant' }).bands.find((x) => x.key === 'on_us').tiles.find((x) => x.key === 'to_check');
  assert.deepStrictEqual([none.n, none.entries], [0, 0]);
});
t('seatOf: auditor if the roles list holds auditor; an adviser-only list is accountant', () => {
  assert.strictEqual(H.seatOf(['adviser', 'auditor']), 'auditor');
  assert.strictEqual(H.seatOf(['auditor']), 'auditor');
  assert.strictEqual(H.seatOf(['adviser']), 'accountant');
});
t('advisory: per client; a no-costs client is named not counted; a stage hides only when no client has its input; a 0 is drawn', () => {
  const cost = (codes) => row({ health: { status: 'help', codes, cash_days: 10, sales_trend_pct: -30, loss_months_running: 0, receivables_over60_share_pct: 0 } });
  const noCost = row({ grant: { ends_in_days: 9, can_see_costs: false }, health: { status: 'good', codes: [], cash_days: null, sales_trend_pct: 1, loss_months_running: null, receivables_over60_share_pct: null } });
  const adv = H.bandOf([cost(['cash_low', 'sales_down']), cost(['cash_low']), noCost], { seat: 'accountant' }).bands.find((x) => x.key === 'advisory');
  const n = (k) => (adv.tiles.find((x) => x.key === k) || {}).n;
  assert.deepStrictEqual([n('cash_low'), n('sales_down'), n('loss'), n('late_debtors')], [2, 1, 0, 0]);
  assert.strictEqual(adv.costs_not_shared, 1);
  assert.ok(!H.bandOf([noCost], { seat: 'accountant' }).bands.some((x) => x.key === 'advisory'));
  const blank = row({ health: { status: 'none', codes: [], cash_days: null, sales_trend_pct: null, loss_months_running: null, receivables_over60_share_pct: null } });
  assert.ok(!H.bandOf([blank], { seat: 'accountant' }).bands.some((x) => x.key === 'advisory'));
});
t('the accountant seat lists the oldest waiting query first, no age last, then urgency', () => {
  const a = row({ name: 'a', queries: { open: 1, on_us: 1, on_client: 0, oldest_days: 3 } }), b = row({ name: 'b', queries: { open: 1, on_us: 1, on_client: 0, oldest_days: 20 } }), c = row({ name: 'c' });
  assert.deepStrictEqual([a, c, b].sort(H.byOldest).map((x) => x.name), ['b', 'a', 'c']);
});
t('statusOf returns codes beside reasons', () => {
  const v = H.statusOf({ cash_days: 3, sales_trend_pct: -30, loss_months_running: 2, receivables_over60_share_pct: 60 });
  assert.deepStrictEqual(v.codes.slice().sort(), ['cash_low', 'late_debtors', 'loss', 'sales_down']);
  assert.deepStrictEqual(H.statusOf({ sales_trend_pct: 1, profit_quarter_minor: 5 }).codes, []);
});

console.log('\nREP-73 · shape (withheld, stage, year_end, to_check)');
const grant = (costs) => ({ grantor_name: 'C', preset: 'auditor', grant_id: 'g', can_see_costs: costs, granted_at: '2026-01-01', expires_at: '2027-01-01' });
const src = (o) => Object.assign({ entity_id: 'e', setting: { country: 'AU', fy_start_month: 7, functional_currency: 'AUD', enabled: true }, currencies: 1, cash_minor: 5, month_rows: rows(12, 0), bank: { accounts: 1, rows: [{ account_id: 'a', period_to: '2026-06-30', difference_minor: 0, currency: 'AUD' }] }, items: [], entries_of: 10, entries_checked: 4, queries: { open: 0, on_us: 0 } }, o);
t('shape adds stage, stage_blocker, year_end, to_check and withheld', () => {
  const s = P.shape(src({}), grant(true), null, TODAY);
  assert.deepStrictEqual([s.stage, s.stage_blocker, s.year_end.fy, s.to_check, s.health.withheld], ['complete', null, 2026, 6, { costs: null, currencies: null }]);
  assert.ok(Array.isArray(s.health.codes));
  assert.ok(!('stages_reached' in s), 'no cumulative list: the filter reads stage (W2)');
});
t('withheld says costs for a grant without costs and currencies for a mixed client', () => {
  assert.strictEqual(P.shape(src({}), grant(false), null, TODAY).health.withheld.costs, 'costs');
  assert.strictEqual(P.shape(src({ currencies: 2 }), grant(true), null, TODAY).health.withheld.currencies, 'currencies');
});
t('a months blocker and a bank blocker reach the row', () => {
  assert.strictEqual(P.shape(src({ month_rows: rows(10, 0) }), grant(true), null, TODAY).stage_blocker, 'months');
  assert.strictEqual(P.shape(src({ bank: null }), grant(true), null, TODAY).stage_blocker, 'bank');
});
t('W4-07: the year-end band also carries Return overdue before Due in 30 days (hand: 2 overdue of 4 clients; 1 due in 30 days)', () => {
  const rs = [row({ bas: { overdue: true, due_in_days: 60 } }), row({ bas: { overdue: true, due_in_days: 90 } }), row({ bas: { due_in_days: 12 } }), row({})];
  const tiles = H.bandOf(rs, { seat: 'auditor' }).bands.find((x) => x.key === 'pipeline').tiles;
  const keys = tiles.map((x) => x.key);
  assert.ok(keys.indexOf('return_overdue') >= 0 && keys.indexOf('return_overdue') < keys.indexOf('return_due_30'), keys.join());
  assert.strictEqual(tiles.find((x) => x.key === 'return_overdue').n, 2);
  assert.strictEqual(tiles.find((x) => x.key === 'return_due_30').n, 1);
});
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
