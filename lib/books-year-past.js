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
 *   So a year closes only when every earlier year the books hold is closed (previous_year_open) — last year too (20 Nov 2026).
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
  /* YE-F-07: overdue = ended, its due day passed, and the books do not hold it closed (the same meaning as lib/return-overdue) */
  return periods.map((item) => Object.assign({}, item, { ended: item.end <= today }, byCode.has(item.period) ? { state: byCode.get(item.period).how || 'open', closed: byCode.get(item.period).closed } : {}, byCode.has(item.period) && !byCode.get(item.period).closed && item.end < today && item.due && item.due < today ? { overdue: true } : {}));
}

/** twelve months, every one hard locked: the year is closed (the same test books.periodsOf and yearState use) */
const closedRows = (rows) => {
  const months = (rows || []).filter((row) => Number(row.period) >= 1);
  return months.length >= 12 && months.every((row) => row.status === 'hard_locked');
};

/**
 * the refusal "an older year is still open", or null. YEARCLOSE (20 Nov 2026, one lock date: Xero/QuickBooks): EVERY year is asked, last year included.
 * allRows = every fiscal_period row the books hold; an earlier year with rows that is not closed names the oldest such year.
 */
function orderRefusal(allRows, fiscalYear, pack, shopDay, E, addDays) {
  const years = Array.from(new Set(allRows.map((row) => row.fiscal_year))).filter((year) => year < fiscalYear).sort();
  const open = years.find((year) => !closedRows(allRows.filter((row) => row.fiscal_year === year)));
  if (!open) return null;
  return { name: 'previous_year_open', why: 'Close ' + open + ' first — the years close oldest first, so each one opens at what the year before closed with.' };
}

/** ACC-380: the year's latest log record is a reopen (newer than its last close) → the year is being CLOSED AGAIN; and whether the returns were declared lodged when it was reopened */
const reopenedOf = (last) => !!last && last.field === 'year_reopened';
const lodgedWhenReopened = (last) => reopenedOf(last) && String(last.old || '').endsWith(LODGED_WORDS);

/**
 * the year close's PAST-YEARS questions, asked of the refusals yearState has built (mutates them): the older-year order (unshifted), the owner's word that the open returns were lodged
 * (the return_open refusal is dropped), and — ACC-380, CLOSE THE YEAR AGAIN (20 Nov 2026) — a year the owner REOPENED (p.last, the change log's latest year record): its months are open on purpose and its
 * tax periods were all closed before the reopen, so months_open and return_open are waived and the close that follows re-locks the months, which re-closes those periods (they read closed through the year close).
 * A period closed by its set-off entry stays closed; a declaration of lodged returns made before the reopen is kept (`relodged`: the close writes the same words), never lost; a year never reopened is judged as before.
 * → { can_close_if_lodged, waived, returns_lodged, closing_ok (the engine's answer, or the reopened year's with only months_open in the way), reclosing, relodged }. p = { open, lodged, closingOk, stopNames, allRows, fiscalYear, pack, shopDay, E, addDays, last }
 */
function judge(refusals, p) {
  const older = orderRefusal(p.allRows, p.fiscalYear, p.pack, p.shopDay, p.E, p.addDays);
  if (older) refusals.unshift(older);
  const reclosing = reopenedOf(p.last), closingOk = p.closingOk || (reclosing && onlyMonthsOpen(refusals, p.stopNames));
  const waived = p.lodged && p.open.length ? p.open : [];
  dropWaived(refusals, reclosing, waived.length > 0);
  const stops = refusals.filter((x) => p.stopNames.includes(x.name) && x.name !== 'return_open');
  const yearRows = p.allRows.filter((row) => row.fiscal_year === p.fiscalYear); /* LODGED-LATER: the declaration, read back through the one reader (howClosed), for the status */
  return { can_close_if_lodged: closingOk && !stops.length && p.open.length > 0 && !reclosing, waived, returns_lodged: closedRows(yearRows) && howClosed(yearRows) === 'declared_lodged', closing_ok: closingOk, reclosing, relodged: lodgedWhenReopened(p.last) };
}
/** the refusals the owner's word (lodged) or a reopen (closing again) waives are taken out, in place */
function dropWaived(refusals, reclosing, lodged) {
  const dropped = reclosing ? ['return_open', 'months_open'] : lodged ? ['return_open'] : [];
  if (dropped.length) refusals.splice(0, refusals.length, ...refusals.filter((x) => !dropped.includes(x.name)));
}
/** the engine refused a REOPENED year for nothing but its open months (or for what yearState names itself): the close again may go ahead */
const onlyMonthsOpen = (refusals, stopNames) => refusals.every((x) => x.name === 'months_open' || stopNames.includes(x.name));

/** the financial years the BAS list names: the two it always had (last year and this year) and every year the books hold rows for, oldest first, at most 31 (the carry's own reach) */
function pastReturnYears(bookYears, last, current) {
  return Array.from(new Set([].concat((bookYears || []).slice(-31), [last, current]))).sort();
}

/**
 * LODGED-LATER (Athi 16 Nov 2026 · found on sit-grund): filing comes AFTER the books are closed, so `returns_lodged:true` on a year ALREADY closed records the declaration if it is not recorded yet:
 * the same words the closing call writes on every month (yearCloseReason) and a change-log record, with who and when. Nothing is posted, no period is reopened, a repeat writes nothing.
 * The answer carries the state (`returns_lodged`, read back through howClosed, the one reader) and `declared` (true only on the call that wrote it). Withdrawing a declaration is not built (backlog).
 */
async function closedYearAnswer(handle, entity, fiscalYear, by, state, opts, store) {
  const alreadyDeclared = howClosed(state.rows) === 'declared_lodged';
  const declare = !!(opts && opts.returnsLodged) && !alreadyDeclared;
  if (declare) {
    for (const r of state.rows) {
      if (r.status !== 'hard_locked') continue;
      await store.setPeriodStatus(handle, entity, fiscalYear, Number(r.period), 'hard_locked', by, yearCloseReason(fiscalYear, true));
    }
    await store.logChange(handle, entity, { by, table_name: 'fiscal_period', row_id: fiscalYear, field: 'returns_lodged', old: 'not recorded', new: 'returns lodged outside the books, said after the close: ' + fiscalYear });
  }
  return { ok: true, duplicate: !declare, declared: declare, returns_lodged: alreadyDeclared || declare, fiscal_year: fiscalYear, next: state.next };
}

/**
 * YE-F-06 · returnStage(period, prepared) → { code, words } — the ONE stage of a return period, from the state the books give it (never a second word beside it):
 * declared_lodged (the owner said so at the year close) · overdue (ended, due day passed, not closed) · closed (its close or its year close ran) · prepared. ChitBridge never lodges, so every word but the first keeps "not lodged".
 */
function returnStage(period, prepared) {
  const p = period || {};
  if (p.state === 'declared_lodged') return { code: 'declared_lodged', words: 'Lodged, as you said' };
  if (p.overdue) return { code: 'overdue', words: 'Overdue — ' + String(prepared).charAt(0).toLowerCase() + String(prepared).slice(1) };
  if (p.closed) return { code: 'closed', words: 'Closed — ' + String(prepared).charAt(0).toLowerCase() + String(prepared).slice(1) };
  return { code: 'prepared', words: prepared };
}

/**
 * YE-F-06 · closedWith(event, rows, carry, readsMoney, currency) → the evidence of a CLOSED year, from what the books stored: { at, by, by_name, how: 'declared_lodged' | 'year_closed' | null, profit_minor? } — when it closed, by whom, whether the returns were declared lodged outside the books, and the profit carried (only for a seat that reads money).
 * A read of stored words: nothing is recomputed (profit_minor is the carry-forward's own).
 */
function closedWith(event, monthRows, carry, readsMoney, currency) {
  const e = event || {};
  return Object.assign({ at: e.at || null, by: e.by || null, by_name: e.by_name || null, how: howClosed((monthRows || []).filter((row) => Number(row.period) >= 1)) }, readsMoney && carry && carry.profit_minor != null ? { profit_minor: carry.profit_minor, currency: currency || null } : {}); /* a money figure carries its currency */
}

/**
 * AW-F-04: a year the books hold NO month rows for while they hold later years (it ended before the ledger began) cannot have its months locked — the lock route answers 404 "No such month" for every one — so the
 * engine's "lock every month ... still open: 2025-04 ..." is a refusal nobody can act on. Said as it is: the year is before the books. Mutates the refusals; the name stays (it still does not close).
 */
function beforeBooks(refusals, fiscalYear, allRows) {
  const held = (allRows || []).filter((row) => Number(row.period) >= 1), before = held.length > 0 && held.every((row) => row.fiscal_year > fiscalYear);
  const at = !before ? -1 : refusals.findIndex((x) => x.name === 'months_open');
  if (at >= 0) refusals[at] = { name: 'months_open', why: fiscalYear + ' is before these books began: it has no months to lock, so there is nothing to close. Close the first year the books hold.' };
}

module.exports = { beforeBooks, returnStage, closedWith, closedYearAnswer, howYearClosed, withStates, CLOSE_PREFIX, LODGED_WORDS, yearCloseReason, closedByYear, howClosed, closedRows, orderRefusal, judge, reopenedOf, pastReturnYears };
