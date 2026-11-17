/**
 * CARD  29-qa-test-tooling-ux-locale-and-design-system/themes-contrast-accessibility
 * a11y-contrast.cjs — measure every theme against the level it CLAIMS.
 *
 * ⚠️⚠️ WHY THIS EXISTS. The accessibility themes make a PROMISE in the user interface: a card that says
 * "WCAG 2.2 AAA — 7:1" is telling someone with low vision that this theme is safe for them to use. A promise
 * about contrast that was made by eye is not a promise, it is a guess with a standard's name on it. Nobody can
 * look at #3A4046 on #FFFFFF and know whether it is 6.8:1 or 7.2:1 — and the difference is exactly the claim.
 *
 * So each theme DECLARES its level in `a11y.level`, and this tool computes whether it holds. A theme that claims
 * AAA and measures 6.4:1 fails here rather than in front of the person who needed the 7.
 *
 * ⚠️ IT MEASURES BOTH ROLES OF EVERY ACCENT, which is the mistake the theme work kept catching by hand: a colour
 * is used as TEXT on a card and as a FILL with white text on it, and those pull in opposite directions. A green
 * light enough to read as a link is too light to carry a white button label. Both are checked here.
 *
 * WCAG 2.2 thresholds applied:
 *   1.4.3 AA   body text 4.5:1 · large text 3:1
 *   1.4.6 AAA  body text 7:1   · large text 4.5:1
 *   1.4.11     non-text UI (rules, borders, focus rings) 3:1  — applies at EVERY level
 *
 * Run: node e2e/a11y-contrast.cjs        (exit 1 on any failed claim)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'public', 'app.html');
const src = fs.readFileSync(APP, 'utf8');

/* ── colour maths ────────────────────────────────────────────────────────────────────────────────────────── */
/* ⭐ ONE COPY, shared with till-contrast.cjs — see e2e/lib/contrast.cjs for why it moved out of this file. */
const { hex, lum, ratio, mix } = require('./lib/contrast.cjs');

/* ── PAGE MODE (index page, 2026-09-30): `node e2e/a11y-contrast.cjs <page.html>` measures a standalone page's
 * own tokens instead of the app's themes — the same reason till-contrast.cjs exists: a page with its own :root
 * is a page nobody has measured. It measures WHAT THE PAGE'S READER ACTUALLY READS (the till tool's discipline),
 * at WCAG AA body text 4.5:1 — no large-text allowance taken — and 3:1 for the non-text marks. The hairline
 * dividers stay advisory here exactly as they are for the app's ordinary themes below (see that note).
 * With no argument, everything below this block runs unchanged. */
if (process.argv[2] && /\.html?$/i.test(process.argv[2])) {
  const file = path.resolve(process.argv[2]);
  const page = fs.readFileSync(file, 'utf8');
  const rootAt = page.indexOf(':root');
  const open = page.indexOf('{', rootAt), close = page.indexOf('}', open);
  if (rootAt < 0 || close < 0) { console.error('a11y-contrast: no :root token block in ' + file); process.exit(1); }
  const toks = {};
  page.slice(open + 1, close).replace(/(--[a-z0-9-]+)\s*:\s*([^;]+)/gi, (_, k, v) => { toks[k] = v.trim(); });
  /* [foreground, background, minimum, what it is on this page] */
  const PAIRS = [
    ['--ink', '--page', 4.5, 'names and figures on the page'],
    ['--ink', '--card', 4.5, 'names and figures on a box'],
    ['--muted', '--page', 4.5, 'the idea line, captions, the footer'],
    ['--muted', '--card', 4.5, 'the what-lines and quiet facts'],
    ['--muted', '--panel', 4.5, 'the Labs caption on the tinted band'],
    ['--green-d', '--card', 4.5, 'the live counter line'],
    ['--amber-i', '--card', 4.5, 'an amber fact on a box'],
    ['--amber-i', '--amber-t', 4.5, 'an amber alert and its fix button'],
    ['--red-i', '--red-t', 4.5, 'a red alert and its fix button'],
    ['--blue-i', '--card', 4.5, 'a blue lab status'],
    ['--blue-i', '--blue-t', 4.5, 'blue text on its tint'],
    ['#FFFFFF', '--green', 4.5, 'the sign-in door\'s label'],
    ['#FFFFFF', '--red-i', 4.5, 'the red alert\'s mark'],
    ['#FFFFFF', '--amber-i', 4.5, 'the amber alert\'s mark'],
    ['--green-d', '--green-t', 4.5, 'the Active badge on the Accounts tile'],
    ['--green', '--card', 3, 'the live dot and the hover edge (non-text, 1.4.11)'],
  ];
  let bad = 0, n = 0;
  console.log('\n══ PAGE CONTRAST — ' + path.relative(path.join(__dirname, '..'), file) + ' against WCAG AA ══');
  PAIRS.forEach(([f, b, min, what]) => {
    const fg = f[0] === '#' ? f : toks[f], bg = b[0] === '#' ? b : toks[b];
    if (!fg || !bg) { bad++; console.log('  ✗ ' + f + ' on ' + b + '  — token missing from the page'); return; }
    n++;
    const got = ratio(fg, bg);
    const ok = got != null && got >= min;
    if (!ok) bad++;
    console.log('  ' + (ok ? '✓' : '✗') + ' ' + (f + ' on ' + b).padEnd(26) + (got == null ? '  n/a' : got.toFixed(2).padStart(6)) + ' / ' + String(min).padEnd(4) + '  ' + what);
  });
  const lineR = ratio(toks['--line'], toks['--card']);
  console.log('  · --line on --card          ' + (lineR == null ? '  n/a' : lineR.toFixed(2).padStart(6)) + ' / 3     divider, not a control boundary — advisory');
  console.log('\n══ ' + n + ' checks · ' + bad + ' failure(s) ══\n');
  process.exit(bad ? 1 : 0);
}

/* ── read the themes out of the app ──────────────────────────────────────────────────────────────────────── */

/**
 * ⚠️ THE BASE PALETTE IS PARSED, NOT COPIED. A theme only overrides SOME tokens; everything else falls through
 * to :root. Duplicating those defaults here would mean this tool measures a palette the app no longer has —
 * green on a screen that is failing. First definition wins, which is what the cascade does.
 */
function baseTokens() {
  const out = {};
  const styleEnd = src.indexOf('</style>');
  const css = src.slice(0, styleEnd > 0 ? styleEnd : 200000);
  const re = /(--[a-z0-9-]+)\s*:\s*([^;{}]+)[;}]/gi;
  let m;
  while ((m = re.exec(css))) {
    const k = m[1], v = m[2].trim();
    if (!(k in out)) out[k] = v;
  }
  return out;
}

/** Resolve one level of var() indirection — `--danger:var(--disp)` must measure as the red it actually is. */
function resolve(tok, map, depth) {
  let v = map[tok];
  for (let i = 0; i < 4 && v && /^var\(/.test(v); i++) {
    const inner = /var\(\s*(--[a-z0-9-]+)/i.exec(v);
    if (!inner) break;
    v = map[inner[1]];
  }
  return v;
}

/**
 * The THEMES are the ENGINE'S now (screen v1.15.0 APP_THEMES — 16, with Terminal), not a literal in app.html: the app, CB Accounts, the
 * index page and the counter read ONE list, so this measures that list. The engine file is a UMD that attaches CBScreen to `window`.
 */
function themes() {
  globalThis.window = globalThis;
  require(path.join(__dirname, '..', 'public', 'engine', 'screen.js'));
  if (!globalThis.CBScreen || !globalThis.CBScreen.APP_THEMES) throw new Error('APP_THEMES not found in public/engine/screen.js');
  return globalThis.CBScreen.APP_THEMES;
}

/* ── the checks ──────────────────────────────────────────────────────────────────────────────────────────── */

const BASE = baseTokens();
const THEMES = themes();

/* Accents carry two jobs each: text on a card, and a fill with white on it. Both are measured. */
const ACCENTS = ['--blue', '--ok', '--prog', '--disp', '--purple', '--gold'];
/* The four greys are a SCALE. Each must clear the bar, and they must still descend — a scale that no longer
   orders is not a scale, and every "less important than" built on it starts lying. */
const GREYS = ['--grey', '--grey-2', '--grey-3', '--grey-4'];
/* The row states. A reader is guaranteed to be looking at the selected row, so muted text must survive on it. */
const ROWS = ['--card', '--hover', '--sel-2', '--picked'];
/**
 * ⭐⭐ A TINT IS HALF OF A PAIR, NOT A DECORATION — and this list is the half the tool was missing.
 *
 * Athi, 2026-08-18, looking at the Legend's Work patterns tab: *"the colour seems to be something that we
 * haven't caught."* He was right, and the miss was structural rather than a slip: every accent check above
 * measures against `--card`, so the one surface these colours are actually PRINTED ON — their own tint — was
 * never measured at all. `--ok-tint` exists precisely so `--ok-2` text can sit on it; that is why nine
 * near-identical pale blues were collapsed into one token in the first place.
 *
 * Every status chip in the product rides on this pairing: done, disputed, in progress, every count badge. The
 * first run found 9 failures including --warn-2 at 3.33:1 in Vibrant and --blue-2 at 3.51:1 in Dark. Nobody had
 * reported those either — a chip is small and easy to squint past, which is exactly why it needs measuring
 * instead of looking at.
 */
const TINT_PAIRS = [
  ['--blue-tint-bg', '--blue-2'], ['--ok-tint', '--ok-2'], ['--danger-tint', '--disp'],
  ['--warn-tint', '--warn-2'], ['--purple-tint', '--purple-2'], ['--neutral-tint', '--grey'],
  /* ⚠️ THERE ARE TWO BLUE TINTS AND THEY ARE USED DIFFERENTLY — --blue-tint is the pale CALLOUT ground and
     --blue-tint-bg is the chip ground. Checking only one left the other unmeasured, which is how a chip at
     4.06:1 survived on the Legend's Work patterns tab until someone looked at it. */
  ['--blue-tint', '--blue'],
];

let failures = 0, checks = 0;
const lines = [];

function check(theme, label, got, min, note) {
  checks++;
  const ok = got != null && got >= min;
  if (!ok) failures++;
  lines.push('    ' + (ok ? '✓' : '✗') + ' ' + label.padEnd(42)
    + (got == null ? '   n/a' : got.toFixed(2).padStart(6)) + ' / ' + String(min).padEnd(5)
    + (note ? '  ' + note : ''));
}

Object.keys(THEMES).forEach((key) => {
  const t = THEMES[key];
  const map = Object.assign({}, BASE, t.vars || {});
  const v = (tok) => resolve(tok, map);

  const claim = (t.a11y && t.a11y.level) || 'AA';
  const TEXT = claim === 'AAA' ? 7 : 4.5;
  const LARGE = claim === 'AAA' ? 4.5 : 3;

  lines.push('');
  lines.push('  ' + (t.name || key) + (t.a11y ? '   [claims ' + claim + (t.a11y.forWho ? ' · ' + t.a11y.forWho : '') + ']' : '   [ordinary theme · AA]'));

  const card = v('--card'), paper = v('--paper');

  check(key, 'ink on card', ratio(v('--ink'), card), TEXT);
  check(key, 'ink on paper', ratio(v('--ink'), paper), TEXT);

  /**
   * ⚠️ A DUPLICATE OF THE LINE ABOVE — TODAY. `--panel` is `var(--paper)` and `--on-panel` is `var(--ink)`,
   * so this measures the same two colours. That is the point of it. The paired-surface rule says a theme
   * overriding a surface must override its partner in the same edit, and the day somebody gives a theme its
   * own `--panel` and forgets `--on-panel`, this is the line that fails instead of the panel going quietly
   * unreadable in one theme nobody happened to open. A guard that is trivially true now is how a rule stays
   * true later. [[feedback-silence-is-the-bug]]
   */
  check(key, 'on-panel on panel', ratio(v('--on-panel'), v('--panel')), TEXT);

  /* ⚠️ Muted text is measured on EVERY row state, not just the card. The bug this catches by construction: a
     selected-row ground that quietly eats the secondary text on the one row the reader is looking at. */
  GREYS.forEach((g) => {
    ROWS.forEach((r) => {
      const bg = v(r);
      if (!bg) return;
      check(key, g + ' on ' + r, ratio(v(g), bg), TEXT);
    });
  });

  /* ⭐ ZEBRA (Athi, 2026-10-09): CBList stripes every other row with --cl-zebra = the theme's --zebra, else the ink mixed 4% into the card, and lights the hovered row with the blue mixed 8%
     into the card (list-ctl.js; the ledger tables use the same zebra). Text must clear the SAME bar on those two grounds as on the card: the ink, the four greys, and the colours the
     rows speak in (you'll get · you'll give · late · Dues). Measured on the colour the screen paints, not on the token's name. */
  {
    const zebra = v('--zebra') || mix(v('--ink'), 0.09, card), hov = mix(v('--blue'), 0.08, card);
    /* GROUP BAND (small-fixes, C12): --cl-gband = the blue mixed 13% into the page; the band's title and figures are the ink */
    const gband = mix(v('--blue'), 0.13, v('--page') || v('--paper') || card);
    /* VISIBLE STRIPE (Athi, 2026-10-09: "no difference, it has to be visible"): the stripe must differ from the plain card by a visible step, in light AND dark themes (contrast ratio of the two grounds >= 1.12), and the hover row / group band must differ from the stripe */
    if (zebra) {
      check(key, 'zebra stripe is visibly different from the plain row (step, min 1.12)', ratio(zebra, card), 1.12, 'zebra visibility');
    }
    /* ROW STRIPES (avatar menu: Off · Light · Strong): Light is the ink mixed 5% into the card (avatar.js :root[data-stripes=light]); it must still be a visible step and keep text AA */
    const zebraLight = mix(v('--ink'), 0.05, card);
    if (zebraLight) check(key, 'zebra stripe (Light) is visibly different from the plain row (step, min 1.05)', ratio(zebraLight, card), 1.05, 'zebra visibility');
    [['zebra row', zebra], ['zebra row (Light)', zebraLight], ['hovered row', hov], ['group band', gband]].forEach(([nm, bg]) => {
      if (!bg) return;
      check(key, 'ink on ' + nm, ratio(v('--ink'), bg), TEXT);
      if (nm !== 'group band') GREYS.forEach((g) => check(key, g + ' on ' + nm, ratio(v(g), bg), TEXT));
      /* the colours the CRM rows speak in, as crm.html resolves them in a chosen theme: you'll get = --green-d (the theme's --ok-2 mixed 20% toward its ink), you'll give · late = --red-text (the theme's --disp mixed 22% toward its ink) */
      const get = mix(v('--ok-2'), 0.8, v('--ink')), give = mix(v('--disp'), 0.78, v('--ink'));
      if (get && nm !== 'group band') check(key, 'you\'ll get (green-d) on ' + nm, ratio(get, bg), TEXT, 'Dues column');
      if (give && nm !== 'group band') check(key, 'you\'ll give · late (--disp) on ' + nm, ratio(give, bg), TEXT, 'Dues · Next follow-up');
    });
  }

  /* The scale must still descend. */
  const ls = GREYS.map((g) => { const c = ratio(v(g), card); return c == null ? null : c; });
  const ordered = ls.every((x, i) => i === 0 || x == null || ls[i - 1] == null || ls[i - 1] >= x - 0.001);
  checks++;
  if (!ordered) { failures++; lines.push('    ✗ the four greys no longer descend            ' + ls.map((x) => x && x.toFixed(2)).join(' > ')); }
  else lines.push('    ✓ the grey scale still descends            ' + ls.map((x) => x && x.toFixed(2)).join(' > '));

  ACCENTS.forEach((a) => {
    const c = v(a);
    if (!c) return;
    /* ⚠️ --gold IS NOT TEXT. It is the brand rule and the ornament on a gold-soft ground — it has never carried
       body copy, and holding it to a text bar reported a failure the product does not have. Its real pairing is
       --on-gold, measured below like every other fill. Measuring a token against a job it does not do is how a
       contrast tool loses the reader's trust and gets ignored. */
    if (a !== '--gold') check(key, a + ' as text on card', ratio(c, card), TEXT);

    /* As a FILL carrying its own paired ink. ⚠️ NOT always white: --on-gold is near-black and --on-purple is
       white, and that pairing is declared in the token set precisely so nobody has to guess. Assuming white
       here measured gold against ink it never sits beneath.
       ⚠️ Large-text bar, not body: these are button labels and chips, set bold and big. Holding fills to the
       body bar would rule out every usable accent and leave a grey product. */
    const on = v('--on-' + a.slice(2)) || '#ffffff';
    check(key, a + ' as fill, its ink on it', ratio(on, c), LARGE, 'button labels');
  });

  /* The tints, against the ink they exist to carry — see the note on TINT_PAIRS. */
  TINT_PAIRS.forEach(([tint, ink]) => {
    const bg = v(tint), fg = v(ink);
    if (!bg || !fg) return;
    check(key, ink + ' on ' + tint, ratio(fg, bg), TEXT, 'status chips');
  });

  /* ⚠️ 1.4.11 IS A FAILURE ONLY WHERE THE THEME PROMISED IT. Our --line is a hairline DIVIDER between rows and
     around cards; nothing about identifying a control depends on seeing it, and at 1.39:1 it sits where most
     modern interfaces put a divider. Failing every ordinary theme on it would bury the real findings under a
     stylistic opinion. But a theme sold as high-contrast is promising visible EDGES — there, it is the claim. */
  const lineR = ratio(v('--line'), card);
  if (t.a11y) check(key, 'line on card (WCAG 1.4.11)', lineR, 3, 'the theme promised visible edges');
  else lines.push('    · line on card                             '
    + (lineR == null ? ' n/a' : lineR.toFixed(2).padStart(6)) + ' / 3      divider, not a control boundary — advisory');
});

console.log('\n══ THEME CONTRAST — every theme against the level it claims ══');
console.log(lines.join('\n'));
console.log('\n══ ' + checks + ' checks · ' + failures + ' failure(s) ══\n');
process.exit(failures ? 1 : 0);
