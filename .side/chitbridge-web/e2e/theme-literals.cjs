/**
 * theme-literals.cjs — a colour written as a LITERAL is a colour the theme cannot reach.
 *
 * ⚠️⚠️ WHY THIS IS A THIRD TOOL AND NOT A CASE OF THE OTHER TWO. a11y-contrast.cjs measures the theme TOKENS —
 * it proves #3A4046 on #FFFFFF really is 7:1, and it is blind to anything not declared as a token.
 * token-check.cjs proves every `var(--x)` resolves — it is blind to a colour that never asks for a token at all.
 * A hardcoded `color:#1d2530` inside a JS template string passes both, cleanly, and is invisible on a dark card.
 * Three different questions: is the token right · does the token exist · WAS A TOKEN USED.
 *
 * ⚠️ AND THIS IS THE FAILURE ATHI REPORTED. A product-row status chip stored its colours as DATA — three
 * [text, background, label] triples in an array, interpolated into a style attribute at render time. No scan of
 * `background:` could see them, so every pass walked past and they stayed light: a pale sand chip on a dark row.
 *
 * WHAT IT RANKS AS CRITICAL — a literal that is invisible in one of the two grounds:
 *   · dark ink with NO background beside it   → vanishes on a dark theme
 *   · light ink with NO background beside it  → vanishes on a light theme
 * A literal text colour PAIRED with a literal background is a self-consistent island: it ignores the theme, but
 * it stays readable in both, so it is a warning and not a failure.
 *
 * ⭐ SOME SURFACES ARE DELIBERATELY SINGLE-THEME — a printable card, an exported PDF, a certificate. Those are
 * not bugs, they are a decision, so they declare it in EXEMPT below WITH A REASON rather than being silently
 * skipped. An exemption nobody wrote a reason for is indistinguishable from an oversight.
 *
 * Run: node e2e/theme-literals.cjs        (exit 1 on any critical)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'public');
const FILES = ['app.html'].concat(
  fs.readdirSync(path.join(WEB, 'app')).filter((f) => f.endsWith('.js')).map((f) => 'app/' + f)
);

/** Surfaces that are meant to look the same however the app is themed. Reason required — see the header. */
/**
 * ⭐ A DECLARED REGION, NOT A WINDOW (2026-09-27). The whole-file EXEMPT below cannot say "this one function is paper":
 * app.html's product-page Invoice tab (prodInvoiceTab) draws a SAMPLE INVOICE on a white sheet — its container sets
 * background:#fff;color:#111 — so its #666 captions are grey on paper, correct in every theme, exactly as the readiness
 * card is. The guard's rule against looking at neighbouring lines stands; this names a whole FUNCTION, with a reason.
 */
const EXEMPT_FN = {
  'app.html': { prodInvoiceTab: 'the sample invoice on the product page — drawn on a white sheet (background:#fff;color:#111), paper by design' },
};
const EXEMPT = {
  'app/cap-readiness.js': 'the printable readiness card — it is exported and printed, so it is white paper by design',
};

/* ── colour maths: enough to know whether a colour reads as ink or as paper ────────────────────────────────── */

function rgbOf(c) {
  const s = String(c || '').trim();
  let m = s.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
    if (h.length < 6) return null;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  m = s.match(/^rgba?\(([^)]*)\)$/i);
  if (m) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.slice(0, 3).some((n) => !isFinite(n))) return null;
    /* ⚠️ A TRANSPARENT COLOUR IS NOT INK. rgba(0,0,0,.06) is a shadow or a hairline, not text, and judging it by
       its opaque luminance reports every scrim in the app as invisible black. Alpha under a half is a wash. */
    if (p.length > 3 && p[3] < 0.5) return null;
    return p.slice(0, 3);
  }
  return null;
}

/** WCAG relative luminance — the sRGB transfer curve, so mid greens do not read as light as mid blues. */
function lum(rgb) {
  const f = rgb.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
}

/* ── where a literal is allowed to live ───────────────────────────────────────────────────────────────────── */

/**
 * ⭐⭐ ONLY INLINE `style="…"` IS IN SCOPE, AND THE REASON IS THE CASCADE. A literal in a stylesheet rule has a
 * ground supplied by an ancestor — `.topbar .ham{color:#fff}` is white on the topbar's own dark bar, and reading
 * that line alone reports a bug that is not there. I flagged 26 of them before checking, which is exactly the
 * mistake this comment exists to stop anyone repeating. A theme can also re-skin a class; it cannot reach into a
 * style attribute. So the attribute is where a literal is FINAL, and that is the only place this fails a build.
 *
 * ⚠️ AND A GROUND IS A GROUND WHATEVER ITS VALUE, AND WHEREVER ON THE LINE IT IS WRITTEN. Two separate
 * corrections, both found by checking a sample before fixing anything. A background painted by a VARIABLE is
 * unknowable here, but the ink is plainly not floating — so ANY background declaration counts, not only a literal
 * or a var(). And a style attribute built by concatenation is not one quoted string: the source reads
 * style="' + rnd + ';background:' + a + ';color:#fff", so pairing quotes finds a fragment holding the ink and not
 * the ground, and reports every coloured button in the cart as invisible white text. The LINE is the unit for the
 * ground; the presence of style= on it is the unit for scope.
 *
 * ⭐ The cost of that widening is stated rather than hidden: a line painting two elements, one with a ground and
 * one without, is read as safe. That is a MISS, not a false alarm — the direction to err in for a guard that
 * fails a build.
 *
 * ⚠️ THE ONE PLACE IT ERRS THE OTHER WAY is an element built across several lines — the recall banner opens with a
 * gradient ground on one line and writes its ink two lines down, so the ink looks unhosted. Left as-is rather than
 * widened to a window: a window big enough to catch it is also big enough to accept the ground of the element
 * ABOVE, and a guard that accepts a neighbour's ground stops being a guard. The banner was tokenised instead,
 * which is the outcome wanted anyway.
 */
function inlineStyled(line) { return /style\s*=/.test(line); }

/* A literal inside a comment is prose about a colour, not a colour. */
function isComment(line) {
  const t = line.trim();
  return t.startsWith('*') || t.startsWith('//') || t.startsWith('/*');
}

const DECL = /(background(?:-color)?|border(?:-[a-z]+)?-color|color|fill|stroke|box-shadow|outline(?:-color)?)\s*:\s*([^;'"`]+)/gi;

const findings = [];

for (const rel of FILES) {
  const lines = fs.readFileSync(path.join(WEB, rel), 'utf8').split('\n');
  let fnName = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fm = line.match(/^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/);
    if (fm) fnName = fm[1];
    if (isComment(line) || !inlineStyled(line)) continue;
    const fnWhy = (EXEMPT_FN[rel] || {})[fnName] || null;

    const decls = [];
    let m;
    DECL.lastIndex = 0;
    while ((m = DECL.exec(line))) decls.push({ prop: m[1].toLowerCase(), val: m[2].trim() });
    if (!decls.length) continue;

    const paints = (p) => /^background/.test(p);
    /* ⚠️ THE GROUND IS FOUND BY ITS PROPERTY, NOT ITS VALUE, and that is the third correction on this one test.
       DECL refuses a value containing a quote — deliberately, so it never swallows the rest of a template string —
       which means a background painted by a variable matches NOTHING AT ALL and reads as no background. Asking
       only whether the word appears is enough: the question is whether something is painted, not what. */
    const hasGround = /background(?:-color)?\s*:\s*(?!\s*(?:none|transparent)\b)\S/.test(line);

    for (const d of decls) {
      /* ⚠️ A SHADOW OR A HAIRLINE IS NOT TEXT. Those literals do not go invisible, they go slightly wrong — a
         different and much smaller problem, so they never rank critical. */
      const decorative = /shadow|outline|border/.test(d.prop);
      const rgb = rgbOf(d.val.split(/\s+/).find((t) => rgbOf(t)) || d.val);
      if (!rgb) continue;

      const L = lum(rgb);
      const ink = !paints(d.prop) && !decorative;
      let sev = 'warn', why = 'ignores the theme, but the pair is self-consistent';
      if (ink && !hasGround) {
        if (L < 0.18) { sev = 'critical'; why = 'dark ink, nothing painted under it — invisible on a dark theme'; }
        else if (L > 0.72) { sev = 'critical'; why = 'light ink, nothing painted under it — invisible on a light theme'; }
      }
      findings.push({ rel, line: i + 1, prop: d.prop, val: d.val.slice(0, 28), sev, why,
        exempt: EXEMPT[rel] || fnWhy || null });
    }
  }
}

/* ── report ───────────────────────────────────────────────────────────────────────────────────────────────── */

const live = findings.filter((f) => !f.exempt);
const crit = live.filter((f) => f.sev === 'critical');
const warn = live.filter((f) => f.sev === 'warn');

/* ⭐ --json so the FIXER consumes exactly what the guard reports. A fixer that re-derives the list from its own
   regex is a second opinion, and the two drift the moment either is corrected — which this one was, three times. */
if (process.argv.indexOf('--json') >= 0) { console.log(JSON.stringify(crit)); process.exit(0); }

console.log('\n══ THEME LITERALS ══   (inline style attributes only — see the header for why)');
console.log('  ' + findings.length + ' literal colour(s) in style attributes · '
  + (findings.length - live.length) + ' on exempt surfaces');
console.log('  ' + crit.length + ' critical · ' + warn.length + ' theme-blind but readable\n');

const byFile = {};
for (const f of crit) (byFile[f.rel] = byFile[f.rel] || []).push(f);
for (const rel of Object.keys(byFile).sort((a, b) => byFile[b].length - byFile[a].length)) {
  console.log('  ✗ ' + rel + '  (' + byFile[rel].length + ')');
  for (const f of byFile[rel].slice(0, 10)) console.log('      ' + f.line + '  ' + f.prop + ':' + f.val + '   ' + f.why);
  if (byFile[rel].length > 10) console.log('      … ' + (byFile[rel].length - 10) + ' more');
}
if (Object.keys(EXEMPT).length) {
  console.log('\n  exempt by declaration:');
  for (const k of Object.keys(EXEMPT)) console.log('      ' + k + ' — ' + EXEMPT[k]);
}
if (!crit.length) console.log('  ✓ no literal ink without a ground in any style attribute');
console.log('');
process.exit(crit.length ? 1 : 0);
