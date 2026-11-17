/**
 * e2e/lib/rule13.cjs — BRIEF RULE 13, ONE COPY (lifted from walk-register.cjs, GOV-SPIN 2026-10-14, so walk-spin-country reuses it):
 * a screen in Cream AND Dark at 1366 AND 390 px — AA contrast of every text (lib/theme-measure.cjs), no clipped text, no inner sideways
 * scroll, nothing floating over a control, no link to app.html, copy within the text budget (≤140 chars, ≤2 sentences per paragraph).
 *   await require('./lib/rule13.cjs').rule13(w, 'R5', 'the code step', 'set')   // hostId: the element the screen paints into
 */
'use strict';
const { measure } = require('./theme-measure.cjs');

const audit = (page, hostId) => page.evaluate((hostId) => {
  const host = document.getElementById(hostId) || document.body, out = { clip: [], scroll: [], cover: [], app: [], budget: [], blank: [] };
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  document.querySelectorAll('body *').forEach((el) => {
    if (!vis(el) || el.closest('#cb-avatar,#toast,script,style')) return;
    const cs = getComputedStyle(el), hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
    if (/auto|scroll/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) out.scroll.push(el.tagName + '.' + el.className + ' ' + el.scrollWidth + '>' + el.clientWidth);
    /* T3-P2-CRM: screen-reader-only text (.sr-only, 1 px wide by design) is for the reader, not clipped on the screen */
    if (host.contains(el) && hasText && !el.classList.contains('sr-only') && (cs.textOverflow === 'ellipsis' || /hidden|clip/.test(cs.overflowX)) && el.scrollWidth > el.clientWidth + 1) out.clip.push(el.textContent.trim().slice(0, 40));
    const href = (el.getAttribute('href') || '') + ' ' + (el.getAttribute('onclick') || '');
    if (/app\.html/.test(href)) out.app.push(el.outerHTML.slice(0, 80));
  });
  if (document.documentElement.scrollWidth > window.innerWidth + 1) out.scroll.push('page ' + document.documentElement.scrollWidth + '>' + window.innerWidth);
  host.querySelectorAll('button,input,select,textarea,a').forEach((c) => {
    if (!vis(c)) return; c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (hit && hit !== c && !c.contains(hit) && !hit.contains(c) && !hit.closest('#toast') && !(c.tagName === 'INPUT' && hit.closest('label') && hit.closest('label').contains(c))) out.cover.push((c.dataset.testid || c.id || c.tagName) + ' under ' + (hit.id || hit.className || hit.tagName));
  });
  /* SET-WALK1 W21: no BLANK AREA — a CBList (or any scroller) taller than what it holds by more than a row paints nothing there */
  host.querySelectorAll('.cbl').forEach((el) => {
    if (!vis(el)) return;
    const box = el.querySelector(':scope > .cbl-list'); if (!box) return;
    const blank = box.clientHeight - box.scrollHeight;
    if (blank > 48 && el.getAttribute('data-cbl-fit') !== 'window') out.blank.push((el.getAttribute('data-cbl') || el.id || 'list') + ' ' + blank + 'px of nothing');
  });
  host.querySelectorAll('p,.hint,.sub,.err').forEach((n) => {
    const t = n.textContent.replace(/\s+/g, ' ').trim(); if (!t) return;
    const sentences = t.split(/[.!?](\s|$)/).filter((s) => s && s.trim()).length;
    if (t.length > 140 || sentences > 2) out.budget.push(t.length + ' chars / ' + sentences + ' sentences: "' + t.slice(0, 50) + '…"');
  });
  window.scrollTo(0, 0);
  return out;
}, hostId);

/** page: the walk's own unless another context's page is given (the spin matrix opens one per place) · restore: an async function that brings the screen back after each theme/width change (the workshop repaints over a window) */
async function rule13(w, id, label, hostId, page, restore) {
  page = page || w.page;
  for (const theme of ['cream', 'dark']) {
    for (const width of [1366, 390]) {
      await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
      await w.step(id + '·' + theme + '·' + width, label + ' · ' + theme + ' · ' + width + ' px -> AA contrast, no clipping, no inner sideways scroll, nothing over a control, no app.html link, copy in budget', async () => {
        await page.evaluate((t) => { CBAvatar.applyTheme(t); }, theme); await page.waitForTimeout(150);
        if (restore) await restore();   /* a workshop screen (a window, a pane) is repainted away by a theme change: the caller puts it back before it is measured */
        const pairs = await page.evaluate(measure), bad = pairs.filter((x) => !x.grad && x.ratio < x.need), a = await audit(page, hostId);
        const fails = [].concat(bad.map((x) => 'contrast ' + x.ratio + ' "' + x.text + '"'), a.clip.map((x) => 'clipped "' + x + '"'), a.scroll.map((x) => 'scroll ' + x),
          a.cover.map((x) => 'covered ' + x), a.app.map((x) => 'app.html ' + x), a.budget.map((x) => 'budget ' + x), (a.blank || []).map((x) => 'blank ' + x));
        return { ok: !fails.length && pairs.length > 5, saw: pairs.length + ' texts measured, lowest ' + Math.min.apply(null, pairs.map((x) => x.ratio)) + (fails.length ? ' · ' + fails.slice(0, 4).join(' · ') : ' · clean') };
      });
    }
  }
  await page.evaluate(() => { CBAvatar.applyTheme(CBAvatar.themeKey()); }).catch(() => {});
  await page.setViewportSize({ width: 1366, height: 900 });
}

module.exports = { rule13, audit };
