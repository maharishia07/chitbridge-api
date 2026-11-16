/**
 * books-year-past.js — THE YEARS BEFORE LAST CLOSE, OLDEST FIRST, WITHOUT RE-PREPARING THEIR RETURNS (PAST-YEARS, Athi 16 Nov 2026; the 150-client / 7-year measurement).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      yearCloseReason(fy, lodged) · lodgedOf(rows) · howClosed(rows) · orderRefusal(…) · pastReturnYears(…) — the words a closed month carries and the three questions the year close asks of a PAST year
 * CALLED BY lib/books.js (yearState · closeYear) · lib/books-period.js (taxPeriodState · taxReturn) · lib/books-action.js (the adviser's year_close body)
 * FLOW      month rows of a year (and of every year before it) → is it closed · was it closed on the owner's word that its returns were lodged · is an older year still open
 * CARD      14-accounting/README
 *
 * ⭐ WHY A DECLARATION, NOT A RE-PREPARATION. A practice that moves in with years of history has lodged those returns long ago, outside these books. The year close used to wait for every return
 *   period of the year to be CLOSED here (a set-off entry, or months a tax close locked) and the tax close takes only last year and this year, so no older year could ever close. The owner (or the
 *   adviser, through the maker-checker year_close) now says "the returns of this year were lodged": a RECORDED FACT, not a switch — it is stored where the close already writes (the reason of
 *   every month it hard-locks, and the change log), nothing is posted, and a year closed without it is judged exactly as before. The books stay "Prepared, not lodged": the product never lodges.
 * ⭐ ORDER. A closed year opens the next one at its carry (CBLedger.carryForward, computed from the year before): closing a year while an older one is open would let a late correction move a closed year's opening.
 *   So a year older than last year closes only when every earlier year the books hold is closed (previous_year_open). Last year and this year keep today's rules.
 */
'use strict';

const CLOSE_PREFIX = 'Year close ';
const LODGED_WORDS = ' — returns lodged outside the books';

/** the reason every month of a year carries when it is hard locked; `lodged` when the returns were declared lodged */
const yearCloseReason = (fiscalYear, lodged) => CLOSE_PREFIX + fiscalYear + (lodged ? LODGED_WORDS : '');
/** one month row closed by a year close, and on the declaration */
const closedByYear = (row) => !!row && row.status === 'hard_locked' && String(row.reason || '').startsWith(CLOSE_PREFIX);
const lodgedRow = (row) => closedByYear(row) && String(row.reason).endsWith(LODGED_WORDS);

/** the months of a span (rows, null where the books hold none) → how the year close left them: 'declared_lodged' | 'year_closed' | null (not closed by a year close) */
function howClosed(monthRows) {
  const rows = monthRows || [];
  if (!rows.length || !rows.every(closedByYear)) return null;
  return rows.every(lodgedRow) ? 'declared_lodged' : 'year_closed';
}

/** twelve months, every one hard locked: the year is closed (the same test books.periodsOf and yearState use) */
const closedRows = (rows) => {
  const months = (rows || []).filter((row) => Number(row.period) >= 1);
  return months.length >= 12 && months.every((row) => row.status === 'hard_locked');
};

/** the financial year before last year, as the shop's day names it: years from here on keep today's rule */
function lastYearOf(pack, shopDay, E, addDays) {
  const packs = E.packs(),
    current = packs.fiscalYearOf(shopDay, pack);
  return packs.fiscalYearOf(addDays(packs.fyRange(current, pack).start, -1), pack);
}

/**
 * the refusal "an older year is still open", or null. Only a year OLDER than last year is asked (last year and this year are judged as they always were).
 * allRows = every fiscal_period row the books hold; an earlier year with rows that is not closed names the oldest such year.
 */
function orderRefusal(allRows, fiscalYear, pack, shopDay, E, addDays) {
  if (!shopDay || !(fiscalYear < lastYearOf(pack, shopDay, E, addDays))) return null;
  const years = Array.from(new Set(allRows.map((row) => row.fiscal_year))).filter((year) => year < fiscalYear).sort();
  const open = years.find((year) => !closedRows(allRows.filter((row) => row.fiscal_year === year)));
  if (!open) return null;
  return { name: 'previous_year_open', why: 'Close ' + open + ' first — the years close oldest first, so each one opens at what the year before closed with.' };
}

/** the financial years the BAS list names: the two it always had (last year and this year) and every year the books hold rows for, oldest first, at most 31 (the carry's own reach) */
function pastReturnYears(bookYears, last, current) {
  return Array.from(new Set([].concat((bookYears || []).slice(-31), [last, current]))).sort();
}

module.exports = { CLOSE_PREFIX, LODGED_WORDS, yearCloseReason, closedByYear, howClosed, closedRows, orderRefusal, pastReturnYears };
