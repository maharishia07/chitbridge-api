/**
 * books-report-period.js — the period of a P&L / Balance sheet and what it is compared with (ACC-357 / W15-118, W15-119).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      periodOf(spec, today, fyStartMonth) · priorOf(range, how) · asAtOf(spec, today, fyStartMonth) · changeOf(now, was) · shareOf(part, whole)
 * CALLED BY routes/books.js GET /pl · GET /bs
 * ⭐ THE PACK DECIDES the financial year (fyStartMonth is the pack's fyRange start); the presets are This year to date · Last month · Quarter · Last year, each stepped with ‹ ›.
 * ⭐ ANY RANGE vs THE SAME RANGE LAST YEAR (the leaders: docs/walks/LEADERS-REPORTS-2026-11-16.md): the prior range is the same days one year earlier, or the equal span just before it. Dates are YYYY-MM-DD strings, no clock.
 * ⭐ A PERCENT IS CARRIED, NEVER WORKED OUT BY THE PAGE: changeOf / shareOf answer basis points (1 bp = 0.01%), rounded half away from zero.
 */
'use strict';
const PRESETS = [['ytd', 'This year to date'], ['month', 'Last month'], ['quarter', 'Quarter'], ['year', 'Last year']];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const parts = (day) => ({ y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)), d: Number(day.slice(8, 10)) });
/** the first of the month `n` months from (y, m) (n may be negative) → { y, m } */
function shiftMonth(y, m, n) {
  const index = y * 12 + (m - 1) + n;
  return { y: Math.floor(index / 12), m: (index % 12) + 1 };
}
const endOf = (y, m) => ymd(y, m, lastDay(y, m));
/** the first day of the financial year that holds `day` */
function fyStartOf(day, fyStartMonth) {
  const p = parts(day);
  return ymd(p.m >= fyStartMonth ? p.y : p.y - 1, fyStartMonth, 1);
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
    from = ymd(fy.y + years, fyStartMonth, 1);
    const end = shiftMonth(fy.y + years, fyStartMonth, 11);
    to = preset === 'ytd' && step === 0 ? today : endOf(end.y, end.m);
  } else if (preset === 'month') {
    const t = parts(today),
      first = shiftMonth(t.y, t.m, -1 + step);
    from = ymd(first.y, first.m, 1);
    to = endOf(first.y, first.m);
  } else {
    const t = parts(today),
      since = (t.y * 12 + t.m - 1) - (fy.y * 12 + fyStartMonth - 1),
      q = shiftMonth(fy.y, fyStartMonth, Math.floor(since / 3) * 3 + step * 3),
      last = shiftMonth(q.y, q.m, 2);
    from = ymd(q.y, q.m, 1);
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
  return ymd(p.y - 1, p.m, Math.min(p.d, lastDay(p.y - 1, p.m)));
}
/** the day `n` months before (an end-of-month stays the end of its month) */
function monthsBefore(day, n) {
  const p = parts(day),
    m = shiftMonth(p.y, p.m, -n),
    atEnd = p.d === lastDay(p.y, p.m);
  return ymd(m.y, m.m, atEnd ? lastDay(m.y, m.m) : Math.min(p.d, lastDay(m.y, m.m)));
}
/** what a range is compared with: how 'year' → the same days one year earlier · 'period' → the equal span just before it */
function priorOf(range, how) {
  if (how === 'period') {
    const span = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) + 1,
      to = new Date(Date.parse(range.from) - 86400000);
    const from = new Date(to.getTime() - (span - 1) * 86400000);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }
  return { from: yearBefore(range.from), to: yearBefore(range.to) };
}
const half = (value) => (value < 0 ? -Math.round(-value) : Math.round(value));
/** the change from `was` to `now` as basis points of |was|; null when there is no earlier figure to compare with (was is 0 or unknown) */
function changeOf(now, was) {
  if (was == null || now == null || Number(was) === 0) return null;
  return half(((Number(now) - Number(was)) * 10000) / Math.abs(Number(was)));
}
/** a part as basis points of the whole (income): null when there is no whole */
function shareOf(part, whole) {
  if (part == null || whole == null || Number(whole) === 0) return null;
  return half((Number(part) * 10000) / Number(whole));
}

module.exports = { PRESETS, periodOf, asAtOf, priorOf, yearBefore, monthsBefore, changeOf, shareOf, fyStartOf };

/**
 * the report lines of this period with the comparison range's figure beside each ledger and each head: prior_minor, change_bp (of the earlier figure), share_bp (of income, this period)
 * — all carried from the engine's own two reads, the page adds nothing. Ledgers are matched by code; a ledger absent from the earlier range has prior_minor 0 (change null).
 */
function compareLines(lines, priorLines, incomeNow, incomePrior) {
  const was = new Map();
  (priorLines || []).forEach((head) => (head.accounts || []).forEach((item) => was.set(String(item.code), Number(item.amount_minor))));
  const headWas = new Map((priorLines || []).map((head) => [head.line, Number(head.amount_minor)]));
  return (lines || []).map((head) => {
    const accounts = (head.accounts || []).map((item) => {
      const prior = was.has(String(item.code)) ? was.get(String(item.code)) : 0;
      return Object.assign({}, item, { prior_minor: prior, change_bp: changeOf(item.amount_minor, prior), share_bp: shareOf(item.amount_minor, incomeNow), prior_share_bp: shareOf(prior, incomePrior) });
    });
    const prior = headWas.has(head.line) ? headWas.get(head.line) : 0;
    return Object.assign({}, head, { accounts, prior_minor: prior, change_bp: changeOf(head.amount_minor, prior), share_bp: shareOf(head.amount_minor, incomeNow) });
  });
}
module.exports.compareLines = compareLines;
