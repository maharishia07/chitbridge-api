/**
 * books-report-period.js — the period of a P&L / Balance sheet and what it is compared with (ACC-357 / W15-118, W15-119).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      knownPreset(name) · isoWeekOf(day) · periodOf(spec, today, fyStartMonth) · priorOf(range, how) · asAtOf(spec, today, fyStartMonth) · changeOf(now, earlier) · shareOf(part, whole) · grossOf(income, expense, currency)
 * CALLED BY routes/books.js GET /pl · GET /bs
 * FLOW      a preset or dates + the step ──▶ periodOf ──▶ priorOf (same days a year earlier, or the span just before) ──▶ changeOf · shareOf (basis points) ──▶ the P&L / balance sheet / trial balance compare
 * CARD      14-accounting/statements-tb-pandl-bs-party-statement
 * ⭐ THE PACK DECIDES the financial year (fyStartMonth is the pack's fyRange start); the presets are This year to date · Last month · Quarter · Last year, each stepped with ‹ ›.
 * ⭐ ANY RANGE vs THE SAME RANGE LAST YEAR (the leaders: docs/walks/LEADERS-REPORTS-2026-11-16.md): the prior range is the same days one year earlier, or the equal span just before it. Dates are YYYY-MM-DD strings, no clock.
 * ⭐ A PERCENT IS CARRIED, NEVER WORKED OUT BY THE PAGE: changeOf / shareOf answer basis points (1 bp = 0.01%), rounded half away from zero.
 */
'use strict';
const { addDays } = require('./books-engines');
const PRESETS = [['ytd', 'This year to date'], ['month', 'Last month'], ['quarter', 'Quarter'], ['year', 'Last year']];
/** MIS A0: the running periods of the owner's overview, beside the P&L's: week (Monday-start ISO week to today) · mtd (the month so far); knownPreset says which words periodOf knows, for a route that must answer 400 to any other (never the silent year to date) */
const RUNNING = [['week', 'This week so far'], ['mtd', 'This month so far']];
const knownPreset = (name) => PRESETS.concat(RUNNING).some((x) => x[0] === name);
const padTwo = (n) => String(n).padStart(2, '0');
const isoDay = (y, m, d) => y + '-' + padTwo(m) + '-' + padTwo(d);
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const parts = (day) => ({ y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)), d: Number(day.slice(8, 10)) });
/** the first of the month `n` months from (y, m) (n may be negative) → { y, m } */
function shiftMonth(y, m, n) {
  const index = y * 12 + (m - 1) + n;
  return { y: Math.floor(index / 12), m: (index % 12) + 1 };
}
const endOf = (y, m) => isoDay(y, m, lastDay(y, m));
/** the first day of the financial year that holds `day` */
function fyStartOf(day, fyStartMonth) {
  const p = parts(day);
  return isoDay(p.m >= fyStartMonth ? p.y : p.y - 1, fyStartMonth, 1);
}
/**
 * the range of a preset, stepped: { preset, step } → { preset, step, from, to, can_next }. step 0 is the running one (to = today), -1 the one before it, and so on; a step past today is refused (can_next false).
 * ytd: the FY start → today, stepped a whole year · month: the month before today's, stepped by months · quarter: the FY quarter of today (to today), stepped by quarters · year: the FY before this one, stepped by years.
 */
function periodOf(spec, today, fyStartMonth) {
  const preset = knownPreset(spec.preset) ? spec.preset : 'ytd',
    step = Math.min(0, Math.trunc(Number(spec.step) || 0));
  const range = RANGE_OF[preset](today, fyStartMonth, step, preset);
  return { preset, step, from: range.from, to: range.to, can_next: step < 0 };
}
/** the Monday-start ISO week holding today, stepped by weeks: step 0 runs to today, an earlier one is whole (Monday to Sunday) */
function weekRange(today, fyStartMonth, step) {
  const monday = addDays(today, 1 - isoWeekday(today) + step * 7);
  return { from: monday, to: step === 0 ? today : addDays(monday, 6) };
}
/** the month so far, stepped by months: step 0 runs to today, an earlier one is the whole month */
function monthSoFarRange(today, fyStartMonth, step) {
  const current = parts(today),
    first = shiftMonth(current.y, current.m, step);
  return { from: isoDay(first.y, first.m, 1), to: step === 0 ? today : endOf(first.y, first.m) };
}
/** the financial year to date ('ytd') or the one before it ('year'), stepped by years */
function yearRange(today, fyStartMonth, step, preset) {
  const fiscalYear = parts(fyStartOf(today, fyStartMonth));
  const years = preset === 'year' ? step - 1 : step;
  const end = shiftMonth(fiscalYear.y + years, fyStartMonth, 11);
  return { from: isoDay(fiscalYear.y + years, fyStartMonth, 1), to: preset === 'ytd' && step === 0 ? today : endOf(end.y, end.m) };
}
/** the month before today's, stepped by months */
function lastMonthRange(today, fyStartMonth, step) {
  const current = parts(today),
    first = shiftMonth(current.y, current.m, -1 + step);
  return { from: isoDay(first.y, first.m, 1), to: endOf(first.y, first.m) };
}
/** the financial quarter of today (to today), stepped by quarters */
function quarterRange(today, fyStartMonth, step) {
  const current = parts(today),
    fiscalYear = parts(fyStartOf(today, fyStartMonth)),
    since = current.y * 12 + current.m - 1 - (fiscalYear.y * 12 + fyStartMonth - 1),
    quarterStart = shiftMonth(fiscalYear.y, fyStartMonth, Math.floor(since / 3) * 3 + step * 3),
    last = shiftMonth(quarterStart.y, quarterStart.m, 2);
  return { from: isoDay(quarterStart.y, quarterStart.m, 1), to: step === 0 ? today : endOf(last.y, last.m) };
}
const RANGE_OF = { week: weekRange, mtd: monthSoFarRange, ytd: yearRange, year: yearRange, month: lastMonthRange, quarter: quarterRange };
/** the as-at day of a balance sheet: 'today' · 'month' (the end of the month before) · 'year' (the end of the last financial year) · stepped by month or by year, never past today */
function asAtOf(spec, today, fyStartMonth) {
  const kind = ['month', 'year'].includes(spec.kind) ? spec.kind : 'today',
    step = Math.min(0, Math.trunc(Number(spec.step) || 0));
  const todayParts = parts(today);
  if (kind === 'today') return { kind, step: 0, as_at: today, can_next: false };
  if (kind === 'month') {
    const month = shiftMonth(todayParts.y, todayParts.m, -1 + step);
    return { kind, step, as_at: endOf(month.y, month.m), can_next: step < 0 };
  }
  const fiscalYear = parts(fyStartOf(today, fyStartMonth)),
    end = shiftMonth(fiscalYear.y + step - 1, fyStartMonth, 11);
  return { kind, step, as_at: endOf(end.y, end.m), can_next: step < 0 };
}
/** the weekday of a day, Monday 1 … Sunday 7 (ISO 8601) */
function isoWeekday(day) {
  const p = parts(day),
    dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}
/** the Monday of ISO week `week` of ISO year `year` (week 1 holds 4 January) */
const mondayOfIsoWeek = (year, week) => addDays(addDays(isoDay(year, 1, 4), 1 - isoWeekday(isoDay(year, 1, 4))), (week - 1) * 7);
/** the ISO year and week of a day: { year, week } (the Thursday of its week names the year) */
function isoWeekOf(day) {
  const thursday = addDays(day, 4 - isoWeekday(day)),
    year = parts(thursday).y;
  return { year, week: Math.floor((Date.parse(thursday) - Date.parse(isoDay(year, 1, 1))) / 86400000 / 7) + 1 };
}
/** the same day one year earlier (29 Feb → 28 Feb) */
function yearBefore(day) {
  const p = parts(day);
  return isoDay(p.y - 1, p.m, Math.min(p.d, lastDay(p.y - 1, p.m)));
}
/** the day `n` months before (an end-of-month stays the end of its month) */
function monthsBefore(day, n) {
  const p = parts(day),
    m = shiftMonth(p.y, p.m, -n),
    atEnd = p.d === lastDay(p.y, p.m);
  return isoDay(m.y, m.m, atEnd ? lastDay(m.y, m.m) : Math.min(p.d, lastDay(m.y, m.m)));
}
/**
 * what a range is compared with: how 'year' → the same days one year earlier · 'period' → the equal span just before it
 * · 'week' (MIS A0) → the same ISO week one ISO year earlier through the same weekdays, so Mondays meet Mondays (NRF's calendar logic); null when last year has no such week (week 53)
 */
function priorOf(range, basis) {
  if (basis === 'week') {
    const { year, week } = isoWeekOf(range.from);
    if (week === 53 && isoWeekOf(addDays(isoDay(year - 1, 12, 28), 0)).week < 53) return null;
    const from = addDays(mondayOfIsoWeek(year - 1, week), isoWeekday(range.from) - 1),
      days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000);
    return { from, to: addDays(from, days) };
  }
  if (basis === 'period') {
    const span = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) + 1,
      to = addDays(range.from, -1);
    return { from: addDays(to, -(span - 1)), to };
  }
  return { from: yearBefore(range.from), to: yearBefore(range.to) };
}
/** a ratio in basis points, to a whole number half away from zero: the engine's timesMoney (one minor unit × the ratio), in the books' currency (CUR-1) */
const half = (value, currency) => require('./books-money-ops').roundMinor(value, currency);
/** the change from `earlier` to `now` as basis points of |earlier|; null when there is no earlier figure to compare with (earlier is 0 or unknown) */
function changeOf(now, earlier, currency) {
  if (earlier == null || now == null || Number(earlier) === 0) return null;
  return half(((Number(now) - Number(earlier)) * 10000) / Math.abs(Number(earlier)), currency);
}
/** a part as basis points of the whole (income): null when there is no whole */
function shareOf(part, whole, currency) {
  if (part == null || whole == null || Number(whole) === 0) return null;
  return half((Number(part) * 10000) / Number(whole), currency);
}

module.exports = { PRESETS, RUNNING, knownPreset, isoWeekday, isoWeekOf, periodOf, asAtOf, priorOf, yearBefore, monthsBefore, changeOf, shareOf, fyStartOf };

/**
 * ASA 520 analytical review: the ONE threshold a change is quietly highlighted at (Athi, 17 Nov; no setting in this slice).
 * Over = at least pct_bp of the earlier figure AND at least min_major whole currency units (the currency's own decimals).
 */
const OVER = { pct_bp: 1000, min_major: 1000 };
/** the threshold as the answer states it: percent (basis points) of the earlier figure, and the amount in this currency's minor units */
function overRule(currency) {
  return { pct_bp: OVER.pct_bp, min_major: OVER.min_major, min_minor: OVER.min_major * Math.pow(10, require('./money').decimals(currency)) };
}
/** a change that reaches both limits; a line with no earlier figure (percent undefined) is over on the amount alone */
function overThreshold(now, prior, currency) {
  const rule = overRule(currency),
    size = Math.abs(require('./books-money-ops').diffMinor(now, prior, currency)),
    bp = changeOf(now, prior, currency);
  return size >= rule.min_minor && (bp == null || Math.abs(bp) >= rule.pct_bp);
}
module.exports.overRule = overRule;
module.exports.overThreshold = overThreshold;

/**
 * the report lines of this period with the comparison range's figure beside each ledger and each head: prior_minor, change_bp (of the earlier figure), share_bp (of income, this period)
 * — all carried from the engine's own two reads, the page adds nothing. Ledgers are matched by code; a ledger absent from the earlier range has prior_minor 0 (change null).
 */
function compareLines(lines, priorLines, incomeNow, incomePrior, currency) {
  const earlier = new Map();
  (priorLines || []).forEach((head) => (head.accounts || []).forEach((item) => earlier.set(String(item.code), Number(item.amount_minor))));
  const headEarlier = new Map((priorLines || []).map((head) => [head.line, Number(head.amount_minor)]));
  const MoneyOps = require('./books-money-ops'),
    compared = !!priorLines; /* no earlier range read: no variance and no highlight (F-61: the prior figure is null, never 0) */
  const vary = (now, prior) => ({ change_minor: compared ? MoneyOps.diffMinor(now, prior, currency) : null, change_over: compared ? overThreshold(now, prior, currency) : false });
  return (lines || []).map((head) => {
    const accounts = (head.accounts || []).map((item) => {
      const prior = compared ? (earlier.has(String(item.code)) ? earlier.get(String(item.code)) : 0) : null;
      return Object.assign({}, item, { prior_minor: prior, change_bp: changeOf(item.amount_minor, prior, currency), share_bp: shareOf(item.amount_minor, incomeNow, currency), prior_share_bp: shareOf(prior, incomePrior, currency) }, vary(item.amount_minor, prior));
    });
    const prior = compared ? (headEarlier.has(head.line) ? headEarlier.get(head.line) : 0) : null;
    return Object.assign({}, head, { accounts, prior_minor: prior, change_bp: changeOf(head.amount_minor, prior, currency), share_bp: shareOf(head.amount_minor, incomeNow, currency) }, vary(head.amount_minor, prior));
  });
}
module.exports.compareLines = compareLines;

/**
 * the TRIAL BALANCE with last year beside it (leader-compare 17 Nov, item 2): each account's NET balance (debit positive, credit negative) at this as-at day and at the SAME day one year earlier,
 * the change between them (change_minor, change_bp of the earlier net) and the one ASA 520 flag (change_over, the same OVER rule as the P&L). An account only the earlier day holds is listed with nothing
 * now (its debit and credit nil), so a ledger closed to nil is seen. Every sum is the books' own helper (MoneyOps.diffMinor), no float arithmetic. priorRows null (not read) → the net only, no variance.
 */
function compareTrialRows(rows, priorRows, currency) {
  const moneyOps = require('./books-money-ops'),
    netOf = (row) => moneyOps.diffMinor(Number(row.debit_minor || 0), Number(row.credit_minor || 0), currency),
    priorByCode = new Map((priorRows || []).map((row) => [String(row.code), row])),
    seen = new Set((rows || []).map((row) => String(row.code))),
    onlyWas = (priorRows || []).filter((row) => !seen.has(String(row.code)) && netOf(row) !== 0).map((row) => Object.assign({}, row, { debit_minor: 0, credit_minor: 0 }));
  return (rows || []).concat(onlyWas).map((row) => {
    const netMinor = netOf(row),
      prior = priorByCode.has(String(row.code)) ? netOf(priorByCode.get(String(row.code))) : 0;
    return Object.assign({}, row, { net_minor: netMinor }, priorRows ? { prior_net_minor: prior, change_minor: moneyOps.diffMinor(netMinor, prior, currency), change_bp: changeOf(netMinor, prior, currency), change_over: overThreshold(netMinor, prior, currency) } : {});
  });
}
module.exports.compareTrialRows = compareTrialRows;

/**
 * RW3-22: the trial balance files each account under the statements' OWN line (the pack's presentation: Employee benefits expense, Finance costs, Revenue), the one grouping
 * the profit and loss and the balance sheet read, so Wages and Bank fees sit where the owner's P&L puts them and every group is one sentence-case phrase. An account the
 * pack does not know (a retired code) falls back to its chart group's key spelt as words. Adds group_label to each row; group (the chart key) is left as it was.
 */
function withGroupLabels(rows, pack) {
  const packs = require('./books-engines').packs(),
    presentation = pack && pack.presentation,
    words = (key) => String(key || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return (rows || []).map((row) => {
    let account = null;
    try {
      account = packs.accountOf(pack, String(row.code));
    } catch (notInPack) {
      require('./logger').fellBack('an account the pack does not hold — its group is said in words', notInPack, 'debug');
      account = null; /* the fallback below says its group */
    }
    const line = account && presentation && presentation.labelOf ? presentation.labelOf(account) : null;
    return Object.assign({}, row, { group_label: line || words(row.group) });
  });
}
module.exports.withGroupLabels = withGroupLabels;

/** the accounts that are the cost of the goods sold, by the account's ROLE (its type), never its code: the practice's gross margin (books-practice) and the P&L's gross profit line read this one list */
/* F-66 (21 Nov): + the pack's DIRECT costs — the expense classes the packs file under cost_of_sales (AU, AE) / direct_expenses (IN): freight inwards, packaging.
   The trial balance prints those under "Cost of sales", so the gross profit takes them off too (tests/mis-1121-grossprofit.test.cjs ties this list to the packs).
   Batch 1126 (engines v1.102.0): WAGES are an operating expense (6015, Athi's decision: a till's staff are not the cost of what was sold) — never in this list, old 5100 rows included. */
const COST_OF_SALES_ROLES = ['purchases', 'changes_in_inventories', 'purchase_returns', 'freight_inward', 'packing'];
/**
 * W18 (Athi 16 Nov): the P&L's gross profit = sales less the cost of sales, by account role. income / expense are the P&L's flat account rows ({ role, amount_minor }).
 * sales = the income accounts whose role starts "sales" (returns inside it, as the practice reads them); cost = the expense accounts in COST_OF_SALES_ROLES, less a purchase-returns account that sits on the income side.
 * null when the period holds no sales account: a statement with no trading is not given a gross profit it never had.
 */
function grossOf(income, expense, currency) {
  const MoneyOps = require('./books-money-ops'),
    amount = (list, test) => MoneyOps.sumMinor((list || []).filter((item) => test(String(item.role || ''))), currency, (item) => item.amount_minor),
    isSales = (role) => role.startsWith('sales');
  if (!(income || []).some((item) => isSales(String(item.role || '')))) return null;
  const sales = amount(income, isSales),
    cost = MoneyOps.diffMinor(amount(expense, (role) => COST_OF_SALES_ROLES.includes(role)), amount(income, (role) => role === 'purchase_returns'), currency);
  return { sales_minor: sales, cost_of_sales_minor: cost, gross_profit_minor: MoneyOps.diffMinor(sales, cost, currency) };
}
/** a comparison P&L that holds nothing (a range before the books began) is no comparison: null, never a Last-year column of 0.00 (F-66) */
function withFigures(pl) {
  return pl && ((pl.income || []).length || (pl.expenses || []).length) ? pl : null;
}
/** the day a range that runs past the shop's day is read to ({ through }), else nothing — so a heading never names the year to come (F-67) */
function throughOf(to, shopDay) {
  return to > shopDay ? { through: shopDay } : {};
}
module.exports.withFigures = withFigures;
module.exports.throughOf = throughOf;
module.exports.grossOf = grossOf;
module.exports.COST_OF_SALES_ROLES = COST_OF_SALES_ROLES;
