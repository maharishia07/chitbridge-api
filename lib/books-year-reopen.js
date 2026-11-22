/**
 * books-year-reopen.js — THE LOCK DATE MOVED BACK, AND WHAT A CLOSE SAYS BEFORE IT HAPPENS (YEARCLOSE, Athi 20 Nov 2026: accepted recommendation, leader practice).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      reopenYear(handle, entity, fy, by, reason, store, refuse) · reopenMonth(…) · closeWarnings(handle, entity, fy, ctx) — the owner's reopen of the NEWEST closed year (or the last hard-locked month) and the warnings[] a close answers
 * CALLED BY lib/books.js (reopenYear · reopenMonth · yearState/closeYear warnings) → routes/books.js (POST /year/:fy/reopen · POST /periods/:fy/:p/reopen)
 * FLOW      owner + reason → only the newest closed year / last hard-locked month → months go back to open (a status change, logged; no entry is edited) → posting is open again; the owner locks and closes again as before
 * CARD      14-accounting/README
 * ⭐ ONE LOCK DATE (Xero, QuickBooks): the lock only moves back newest first, for the owner, with a reason, in the change log. A year older than a closed one cannot be reopened (the later year opened at its carry).
 * ⭐ NO NEW CALCULATION: nothing is posted or recomputed here; the carry stays CBLedger.carryForward's, computed, never stored — reopen then close leaves every total as it was when nothing was posted between.
 * ⭐ WARNINGS ARE NOT A GATE: a close still goes ahead on the owner's word; each thing waiting is named so the owner can confirm (the web close dialog lists them).
 */
'use strict';
const yearPast = require('./books-year-past');

const need = (reason, refuse) => {
  if (!String(reason || '').trim()) throw refuse('Opening a closed period again needs a reason.', 'BOOKS_BAD_REQUEST');
};
const monthKey = (row) => row.fiscal_year + '|' + String(row.period).padStart(2, '0');

/** reopen the year: it must be closed and the newest closed one; every row of it goes back to open, logged with the reason */
async function reopenYear(handle, entity, fiscalYear, by, reason, store, refuse) {
  need(reason, refuse);
  const all = await store.periods(handle, entity, null),
    rows = all.filter((row) => row.fiscal_year === fiscalYear);
  if (!rows.length || !yearPast.closedRows(rows)) throw refuse(fiscalYear + ' is not closed, so there is nothing to open again.', 'BOOKS_BAD_REQUEST');
  const later = all.filter((row) => row.fiscal_year > fiscalYear && row.status === 'hard_locked' && Number(row.period) >= 1).map((row) => row.fiscal_year).sort()[0];
  if (later) throw refuse('Open ' + later + ' first — only the most recently closed year can be opened again, so each year keeps the opening the year before closed with.', 'BOOKS_BAD_REQUEST');
  const declared = yearPast.howClosed(rows) === 'declared_lodged'; /* a FILED return stays filed: the reopen records it, the close again writes the same words */
  const words = 'Reopened — ' + String(reason).trim().slice(0, 300);
  for (const row of rows) await store.setPeriodStatus(handle, entity, fiscalYear, Number(row.period), 'open', by, words);
  await store.logChange(handle, entity, { by, table_name: 'fiscal_period', row_id: fiscalYear, field: 'year_reopened', old: 'closed' + (declared ? yearPast.LODGED_WORDS : ''), new: 'open — ' + String(reason).trim() });
  return { ok: true, fiscal_year: fiscalYear, reopened: rows.length };
}

/** reopen ONE hard-locked month: only the newest locked month, and not a month a year close locked (that year opens as a whole) */
async function reopenMonth(handle, entity, fiscalYear, period, by, reason, store, refuse) {
  need(reason, refuse);
  const all = await store.periods(handle, entity, null),
    row = all.find((item) => item.fiscal_year === fiscalYear && Number(item.period) === Number(period));
  if (!row) throw refuse('No such month.', 'BOOKS_NOT_FOUND');
  if (row.status !== 'hard_locked') throw refuse('That month is not closed (hard lock), so there is nothing to open again.', 'BOOKS_BAD_REQUEST');
  if (yearPast.closedByYear(row)) throw refuse(fiscalYear + ' was closed as a year — open the year again, not one month.', 'BOOKS_BAD_REQUEST');
  const later = all.filter((item) => Number(item.period) >= 1 && monthKey(item) > monthKey(row) && item.status !== 'open');
  if (later.length) throw refuse('Only the last closed month can be opened again — a later month is locked.', 'BOOKS_BAD_REQUEST');
  await store.setPeriodStatus(handle, entity, fiscalYear, Number(period), 'open', by, 'Reopened — ' + String(reason).trim().slice(0, 300));
  await store.logChange(handle, entity, { by, table_name: 'fiscal_period', row_id: fiscalYear + '/' + period, field: 'status', old: 'hard_locked', new: 'open — ' + String(reason).trim() });
  return { ok: true, fiscal_year: fiscalYear, period: Number(period), status: 'open' };
}

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

/**
 * warnings[] for a close of `fiscalYear` ({ name, why, count }): entries waiting for the owner's OK or a review · bank accounts not reconciled to the year's last day · the auditor's open queries and holds on the year.
 * Every reader is the one the To do uses (books-action-queue, bank-rec-log.onTrialBalance, books-needs.openMarks); a read that fails leaves that warning out, never the close.
 * ctx = { range, chart, cur, req } (req only for the auditor's marks).
 */
async function closeWarnings(handle, entity, fiscalYear, ctx) {
  const out = [];
  /** one warning read in its own savepoint: its answer, or null (logged, left out) when it could not be read, so one failed read never aborts the close */
  const tryRead = async (name, fn) => {
    await handle.query('SAVEPOINT year_warn');
    try {
      const answer = await fn();
      await handle.query('RELEASE SAVEPOINT year_warn');
      return answer;
    } catch (err) {
      await handle.query('ROLLBACK TO SAVEPOINT year_warn').catch(require('./logger').orElse('year warnings: rollback', undefined));
      require('./logger').fellBack('year close warnings: ' + name + ' could not be read — left out', err);
      return null;
    }
  };
  const held = await tryRead('actions', async () => {
    const queue = require('./books-action-queue');
    return queue.queuePage(handle, entity, queue.queueAsked({ state: 'open', limit: 1 }, {}));
  });
  if (held && held.total > 0) out.push({ name: 'actions_waiting', count: held.total, why: plural(held.total, 'entry is', 'entries are') + ' still waiting for review or your OK — they will not be in the closed year.' });
  const end = String(ctx.range.end).slice(0, 10);
  const bank = await tryRead('bank', async () => (await require('./bank-rec-log').onTrialBalance(handle, entity, end, [], ctx.chart, ctx.cur)) || []);
  const unreconciled = (bank || []).filter((line) => line.state !== 'reconciled');
  if (unreconciled.length) out.push({ name: 'bank_unreconciled', count: unreconciled.length, why: 'Bank not reconciled to ' + end + ': ' + unreconciled.map((line) => line.name).join(', ') + '.' });
  const marks = ctx.req ? await tryRead('marks', () => require('./books-needs').openMarks(handle, entity, ctx.req, String(ctx.range.start).slice(0, 10), end)) : null;
  const queries = (marks || []).filter((mark) => mark.class === 'open' || mark.class === 'hold');
  if (queries.length) out.push({ name: 'auditor_open', count: queries.length, why: plural(queries.length, 'entry has', 'entries have') + ' an open query or hold from the auditor.' });
  return out;
}

module.exports = { reopenYear, reopenMonth, closeWarnings };
