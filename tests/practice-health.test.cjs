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
  assert.strictEqual(v.status, 'help'); assert.ok(v.reasons.includes('sales -28%'));
});
t('sales down 12% is Watch; flat sales and a profit are Doing well', () => {
  assert.strictEqual(H.statusOf({ sales_trend_pct: -12, profit_quarter_minor: 5 }).status, 'watch');
  assert.strictEqual(H.statusOf({ sales_trend_pct: 3, profit_quarter_minor: 5, loss_months_running: 0 }).status, 'good');
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
const row = (o) => Object.assign({ name: 'x', health: { status: 'good' }, queries: { open: 0, on_us: 0, on_client: 0 }, bas: { due_in_days: null }, months_unlocked: 0, checked: { n: 0, of: 0 }, grant: { ends_in_days: 200 }, action_count: 0 }, o);
t('the band counts equal the filters; the default order is Needs help first, then most action', () => {
  const rows = [row({ name: 'a', health: { status: 'good' }, action_count: 5 }), row({ name: 'b', health: { status: 'help' }, action_count: 1 }), row({ name: 'c', health: { status: 'help' }, action_count: 4, bas: { due_in_days: 10 } })];
  const band = H.bandOf(rows);
  assert.deepStrictEqual([band.health.good, band.health.help, band.bas_due_30], [1, 2, 1]);
  assert.deepStrictEqual(rows.sort(H.byUrgency).map((r) => r.name), ['c', 'b', 'a']);
});
t('figures: last completed month against the three before; a mixed-currency client carries no figure', () => {
  const months = [['2026-07-01', 100], ['2026-08-01', 100], ['2026-09-01', 100], ['2026-10-01', 70], ['2026-11-01', 10]].map(([start, s]) => ({ start, sales: s * 100, income: s * 100, expense: 50 * 100, cogs: 0 }));
  const f = P.figuresOf({ months, quarter_start: '2026-10-01', currencies: 1, cash_minor: 5 }, '2026-11-15', true);
  assert.strictEqual(f.sales_trend_pct, -30); assert.strictEqual(P.figuresOf({ months, currencies: 2 }, '2026-11-15', true).sales_trend_pct, null);
  assert.strictEqual(P.figuresOf({ months, quarter_start: '2026-10-01', currencies: 1 }, '2026-11-15', false).profit_quarter_minor, null); /* costs not consented */
});
t('the statement is one statement (no second ; outside a literal) with and without marks', () => {
  [true, false].forEach((marks) => assert.ok(!/;\s*\S/.test(P.statement(marks, ['cash']).replace(/'(?:[^']|'')*'/g, ''))));
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
  assert.strictEqual(seen[1].params.length, 19);
});
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
