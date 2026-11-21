/**
 * books-mis.js — the owner's overview: how the business is doing, in ONE read (REQ-MIS-SHOWCASE 14, critic c26fe54e, slice A3).
 * OWNER     cb-reports
 * RISK      money
 * OWNS      read(h, e, req, { period, today, fyMonth, seat }) · PERIODS (the four words the route accepts) · seatOf(req, e, isOwner) · barSpans(today, n)
 * CALLED BY routes/books.js GET /overview
 * FLOW      GET /overview?period ──▶ seatOf (who sees costs and cash) ──▶ read: salesBlock · duesBlock ──▶ (cost-seeing seat only) plBlock · monthsBlock · cashBlock ──▶ one object
 * CARD      26-reporting-mis-and-bi/mis
 * ⭐ NO NEW CALCULATION: dates come from books-report-period (periodOf · priorOf · changeOf · grossOf), SOLD from books-store.soldTotals (one statement for the figure and its prior, soldByDay for the 12 bars),
 *   income · expenses · profit from books.profitAndLoss (the code GET /pl runs) and profitAndLossMonths, owed and owing from books-dues.read (the code GET /dues runs), cash from books-cashflow.read at its own 30 days
 *   (the engine has horizons 7 and 30, no 90). Every percent is changeOf basis points; the page adds nothing.
 * ⭐ Two labels, never one word: `sales` is SOLD, tax in (the Home / Trend figure); `income` · `expenses` · `profit` are the P&L, tax out. No ratio or subtraction crosses the two.
 * ⭐ A figure is read or it is ABSENT (a key with `why`), never 0. A reader without can_see_costs gets no purchases, expenses, profit, gross profit, to-pay or cash (cost_hidden); cash also only for the owner or a grant.
 */
'use strict';
const reportPeriod = require('./books-report-period');
const books = require('./books');
const store = require('./books-store');
const moneyOps = require('./books-money-ops');
const Dues = require('./books-dues');
const { addDays } = require('./books-engines');

/** the words the route accepts, each a running period (a closed one is the P&L's): week · mtd · quarter · ytd */
const PERIODS = ['week', 'mtd', 'quarter', 'ytd'];
const BARS = 12;
const absent = (reason) => ({ minor: null, why: reason });
const noNames = async () => new Map();
/** who may see what: blind = no can_see_costs (fail-closed, lib/cost); cash = the owner or a grant */
async function seatOf(req, e, isOwner) {
  const blind = await require('./cost').isCostBlind(req, e);
  return { blind, cash: !blind && (isOwner(req) || !!req.acting_for_grant) };
}
/** the last `count` calendar months, oldest first, each a whole month except the running one (to today): the 12 bars and the profit by month */
function barSpans(today, count) {
  const out = [];
  for (let monthsBack = count - 1; monthsBack >= 0; monthsBack--) {
    const month = reportPeriod.periodOf({ preset: 'mtd', step: -monthsBack }, today, 1);
    out.push({ from: month.from, to: month.to, running: monthsBack === 0 });
  }
  return out;
}
/** the seven days (Monday first) of this ISO week and of the same week last year (reportPeriod.priorOf, 'week'; null when last year has no such week): SOLD by weekday reads the SAME soldByDay statement as the bars */
function weekSpans(today) {
  const thisWeek = reportPeriod.periodOf({ preset: 'week', step: 0 }, today, 1),
    sunday = addDays(thisWeek.from, 6),
    prior = reportPeriod.priorOf({ from: thisWeek.from, to: sunday }, 'week'),
    list = (from) => [0, 1, 2, 3, 4, 5, 6].map((offset) => addDays(from, offset));
  return { now: list(thisWeek.from), last: prior ? list(prior.from) : null };
}
/** the same month's (or the running month's same dates') SOLD a year before, from the same days: { minor, partial } — null only when the books hold no day there (YE-F-03: the month the books began in is read and says partial, never shown as a whole one) */
function lastYearBar(days, span, start, currency) {
  const before = { from: reportPeriod.yearBefore(span.from), to: reportPeriod.yearBefore(span.to) },
    minor = barOf(days, before, currency);
  return { minor, partial: minor != null && !!start && start > before.from };
}
/** one month's SOLD from the Day book's days (soldByDay, one statement over the 12 months): the sum of its days in the books' own money op; a month with no day is absent, one holding two currencies too */
function barOf(days, span, currency) {
  const mine = days.filter((dayRow) => dayRow.day >= span.from && dayRow.day <= span.to);
  if (!mine.length || mine.some((dayRow) => dayRow.sold.minor == null || dayRow.sold.currency !== currency)) return null;
  return moneyOps.sumMinor(mine, currency, (dayRow) => dayRow.sold.minor);
}
/** SOLD for the range and its prior (soldTotals, one statement) and the 12 month bars (soldByDay, one statement: 14 ranges in one UNION read 7 years of entries 14 times, 556 ms against 60); the figure says how far the books reach (through) and whether the range begins before the books do */
async function salesBlock(handle, e, range, prior, today, currency) {
  const bars = barSpans(today, BARS),
    soldRanges = await store.soldTotals(handle, e, [range].concat(prior ? [prior] : [])),
    week = weekSpans(today),
    days = await store.soldByDay(handle, e, { from: reportPeriod.yearBefore(bars[0].from), to: today }),
    start = await store.soldFrom(handle, e);
  const figure = (found, span) => (found && found.entries ? { minor: found.sold.minor, currency: found.sold.currency, through: found.through, bills: found.bills, partial: !!(start && start > span.from) } : absent('no sales posted in this period'));
  const sales = figure(soldRanges[0], range),
    before = prior ? figure(soldRanges[1], prior) : absent('last year has no such week');
  const comparable = sales.minor != null && before.minor != null && sales.currency === before.currency;
  return {
    sales: Object.assign(sales, { prior: before, change_bp: comparable ? reportPeriod.changeOf(sales.minor, before.minor, currency) : null }),
    bars: bars.map((span) => {
      const last = lastYearBar(days, span, start, currency);
      return Object.assign({ from: span.from, to: span.to, running: span.running, sold_minor: barOf(days, span, currency), last_year_minor: last.minor }, last.partial ? { last_year_partial: true } : {});
    }),
    weekdays: week.now.map((date, index) => ({ iso: index + 1, day: date, sold_minor: date > today ? null : barOf(days, { from: date, to: date }, currency), last_year_day: week.last ? week.last[index] : null, last_year_minor: week.last ? barOf(days, { from: week.last[index], to: week.last[index] }, currency) : null }))
  };
}
/** the P&L now and the P&L of the comparison range: the code /pl runs; a prior range that cannot be read is no comparison, said */
async function plBlock(handle, e, range, prior, currency) {
  const now = await books.profitAndLoss(handle, e, range.from, range.to),
    priorPl = prior ? await books.profitAndLoss(handle, e, prior.from, prior.to).catch((err) => { require('./logger').fellBack('books-mis: the prior range cannot be read, so the overview shows no comparison for it', err, 'warn'); return null; }) : null;
  const flat = (lines) => [].concat(...(lines || []).map((head) => (head.accounts || []).map((account) => ({ role: account.role, amount_minor: account.amount_minor }))));
  const line = (nowMinor, priorMinor) => ({ minor: nowMinor, prior_minor: priorPl ? priorMinor : null, change_bp: priorPl ? reportPeriod.changeOf(nowMinor, priorMinor, currency) : null });
  return {
    income: line(now.total_income_minor, priorPl && priorPl.total_income_minor),
    expenses: line(now.total_expenses_minor, priorPl && priorPl.total_expenses_minor),
    profit: line(now.profit_minor, priorPl && priorPl.profit_minor),
    gross: reportPeriod.grossOf(flat(now.income), flat(now.expenses), currency),
    profit_share_bp: reportPeriod.shareOf(now.profit_minor, now.total_income_minor, currency)
  };
}
/** the profit and income of each of the 12 months: profitAndLossMonths, one read of the lines per financial year */
async function monthsBlock(handle, e, today, bars) {
  const spans = barSpans(today, BARS),
    monthlyPl = await books.profitAndLossMonths(handle, e, spans.map((span) => ({ from: span.from, to: span.to })));
  /* a month with no books is ABSENT (null), as its sales bar is: no sale that month and nothing in the P&L (income, expenses) — a month the books have not reached never draws a zero bar */
  const none = (index) => bars[index].sold_minor == null && !monthlyPl[index].total_income_minor && !monthlyPl[index].total_expenses_minor && !monthlyPl[index].profit_minor;
  return spans.map((span, index) => ({ from: span.from, to: span.to, running: span.running, income_minor: none(index) ? null : monthlyPl[index].total_income_minor, profit_minor: none(index) ? null : monthlyPl[index].profit_minor }));
}
/** to collect and to pay, the dues' own totals (a blind reader asks the customer side only) */
async function duesBlock(handle, e, req, today, sides, currency) {
  const { rows } = await Dues.read(handle, e, { req, fin: false, pay: false, sides, asOf: today, partyNames: noNames }),
    totals = Dues.agedTotals(rows, sides, currency);
  return {
    aged_totals: totals,
    to_collect: totals.customer ? { minor: totals.customer.balance_minor, parties: rows.filter((row) => row.side !== 'supplier').length } : absent('not asked'),
    to_pay: totals.supplier ? { minor: moneyOps.diffMinor(0, totals.supplier.balance_minor, currency), parties: rows.filter((row) => row.side === 'supplier').length } : absent('cost hidden')
  };
}
/** the cash view at its own 30 days: its words, its lowest day, its shortfall, as the engine answers */
async function cashBlock(handle, e, req, today) {
  const cash = await require('./books-cashflow').read(handle, e, req.books, { asOf: today, days: 30 });
  return { days: cash.days, opening_minor: cash.opening_minor, closing_minor: cash.closing_minor, series: cash.series.map((point) => ({ date: point.date, balance_minor: point.balance_minor })), lowest: cash.lowest, shortfall: cash.shortfall, words: cash.words };
}
/**
 * read → the overview of the period (one of PERIODS): { currency, period { word, from, to }, compare { how, from, to } | null, sales (SOLD, tax in), bars[12] (each with last_year_minor), aged_totals (the /dues object), to_collect, to_pay, weekdays[7] (this ISO week by weekday against the same week last year),
 * and for a reader who sees costs: income · expenses · profit · gross · profit_share_bp, profit_by_month[12], cash }, cost_hidden. Everything inside the caller's handle (one transaction).
 */
async function read(handle, e, req, opts) {
  const currency = books.curOf(req.books),
    current = reportPeriod.periodOf({ preset: opts.period, step: 0 }, opts.today, opts.fyMonth),
    range = { from: current.from, to: current.to },
    compareBy = opts.period === 'week' ? 'week' : 'year',
    prior = reportPeriod.priorOf(range, compareBy),
    seat = opts.seat;
  const out = { currency, period: { word: opts.period, from: current.from, to: current.to }, compare: prior ? { how: compareBy, from: prior.from, to: prior.to } : null, cost_hidden: !!seat.blind };
  Object.assign(out, await salesBlock(handle, e, range, prior, opts.today, currency));
  Object.assign(out, await duesBlock(handle, e, req, opts.today, seat.blind ? ['debtors'] : ['debtors', 'creditors'], currency));
  if (seat.blind) return out;
  Object.assign(out, await plBlock(handle, e, range, prior, currency));
  out.profit_by_month = await monthsBlock(handle, e, opts.today, out.bars);
  out.cash = seat.cash ? await cashBlock(handle, e, req, opts.today) : null;
  return out;
}
module.exports = { PERIODS, read, seatOf, barSpans };
