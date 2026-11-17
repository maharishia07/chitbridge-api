/**
 * books-mis.js — the owner's overview: how the business is doing, in ONE read (REQ-MIS-SHOWCASE 14, critic c26fe54e, slice A3).
 * OWNER     cb-reports
 * RISK      money
 * OWNS      read(h, e, req, { period, today, fyMonth, seat }) · PERIODS (the four words the route accepts) · seatOf(req, e, isOwner) · barSpans(today, n)
 * CALLED BY routes/books.js GET /overview
 * ⭐ NO NEW CALCULATION: dates come from books-report-period (periodOf · priorOf · changeOf · grossOf), SOLD from books-store.soldTotals (one statement for the figure and its prior, soldByDay for the 12 bars),
 *   income · expenses · profit from books.profitAndLoss (the code GET /pl runs) and profitAndLossMonths, owed and owing from books-dues.read (the code GET /dues runs), cash from books-cashflow.read at its own 30 days
 *   (the engine has horizons 7 and 30, no 90). Every percent is changeOf basis points; the page adds nothing.
 * ⭐ Two labels, never one word: `sales` is SOLD, tax in (the Home / Trend figure); `income` · `expenses` · `profit` are the P&L, tax out. No ratio or subtraction crosses the two.
 * ⭐ A figure is read or it is ABSENT (a key with `why`), never 0. A reader without can_see_costs gets no purchases, expenses, profit, gross profit, to-pay or cash (cost_hidden); cash also only for the owner or a grant.
 */
'use strict';
const R = require('./books-report-period');
const B = require('./books');
const S = require('./books-store');
const MO = require('./books-money-ops');
const Dues = require('./books-dues');
const { addDays } = require('./books-engines');

/** the words the route accepts, each a running period (a closed one is the P&L's): week · mtd · quarter · ytd */
const PERIODS = ['week', 'mtd', 'quarter', 'ytd'];
const BARS = 12;
const absent = (why) => ({ minor: null, why });
const noNames = async () => new Map();
/** who may see what: blind = no can_see_costs (fail-closed, lib/cost); cash = the owner or a grant */
async function seatOf(req, e, isOwner) {
  const blind = await require('./cost').isCostBlind(req, e);
  return { blind, cash: !blind && (isOwner(req) || !!req.acting_for_grant) };
}
/** the last `n` calendar months, oldest first, each a whole month except the running one (to today): the 12 bars and the profit by month */
function barSpans(today, n) {
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const p = R.periodOf({ preset: 'mtd', step: -k }, today, 1);
    out.push({ from: p.from, to: p.to, running: k === 0 });
  }
  return out;
}
/** the seven days (Monday first) of this ISO week and of the same week last year (R.priorOf, 'week'; null when last year has no such week): SOLD by weekday reads the SAME soldByDay statement as the bars */
function weekSpans(today) {
  const p = R.periodOf({ preset: 'week', step: 0 }, today, 1),
    sunday = addDays(p.from, 6),
    prior = R.priorOf({ from: p.from, to: sunday }, 'week'),
    list = (from) => [0, 1, 2, 3, 4, 5, 6].map((k) => addDays(from, k));
  return { now: list(p.from), last: prior ? list(prior.from) : null };
}
/** the same month's (or the running month's same dates') SOLD a year before, from the same days; absent when the books began after that month's first day (a part-month is never shown as a whole one) */
function lastYearBar(days, span, start, cur) {
  const before = { from: R.yearBefore(span.from), to: R.yearBefore(span.to) };
  return start && start > before.from ? null : barOf(days, before, cur);
}
/** one month's SOLD from the Day book's days (soldByDay, one statement over the 12 months): the sum of its days in the books' own money op; a month with no day is absent, one holding two currencies too */
function barOf(days, span, cur) {
  const mine = days.filter((d) => d.day >= span.from && d.day <= span.to);
  if (!mine.length || mine.some((d) => d.sold.minor == null || d.sold.currency !== cur)) return null;
  return MO.sumMinor(mine, cur, (d) => d.sold.minor);
}
/** SOLD for the range and its prior (soldTotals, one statement) and the 12 month bars (soldByDay, one statement: 14 ranges in one UNION read 7 years of entries 14 times, 556 ms against 60); the figure says how far the books reach (through) and whether the range begins before the books do */
async function salesBlock(h, e, range, prior, today, cur) {
  const bars = barSpans(today, BARS),
    got = await S.soldTotals(h, e, [range].concat(prior ? [prior] : [])),
    week = weekSpans(today),
    days = await S.soldByDay(h, e, { from: R.yearBefore(bars[0].from), to: today }),
    start = await S.soldFrom(h, e);
  const figure = (x, span) => (x && x.entries ? { minor: x.sold.minor, currency: x.sold.currency, through: x.through, bills: x.bills, partial: !!(start && start > span.from) } : absent('no sales posted in this period'));
  const sales = figure(got[0], range),
    before = prior ? figure(got[1], prior) : absent('last year has no such week');
  const comparable = sales.minor != null && before.minor != null && sales.currency === before.currency;
  return {
    sales: Object.assign(sales, { prior: before, change_bp: comparable ? R.changeOf(sales.minor, before.minor, cur) : null }),
    bars: bars.map((span) => ({ from: span.from, to: span.to, running: span.running, sold_minor: barOf(days, span, cur), last_year_minor: lastYearBar(days, span, start, cur) })),
    weekdays: week.now.map((day, i) => ({ iso: i + 1, day, sold_minor: day > today ? null : barOf(days, { from: day, to: day }, cur), last_year_day: week.last ? week.last[i] : null, last_year_minor: week.last ? barOf(days, { from: week.last[i], to: week.last[i] }, cur) : null }))
  };
}
/** the P&L now and the P&L of the comparison range: the code /pl runs; a prior range that cannot be read is no comparison, said */
async function plBlock(h, e, range, prior, cur) {
  const now = await B.profitAndLoss(h, e, range.from, range.to),
    was = prior ? await B.profitAndLoss(h, e, prior.from, prior.to).catch(() => null) : null;
  const flat = (lines) => [].concat(...(lines || []).map((head) => (head.accounts || []).map((a) => ({ role: a.role, amount_minor: a.amount_minor }))));
  const line = (x, y) => ({ minor: x, prior_minor: was ? y : null, change_bp: was ? R.changeOf(x, y, cur) : null });
  return {
    income: line(now.total_income_minor, was && was.total_income_minor),
    expenses: line(now.total_expenses_minor, was && was.total_expenses_minor),
    profit: line(now.profit_minor, was && was.profit_minor),
    gross: R.grossOf(flat(now.income), flat(now.expenses), cur),
    profit_share_bp: R.shareOf(now.profit_minor, now.total_income_minor, cur)
  };
}
/** the profit and income of each of the 12 months: profitAndLossMonths, one read of the lines per financial year */
async function monthsBlock(h, e, today) {
  const spans = barSpans(today, BARS),
    pls = await B.profitAndLossMonths(h, e, spans.map((s) => ({ from: s.from, to: s.to })));
  return spans.map((s, i) => ({ from: s.from, to: s.to, running: s.running, income_minor: pls[i].total_income_minor, profit_minor: pls[i].profit_minor }));
}
/** to collect and to pay, the dues' own totals (a blind reader asks the customer side only) */
async function duesBlock(h, e, req, today, sides, cur) {
  const { rows } = await Dues.read(h, e, { req, fin: false, pay: false, sides, asOf: today, partyNames: noNames }),
    totals = Dues.agedTotals(rows, sides, cur);
  return {
    aged_totals: totals,
    to_collect: totals.customer ? { minor: totals.customer.balance_minor, parties: rows.filter((r) => r.side !== 'supplier').length } : absent('not asked'),
    to_pay: totals.supplier ? { minor: MO.diffMinor(0, totals.supplier.balance_minor, cur), parties: rows.filter((r) => r.side === 'supplier').length } : absent('cost hidden')
  };
}
/** the cash view at its own 30 days: its words, its lowest day, its shortfall, as the engine answers */
async function cashBlock(h, e, req, today) {
  const cash = await require('./books-cashflow').read(h, e, req.books, { asOf: today, days: 30 });
  return { days: cash.days, opening_minor: cash.opening_minor, closing_minor: cash.closing_minor, series: cash.series.map((day) => ({ date: day.date, balance_minor: day.balance_minor })), lowest: cash.lowest, shortfall: cash.shortfall, words: cash.words };
}
/**
 * read → the overview of the period (one of PERIODS): { currency, period { word, from, to }, compare { how, from, to } | null, sales (SOLD, tax in), bars[12] (each with last_year_minor), aged_totals (the /dues object), to_collect, to_pay, weekdays[7] (this ISO week by weekday against the same week last year),
 * and for a reader who sees costs: income · expenses · profit · gross · profit_share_bp, profit_by_month[12], cash }, cost_hidden. Everything inside the caller's handle (one transaction).
 */
async function read(h, e, req, o) {
  const cur = B.curOf(req.books),
    p = R.periodOf({ preset: o.period, step: 0 }, o.today, o.fyMonth),
    range = { from: p.from, to: p.to },
    how = o.period === 'week' ? 'week' : 'year',
    prior = R.priorOf(range, how),
    seat = o.seat;
  const out = { currency: cur, period: { word: o.period, from: p.from, to: p.to }, compare: prior ? { how, from: prior.from, to: prior.to } : null, cost_hidden: !!seat.blind };
  Object.assign(out, await salesBlock(h, e, range, prior, o.today, cur));
  Object.assign(out, await duesBlock(h, e, req, o.today, seat.blind ? ['debtors'] : ['debtors', 'creditors'], cur));
  if (seat.blind) return out;
  Object.assign(out, await plBlock(h, e, range, prior, cur));
  out.profit_by_month = await monthsBlock(h, e, o.today);
  out.cash = seat.cash ? await cashBlock(h, e, req, o.today) : null;
  return out;
}
module.exports = { PERIODS, read, seatOf, barSpans };
