#!/usr/bin/env node
// @type: unit
/**
 * tests/books-before-books-lock.test.cjs — E3 (Fable multi-role walk 17 Nov): months before the books start are not work to lock.
 * A PRODUCT control (the E3 standard check found no Xero/MYOB source for it); W22's booksLockLine already says the books start at the first month holding an entry.
 * One rule (books.markBeforeBooks / before_books) read by the lock gate (periodAdvice), the practice count (monthsNotLocked, books-practice.shape) and the year line (yearsOf, yearEndOf).
 * HAND-COMPUTED  Books FY 2024-25 (Jul 2024-Jun 2025) and FY 2025-26, today 17 Nov 2026. Entries only in Jun 2025 (2024-25 period 12) and Jul 2025 (2025-26 period 1).
 *   Start = 2024-25 / 12. Months before it: 2024-25 periods 1-11 (11 months). Live and over, none locked: Jun 2025 + all 12 of 2025-26 = 13 (all 12 end before 17 Nov 2026).
 *   Raw (the defect): 11 + 13 = 24. After locking Jun 2025, Jul 2025 may lock at once (it waited for Jul 2024 before). FY 2024-25 line: 1 month, 0 locked.
 * OWNS the offline guard of E3.   CALLED BY scripts/guards.cjs.   CARD 14-accounting
 */
'use strict';
process.env.NODE_ENV = 'test';
const path = require('path');
const assert = require('assert');
const B = require(path.join(__dirname, '..', 'lib', 'books.js'));
const PC = require(path.join(__dirname, '..', 'lib', 'books-period-choices.js'));
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + String((e && e.message) || e).slice(0, 400)); } };
const TODAY = '2026-11-17';
const pad = (n) => String(n).padStart(2, '0');
const year = (fy, firstYear) => Array.from({ length: 12 }, (_, i) => {
  const m = ((6 + i) % 12) + 1, y = firstYear + (6 + i >= 12 ? 1 : 0), last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { fiscal_year: fy, period: i + 1, start_date: y + '-' + pad(m) + '-01', end_date: y + '-' + pad(m) + '-' + pad(last), status: 'open' };
});
const rows = () => year('2024-25', 2024).concat(year('2025-26', 2025));
const figures = [{ fiscal_year: '2024-25', period: 12, entries: 3, sales_minor: 0 }, { fiscal_year: '2025-26', period: 1, entries: 2, sales_minor: 0 }];

t('the books start at Jun 2025 (the first month with an entry)', () => assert.deepStrictEqual(B.booksLockLine(rows(), figures).books_start, { fiscal_year: '2024-25', period: 12, start_date: '2025-06-01' }));
const flagged = B.markBeforeBooks(rows(), B.booksLockLine(rows(), figures).books_start);
t('11 months are before the books, no more', () => assert.strictEqual(flagged.filter((x) => x.before_books).length, 11));
t('months not locked: 13 (it was 24 with the nine-and-more empty months before the books)', () => {
  assert.strictEqual(B.monthsNotLocked(flagged, TODAY), 13);
  assert.strictEqual(B.monthsNotLocked(rows(), TODAY), 24);
});
const advised = B.periodAdvice(rows(), figures, TODAY, [], null);
const at = (fy, p) => advised.find((x) => x.fiscal_year === fy && x.period === p);
t('Jun 2025 may lock at once: nothing earlier is owed', () => assert.strictEqual(at('2024-25', 12).lock.may, true));
t('Jul 2025 waits for Jun 2025 only, not for Jul 2024', () => { const l = at('2025-26', 1).lock; assert.strictEqual(l.may, false); assert.deepStrictEqual([l.first.fiscal_year, l.first.period], ['2024-25', 12]); });
t('with Jun 2025 locked, Jul 2025 may lock', () => {
  const locked = rows(); locked[11].status = 'soft_locked';
  assert.strictEqual(B.periodAdvice(locked, figures, TODAY, [], null).find((x) => x.fiscal_year === '2025-26' && x.period === 1).lock.may, true);
});
t('the year line counts the live months: FY 2024-25 = 1 month, 0 locked; FY 2025-26 = 12', () => {
  const years = PC.yearsOf(advised), a = years.find((y) => y.fy === '2024-25'), b = years.find((y) => y.fy === '2025-26');
  assert.deepStrictEqual([a.months, a.locked, b.months], [1, 0, 12]);
});
t('with a lock date, a month before the books reads covered, never open to lock', () => {
  const locked = rows(); locked[11].status = 'soft_locked'; /* Jun 2025 locked: the lock date is 2025-06-30 */
  const adv = B.periodAdvice(locked, figures, TODAY, [], null), early = adv.find((x) => x.fiscal_year === '2024-25' && x.period === 1);
  assert.strictEqual(B.booksLockLine(locked, figures).lock_date, '2025-06-30');
  assert.deepStrictEqual([early.before_books, early.lock.may, early.lock.why], [true, false, 'Covered by the lock date.']);
});
t('no lock date yet: a month before the books is not offered as covered', () => assert.notStrictEqual(at('2024-25', 1).lock.why, 'Covered by the lock date.'));
t('no entry anywhere: nothing is before the books (every month still counts)', () => assert.strictEqual(B.markBeforeBooks(rows(), null).filter((x) => x.before_books).length, 0));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
