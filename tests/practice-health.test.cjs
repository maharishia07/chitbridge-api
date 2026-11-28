#!/usr/bin/env node
// @type: unit
/**
 * tests/practice-health.test.cjs — l16/firm-dash: the practice rule and the practice read's pure parts (offline).
 * Contract: statusOf says Doing well / Watch / Needs help with a short reason and never reads an unknown figure as bad or good; the band counts equal the filters; the one statement is ONE statement (queryAsEach refuses a second); a client whose grant is ended is never read.
 * OWNS      the offline checks of lib/practice-health.js and lib/books-practice.js (figuresOf, statement, basOf).   CALLED BY scripts/guards.cjs.   CARD  04-network/ACC-176-AUDITOR-GRANT
 */
'use strict';
process.env.NODE_ENV = 'test';
const path = require('path');
const assert = require('assert');
const H = require(path.join(__dirname, '..', 'lib', 'practice-health.js'));
const P = require(path.join(__dirname, '..', 'lib', 'books-practice.js'));
const grants = require(path.join(__dirname, '..', 'lib', 'books-grant.js'));
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + String((e && e.message) || e).slice(0, 300)); } };

console.log('\nl16 firm-dash · practice rule (offline)');
t('sales down 28% is Needs help, with its reason in words', () => {
  const v = H.statusOf({ sales_trend_pct: -28, profit_quarter_minor: 5 });
  assert.strictEqual(v.status, 'help'); assert.ok(v.reasons.includes('sales down 28% on the 3 months before'));
});
t('sales down 12% is Watch; flat sales and a profit are Doing well', () => {
  assert.strictEqual(H.statusOf({ sales_trend_pct: -12, profit_quarter_minor: 5 }).status, 'watch');
  assert.strictEqual(H.statusOf({ sales_trend_pct: 3, profit_quarter_minor: 5, loss_months_running: 0 }).status, 'good');
});
t('sales down 27% on the 2 months available is Needs help, and the reason names the base', () => {
  const v = H.statusOf({ sales_trend_pct: -27, sales_trend_months: 2, profit_quarter_minor: 5 });
  assert.strictEqual(v.status, 'help'); assert.deepStrictEqual(v.reasons, ['sales down 27% on the 2 months before']);
});
t('late debtors: 25% is Watch, 50% and over is Needs help, under 25% is not a reason', () => {
  const f = (p) => H.statusOf({ receivables_over60_share_pct: p, sales_trend_pct: 1, profit_quarter_minor: 5 });
  assert.strictEqual(f(24.9).status, 'good'); assert.strictEqual(f(25).status, 'watch'); assert.strictEqual(f(49.9).status, 'watch');
  assert.strictEqual(f(50).status, 'help'); assert.deepStrictEqual(f(64).reasons, ['late debtors 64%']);
  assert.strictEqual(H.RULE.help.receivables_over60_share_pct, 50); assert.strictEqual(H.RULE.watch.receivables_over60_share_pct, 25);
});
t('under 2 months of history: the trend is unknown, the reason says so, and the class stays what the other facts say', () => {
  const good = H.statusOf({ sales_trend_pct: null, sales_trend_months: 1, profit_quarter_minor: 5, loss_months_running: 0 });
  assert.deepStrictEqual([good.status, good.reasons], ['good', ['sales trend: under 2 months of history']]);
  const help = H.statusOf({ sales_trend_pct: null, sales_trend_months: 0, cash_days: 3 });
  assert.strictEqual(help.status, 'help'); assert.ok(help.reasons.includes('sales trend: under 2 months of history'));
  assert.strictEqual(H.statusOf({ sales_trend_pct: null, sales_trend_months: 0 }).status, 'none');
});
t('a loss two months running is Needs help; a loss this quarter alone is Watch', () => {
  assert.strictEqual(H.statusOf({ loss_months_running: 2, profit_quarter_minor: -1 }).status, 'help');
  assert.strictEqual(H.statusOf({ loss_months_running: 1, profit_quarter_minor: -1 }).status, 'watch');
});
t('cash under 30 days is Needs help; nothing known is "none", never Doing well', () => {
  assert.strictEqual(H.statusOf({ cash_days: 12, sales_trend_pct: 1 }).status, 'help');
  assert.strictEqual(H.statusOf({}).status, 'none');
});
t('the thresholds are one object and travel with the answer', () => { assert.ok(H.RULE.help.cash_days_below === 30 && H.RULE.source.includes('starting rule')); });
const row = (o) => Object.assign({ name: 'x', bank: { state: 'none' }, health: { status: 'good' }, queries: { open: 0, on_us: 0, on_client: 0 }, bas: { due_in_days: null }, months_unlocked: 0, checked: { n: 0, of: 0 }, grant: { ends_in_days: 200 }, action_count: 0 }, o);
t('the band counts equal the filters; the default order is Needs help first, then most action', () => {
  const rows = [row({ name: 'a', health: { status: 'good' }, action_count: 5 }), row({ name: 'b', health: { status: 'help' }, action_count: 1 }), row({ name: 'c', health: { status: 'help' }, action_count: 4, bas: { due_in_days: 10 } })];
  const band = H.bandOf(rows);
  assert.deepStrictEqual([band.health.good, band.health.help, band.return_due_30], [1, 2, 1]);
  assert.deepStrictEqual(rows.sort(H.byUrgency).map((r) => r.name), ['c', 'b', 'a']);
});
t('figures: the books own sums are read; a mixed-currency client carries none, no consent to costs hides margin and profit', () => {
  const row = { sales_trend_pct: -30, sales_trend_months: 2, last_month_sales_minor: 7000000, gross_sales_minor: 1000, gross_cost_minor: 600, profit_quarter_minor: 1300000, loss_months_running: 0, cash_minor: '5', currencies: 1 };
  const f = P.figuresOf(row, '2026-11-15', true);
  assert.deepStrictEqual([f.sales_trend_pct, f.gross_margin_pct, f.profit_quarter_minor, f.loss_months_running, f.cash_minor], [-30, 40, 1300000, 0, 5]);
  const mixed = P.figuresOf(Object.assign({}, row, { currencies: 2 }), '2026-11-15', true);
  assert.deepStrictEqual([mixed.sales_trend_pct, mixed.profit_quarter_minor, mixed.cash_minor], [null, null, null]);
  const noCosts = P.figuresOf(row, '2026-11-15', false);
  assert.deepStrictEqual([noCosts.sales_trend_pct, noCosts.gross_margin_pct, noCosts.profit_quarter_minor, noCosts.loss_months_running], [-30, null, null, null]);
});
t('the statement is one statement (no second ; outside a literal) with and without marks', () => {
  [true, false].forEach((bank) => assert.ok(!/;s*S/.test(P.statement(['cash'], bank).replace(/'(?:[^']|'')*'/g, ''))));
});
t('an ended, expired or edge_off grant is not allowed by the look (verdictOf reused)', () => {
  const live = { revoked_at: null, unexpired: true, edge_live: true, preset: 'auditor' }, req = { method: 'GET', listed: true };
  assert.strictEqual(grants.verdictOf(live, req), 'allowed');
  assert.strictEqual(grants.verdictOf(Object.assign({}, live, { revoked_at: new Date() }), req), 'revoked');
  assert.strictEqual(grants.verdictOf(Object.assign({}, live, { unexpired: false }), req), 'expired');
  assert.strictEqual(grants.verdictOf(Object.assign({}, live, { edge_live: false }), req), 'edge_off');
});
t('the multi-row look insert has one row per client in both shapes', () => {
  const seen = [];
  const tx = { query: (text, params) => { seen.push({ text, params }); return Promise.resolve({ rows: [] }); } };
  const rows = [{ grant_id: 'g1', grantor_entity: 'm1', preset: 'auditor' }, { grant_id: 'g2', grantor_entity: 'm2', preset: 'adviser' }];
  grants.writeLogRows(tx, false, rows, 'f', { actor: 'a', pattern: 'GET /practice' }, { status: 200, outcome: 'allowed' });
  grants.writeLogRows(tx, true, rows, 'f', { actor: 'a', actor_name: 'N', pattern: 'GET /practice' }, { status: 200, outcome: 'allowed' });
  assert.strictEqual((seen[0].text.match(/\(\$/g) || []).length, 2); assert.strictEqual(seen[0].params.length, 16);
  assert.strictEqual(seen[1].params.length, 20);
/* REP-66b: the nine hand-computed rows (AU year from 1 July, today 2026-11-16, minor units) through the one yoyOf */
const TODAY = '2026-11-16';
const DATES = P.yoyDates(TODAY, 7);
const yoy = (now, before, through, first, cur) => P.yoyOf({ sales_ytd_minor: now, sales_prev_ytd_minor: before, sales_through: through || '2026-11-15', sales_first: first || '2025-07-02' }, { currencies: cur || 1 }, DATES, TODAY);
t('REP-66b dates: 1 Jul to today against the same days a year back; 29 Feb maps to 28 Feb', () => {
  assert.deepStrictEqual(DATES, ['2026-07-01', '2026-11-16', '2025-07-01', '2025-11-16']);
  assert.deepStrictEqual(P.yoyDates('2028-02-29', 7), ['2027-07-01', '2028-02-29', '2026-07-01', '2027-02-28']);
});
t('REP-66b A: 120,000.00 against 150,000.00 is -20.0%, ok', () => { const r = yoy(12000000, 15000000); assert.strictEqual(r.sales_yoy_pct, -20); assert.strictEqual(r.sales_yoy_state, 'ok'); assert.strictEqual(r.sales_yoy_from, '2026-07-01'); assert.strictEqual(r.sales_prev_to, '2025-11-16'); });
t('REP-66b B and C: +10.0% and +11.1%', () => { assert.strictEqual(yoy(5500000, 5000000).sales_yoy_pct, 10); assert.strictEqual(yoy(3333300, 3000000).sales_yoy_pct, 11.1); });
t('REP-66b D: last year zero is no change and state no_last_year, never 0%', () => { const r = yoy(4200000, 0); assert.strictEqual(r.sales_yoy_pct, null); assert.strictEqual(r.sales_yoy_state, 'no_last_year'); });
t('REP-66b E: +900.0% carried true (the page caps the bar, not the figure)', () => assert.strictEqual(yoy(100000, 10000).sales_yoy_pct, 900));
t('REP-66b F: 29,985.00 against 30,000.00 is zero on the wire, not minus 0', () => { const r = yoy(2998500, 3000000); assert.strictEqual(JSON.stringify(r.sales_yoy_pct), '0'); assert.strictEqual(r.sales_yoy_state, 'ok'); });
t('REP-66b G: last sale 30 Sep (47 days) is stale, the true -33.3% still carried, with sales_through', () => { const r = yoy(6000000, 9000000, '2026-09-30'); assert.strictEqual(r.sales_yoy_state, 'stale'); assert.strictEqual(r.sales_yoy_pct, -33.3); assert.strictEqual(r.sales_through, '2026-09-30'); });
t('REP-66b H: first sale last year 1 Oct (92 days after 1 Jul) is short_last_year, no change', () => { const r = yoy(8000000, 2000000, null, '2025-10-01'); assert.strictEqual(r.sales_yoy_state, 'short_last_year'); assert.strictEqual(r.sales_yoy_pct, null); });
t('REP-66b I: two currencies are all null, state mixed', () => { const r = yoy(1, 1, null, null, 2); assert.strictEqual(r.sales_yoy_state, 'mixed'); assert.strictEqual(r.sales_ytd_minor, null); assert.strictEqual(r.sales_yoy_pct, null); });
t('REP-66b the statement also reads sales_through and sales_first from the same two bounded ranges', () => assert.ok(P.YOY_STATEMENT.includes('AS sales_through') && P.YOY_STATEMENT.includes('AS sales_first') && H.RULE.yoy_stale_days === 31));
});
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
