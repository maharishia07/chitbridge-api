/**
 * books-report-period.js — the period of a P&L / Balance sheet and what it is compared with (ACC-357 / W15-118, W15-119).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      periodOf(spec, today, fyStartMonth) · priorOf(range, how) · asAtOf(spec, today, fyStartMonth) · changeOf(now, was) · shareOf(part, whole) · grossOf(income, expense, currency)
 * CALLED BY routes/books.js GET /pl · GET /bs
 * ⭐ THE PACK DECIDES the financial year (fyStartMonth is the pack's fyRange start); the presets are This year to date · Last month · Quarter · Last year, each stepped with ‹ ›.
 * ⭐ ANY RANGE vs THE SAME RANGE LAST YEAR (the leaders: docs/walks/LEADERS-REPORTS-2026-11-16.md): the prior range is the same days one year earlier, or the equal span just before it. Dates are YYYY-MM-DD strings, no clock.
 * ⭐ A PERCENT IS CARRIED, NEVER WORKED OUT BY THE PAGE: changeOf / shareOf answer basis points (1 bp = 0.01%), rounded half away from zero.
 */
'use strict';
const { addDays } = require('./books-engines');
const PRESETS = [['ytd', 'This year to date'], ['month', 'Last month'], ['quarter', 'Quarter'], ['year', 'Last year']];
const pad = (n) => String(n).padStart(2, '0');
const isoDay = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
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
  const preset = PRESETS.some((x) => x[0] === spec.preset) ? spec.preset : 'ytd',
    step = Math.min(0, Math.trunc(Number(spec.step) || 0));
  const fy = parts(fyStartOf(today, fyStartMonth));
  let from, to;
  if (preset === 'ytd' || preset === 'year') {
    const years = preset === 'year' ? step - 1 : step;
    from = isoDay(fy.y + years, fyStartMonth, 1);
    const end = shiftMonth(fy.y + years, fyStartMonth, 11);
    to = preset === 'ytd' && step === 0 ? today : endOf(end.y, end.m);
  } else if (preset === 'month') {
    const t = parts(today),
      first = shiftMonth(t.y, t.m, -1 + step);
    from = isoDay(first.y, first.m, 1);
    to = endOf(first.y, first.m);
  } else {
    const t = parts(today),
      since = (t.y * 12 + t.m - 1) - (fy.y * 12 + fyStartMonth - 1),
      q = shiftMonth(fy.y, fyStartMonth, Math.floor(since / 3) * 3 + step * 3),
      last = shiftMonth(q.y, q.m, 2);
    from = isoDay(q.y, q.m, 1);
    to = step === 0 ? today : endOf(last.y, last.m);
  }
  return { preset, step, from, to, can_next: step < 0 };
}
/** the as-at day of a balance sheet: 'today' · 'month' (the end of the month before) · 'year' (the end of the last financial year) · stepped by month or by year, never past today */
function asAtOf(spec, today, fyStartMonth) {
  const kind = ['month', 'year'].includes(spec.kind) ? spec.kind : 'today',
    step = Math.min(0, Math.trunc(Number(spec.step) || 0));
  const t = parts(today);
  if (kind === 'today') return { kind, step: 0, as_at: today, can_next: false };
  if (kind === 'month') {
    const m = shiftMonth(t.y, t.m, -1 + step);
    return { kind, step, as_at: endOf(m.y, m.m), can_next: step < 0 };
  }
  const fy = parts(fyStartOf(today, fyStartMonth)),
    end = shiftMonth(fy.y + step - 1, fyStartMonth, 11);
  return { kind, step, as_at: endOf(end.y, end.m), can_next: step < 0 };
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
/** what a range is compared with: how 'year' → the same days one year earlier · 'period' → the equal span just before it */
function priorOf(range, how) {
  if (how === 'period') {
    const span = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) + 1,
      to = addDays(range.from, -1);
    return { from: addDays(to, -(span - 1)), to };
  }
  return { from: yearBefore(range.from), to: yearBefore(range.to) };
}
/** a ratio in basis points, to a whole number half away from zero: the engine's timesMoney (one minor unit × the ratio), in the books' currency (CUR-1) */
const half = (value, currency) => require('./books-money-ops').roundMinor(value, currency);
/** the change from `was` to `now` as basis points of |was|; null when there is no earlier figure to compare with (was is 0 or unknown) */
function changeOf(now, was, currency) {
  if (was == null || now == null || Number(was) === 0) return null;
  return half(((Number(now) - Number(was)) * 10000) / Math.abs(Number(was)), currency);
}
/** a part as basis points of the whole (income): null when there is no whole */
function shareOf(part, whole, currency) {
  if (part == null || whole == null || Number(whole) === 0) return null;
  return half((Number(part) * 10000) / Number(whole), currency);
}

module.exports = { PRESETS, periodOf, asAtOf, priorOf, yearBefore, monthsBefore, changeOf, shareOf, fyStartOf };

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
  const was = new Map();
  (priorLines || []).forEach((head) => (head.accounts || []).forEach((item) => was.set(String(item.code), Number(item.amount_minor))));
  const headWas = new Map((priorLines || []).map((head) => [head.line, Number(head.amount_minor)]));
  const MO = require('./books-money-ops'),
    compared = !!priorLines; /* no earlier range read: no variance and no highlight (the prior figure stays 0 as before) */
  const vary = (now, prior) => ({ change_minor: compared ? MO.diffMinor(now, prior, currency) : null, change_over: compared ? overThreshold(now, prior, currency) : false });
  return (lines || []).map((head) => {
    const accounts = (head.accounts || []).map((item) => {
      const prior = was.has(String(item.code)) ? was.get(String(item.code)) : 0;
      return Object.assign({}, item, { prior_minor: prior, change_bp: changeOf(item.amount_minor, prior, currency), share_bp: shareOf(item.amount_minor, incomeNow, currency), prior_share_bp: shareOf(prior, incomePrior, currency) }, vary(item.amount_minor, prior));
    });
    const prior = headWas.has(head.line) ? headWas.get(head.line) : 0;
    return Object.assign({}, head, { accounts, prior_minor: prior, change_bp: changeOf(head.amount_minor, prior, currency), share_bp: shareOf(head.amount_minor, incomeNow, currency) }, vary(head.amount_minor, prior));
  });
}
module.exports.compareLines = compareLines;

/** the accounts that are the cost of the goods sold, by the account's ROLE (its type), never its code: the practice's gross margin (books-practice) and the P&L's gross profit line read this one list */
const COST_OF_SALES_ROLES = ['purchases', 'changes_in_inventories', 'purchase_returns'];
/**
 * W18 (Athi 16 Nov): the P&L's gross profit = sales less the cost of sales, by account role. income / expense are the P&L's flat account rows ({ role, amount_minor }).
 * sales = the income accounts whose role starts "sales" (returns inside it, as the practice reads them); cost = the expense accounts in COST_OF_SALES_ROLES, less a purchase-returns account that sits on the income side.
 * null when the period holds no sales account: a statement with no trading is not given a gross profit it never had.
 */
function grossOf(income, expense, currency) {
  const MO = require('./books-money-ops'),
    amount = (list, test) => MO.sumMinor((list || []).filter((item) => test(String(item.role || ''))), currency, (item) => item.amount_minor),
    isSales = (role) => role.startsWith('sales');
  if (!(income || []).some((item) => isSales(String(item.role || '')))) return null;
  const sales = amount(income, isSales),
    cost = MO.diffMinor(amount(expense, (role) => COST_OF_SALES_ROLES.includes(role)), amount(income, (role) => role === 'purchase_returns'), currency);
  return { sales_minor: sales, cost_of_sales_minor: cost, gross_profit_minor: MO.diffMinor(sales, cost, currency) };
}
module.exports.grossOf = grossOf;
module.exports.COST_OF_SALES_ROLES = COST_OF_SALES_ROLES;
