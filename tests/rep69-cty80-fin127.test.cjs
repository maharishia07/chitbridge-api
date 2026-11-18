#!/usr/bin/env node
// @type: unit
/**
 * tests/rep69-cty80-fin127.test.cjs — REP-69 B (practice margin/profit parity with the P&L rule) · CTY-80 (nextReturnDue fixtures) · FIN-127 (pending fixture) — offline.
 * Contract: the practice SQL and books-report-period.grossOf use ONE role list and agree on a hand-computed month; the next return due is a FINISHED period's; the FIN-127 case waits for Athi's A or B.
 * OWNS      the offline checks of REP-69 B, CTY-80 and the pending FIN-127 case (docs/critique/REP69-CTY80-FIN127-2026-11-18-PLAN.md).   CALLED BY scripts/guards.cjs.   CARD  16-finance/cash-position
 */
'use strict';
process.env.NODE_ENV = 'test';
const path = require('path');
const assert = require('assert');
const lib = (name) => require(path.join(__dirname, '..', 'lib', name));
let pass = 0, fail = 0, pending = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + String((e && e.message) || e).slice(0, 300)); } };
const todo = (name) => { pending++; console.log('  PENDING ' + name); };

console.log('\nREP-69 B · practice margin and profit agree with the P&L rule');
/* July (AUD, minor): one SV sale 110.00 with 10.00 GST -> sales account 10000; bank interest income 5.00 -> 500; purchases 60.00 -> 6000 */
const income = [{ role: 'sales', amount_minor: 10000 }, { role: 'interest_income', amount_minor: 500 }];
const expense = [{ role: 'purchases', amount_minor: 6000 }];
t('grossOf: sales 10000, cost 6000, gross profit 4000', () => {
  const g = lib('books-report-period').grossOf(income, expense, 'AUD');
  assert.deepStrictEqual([g.sales_minor, g.cost_of_sales_minor, g.gross_profit_minor], [10000, 6000, 4000]);
});
t('the practice rule on the same month: margin 40.0 and profit 4500, the numbers the SQL sums', () => {
  const g = lib('books-report-period').grossOf(income, expense, 'AUD');
  const margin = Math.round((1000 * (g.sales_minor - g.cost_of_sales_minor)) / g.sales_minor) / 10; /* the SQL: round(100.0 * (s - c) / s, 1) */
  const profit = income.reduce((a, x) => a + x.amount_minor, 0) - expense.reduce((a, x) => a + x.amount_minor, 0); /* the SQL: income - expense */
  assert.strictEqual(margin, 40); assert.strictEqual(profit, 4500);
});
t('the practice SQL reads the same role rule: sales% and the P&L cost-of-sales list, by role', () => {
  const sql = lib('books-practice').statement([], false);
  assert.ok(sql.includes("la.role LIKE 'sales%'"));
  for (const role of lib('books-report-period').COST_OF_SALES_ROLES) assert.ok(sql.includes("'" + role + "'"), role);
});

console.log('\nCTY-80 · the return that falls due next (AU, FY from July)');
const pack = lib('books').packOf({ country: 'AU', fy_start_month: 7 });
const next = lib('books-cashflow-return').nextReturnDue;
t('monthly on 18 Nov 2026 -> October, due 21 Nov 2026 (not November, 21 Dec)', () => {
  const r = next(pack, '2026-11-18', { frequency: 'monthly' });
  assert.deepStrictEqual([r.period, r.due_date], ['2026-10', '2026-11-21']);
});
t('quarterly on 10 Feb 2027 -> Q2 Oct-Dec, due 28 Feb 2027', () => {
  const r = next(pack, '2027-02-10', {});
  assert.deepStrictEqual([r.period, r.due_date], ['2026-Q2', '2027-02-28']);
});
t('quarterly on 18 Nov 2026 with Q1 (and last year Q4) lodged -> Q2 (due 28 Feb 2027): nothing falls due within 30 days', () => {
  const r = next(pack, '2026-11-18', { lodged: new Set(['2026-Q4', '2026-Q1']) });
  assert.deepStrictEqual([r.period, r.due_date], ['2026-Q2', '2027-02-28']);
});
t('Q1 NOT lodged (known) -> Q1 is the one due, its date already past', () => {
  const r = next(pack, '2026-11-18', { lodged: new Set(['2026-Q4']) });
  assert.deepStrictEqual([r.period, r.due_date], ['2026-Q1', '2026-10-28']);
});
t('the practice row (basOf) reads it: monthly is not asked there, quarterly on 10 Feb is 18 days', () => {
  const r = lib('books-practice').basOf({ country: 'AU', fy_start_month: 7 }, '2027-02-10');
  assert.deepStrictEqual([r.due_date, r.due_in_days, r.lodged_known], ['2027-02-28', 18, false]);
});

console.log('\nFIN-127 · duplicate-payment guard (waits for Athi: option A or B)');
todo('fixture 2: yesterday\'s receipt (recorded 2 min ago, dated yesterday) keyed twice today, same party and amount 250.00 -> expect same_again (A and B); today it answers none (lib/books.js:878-881, E7)');

console.log('\n' + pass + ' passed, ' + fail + ' failed, ' + pending + ' pending');
process.exit(fail ? 1 : 0);
