/**
 * books-cashflow-return.js — WHEN the tax return falls due, and the return page's own figure for the period (split out of books-cashflow.js, whose size row may not grow).
 * OWNER     cb-finance
 * RISK      money
 * OWNS      returnWords(pack) · returnPeriodsAround(pack, asOf, opts) · returnDueFor(pack, asOf, opts) · returnPeriodFigure(db, entity, settings, asOf)
 * CALLED BY lib/books-cashflow.js (read · gstLine's input) · home-facts (returnDueFor, through books-cashflow)
 * FLOW      pack + asOf → books-period.returnPeriods (the ONE table) → the period that holds the day → its due date · books-period.taxReturn → the return page's payable_minor for that period
 * CARD      16-finance/cash-position
 */
'use strict';
const periods = require('./books-period');

/* ── the return calendar is the PACK's (engines gst-returns, adopted v1.39.0) — never a day typed here ─────────────────── */
const gstReturns = () => require('./gst-returns');
const INDIA_RETURN = { form: 'GSTR-3B', short: 'GST' }; /* India's pack has no `returns` block: gst-returns.periodsFor names its form; the chip's word is GST */
const BAS_DEFAULT_FREQUENCY = 'quarterly'; /* the ATO's default (GST turnover under $20m); the table itself is books-period.returnPeriods, which takes the same default (ACC-204: one table) */
const DUE_NEEDS_PERIOD = 'Due date unknown until the return period is picked under Returns.';
/** the words a screen calls this pack's return — the pack's own (`returns.id` · `returns.short`), India's from gst-returns */
function returnWords(pack) {
  const receivables = pack && pack.returns;
  if (receivables && receivables.id) return { form: receivables.id, short: receivables.short || receivables.id };
  return pack && pack.id === 'IN' ? Object.assign({}, INDIA_RETURN) : { form: null, short: 'Tax' };
}
/** the pack's period table around asOf — the ONE table (books-period.returnPeriods: the year that holds asOf and the one before; BAS quarterly unless asked monthly, AE by the stagger asked, never guessed) → { ok, periods } | { ok: false, why } */
function returnPeriodsAround(pack, asOf, opts) {
  try {
    const table = periods.returnPeriods(pack, opts || {}, asOf);
    return table.needs ? { ok: false, why: table.why } : { ok: true, periods: table.periods };
  } catch (e) {
    return { ok: false, why: e.message }; /* the engine refused the table (a frequency or stagger it does not know): the due date stays unknown, in its words */
  }
}
/**
 * ⭐ returnDueFor(pack, asOf, opts?) → { form, short, due_date, why } — WHEN what the ledgers owe at asOf falls due: the return of the period that HOLDS asOf,
 * by the pack's own calendar. IN: gst-returns.dueDate (the 20th after the month). AU: the BAS quarter's `due` (the 28th after; monthly the 21st). AE: the
 * stagger's `due` (the 28th after) — and with NO stagger (opts.stagger; nothing stores it yet) the date is null and `why` says so: it is never guessed.
 */
function returnDueFor(pack, asOf, opts) {
  const words = returnWords(pack),
    day0 = String(asOf || '').slice(0, 10);
  if (!pack || !pack.id) return Object.assign(words, { due_date: null, why: 'The shop has no country pack: no return calendar.' });
  if (!pack.returns || !pack.returns.id) {
    if (pack.id === 'IN') return Object.assign(words, { due_date: gstReturns().dueDate(day0.slice(0, 7)), why: null });
    return Object.assign(words, { due_date: null, why: 'No return is built for the ' + pack.id + ' pack yet.' });
  }
  const table = returnPeriodsAround(pack, day0, opts);
  if (!table.ok) return Object.assign(words, { due_date: null, why: DUE_NEEDS_PERIOD });
  const period = table.periods.find((item) => item.start <= day0 && day0 <= item.end) || null;
  return Object.assign(words, { due_date: period ? period.due : null, why: period ? null : 'No ' + words.short + ' period is known for ' + day0 + '.' });
}

/** the return page's own figure for the period that holds the day (periods.taxReturn → payable_minor, what GET /returns answers) → { payable_minor, start } or null (no return in the pack, or it cannot be read) */
async function returnPeriodFigure(db, entity, settings, asOf) {
  try {
    const form = await periods.taxReturn(entity, settings, { on: asOf }, db);
    return form && form.period && typeof form.payable_minor === 'number' ? { payable_minor: form.payable_minor, start: form.period.start } : null;
  } catch (e) {
    require('./logger').fellBack('cashflow: the return page has no figure for this day — the one ledger figure stands', e, 'debug');
    return null; /* India reads its return from the rail; a pack with no table: the one ledger figure stands */
  }
}

module.exports = { returnWords, returnPeriodsAround, returnDueFor, returnPeriodFigure, BAS_DEFAULT_FREQUENCY, DUE_NEEDS_PERIOD };
