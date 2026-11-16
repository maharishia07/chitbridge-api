/**
 * books-year-past.js — THE YEARS BEFORE LAST CLOSE, OLDEST FIRST, WITHOUT RE-PREPARING THEIR RETURNS (PAST-YEARS, Athi 16 Nov 2026; the 150-client / 7-year measurement).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      closedYearAnswer(…) (LODGED-LATER: the declaration on a year already closed) · yearCloseReason(fy, lodged) · lodgedOf(rows) · howClosed(rows) · howYearClosed(…) · withStates(…) · orderRefusal(…) · judge(…) · pastReturnYears(…) — the words a closed month carries and the three questions the year close asks of a PAST year
 * CALLED BY lib/books.js (yearState · closeYear) · lib/books-period.js (taxPeriodState · taxReturn) · lib/books-action.js (the adviser's year_close body)
 * FLOW      month rows of a year (and of every year before it) → is it closed · was it closed on the owner's word that its returns were lodged · is an older year still open
 * CARD      14-accounting/README
 *
 * ⭐ WHY A DECLARATION, NOT A RE-PREPARATION. A practice that moves in with years of history has lodged those returns long ago, outside these books. The year close used to wait for every return
 *   period of the year to be CLOSED here (a set-off entry, or months a tax close locked) and the tax close takes only last year and this year, so no older year could ever close. The owner (or the
 *   adviser, through the maker-checker year_close) now says "the returns of this year were lodged": a RECORDED FACT, not a switch — it is stored where the close already writes (the reason of
 *   every month it hard-locks, and the change log), nothing is posted, and a year closed without it is judged exactly as before. The books stay "Prepared, not lodged": the product never lodges.
 * ⚠️ PRODUCT POLICY, NOT LAW. Taking the owner's word that the returns were lodged is OUR rule for a year the shop moved in with; it is not drawn from, and cites, no tax statute (the ATO pages were not
 *   readable when this was built). The declaration is never a switch that changes a tax figure: nothing is posted, the books stay 'Prepared, not lodged', and the refusal without it is unchanged.
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

/** a period's months read from the books: how a YEAR CLOSE left them (howClosed) — async because it reads the month rows (books-period-lock) */
async function howYearClosed(handle, entity, setting, span, rows) {
  const { monthsCovered } = require('./books-period-lock');
  return howClosed((await monthsCovered(handle, entity, setting, span, rows)).map((month) => month.row));
}

/** the pack's period table + returnStatesFor's answer (one entry per financial year) → each period with `ended` and `state` ('set_off' | 'months_locked' | 'year_closed' | 'declared_lodged' | 'open') and `closed`; no state where no return is closed here (the shop charges no tax) */
function withStates(periods, years, today) {
  const byCode = new Map();
  years.forEach((year) => year.periods.forEach((item) => byCode.set(item.period, item)));
  return periods.map((item) => Object.assign({}, item, { ended: item.end <= today }, byCode.has(item.period) ? { state: byCode.get(item.period).how || 'open', closed: byCode.get(item.period).closed } : {}));
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

/**
 * the year close's two PAST-YEARS questions, asked of the refusals yearState has built (mutates them): the older-year order (unshifted) and the owner's word that the open returns were lodged
 * (the return_open refusal is dropped). → { can_close_if_lodged, waived, returns_lodged } for yearState's answer. p = { open, lodged, closingOk, stopNames, allRows, fiscalYear, pack, shopDay, E, addDays }
 */
function judge(refusals, p) {
  const older = orderRefusal(p.allRows, p.fiscalYear, p.pack, p.shopDay, p.E, p.addDays);
  if (older) refusals.unshift(older);
  const waived = p.lodged && p.open.length ? p.open : [];
  if (waived.length) refusals.splice(0, refusals.length, ...refusals.filter((x) => x.name !== 'return_open'));
  const stops = refusals.filter((x) => p.stopNames.includes(x.name) && x.name !== 'return_open');
  const yearRows = p.allRows.filter((row) => row.fiscal_year === p.fiscalYear); /* LODGED-LATER: the declaration, read back through the one reader (howClosed), for the status */
  return { can_close_if_lodged: p.closingOk && !stops.length && p.open.length > 0, waived, returns_lodged: closedRows(yearRows) && howClosed(yearRows) === 'declared_lodged' };
}

/** the financial years the BAS list names: the two it always had (last year and this year) and every year the books hold rows for, oldest first, at most 31 (the carry's own reach) */
function pastReturnYears(bookYears, last, current) {
  return Array.from(new Set([].concat((bookYears || []).slice(-31), [last, current]))).sort();
}

/**
 * LODGED-LATER (Athi 16 Nov 2026 · found on sit-grund): filing comes AFTER the books are closed, so `returns_lodged:true` on a year ALREADY closed records the declaration if it is not recorded yet:
 * the same words the closing call writes on every month (yearCloseReason) and a change-log record, with who and when. Nothing is posted, no period is reopened, a repeat writes nothing.
 * The answer carries the state (`returns_lodged`, read back through howClosed, the one reader) and `declared` (true only on the call that wrote it). Withdrawing a declaration is not built (backlog).
 */
async function closedYearAnswer(handle, entity, fiscalYear, by, state, opts, S) {
  const had = howClosed(state.rows) === 'declared_lodged';
  const declare = !!(opts && opts.returnsLodged) && !had;
  if (declare) {
    for (const r of state.rows) {
      if (r.status !== 'hard_locked') continue;
      await S.setPeriodStatus(handle, entity, fiscalYear, Number(r.period), 'hard_locked', by, yearCloseReason(fiscalYear, true));
    }
    await S.logChange(handle, entity, { by, table_name: 'fiscal_period', row_id: fiscalYear, field: 'returns_lodged', old: 'not recorded', new: 'returns lodged outside the books, said after the close: ' + fiscalYear });
  }
  return { ok: true, duplicate: !declare, declared: declare, returns_lodged: had || declare, fiscal_year: fiscalYear, next: state.next };
}

module.exports = { closedYearAnswer, howYearClosed, withStates, CLOSE_PREFIX, LODGED_WORDS, yearCloseReason, closedByYear, howClosed, closedRows, orderRefusal, judge, pastReturnYears };
