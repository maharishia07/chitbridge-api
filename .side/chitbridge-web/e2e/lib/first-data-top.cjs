/**
 * first-data-top.cjs — THE FIRST-DATA GUARD (w19-first-data-top, Athi's rule 4: data by 20% of a 1366x768 screen, 30% of a 390x844 phone), ONE guard for BOTH seats.
 * OWNS     the measurement: for every client view (Trial balance, Profit and loss, Balance sheet, Day book, Who owes whom, Months) at both sizes, the VISIBLE top of the first data row, measured from y = 0 of the page at scroll 0, nothing subtracted
 *          (the shell bar, a wrapped crumb, a search box all count: the person sees them). A view with no rows measures its empty state's top. Sideways scroll and a search box on fewer than ten rows fail too.
 * CALLED BY e2e/walk-books-grant.cjs (the auditor seat, step W19) and e2e/walk-books-adviser.cjs (the accountant seat). Needs the walk's page on an open client with the tabs drawn.
 * PHONE the six tabs are ONE select (bv-tab-select), no tab buttons.
 * CEILINGS TARGET.wide 0.20 · TARGET.narrow 0.30 for every view. A view that cannot meet it yet is listed in e2e/first-data-ceilings.json under "<seat>.<view>.<width>" with its MEASURED fraction; that number may only fall, never be raised (a PR that raises one is refused in review).
 *          The walk prints each view's figure; nothing is loosened silently.
 */
'use strict';
const fs = require('fs'), path = require('path');
const TARGET = { wide: 0.20, narrow: 0.30 };
const SLACK_PX = 2;
const VIEWS = ['tb', 'pl', 'bs', 'daybook', 'dues', 'periods'];
function overrides() { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'first-data-ceilings.json'), 'utf8')).ceilings || {}; } catch (_) { return {}; } }
/** one measurement of the open view, in the page: the first visible data row (or the empty state) and the sideways overflow */
const measure = () => document && (() => {
  const visible = (e) => e && e.offsetParent !== null && e.getBoundingClientRect().height > 0;
  const rows = Array.from(document.querySelectorAll('[data-testid^="bv-row-"], #bv_list tbody tr, #bv_dues_c tbody tr, #bv_list .cbl-row')).filter(visible);
  const empty = Array.from(document.querySelectorAll('#bv_list .cbl-state, #bv_list .empty, #bv_list [data-testid*="empty"], #bv_list .bv-dues-nil')).filter(visible)[0];
  const el = rows[0] || empty || null;
  let top = null;
  if (el) { top = el.getBoundingClientRect().top; const sticky = document.querySelector('#bv_list thead, #bv_list .cbl-head'); if (sticky && visible(sticky) && rows[0] && sticky.getBoundingClientRect().bottom > top) top = sticky.getBoundingClientRect().bottom; } /* a sticky head covering the first row: the row's visible top is under the head */
  return { H: innerHeight, top, rows: rows.length, kind: rows[0] ? 'row' : empty ? 'empty' : 'none', search: Array.from(document.querySelectorAll('#bv_list .cbl-search')).filter(visible).length, x: document.documentElement.scrollWidth - document.documentElement.clientWidth };
})();
async function firstDataTop(page, o) {
  const { T, has, WIDE, NARROW, seat } = o, held = overrides(), out = [], bad = [];
  for (const vp of [WIDE, NARROW]) {
    await page.setViewportSize(vp); await page.waitForTimeout(300);
    const narrow = vp.width < 500;
    for (const view of VIEWS) {
      const pick = narrow && (await has(T('bv-tab-select'))); /* a phone holds the six screens as ONE library select (header line); a laptop as buttons */
      if (!pick && !(await has(T('bv-tab-' + view)))) continue;
      if (pick) await page.selectOption(T('bv-tab-select'), view); else await page.click(T('bv-tab-' + view));
      if (narrow && !pick) bad.push(seat + '.' + view + '.' + vp.width + ' phone without the one screen select');
      await page.waitForFunction((k) => { const b = document.querySelector('[data-testid="bv-tab-' + k + '"]'); return b && (b.getAttribute('aria-pressed') === 'true' || b.classList.contains('on') || b.getAttribute('aria-selected') === 'true' || true); }, view).catch(() => {});
      await page.waitForTimeout(600);
      await page.evaluate(() => window.scrollTo(0, 0));
      const m = await page.evaluate(measure), key = seat + '.' + view + '.' + vp.width, target = narrow ? TARGET.narrow : TARGET.wide, ceiling = Math.max(held[key] || 0, target);
      if (m.top == null) { bad.push(key + ' nothing to measure'); continue; }
      const frac = m.top / m.H;
      out.push(key + ' ' + m.kind + ' ' + Math.round(m.top) + 'px ' + (frac * 100).toFixed(0) + '% (limit ' + (ceiling * 100).toFixed(0) + '%)');
      const slack = held[key] ? SLACK_PX / m.H : 0; /* a HELD view is allowed 2 px over its measured figure (sub-pixel layout); a view at the plain target is not */
      if (frac > ceiling + slack + 1e-9) bad.push(key + ' first ' + m.kind + ' at ' + Math.round(m.top) + 'px = ' + (frac * 100).toFixed(1) + '% > ' + (ceiling * 100).toFixed(0) + '%');
      else if (frac > target + 1e-9) out.push(key + ' above the target, held at its measured ceiling');
      if (m.x > 0) bad.push(key + ' sideways ' + m.x);
      if (m.rows < 10 && m.search) bad.push(key + ' search box on ' + m.rows + ' rows');
    }
  }
  await page.setViewportSize(WIDE); await page.waitForTimeout(300);
  return { ok: bad.length === 0, saw: bad.length ? bad.join(' · ') + ' || ' + out.join(' · ') : out.join(' · '), all: out, bad };
}
module.exports = { firstDataTop, TARGET, VIEWS };
