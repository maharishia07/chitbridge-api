/* icon-measure.cjs - THE ICON TEST'S EYES, ONE COPY (WEB-ICONS-2, 2026-11-13). Reuses the contrast idea of theme-measure.cjs for a glyph-only control.
 * OWNS      readIcon(testid): run INSIDE a page (page.evaluate(readIcon, testid)); returns the control's register attributes, its accessible name, its box, and
 *           the ink-against-ground contrast ratio (the ground = the first fully opaque background above it). Nothing here reads a page global: it is serialised whole.
 * CALLED BY e2e/walk-standards-icons.cjs (e2e/walk-shop-icons.cjs keeps its own copy until both PRs have landed, then it should call this).
 * CARD      qa/ui-identity
 */
'use strict';
function readIcon(testid) {
  const el = document.querySelector('[data-testid="' + testid + '"]');
  if (!el) return null;
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (s) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = s; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  let bg = [255, 255, 255, 1];
  for (let n = el; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] >= 1) { bg = c; break; } }
  const fg = rgba(getComputedStyle(el).color), a = lum(fg), b = lum(bg), r = el.getBoundingClientRect();
  return { sid: el.getAttribute('data-cbsid'), name: el.getAttribute('data-cbname'), mount: el.getAttribute('data-cbmount'), label: el.getAttribute('aria-label'),
    title: el.getAttribute('title'), w: Math.round(r.width), h: Math.round(r.height), ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100,
    tag: el.tagName, onclick: el.getAttribute('onclick') };
}
module.exports = { readIcon };
