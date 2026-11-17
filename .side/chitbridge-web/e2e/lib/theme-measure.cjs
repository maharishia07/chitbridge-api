/* theme-measure.cjs — THE CONTRAST MEASUREMENT, ONE COPY (moved out of e2e/crm-themes.cjs, 2026-10-03, so e2e/standards-page.cjs measures with the same eyes).
 * measure() runs INSIDE a page (page.evaluate(measure)): every visible text element's colour (alpha included) against the colour actually painted behind it
 * (the ancestors' backgrounds composited), sorted into categories; need 4.5:1, or 3:1 for large text. It returns one record per element; the caller decides
 * what a failure is. Nothing here reads a page global, so it is serialised whole.                                                                     */
'use strict';
function measure() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (s) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = s; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top, under) => { const a = top[3]; return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  /* the colour painted behind an element: walk up, collecting backgrounds, composite from the page down. A gradient/image ground is skipped (flagged). */
  function ground(el) {
    const layers = []; let grad = false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') grad = true;
      const bg = rgba(cs.backgroundColor); if (bg[3] > 0) layers.push(bg);
      if (bg[3] >= 1) break;
    }
    let base = [255, 255, 255, 1]; for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return { c: base, grad };
  }
  const CATS = [['selected row', '.cbl-row.sel,.cbl-lrec.sel'], ['title', '.cbl-title h1'], ['group label', '.cbl-group'], ['column head', '.cbl-hc'], ['row', '.cbl-row,.cbl-lrec,.cbl-next'],
    ['toolbar button', '.cbl-tools button,.cbl-tools select,.cbl-tools input,.cbl-seg button,.cbl-count,.cbl-btn'], ['chip', '.tag,.cbl-chip,.cbl-fchip,.optchip,.n'], ['sidebar', '.side'], ['bar', '.bar'], ['heading', 'h1,h2,h3']];
  const out = [], seen = new Set();
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return false; } return true; };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t; (t = walker.nextNode());) {
    const txt = t.nodeValue.replace(/\s+/g, ' ').trim(); if (!txt || !/[A-Za-z0-9]/.test(txt)) continue;
    const el = t.parentElement; if (!el || seen.has(el) || /^(SCRIPT|STYLE|TITLE|OPTION)$/.test(el.tagName)) continue;
    if (el.closest('#cb-avatar,.proto,:disabled,[aria-disabled="true"],[hidden],.sr-only,.cbl-live,dialog:not([open]),#toast')) continue;
    if (!vis(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el); let a = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) a *= Number(getComputedStyle(n).opacity);
    if (a < 0.05) continue;   /* text faded out (the kural band on a phone takes turns) is not on screen */
    const g = ground(el); let fg = rgba(cs.color); fg[3] *= a; fg = over(fg, g.c);
    const size = parseFloat(cs.fontSize), w = Number(cs.fontWeight) >= 700 || cs.fontWeight === 'bold', large = size >= 24 || (size >= 18.66 && w);
    let cat = 'other'; for (const [name, sel] of CATS) { if (el.closest(sel)) { cat = name; break; } }
    out.push({ cat, text: txt.slice(0, 28), ratio: Math.round(ratio(fg, g.c) * 100) / 100, need: large ? 3 : 4.5, grad: g.grad, html: el.outerHTML.slice(0, 150), tag: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '') });
  }
  return out;
}

module.exports = { measure };
