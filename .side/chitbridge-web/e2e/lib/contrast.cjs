/**
 * e2e/lib/contrast.cjs — WCAG contrast maths, in ONE place.
 *
 * ⚠️ IT LIVES HERE BECAUSE THERE ARE NOW TWO CALLERS. `a11y-contrast.cjs` measures the app's themes and
 * `till-contrast.cjs` measures the counter's, and a second copy of the sRGB transfer curve is the kind of
 * duplicate that stays right for a year and then silently disagrees — at which point one of the two tools is
 * passing a palette the other fails, and neither says so. [[feedback-no-duplicate-functions]]
 *
 * The numbers are WCAG 2.2:
 *   1.4.3 AA   body 4.5:1 · large 3:1
 *   1.4.6 AAA  body 7:1   · large 4.5:1
 *   1.4.11     non-text UI (rules, borders, focus rings) 3:1 — at every level
 */
'use strict';

/** '#abc' and '#aabbcc' both → [r,g,b]; anything else → null, so a bad token FAILS rather than measuring 0. */
function hex(c) {
  let s = String(c || '').trim().replace(/^#/, '');
  if (s.length === 3) s = s.split('').map((x) => x + x).join('');
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}

/** WCAG relative luminance — the sRGB transfer curve, not a naive average. */
function lum(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg, bg) {
  const a = hex(fg), b = hex(bg);
  if (!a || !b) return null;
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** color-mix(in srgb, fg pct%, bg) as a hex — what CBList's zebra and hover shades are made of (--cl-zebra · --cl-hov), so the tool measures the colour the screen paints. */
function mix(fg, pct, bg) {
  const a = hex(fg), b = hex(bg);
  if (!a || !b) return null;
  return '#' + a.map((v, i) => Math.round(v * pct + b[i] * (1 - pct)).toString(16).padStart(2, '0')).join('');
}

module.exports = { hex, lum, ratio, mix };
