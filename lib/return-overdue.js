'use strict';
/**
 * lib/return-overdue.js — YE-F-07: WHICH RETURN IS OVERDUE, one rule for the owner's To do, the BAS list and the firm's row.
 * OWNER     cb-accounting
 * OWNS      overdueReturns (the pack's return periods that ended, are past due and not closed in the books) · closedByMonths (the firm's reading of closed from month locks) · daysBetween
 * CARD      14-accounting/README
 * RISK      money
 * CALLED BY lib/books-practice.js (basOf, the firm's row) · lib/books-todo.js (the owner's To do)
 * FLOW      the pack's own return periods (gst-returns.periodsFor: label, start, end, DUE) → keep those that have ended, whose due day is before today and that the books do not hold closed → oldest first.
 * ⭐ OVERDUE = the pack's due day has passed AND the period is not closed in the books (closed by its tax close, its locked months, or its year close — books-period.taxPeriodState's own
 *   meaning). ChitBridge never lodges and records no lodgement date, so the words say "not closed in the books", never "not lodged". Only a pack whose return is a read of the books (BAS) is asked.
 * Nothing is computed here that an engine owns: the due days are the pack's; this module only compares ISO days.
 */
const booksEngines = require('./books-engines');

/** the whole days from `from` to `to` (ISO 'YYYY-MM-DD'), by the shop-calendar day number the cashflow uses */
const daysBetween = (from, to) => require('./books-cashflow').day(to) - require('./books-cashflow').day(from);

/**
 * overdueReturns(pack, today, fiscalYears, closedOf) → [{ form, period, label, start, end, due, days_late }] oldest first; [] for a pack with no read-of-the-books return.
 * `closedOf(period)` says whether the books hold that period closed (the caller reads it: the owner's To do from the return states, the firm's row from the month locks).
 */
function overdueReturns(pack, today, fiscalYears, closedOf) {
  const returnsDef = (pack && pack.returns) || {};
  if (returnsDef.id !== 'BAS') return [];
  const years = Array.from(new Set((fiscalYears || []).concat(booksEngines.packs().fiscalYearOf(today, pack)).filter(Boolean))).sort();
  const out = [];
  for (const fy of years) overdueOfYear(pack, fy, today, closedOf, out);
  return out.sort((first, second) => (first.due < second.due ? -1 : first.due > second.due ? 1 : 0));
}

/** adds to `out` the periods of one fiscal year that ended, are past their due day and are not closed in the books */
function overdueOfYear(pack, fy, today, closedOf, out) {
  const table = require('./gst-returns').periodsFor(pack, { fy, frequency: 'quarterly' });
  if (!table.ok) return;
  for (const item of table.periods) {
    if (item.end < today && item.due < today && !closedOf(item)) out.push({ form: table.form, period: item.period, label: item.label, start: item.start, end: item.end, due: item.due, days_late: daysBetween(item.due, today) });
  }
}

/** the firm's reading of "closed" from a client's month rows alone: every month of the period that the books hold is locked, and at least one is held (a period wholly before the books is not owed) */
function closedByMonths(monthRows) {
  const locked = (row) => row.status === 'soft_locked' || row.status === 'hard_locked';
  return (item) => {
    const mine = (monthRows || []).filter((row) => Number(row.period) >= 1 && !row.before_books && String(row.end_date).slice(0, 10) >= item.start && String(row.end_date).slice(0, 10) <= item.end);
    return mine.length === 0 ? true : mine.every(locked);
  };
}

module.exports = { overdueReturns, closedByMonths, daysBetween };
