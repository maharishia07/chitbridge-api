/**
 * books-opening-count.js — P1-1 (18 Nov): the ONE place the opening-balance journal is counted into a month.
 * OWNER     cb-accounting
 * RISK      money (none: counts only)
 * OWNS      foldOpening(figures, days, months)
 * CALLED BY lib/books-store.periodFigures (and the in-memory store of the tests)
 * FLOW      month figures + the opening journals' days -> the same figures with each opening counted in the month of its day
 * CARD      14-accounting/README
 */
'use strict';
/** the opening journals (period 0) counted into the month their day falls in: figures [{ fiscal_year, period, entries, sales_minor }], days [{ fiscal_year, day, n }], months [{ fiscal_year, period, start_date, end_date }] (ISO days). A day no month holds stays in period 0 (never lost). Pure: counts only, no money. */
function foldOpening(figures, days, months) {
  const out = figures.map((x) => Object.assign({}, x));
  for (const d of days || []) {
    const home = (months || []).find((m) => m.fiscal_year === d.fiscal_year && Number(m.period) >= 1 && d.day >= m.start_date && d.day <= m.end_date);
    if (!home) continue;
    const zero = out.find((x) => x.fiscal_year === d.fiscal_year && x.period === 0);
    let into = out.find((x) => x.fiscal_year === home.fiscal_year && x.period === Number(home.period));
    if (!into) { into = { fiscal_year: home.fiscal_year, period: Number(home.period), entries: 0, sales_minor: 0 }; out.push(into); }
    into.entries += Number(d.n);
    if (zero) zero.entries -= Number(d.n);
  }
  return out.filter((x) => x.entries > 0);
}
module.exports = { foldOpening };
