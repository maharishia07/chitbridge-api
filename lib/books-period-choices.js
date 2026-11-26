/**
 * books-period-choices.js — the ONE period a firm looks at (Athi 16 Nov, W8/W14/W15/W17/W18): what GET /periods adds so every view opens on the same period and the picker can say each month's state.
 * OWNER     cb-reports
 * RISK      money (none: counts only) · privacy (counts, never entries)
 * OWNS      underReview(rows, today) · checkedByMonth(db, entity, rows, figures) · withChecked(rows, byMonth) · yearsOf(rows)
 * CALLED BY routes/books.js GET /periods (?marks=1 adds the checked counts)
 * FLOW      the periods the books hold → underReview (the year under review, practice-health.yearEndOf) → checkedByMonth (review-mark's cleared read, cut by month) → withChecked → the picker's rows
 * CARD      14-accounting/README
 * ⭐ THE YEAR UNDER REVIEW is practice-health.yearEndOf's rule (the latest financial year whose year end has passed) — called, never copied, so the practice list and this picker name the same year.
 * ⭐ CHECKED n OF m per month is review-mark's own rule (coverageSql + stillCleared): ONE read of the cleared entries across the span, cut by day into months here; never a second definition of "checked".
 */
'use strict';
const ReviewMark = require('./review-mark');
const detect = require('./mark-detect');
const Engines = require('./books-engines');
const ADOPTER = 'acc.audit';
const { monthIsOver } = require('./books-month-advice'); /* W4-13: the one reading of "a month that is over" */
const LOCKED = ['soft_locked', 'hard_locked'];
const CLEARED_READ_CAP = 5000; /* coverageSql's cleared read stops here: past it a count would be short, so the answer says "unknown" (null), never a smaller number */

/** the year under review → { fy, from, to } | null when no financial year has ended yet. `rows` are the periods as GET /periods answers them. */
function underReview(rows, today) {
  const year = require('./practice-health').yearEndOf(rows, null, today);
  return year ? { fy: year.fy, from: year.start, to: year.end } : null;
}
/** the cleared entries of the span, counted per month row: → Map('fy|period' → { checked, of }); null when the marks cannot be read (the picker then names no count). `of` is the month's entry count. */
async function checkedByMonth(db, entity, rows, figures) {
  const entries = new Map((figures || []).map((item) => [item.fiscal_year + '|' + Number(item.period), Number(item.entries)]));
  const sql = ReviewMark.coverageSql(ReviewMark.adopterOf(ADOPTER));
  const months = (rows || []).filter((row) => Number(row.period) >= 1 && entries.get(row.fiscal_year + '|' + Number(row.period)) > 0).map((row) => Object.assign({}, row, { start_date: Engines.ymd(row.start_date), end_date: Engines.ymd(row.end_date), entries: entries.get(row.fiscal_year + '|' + Number(row.period)) }));
  if (!sql || !months.length) return new Map();
  const from = months.map((row) => String(row.start_date).slice(0, 10)).sort()[0],
    to = months.map((row) => String(row.end_date).slice(0, 10)).sort().pop();
  const cleared = await db.query(sql.cleared, [entity, ADOPTER, from, to]);
  const capped = cleared.rows.length >= CLEARED_READ_CAP;
  const now = await detect.subjectsNow(db, ReviewMark.adopterOf(ADOPTER), entity, cleared.rows.map((row) => row.subject_id));
  const standing = ReviewMark.stillCleared(cleared.rows, now);
  const out = new Map();
  for (const month of months) {
    const start = String(month.start_date).slice(0, 10), end = String(month.end_date).slice(0, 10);
    out.set(month.fiscal_year + '|' + Number(month.period), { checked: capped ? null : standing.filter((row) => row.day >= start && row.day <= end).length, of: Number(month.entries) });
  }
  return out;
}
/** each month row with its checked and of (null, null for a month with no read) */
function withChecked(rows, byMonth) {
  return (rows || []).map((row) => {
    const got = byMonth && byMonth.get(row.fiscal_year + '|' + Number(row.period));
    return Object.assign({}, row, { checked: got ? got.checked : null, of: got ? got.of : null });
  });
}
/** a COUNT of entries over month rows (how many entries, how many checked) — never money, so no money figure is added up here */
function countOf(rows, pick) {
  let n = 0;
  for (const row of rows) n += Number(pick(row));
  return n;
}
/** F-67 (21 Nov) · W4-13 (26 Nov): `today` given → a month that is not over yet (its last day is not before today) is not counted (the year box said "0 of 11" while Months listed 4: one count, the months from the books' start to today).
 * one line per financial year for the year switch (W8): { fy, from, to, months, locked, entries, checked, of } from the month rows; checked / of are null unless every month with entries has a read. Newest first. */
function yearsOf(rows, today) {
  const byYear = new Map();
  for (const row of rows || []) {
    if (Number(row.period) < 1) continue;
    if (!byYear.has(row.fiscal_year)) byYear.set(row.fiscal_year, []);
    byYear.get(row.fiscal_year).push(row);
  }
  return [...byYear.entries()].map(([fy, list]) => {
    const counted = list.filter((row) => !row.before_books && (!today || monthIsOver(row, String(today).slice(0, 10)))), /* W4-13: with a day, the months OVER (monthsNotLocked's own rule, so the year box, the Months tab and the practice list say one number) */
       busy = list.filter((row) => Number(row.entries) > 0), read = busy.every((row) => row.checked != null);
    const sum = (pick) => countOf(busy, pick);
    return { fy, from: list.map((row) => String(row.start_date).slice(0, 10)).sort()[0], to: list.map((row) => String(row.end_date).slice(0, 10)).sort().pop(), months: counted.length, locked: counted.filter((row) => LOCKED.includes(row.status)).length, /* E3: months before the books start are not counted */ entries: sum((row) => row.entries), checked: read ? sum((row) => row.checked) : null, of: read ? sum((row) => row.of) : null };
  }).sort((a, b) => (a.to < b.to ? 1 : -1));
}
module.exports = { underReview, checkedByMonth, withChecked, yearsOf };
