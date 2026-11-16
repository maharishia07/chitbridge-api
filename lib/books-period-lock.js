/**
 * books-period-lock.js — THE MONTHS A TAX CLOSE LOCKS, and which of them read as closed (ACC-204; split out of books-period.js, whose size row may not grow).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      lockedByTaxClose(row) · lockCovered(handle, entity, shop, span, by) · closedBefore(handle, entity, shop, span, rows0) · nextMonth(isoDay)
 * CALLED BY lib/books-period.js (the tax close, the year close's wait, returnStateFor) · lib/books-period-state.js
 * FLOW      a tax period's span → its months and the rows the books hold for them → the ones a tax close locked (by the reason's PREFIX, never its label)
 * CARD      14-accounting/README
 */
'use strict';
const B = require('./books');
const E = require('./books-engines');
const S = require('./books-store');

const nextMonth = (isoDay) => {
  const y = Number(isoDay.slice(0, 4)),
    month = Number(isoDay.slice(5, 7));
  return (month === 12 ? y + 1 : y) + '-' + String(month === 12 ? 1 : month + 1).padStart(2, '0') + '-01';
};
const CLOSE_LOCK_PREFIX = 'Tax period closed — ';
const CLOSE_LOCK_REASON = (span) => CLOSE_LOCK_PREFIX + span.label;
/* ACC-204 / E8 (critic B9): a month the tax close locked is known by the reason's PREFIX, never the label text — a pack may reword a period's
   label (engines #77 "FY27 Q1 (Jul–Sep 2026)") and a close made under the old words must still read closed; each month belongs to one tax period */
const lockedByTaxClose = (row) => !!row && row.status !== 'open' && String(row.reason || '').startsWith(CLOSE_LOCK_PREFIX);
/** the months a span covers, with the row the books hold for each: [{ fiscal_year, period, row }] — ONE periods read (or the caller's rows) */
async function monthsCovered(handle, entity, shop, span, rows0) {
  const packs = E.packs(),
    pack = B.packOf(shop),
    rows = rows0 || (await S.periods(handle, entity, null)),
    months = [];
  for (let day = String(span.start).slice(0, 7) + '-01'; day <= span.end; day = nextMonth(day)) {
    const fiscalYear = packs.fiscalYearOf(day, pack),
      period = Number(packs.periodOf(day, pack));
    months.push({ fiscal_year: fiscalYear, period, row: rows.find((row) => row.fiscal_year === fiscalYear && Number(row.period) === period) || null });
  }
  return months;
}
/* ACC-204: a month the owner locked by hand before the close is RE-STAMPED with the close's reason (the owner's words stay in the change log) — a close
   that had nothing to set off leaves no entry, so the months it covers are its only record and the year close reads them (closedBefore) */
async function lockCovered(handle, entity, shop, span, by) {
  const locked = [];
  for (const month of await monthsCovered(handle, entity, shop, span)) {
    if (!month.row || month.row.status === 'hard_locked' || lockedByTaxClose(month.row)) continue;
    await B.setPeriod(handle, entity, month.fiscal_year, month.period, 'soft_locked', by, CLOSE_LOCK_REASON(span));
    locked.push({ fiscal_year: month.fiscal_year, period: month.period });
  }
  return locked;
}
/** a close that posted no entry (nothing to set off) is still a close: every month it covers is locked by a tax close (the prefix, whatever label it carried then) */
async function closedBefore(handle, entity, shop, span, rows0) {
  const months = await monthsCovered(handle, entity, shop, span, rows0);
  return months.length > 0 && months.every((month) => lockedByTaxClose(month.row));
}

module.exports = { lockedByTaxClose, lockCovered, closedBefore, nextMonth };
