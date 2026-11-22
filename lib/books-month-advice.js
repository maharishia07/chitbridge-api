/**
 * books-month-advice.js — WHAT A MONTH MAY DO and the lock line / trail, as the Month lock page reads them (split out of books.js, whose size row may not grow; pure reads of rows, nothing is written).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      isLockedStatus · monthIsOver · monthsNotLocked · markBeforeBooks · booksLockLine · periodAdvice · lockTrailOf
 * CALLED BY lib/books.js (re-exported: books-period, books-practice, the pack and the routes still ask books.js)
 * FLOW      month rows + figures + today (+ tax periods, trail rows) → one lock / reopen answer per month, with its reason in words
 * CARD      16-finance/books-posting
 */
'use strict';
/** a month is locked when its status says so, soft or hard — the one reading (the month's lock advice, the handover pack) */
const isLockedStatus = (status) => status === 'soft_locked' || status === 'hard_locked';
/**
 * ⭐ ONE RULE OF "MONTHS NOT LOCKED" (l16 onerule): a month (period >= 1, never the opening period) whose last day is before today and that is not locked — WHETHER OR NOT IT HOLDS ENTRIES.
 * Xero and QuickBooks Online keep a lock (close) DATE, not an activity flag: every month up to that date is locked, a quiet month before it included, so a finished month after it is open work.
 * The Month lock page (periodAdvice: lock.why 'not over yet') and the practice list (lib/books-practice.js) both call monthIsOver / monthsNotLocked; nothing counts them a second way.
 */
const monthIsOver = (item, today) => !!(item && item.end_date && String(item.end_date).slice(0, 10) < today);
/* E3 (Fable walk 17 Nov): a month before the books start (before the first entry) is not work to lock. This is a PRODUCT control, not a Xero or MYOB rule (the E3 standard check found no source for nothing-to-lock-before-the-first-entry); the practice followed is one cut-off covering everything up to it, as MYOB and QBO keep. Once a lock date exists those months read as covered by it, never as open. Rows carry `before_books` (markBeforeBooks); the lock gate (periodAdvice), the year counts and this count all pass over them. */
const monthsNotLocked = (rows, today) => (rows || []).filter((item) => Number(item.period) >= 1 && !item.before_books && monthIsOver(item, today) && !isLockedStatus(item.status)).length;
/** a month's sort key: its year and its two-digit period, so keys compare in calendar order */
function monthKey(x) {
  return String(x.fiscal_year) + '|' + String(Number(x.period)).padStart(2, '0');
}
/** the month rows with `before_books: true` on every month before `start` ({ fiscal_year, period }: the books start, booksLockLine's own); no start (no entry yet) → none is before */
function markBeforeBooks(rows, start) {
  return (rows || []).map((x) => (start && Number(x.period) >= 1 && monthKey(x) < monthKey(start) ? Object.assign({}, x, { before_books: true }) : x));
}
/**
 * W22 (16 Nov) · THE BOOKS' LOCK LINE, one rule for the page, as Xero's one lock date and MYOB's lock period read: the books START at the first month that holds an entry (no start date is stored);
 * the LOCK DATE is the last day of the unbroken run of locked months from that start; an open month with a locked one after it is a GAP (a real hole in the lock); months before the start are not the books.
 * → { books_start: { fiscal_year, period, start_date } | null, lock_date: 'YYYY-MM-DD' | null, gaps: [{ fiscal_year, period, start_date }] } — months are 1-12 (the opening period 0 is not a month); rows in year/period order
 */
function booksLockLine(rows, figures) {
  const months = (rows || []).filter((x) => Number(x.period) >= 1),
    counted = new Set((figures || []).filter((x) => Number(x.entries) > 0 && Number(x.period) >= 1).map(monthKey)),
    first = months.findIndex((x) => counted.has(monthKey(x)));
  if (first < 0) return { books_start: null, lock_date: null, gaps: [] };
  const live = months.slice(first),
    isLocked = (x) => isLockedStatus(x.status),
    pick = (x) => ({ fiscal_year: x.fiscal_year, period: Number(x.period), start_date: String(x.start_date || '').slice(0, 10) });
  let lockedRun = 0;
  while (lockedRun < live.length && isLocked(live[lockedRun])) lockedRun += 1;
  let lastLocked = -1;
  live.forEach((x, n) => { if (isLocked(x)) lastLocked = n; });
  return {
    books_start: pick(live[0]),
    lock_date: lockedRun ? String(live[lockedRun - 1].end_date || '').slice(0, 10) || null : null,
    gaps: live.slice(lockedRun, lastLocked + 1).filter((x) => !isLocked(x)).map(pick)
  };
}
/** the month as the page names a month it points at: { fiscal_year, period, start_date } */
const monthOf = (x) => ({ fiscal_year: x.fiscal_year, period: Number(x.period), start_date: x.start_date });
/** the tax period a month ends in (ACC-204), as { return: { form, period, label, closed } } — or {} when the pack closes no return there */
function taxPeriodOf(item, taxPeriods) {
  const end = String(item.end_date || '').slice(0, 10);
  const found = Number(item.period) >= 1 && end ? (taxPeriods || []).find((taxPeriod) => taxPeriod.start <= end && end <= taxPeriod.end) : null;
  return found ? { return: { form: found.form, period: found.period, label: found.label, closed: found.closed } } : {};
}
/** may this month be locked now, and if not why (in words); `facts` = { earlier (unlocked months before it), isBefore (before the books start), lockDate, today } */
function lockAnswer(item, facts) {
  if (isLockedStatus(item.status)) return { may: false, why: 'Already locked.' };
  if (facts.isBefore && facts.lockDate) return { may: false, why: 'Covered by the lock date.' }; /* E3: one cut-off covers everything up to it, the months before the books start included */
  if (!monthIsOver(item, facts.today)) return { may: false, why: 'This month is not over yet.' };
  if (facts.earlier.length) return { may: false, why: 'Lock the earlier months first.', first: monthOf(facts.earlier[0]) };
  return { may: true, why: null };
}
/** may this month be opened again (W15-97: newest first — only when no later month is locked), and if not why; `later` = the locked months after it */
function reopenAnswer(item, later) {
  /* YE-F-05: a month the YEAR CLOSE locked opens only with the year (reopenMonth refuses it): said, and flagged so a screen offers no Reopen month on it */
  if (item.status === 'hard_locked' && require('./books-year-past').closedByYear(item)) return { may: false, why: 'Closed with the year — it opens again only with the year.', by_year: true };
  /* AK-F-03: the newest hard-locked month DOES open for the owner, with a reason (POST /periods/:fy/:p/reopen, also what /unlock now does for it): said as may true; an older one waits for the newer */
  if (item.status === 'hard_locked') return later.length ? { may: false, why: 'Closed (hard lock). Only the owner can open it again, newest closed month first, with a reason: open the later closed month first.', first: monthOf(later[later.length - 1]) } : { may: true, why: 'Closed (hard lock). Only the owner can open it again, with a reason.' };
  if (item.status !== 'soft_locked') return { may: false, why: null };
  if (!later.length) return { may: true, why: 'Opening it again needs a reason.' };
  const hardLater = later.some((x) => x.status === 'hard_locked');
  return { may: false, why: hardLater ? 'A later month is closed (hard lock), so this one stays locked until the owner opens that month again.' : 'Open the later months first.', first: monthOf(later[later.length - 1]) };
}
/**
 * ⭐ M157 — WHAT A MONTH MAY DO, said by the server, one rule: Lock is offered for a FINISHED month (its last day is before today), oldest first (every earlier
 * month of that year already locked); a soft lock can be opened again with a reason, a hard lock never. Each month carries its entries and its sales (ONE-FIGURE: sales_minor is the P&L's income for the month, before tax — set by GET /periods from B.profitAndLoss total_income_minor; the store's SUM is only the fallback shape).
 * → rows with { entries, sales_minor, lock: { may, why }, reopen: { may, why }, return?: { form, period, label, closed } }
 * ACC-204 (Athi, 30 Oct): the lock stays allowed; `return` names the tax period the month ends in and whether its close has run (taxPeriods =
 * books-period.returnStatesFor's periods, each with its form) — only for a pack whose return the ledgers close; India's rows are unchanged.
 * ACC-240: given `trailRows` (store.lockTrail), every month carries `lock_trail`: who locked or opened it, when, and why — the auditor reads it beside the month.
 */
function periodAdvice(rows, figures, today, taxPeriods, trailRows) {
  const lookup = new Map((figures || []).map((item) => [item.fiscal_year + '|' + item.period, item]));
  const locked = (period) => isLockedStatus(period.status);
  const line = booksLockLine(rows, figures),
    start = line.books_start,
    isBefore = (x) => !!start && Number(x.period) >= 1 && monthKey(x) < monthKey(start);
  return (rows || []).map((item, index) => {
    const monthFigures = lookup.get(item.fiscal_year + '|' + Number(item.period)) || { entries: 0, sales_minor: 0 };
    /* the earlier MONTHS (1-12, never the opening period 0) of this year and of any earlier year the books hold; the first month of the first year has none */
    const earlier = rows.slice(0, index).filter((x) => Number(x.period) >= 1 && !locked(x) && !isBefore(x)); /* E3: months before the books start are not owed a lock */
    /* W15-97: ONE lock line, as Xero's lock date reads: every month up to a point is locked and none after it, so a month opens newest first and locks oldest first (setPeriod holds the same rule) */
    const later = rows.slice(index + 1).filter((x) => Number(x.period) >= 1 && locked(x));
    const lock = lockAnswer(item, { earlier, isBefore: isBefore(item), lockDate: line.lock_date, today });
    const reopen = reopenAnswer(item, later);
    const trail = trailRows ? { lock_trail: lockTrailOf(trailRows, item) } : {};
    const openBelowLocked = !locked(item) && Number(item.period) >= 1 && later.length > 0 ? { open_below_locked: true } : {}; /* an open month with a locked one after it: the page says why (a reopened earlier month) */
    const before = isBefore(item) ? { before_books: true } : {}; /* W22: a month before the first entry is not the books; the page leaves it out */
    return Object.assign({}, item, { entries: monthFigures.entries, sales_minor: monthFigures.sales_minor, profit_minor: monthFigures.profit_minor, lock, reopen }, openBelowLocked, before, trail, taxPeriodOf(item, taxPeriods));
  });
}

/**
 * ACC-240: one month's trail from the change-log rows setPeriod wrote (new = '<status>' or '<status> — <reason>'; the reason never holds the dash first).
 * → [{ at, by, by_name, action: 'locked' | 'unlocked', from, to, reason }] oldest first. A pure read of stored words, no arithmetic.
 */
function lockTrailOf(trailRows, month) {
  const key = month.fiscal_year + '/' + Number(month.period);
  return (trailRows || [])
    .filter((row) => row.row_id === key)
    .map((row) => {
      const text = String(row.new == null ? '' : row.new),
        dashAt = text.indexOf(' — '),
        to = dashAt < 0 ? text : text.slice(0, dashAt);
      return { at: row.at, by: row.by || null, by_name: row.by_name || null, action: to === 'open' ? 'unlocked' : 'locked', from: row.old || null, to, reason: dashAt < 0 ? null : text.slice(dashAt + 3) };
    });
}

/**
 * GREY-AU (U-F-04): what a month may do is also a question of WHO asks. Lock / Open again / Reopen are the owner's (POST /periods/:fy/:p/:act is behind `owner`), so for any other seat
 * every month's lock and reopen answer says so in the seat's own sentence: the screen greys the button with it, the server still refuses the write.
 * `seat` = { owner: bool, why: the sentence } → the rows unchanged for the owner, else lock and reopen { may: false, why }.
 */
function seatAnswer(rows, seat) {
  if (!seat || seat.owner) return rows;
  return (rows || []).map((item) => Object.assign({}, item, { lock: { may: false, why: seat.why }, reopen: Object.assign({}, item.reopen, { may: false, why: seat.why }) }));
}

module.exports = { seatAnswer, isLockedStatus, monthIsOver, monthsNotLocked, markBeforeBooks, booksLockLine, periodAdvice, lockTrailOf };
