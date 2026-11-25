/**
 * books-cashflow-return.js — WHEN the tax return falls due, and the return page's own figure for the period (split out of books-cashflow.js, whose size row may not grow).
 * OWNER     cb-finance
 * RISK      money
 * OWNS      gstReturnLine(gstRow, figure) · nextReturnFigure(db, entity, settings, pack, asOf) · returnWords(pack) · returnPeriodsAround(pack, asOf, opts) · returnDueFor(pack, asOf, opts) · nextReturnDue(pack, asOf, opts) · returnPeriodFigure(db, entity, settings, asOf)
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
/** India's own return is gst-returns' (no period table in the pack): the ONE place this file names it */
const isIndia = (pack) => !!pack && pack.id === 'IN';
/** the words a screen calls this pack's return — the pack's own (`returns.id` · `returns.short`), India's from gst-returns */
function returnWords(pack) {
  const receivables = pack && pack.returns;
  if (receivables && receivables.id) return { form: receivables.id, short: receivables.short || receivables.id };
  return isIndia(pack) ? Object.assign({}, INDIA_RETURN) : { form: null, short: 'Tax' };
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
    if (isIndia(pack)) return Object.assign(words, { due_date: gstReturns().dueDate(day0.slice(0, 7)), why: null });
    return Object.assign(words, { due_date: null, why: 'No return is built for the ' + pack.id + ' pack yet.' });
  }
  const table = returnPeriodsAround(pack, day0, opts);
  if (!table.ok) return Object.assign(words, { due_date: null, why: DUE_NEEDS_PERIOD });
  const period = table.periods.find((item) => item.start <= day0 && day0 <= item.end) || null;
  return Object.assign(words, { due_date: period ? period.due : null, why: period ? null : 'No ' + words.short + ' period is known for ' + day0 + '.' });
}

/** the periods that have ENDED and still owe a return: this financial year's, and the one that ended the day before it (earlier years' lodgements are not this function's to know); with no lodged list, only those not yet past due */
function endedUnlodged(pack, table, day0, lodged) {
  const packs = require('./books-engines').packs(),
    yearStart = packs.fyRange(packs.fiscalYearOf(day0, pack), pack).start,
    sinceDay = require('./books').addDays(yearStart, -1),
    isLodged = (item) => !!lodged && (lodged.has(item.period) || lodged.has(item.label));
  return table.periods.filter((item) => item.end < day0 && item.end >= sinceDay && !isLodged(item) && (lodged || item.due >= day0)).sort((first, second) => (first.end < second.end ? -1 : 1));
}
/** India has no period table (gst-returns names the month's 20th): the month that has just ENDED falls due next unless its 20th has passed (or it is lodged), else the month that holds the day → the same shape as nextReturnDue's table answer */
function indiaNext(day0, base, opts) {
  const monthOf = (day) => String(day).slice(0, 7),
    lodged = (opts && opts.lodged) || null,
    prev = monthOf(require('./books').addDays(monthOf(day0) + '-01', -1)),
    due = gstReturns().dueDate(prev),
    offerPrev = due >= day0 && !(lodged && lodged.has(prev)),
    key = offerPrev ? prev : monthOf(day0);
  return Object.assign(base, { due_date: offerPrev ? due : base.due_date, period: key, period_start: key + '-01' });
}
/**
 * ⭐ CTY-80 nextReturnDue(pack, asOf, opts?) → { form, short, due_date, period, period_start, why } — the return that falls due NEXT: the EARLIEST period that has ENDED (end < asOf) and is not lodged,
 * else the period that holds asOf. A finished period's return is the one that falls due; the period holding today is never due inside it (monthly on 18 Nov: October, due 21 Nov, not November).
 * opts.lodged = a Set of period keys already lodged (books-period.returnStatesFor, `closed`); nothing stores a lodgement yet, so with none given a period whose due date has PASSED is not
 * offered (it would read as overdue on a guess): the earliest ended period still ahead of asOf is. Same table, same calendar, same words as returnDueFor: no second calendar.
 */
function nextReturnDue(pack, asOf, opts) {
  const day0 = String(asOf || '').slice(0, 10),
    base = returnDueFor(pack, day0, opts),
    table = returnPeriodsAround(pack, day0, opts);
  if (isIndia(pack) && hasNoReturnTable(pack) && base.due_date) return indiaNext(day0, base, opts);
  if (!base.due_date || !table.ok) return Object.assign(base, { period: null, period_start: null });
  const pick = endedUnlodged(pack, table, day0, (opts && opts.lodged) || null)[0] || table.periods.find((item) => item.start <= day0 && day0 <= item.end);
  return Object.assign(base, pickedFields(base, pick));
}
/** the pack names no return of its own (no pack.returns.id) */
function hasNoReturnTable(pack) {
  return !(pack.returns && pack.returns.id);
}
/** the due date and period of the picked period; with none picked the base due date stands and the period is null */
function pickedFields(base, pick) {
  if (!pick) return { due_date: base.due_date, period: null, period_start: null };
  return { due_date: pick.due, period: pick.period, period_start: pick.start };
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

/**
 * FW-30 (walk 25 Nov): the returns of FINISHED periods that are not closed, oldest first, each with the return page's own figure and its due date, so the Cash line names a late return
 * the way the BAS page does (BAS Q1 A$1,803.50 · due 28 Oct · overdue) instead of lumping it with "no due date". `before` = the first day of the period that holds the day (those are not 'earlier').
 * → [{ period, label, due_date, payable_minor, overdue }]; a period with nothing owed is left out; an unreadable table or return answers [] (the lump stays, named). The set is the pack's period table (this year and the one before).
 */
async function earlierReturns(db, entity, settings, pack, asOf, before) {
  const day0 = String(asOf || '').slice(0, 10),
    table = returnPeriodsAround(pack, day0, undefined);
  if (!table.ok || !before) return [];
  let closed = new Set();
  try {
    const rows = await require('./books-store').periods(db, entity, null),
      states = await periods.returnStatesFor(db, entity, settings, rows);
    for (const year of states.values()) for (const item of year.periods || []) if (item.closed) closed.add(item.period);
  } catch (e) {
    require('./logger').fellBack('cashflow: the closed returns could not be read — earlier tax stays one lump', e, 'debug');
    return [];
  }
  const ended = table.periods.filter((item) => item.end < before && !closed.has(item.period)).sort((first, second) => (first.end < second.end ? -1 : 1));
  const out = [];
  for (const item of ended) {
    const figure = await returnPeriodFigure(db, entity, settings, item.start);
    if (figure && figure.payable_minor > 0) out.push({ period: item.period, label: item.label || item.period, due_date: item.due || null, payable_minor: figure.payable_minor, overdue: !!item.due && item.due < day0 });
  }
  return out;
}

/** the answer's tax line: the figure, its date, and the words (the pack's form and short name; `why` is the set-off's refusal or the estimate's words) */
function gstReturnLine(gstRow, figure) {
  /* MONEY-01 A1/Q3: no figure for the period (the return page could not be read): the ledger's lump stands, NAMED as an estimate — never a silent fallback */
  const estimate = figure.split ? null : 'This is the total the books owe for tax; the return for the period itself could not be read, so the amount and its date are an estimate.';
  return { payable_minor: figure.payable, due_date: figure.dueOn, counted: figure.counted, estimated: !figure.split && figure.owed > 0, why: gstRow.why || estimate, form: gstRow.form || null, short: gstRow.short || null };
}
/** the return that falls due next: { dueDay: its form, short and due date, heldPeriod: the return page's own figure for it }. A finished period that owes something wins over the period that holds the day. */
async function nextReturnFigure(db, entity, settings, pack, asOf) {
  const ended = nextReturnDue(pack, asOf),
    endedFigure = ended.period_start ? await returnPeriodFigure(db, entity, settings, ended.period_start) : null,
    holding = returnDueFor(pack, asOf),
    useEnded = !!endedFigure && endedFigure.payable_minor > 0 && ended.due_date !== holding.due_date; /* a finished period, not the one that holds the day */
  return {
    dueDay: useEnded ? ended : holding,
    heldPeriod: useEnded ? endedFigure : await returnPeriodFigure(db, entity, settings, asOf)
  };
}
module.exports = { earlierReturns, nextReturnFigure, gstReturnLine, returnWords, returnPeriodsAround, returnDueFor, nextReturnDue, returnPeriodFigure, BAS_DEFAULT_FREQUENCY, DUE_NEEDS_PERIOD };
