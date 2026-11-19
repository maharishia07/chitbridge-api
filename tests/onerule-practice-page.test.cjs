#!/usr/bin/env node
// @type: unit
/**
 * tests/onerule-practice-page.test.cjs — l16 onerule: the practice row and the client's own page say the SAME value for the same fact, for every seeded client (in-memory, offline).
 * The defect class: the practice read (lib/books-practice.js, a batch read) had its own SQL per fact while the client pages used other functions, so the two drifted (unexplained, Bank "Missing", months not locked).
 * Here each client is a set of stored rows (fiscal_period months, signed bank statements); the PAGE side is the page's own function (books.periodAdvice for the Month lock page, bank-rec-log.unexplained for the Bank home),
 * the PRACTICE side is books-practice.shape over the same rows. Every fact in FACTS is compared for every client; add a fact to the practice row = add it to FACTS (the table the guard reads).
 * HAND-COMPUTED  Moonee (today 2026-11-16, FY Jul-Jun): Jul has no entries, Aug-Oct hold entries, none locked → 4 months not locked (Xero/QBO lock-date rule: a quiet finished month before no lock is open);
 *   Nov is not over → not counted. Locked Jul-Jun last year → 0. Soft-locked Jul-Aug, Sep-Oct open → 2. Hard-locked counts as locked.
 * OWNS      the offline consistency guard of practice vs page.   CALLED BY scripts/guards.cjs.   CARD  04-network/ACC-176-AUDITOR-GRANT
 */
'use strict';
process.env.NODE_ENV = 'test';
const path = require('path');
const assert = require('assert');
const B = require(path.join(__dirname, '..', 'lib', 'books.js'));
const P = require(path.join(__dirname, '..', 'lib', 'books-practice.js'));
const BR = require(path.join(__dirname, '..', 'lib', 'bank-rec-log.js'));
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + String((e && e.message) || e).slice(0, 300)); } };

const TODAY = '2026-11-16';
/* a financial year Jul-Jun: months of 2026-27 (period 1..12) plus the opening period 0 */
const END = ['2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31'];
const START = ['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01'];
const months = (statuses) => [{ fiscal_year: 'FY2026-27', period: 0, start_date: '2026-06-30', end_date: '2026-06-30', status: 'open' }].concat(
  statuses.map((status, i) => ({ fiscal_year: 'FY2026-27', period: i + 1, start_date: START[i], end_date: END[i], status })));
const CLIENTS = [
  { name: 'Moonee: Jul-Dec open, Jul empty', rows: months(['open', 'open', 'open', 'open', 'open', 'open']), entries: [0, 5, 7, 3, 1, 0], bank: [] },
  { name: 'all finished months soft-locked', rows: months(['soft_locked', 'soft_locked', 'soft_locked', 'soft_locked', 'open', 'open']), entries: [2, 5, 7, 3, 1, 0], bank: [{ account_id: 'a', period_to: '2026-10-31', difference_minor: 0, currency: 'AUD' }] },
  { name: 'two locked, two open, one hard', rows: months(['soft_locked', 'hard_locked', 'open', 'open', 'open', 'open']), entries: [2, 5, 0, 3, 1, 0], bank: [{ account_id: 'a', period_to: '2026-09-30', difference_minor: -2500, currency: 'AUD' }, { account_id: 'b', period_to: '2026-10-31', difference_minor: 100, currency: 'USD' }] },
  { name: 'nothing finished yet', rows: months(['open', 'open', 'open', 'open', 'open', 'open']).map((r) => (r.period >= 1 ? Object.assign({}, r, { end_date: '2027-0' + r.period + '-28' }) : r)), entries: [0, 0, 0, 0, 0, 0], bank: [] }
];
const GRANT = { can_see_costs: true, preset: 'auditor', grant_id: 'g', grantor_name: 'x', granted_at: '2026-01-01', expires_at: '2027-12-31' };

/* the PAGE's side of each fact: the function the client's own page calls */
const pageMonths = (c) => {
  const figures = c.entries.map((n, i) => ({ fiscal_year: 'FY2026-27', period: i + 1, entries: n, sales_minor: 0 }));
  const advice = B.periodAdvice(c.rows, figures, TODAY, [], null);
  /* the Month lock page: a month it offers or waits on (not locked, and its last day is past) = a month still to lock */
  return advice.filter((x) => Number(x.period) >= 1 && !B.isLockedStatus(x.status) && x.lock.why !== 'This month is not over yet.').length;
};
const pageBank = (c) => BR.unexplainedOf(c.bank);

const FACTS = [
  ['months_unlocked', (row) => row.months_unlocked, pageMonths],
  ['bank.unexplained_minor', (row) => row.bank.unexplained_minor, (c) => pageBank(c).unexplained_minor],
  ['bank.currency', (row) => row.bank.currency, (c) => pageBank(c).currency],
  ['bank.reconciled_to', (row) => row.bank.reconciled_to, (c) => pageBank(c).to],
  ['bank.state', (row) => row.bank.state, (c) => (!c.bank.length ? 'none' : pageBank(c).by_currency.length ? 'unexplained' : 'reconciled')]
];

console.log('\nl16 onerule · practice row = the client page, every fact, every seeded client');
for (const c of CLIENTS) {
  /* the practice statement's own columns, as the store gives them for these rows */
  const stored = {
    entity_id: 'e', setting: { country: 'AU', fy_start_month: 7, functional_currency: 'AUD', enabled: true }, currencies: 1, cash_minor: 0, items: [], queries: { open: 0, on_us: 0 },
    month_rows: c.rows.filter((r) => Number(r.period) >= 1).map((r) => ({ period: r.period, end_date: r.end_date, status: r.status })),
    /* what the OLD statement said: open, finished months that hold entries */
    months_unlocked: c.rows.filter((r, i) => r.period >= 1 && r.status === 'open' && r.end_date < TODAY && c.entries[r.period - 1] > 0).length,
    bank: c.bank.length ? { accounts: c.bank.length, rows: c.bank } : null
  };
  const row = P.shape(stored, GRANT, null, TODAY);
  for (const [fact, practice, page] of FACTS) t(c.name + ' · ' + fact + ' · practice = page', () => assert.deepStrictEqual(practice(row), page(c)));
}
t('hand-computed: Moonee has 4 months not locked (July has no entries and still counts), as the page lists them', () => {
  const row = P.shape({ entity_id: 'e', setting: null, currencies: 1, queries: null, items: [], month_rows: CLIENTS[0].rows.map((r) => ({ period: r.period, end_date: r.end_date, status: r.status })), bank: null }, GRANT, null, TODAY);
  assert.strictEqual(row.months_unlocked, 4); assert.strictEqual(pageMonths(CLIENTS[0]), 4);
});
t('the opening period (0) and a month not yet over are never counted', () => {
  assert.strictEqual(B.monthsNotLocked([{ period: 0, end_date: '2026-06-30', status: 'open' }, { period: 11, end_date: '2026-11-30', status: 'open' }], TODAY), 0);
});
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
