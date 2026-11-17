/**
 * till-contrast.cjs — THE COUNTER'S OWN PALETTE, MEASURED.
 *
 * ⚠️⚠️ WHY THIS EXISTS. `a11y-contrast.cjs` measures app.html and has done for months — 575 checks, green. The
 * counter was never in it. The till is a separate file with its OWN tokens, so the one screen that is read at
 * arm's length, in a bright shop, by somebody counting money in front of a customer, was the one screen whose
 * colours nobody had ever measured. Athi, 2026-09-16: *"pass our screen through design gateway, so the look and
 * feel should be prominent."* A look-and-feel claim that has not been measured is an opinion.
 *
 * ⭐ IT MEASURES WHAT A COUNTER ACTUALLY READS, not every token pair that exists:
 *   · the figures        --ink on --card / --paper
 *   · the quiet facts    --dim (the per-unit line, the "qty × price" column) — this is the one that slips
 *   · the discount       --ok on --card: the only green number on the row, and a number people check
 *   · the buttons        --ok and --warn as FILLS with white on them (Save & print, remove)
 *   · the edges          --line on --card (WCAG 1.4.11) — the six-column cart is made of rules now
 *   · BOTH THEMES, because a dark till is a real shop at night, not a preference.
 *
 * ⚠️ LARGE-TEXT ALLOWANCES ARE NOT TAKEN. Everything here is treated as body text at 4.5:1 even where the type
 * is big, because the operator sets the text size (Small…Very large) and a threshold that depends on a setting
 * is not a threshold. The TOTAL is large in every theme; the per-unit line under a cart row is not.
 *
 * Run: node e2e/till-contrast.cjs        (exit 1 on any failure)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { ratio } = require('./lib/contrast.cjs');

const TILL = path.join(__dirname, '..', 'public', 'till.html');
const src = fs.readFileSync(TILL, 'utf8');

/**
 * ⚠️ PARSED, NEVER COPIED. If the palette were written out here, this tool would keep passing a set of colours
 * the counter no longer uses — the exact failure mode the app's gate warns about in its own header.
 */
function blockAfter(marker) {
  const at = src.indexOf(marker);
  if (at < 0) return null;
  const open = src.indexOf('{', at);
  const close = src.indexOf('}', open);
  if (open < 0 || close < 0) return null;
  return src.slice(open + 1, close);
}
function tokens(block) {
  const out = {};
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+)/gi;
  let m;
  while ((m = re.exec(block))) out[m[1]] = m[2].trim();
  return out;
}

const lightBlock = blockAfter(':root{');
const darkBlock = blockAfter(':root[data-theme="dark"]{');
if (!lightBlock) { console.error('till-contrast: could not find :root{ in till.html'); process.exit(1); }
if (!darkBlock) { console.error('till-contrast: could not find the dark theme in till.html'); process.exit(1); }

const light = tokens(lightBlock);
/* ⚠️ a theme overrides only SOME tokens; the rest fall through to :root, exactly as the cascade does */
const dark = Object.assign({}, light, tokens(darkBlock));

/**
 * ⭐⭐ THE REGISTRY MUST AGREE WITH THE PAGE IT DESCRIBES. lib/screen-kit.js (vendored to engine/screen.js) is
 * the counter's own "library of designs" — Settings and the screen gallery preview a theme by reading THIS
 * registry, never the live page. For `lightCream` and `dark`, applyLook() in till.html deliberately does NOT
 * apply the registry's vars — it relies on the CSS above and only uses the registry entry to decide light vs
 * dark. So a shopkeeper previewing "Light cream" was seeing whatever colour someone typed into screen-kit.js,
 * which had quietly drifted from what picking it actually gives them (2026-09-17: --ink #1D1B16 previewed vs
 * #141210 live, --ok #16693F vs #1c7a4a, --warn #8E3517 vs #a8410f). Checked here, not eyeballed again.
 */
const K = require(path.join(__dirname, '..', '..', 'chitbridge-api', 'lib', 'screen-kit.js'));
let checks = 0, fails = 0;
function checkParity(name, registryVars, live) {
  Object.keys(registryVars).forEach((k) => {
    if (!(k in live)) return;   // --panel, --accent: screen-kit-only, no live counterpart to drift from
    checks++;
    const ok = String(registryVars[k]).toLowerCase() === String(live[k]).toLowerCase();
    if (!ok) fails++;
    console.log('    ' + (ok ? '✓' : '✗') + ' registry ' + name + ' ' + k
      + (ok ? ' matches the counter' : ' is ' + registryVars[k] + ' but the counter is ' + live[k]));
  });
}
console.log('\n  ── screen-kit registry vs the counter it previews ──');
checkParity('lightCream', K.THEMES.lightCream.vars, light);
checkParity('dark', K.THEMES.dark.vars, dark);

/**
 * ⚠️ THE INK ON A FILL IS A TOKEN NOW, not a hard-coded white. In dark mode the accents invert to pale mint and
 * apricot, so white on them measured 2.22:1 — the biggest button on the counter, unreadable, for as long as the
 * dark theme has existed. Measuring the token is the whole point: it flips with the theme and this proves it.
 */
const onFill = (T) => T['--on-accent'] || '#ffffff';

const THRESH_TEXT = 4.5;   /* WCAG 1.4.3 body text */
const THRESH_UI = 3;       /* WCAG 1.4.11 non-text: rules, borders */

const say = (ok, what, got, need, why) => {
  checks++;
  if (!ok) fails++;
  console.log('    ' + (ok ? '✓' : '✗') + ' ' + what.padEnd(42)
    + (got == null ? '—' : got.toFixed(2)) + ' / ' + need + '   ' + (why || ''));
};
const pair = (T, fg, bg, need, why) => {
  const r = ratio(T[fg], T[bg]);
  say(r != null && r >= need, fg + ' on ' + bg, r, need, why);
};

/**
 * ⭐⭐ PAPER AND NAVY ARE THE TWO THEMES a11y NEVER SAW. Unlike lightCream/dark, applyLook() actually sets THESE
 * vars as inline overrides on top of the light/dark base (paper is a light theme, navy is dark) — a real,
 * selectable, live palette with nothing measuring it until now. Merged exactly as applyLook() builds it: reset
 * to the base for that theme's light/dark, then the registry's own vars laid over it.
 */
const paper = Object.assign({}, light, K.THEMES.paper.vars);
const navy = Object.assign({}, dark, K.THEMES.navy.vars);

for (const [name, T] of [['light', light], ['dark', dark], ['paper', paper], ['navy', navy]]) {
  console.log('\n  ── the counter, ' + name + ' ──');
  /* the figures a bill is made of */
  pair(T, '--ink', '--card', THRESH_TEXT, 'the amounts');
  pair(T, '--ink', '--paper', THRESH_TEXT, 'the page');
  /* ⚠️ THE ONE THAT SLIPS. --dim carries the per-unit line, the "qty x price" column and every note. */
  pair(T, '--dim', '--card', THRESH_TEXT, 'per-unit, qty x price, notes');
  pair(T, '--dim', '--paper', THRESH_TEXT, 'the shelf rows');
  /* the discount: the only green number on a cart row, and one a customer asks about */
  pair(T, '--ok', '--card', THRESH_TEXT, 'the discount column');
  pair(T, '--ok', '--ok-tint', THRESH_TEXT, 'the selected line');
  pair(T, '--warn', '--card', THRESH_TEXT, 'what is off the shelf');
  pair(T, '--warn', '--warn-tint', THRESH_TEXT, 'warnings');
  pair(T, '--blue', '--card', THRESH_TEXT, 'links');
  /* fills carrying white: Save & print is --ok, the remove x is --warn */
  /* ⚠️ a button LABEL is text, so it is held to 4.5:1 — not to the 3:1 a non-text component gets */
  const onOk = ratio(onFill(T), T['--ok']), onWarn = ratio(onFill(T), T['--warn']);
  say(onOk != null && onOk >= THRESH_TEXT, '--on-accent on --ok (fill)', onOk, THRESH_TEXT, 'Save & print');
  say(onWarn != null && onWarn >= THRESH_TEXT, '--on-accent on --warn (fill)', onWarn, THRESH_TEXT, 'the off-shelf tag');
  /**
   * the edges of things you OPERATE — a box you type in, a key you press. WCAG 1.4.11 asks 3:1 of these.
   * ⚠️ --line is NOT held to it: a decorative rule between two of sixty shelf rows is not a control, and forcing
   * 3:1 on every hairline would turn the shelf into a spreadsheet. It is reported so a change is still visible.
   */
  pair(T, '--edge', '--card', THRESH_UI, 'input & button edges (WCAG 1.4.11)');
  pair(T, '--edge', '--paper', THRESH_UI, 'controls on the page (WCAG 1.4.11)');
  const ln = ratio(T['--line'], T['--card']);
  console.log('    · --line on --card'.padEnd(48) + (ln == null ? '—' : ln.toFixed(2))
    + '         dividers — reported, not gated');
}

console.log('\n══ ' + checks + ' checks · ' + fails + ' failure(s) ══');
process.exit(fails ? 1 : 0);
