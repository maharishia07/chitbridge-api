/**
 * W22 (16 Nov) · the books' lock line: books start at the first month with an entry; the lock date is the end of the unbroken locked run from there; an open month under a later locked one is a gap; months before the start are flagged out.
 * Hand fixture: books start Jul 2025 (FY 2025-26, months Jul..Jun); every month locked but Feb 2026; entries from Jul 2025; Jun-Jul 2024 held as empty open months before the start.
 */
const assert = require('node:assert');
const path = require('node:path');
const B = require(path.join(__dirname, '..', 'lib', 'books.js'));
const names = ['2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
const endOf = (ym) => { const [y, m] = ym.split('-').map(Number); return ym + '-' + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0'); };
const month = (fy, n, ym, status) => ({ fiscal_year: fy, period: n, start_date: ym + '-01', end_date: endOf(ym), status });
const early = [month('2024-25', 1, '2024-07', 'open'), month('2024-25', 2, '2024-08', 'open')];
const rows = early.concat(names.map((ym, n) => month('2025-26', n + 1, ym, ym === '2026-02' ? 'open' : 'soft_locked')));
const figures = names.map((ym, n) => ({ fiscal_year: '2025-26', period: n + 1, entries: 3, sales_minor: 0 }));
(() => {
  const line = B.booksLockLine(rows, figures);
  assert.deepStrictEqual(line.books_start, { fiscal_year: '2025-26', period: 1, start_date: '2025-07-01' });
  assert.strictEqual(line.lock_date, '2026-01-31', 'Locked to Jan 2026');
  assert.deepStrictEqual(line.gaps, [{ fiscal_year: '2025-26', period: 8, start_date: '2026-02-01' }], 'Feb 2026 is the gap');
  const advice = B.periodAdvice(rows, figures, '2026-11-16', [], []);
  assert.deepStrictEqual(advice.filter((x) => x.before_books).map((x) => x.start_date), ['2024-07-01', '2024-08-01'], 'only the two months before Jul 2025 are flagged');
  assert.strictEqual(advice.filter((x) => x.fiscal_year === '2025-26').some((x) => x.before_books), false);
  /* no entries at all: no start, no lock line, nothing flagged */
  const none = B.booksLockLine(rows, []);
  assert.deepStrictEqual(none, { books_start: null, lock_date: null, gaps: [] });
  /* an unbroken run: lock date is the last locked month, no gaps */
  const clean = rows.map((x) => (x.status === 'open' && x.fiscal_year === '2025-26' ? Object.assign({}, x, { status: 'soft_locked' }) : x));
  const all = B.booksLockLine(clean, figures);
  assert.strictEqual(all.lock_date, '2026-06-30');
  assert.deepStrictEqual(all.gaps, []);
  /* nothing locked: no lock date */
  assert.strictEqual(B.booksLockLine(rows.map((x) => Object.assign({}, x, { status: 'open' })), figures).lock_date, null);
  console.log('w22 lock line: ok, 9 checks');
})();
