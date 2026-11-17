/* cap-opening-years.js — the YEAR STRIP under Opening balances: one chip per financial year, read only; every figure is the server's carry (GET /api/books/opening/years).
 * ⭐ NOTHING IS ADDED UP HERE. "Matches last year's closing balance sheet ✓" is the server's own comparison of two carried totals (last year's carried out, this year's opening);
 *   when they differ the page shows both and the gap, and a year whose carry the engine refuses (Suspense not nil) shows the engine's sentence — never a blank year.
 * OWNS      obYearsHtml (the strip's markup from OPENING.years)
 * CALLED BY public/app/cap-opening.js (obRender · obShowSaved); loaded with it (accounts.html script tag · app.html CAP_WITH books)
 * FLOW      OPENING.years (GET /opening/years, read by obView) → obYearsHtml → chips
 * CARD      14-accounting/README
 */
'use strict';
/* ── the year strip: read only, every figure the server's carry ── */
function obYearsHtml() {
  var years = (OPENING.years && OPENING.years.years) || [];
  if (!years.length) return '';
  var currency = OPENING.years.currency;
  return (
    '<div class="ob-years">' +
    years
      .map(function (year, index) {
        var prev = index ? years[index - 1] : null;
        var line = '';
        if (prev && prev.refusal) line = '<span class="ob-bad">' + esc(prev.refusal) + '</span>';
        else if (prev && prev.matches === true) line = '<span class="ob-ok" data-testid="ob-match">' + esc(tx("matches last year's closing balance sheet")) + ' ✓</span>';
        else if (prev && prev.matches === false)
          line = '<span class="ob-bad">' + esc(txf("Opening {a} vs last year's closing {b}: {gap} apart", { a: bkMoney(prev.next_opening_minor, currency), b: bkMoney(prev.closing_minor, currency), gap: bkMoney(prev.apart_minor, currency) })) + '</span>';
        else if (!prev) line = '<span style="color:var(--grey)">' + esc(tx('Typed in by you')) + '</span>';
        return (
          '<div class="ob-year" data-testid="ob-year"><b>' + esc(year.fiscal_year) + '</b> · ' + esc(tx('opening')) + ' ' + esc(bkMoney(year.opening_minor, currency)) +
          (year.closing_minor != null ? ' · ' + esc(tx('closing')) + ' ' + esc(bkMoney(year.closing_minor, currency)) : '') + '<br>' + line + '</div>'
        );
      })
      .join('') +
    '</div>'
  );
}
