/**
 * dup-functions.cjs — two top-level functions with one name is a feature deleted in silence.
 *
 * ⚠️⚠️ WHY THIS EXISTS. On 2026-09-02 the ERP and Tax panels arrived carrying their own `catsetFaceLoad`, while
 * the Variants panel had used one of that name since long before. Function declarations HOIST, so the second
 * definition won and the first vanished — its variable was never assigned, and the Variants renderer's
 *
 *     if (CATSET_FACE === undefined) { catsetFaceLoad().then(catsetPaintDetail); … }
 *
 * re-entered on every paint: load → repaint → still undefined → load. **An infinite repaint loop — a frozen
 * tab**, reported by Athi as *"declare variants chip, when clicked page become unresponsive."*
 *
 * ⭐⭐ AND NOTHING COULD HAVE CAUGHT IT. A duplicate top-level function is legal JavaScript. `node --check`
 * passes. html-syntax, guard-static, token-check, theme-literals and the panel-render guard all passed — the
 * panel rendered fine, it just never stopped rendering. The only symptom is a screen that stops answering, and
 * the only reliable moment to notice is before it ships.
 *
 * ⚠️ IT IS ALSO A STANDING RULE ALREADY BROKEN. "No duplicate functions" is written down; what was missing was
 * anything that ENFORCES it. A rule nobody can accidentally comply with is a rule that gets broken by the
 * person who wrote it — which is what happened here.
 *
 * ⚠️ SCOPE: top-level declarations only. A nested helper of the same name in two functions is ordinary and
 * harmless; two at file scope in the SAME loaded file, or across files that share the global scope, is the
 * hazard — every one of these is loaded into one window.
 *
 * Run: node e2e/dup-functions.cjs        (exit 1 on any duplicate)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'public');
const FILES = ['app.html'].concat(
  fs.readdirSync(path.join(WEB, 'app')).filter((f) => f.endsWith('.js')).map((f) => 'app/' + f)
);

/**
 * ⚠️ COLUMN ZERO IS THE WHOLE TEST. An indented `function foo(){}` is nested inside something and is scoped to
 * it; one at the start of a line is global to the window every one of these files shares. Matching both would
 * report every local helper in the codebase and the report would be ignored, which is worse than no report.
 */
const DECL = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;

/** one PAGE = one window: the files a page loads share a namespace; two pages do not (shop.html has its own esc/render) */
function scan(label, files) {
  const seen = new Map();          // name → [{file, line}]
  for (const rel of files) {
    const raw = fs.readFileSync(path.join(WEB, rel), 'utf8');
    /**
     * ── ⚠️⚠️ A FILE WRAPPED IN AN IIFE DECLARES NOTHING AT TOP LEVEL (2026-09-16) ────────────────────────────
     *
     * This guard's whole premise — "the LAST one wins, every earlier definition is silently discarded" — is
     * true of a plain script and FALSE of a module wrapper. The generated tax mirrors paste their master at
     * column zero inside `(function (root) { … })(globalThis)`, so `resolve`, `slabOf` and `r2` appeared to be
     * declared twice and to be fighting. They are in three separate scopes and cannot see each other.
     *
     * ⭐ WHAT THEY REALLY CONTEST IS THE GLOBAL THEY PUBLISH, and that is checked and is fine: engine/tax.js sets
     * `CBTax`, engine/tax.js's tax-slab part sets `CBTaxSlab`, and app/tax-engine.js — which app.html does not load at all —
     * sets the combined `CBTax` for the till and for `require()`. The app calls `CBTaxSlab.resolve` and
     * `CBTax.determine`, which is exactly what those two files provide.
     */
    /* ⚠️ COMMENTS STRIPPED FIRST, then a flat test. The obvious pattern for "comments, then (function" nests a
       quantifier — `(?:\/\*[\s\S]*?\*\/\s*)*` — and on a 400 KB file that does NOT match it backtracks until it
       hangs. It did, for four minutes, before this line replaced it. */
    /* 16000, not 4000: signin-ui.js's contract header grew past 4 KB and cut its wrapper off the window (till, 2026-10-08). */
    const head = raw.slice(0, 16000).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
    if (/^\s*\(function\b/.test(head)) continue;
    const lines = raw.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = DECL.exec(lines[i]);
      if (!m) continue;
      const at = seen.get(m[1]) || [];
      at.push({ file: rel, line: i + 1 });
      seen.set(m[1], at);
    }
  }
  const dupes = [...seen.entries()].filter(([, at]) => at.length > 1);
  console.log('\n══ DUPLICATE FUNCTIONS · ' + label + ' ══');
  console.log('  ' + seen.size + ' top-level function(s) across ' + files.length + ' file(s)\n');
  for (const [name, at] of dupes) {
    console.log('  ✗ ' + name + '  declared ' + at.length + ' times');
    at.forEach((a) => console.log('      ' + a.file + ':' + a.line));
    console.log('      the LAST one wins — every earlier definition is silently discarded\n');
  }
  if (!dupes.length) console.log('  ✓ every top-level function is declared once\n');
  return dupes.length;
}

/* the storefront page: shop.html plus exactly the app/*.js files it includes (2026-09-05 — it was never scanned) */
const shopSrc = fs.readFileSync(path.join(WEB, 'shop.html'), 'utf8');
const SHOP = ['shop.html'].concat([...shopSrc.matchAll(/<script[^>]*src="app\/([^"]+)"/g)].map((m) => 'app/' + m[1]).filter((f) => fs.existsSync(path.join(WEB, f))));


/**
 * ── SECOND CHECK: DUPLICATE BODIES (l15-webdup, 2026-11-15) ──────────────────────────────────────────────────
 * Two functions, two names, one body is the same code kept twice (a getter per localStorage key, a chit opener per capability).
 * This counts the groups the way C:/dev/dead-exports.cjs does (named functions of 6+ lines, comments and strings blanked, whitespace gone)
 * over public/app/*.js (app.html's own inline script is left out: fontSet/textSizeSet/motionSet and restoreChit/unarchiveChit sit there, for a later round), and fails if the count RISES above the ceiling. Lower the ceiling when a group is merged; never raise it.
 * ⚠️ Blanking strings makes two markup builders that differ only in their literals look equal (showcase-templates menuRow/serviceCard,
 * cap-catalogue itemsHTML/categoriesHTML): they are counted, because the ceiling is a measure and not a verdict.
 */
const BODY_GROUP_CEILING = 7;
const BODY_MIN_LINES = 6;
const blankCode = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
  .replace(/`(?:[^`\\]|\\.)*`/g, ' ').replace(/'(?:[^'\\\n]|\\.)*'/g, ' ').replace(/"(?:[^"\\\n]|\\.)*"/g, ' ');
function bodyGroups(files) {
  const seen = new Map();
  for (const rel of files) {
    const code = blankCode(fs.readFileSync(path.join(WEB, rel), 'utf8'));
    const head = /(?:^|\n)[ \t]*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
    let m;
    while ((m = head.exec(code))) {
      let depth = 1, i = head.lastIndex;
      while (i < code.length && depth) { const ch = code[i++]; if (ch === '{') depth++; else if (ch === '}') depth--; }
      const body = code.slice(head.lastIndex, i);
      if (body.split('\n').length < BODY_MIN_LINES) continue;
      const key = body.replace(/\s+/g, '');
      seen.set(key, (seen.get(key) || []).concat(rel + ':' + m[1]));
    }
  }
  return [...seen.values()].filter((group) => group.length > 1);
}
function checkBodyGroups(files) {
  const groups = bodyGroups(files);
  console.log('\n══ DUPLICATE BODIES · ' + groups.length + ' group(s), ceiling ' + BODY_GROUP_CEILING + ' ══');
  groups.forEach((group) => console.log('  ' + group.join('  =  ')));
  if (groups.length > BODY_GROUP_CEILING) console.log('  ✗ more duplicate-body groups than the ceiling: merge into the one helper, do not add a copy\n');
  return groups.length > BODY_GROUP_CEILING ? 1 : 0;
}

const bad = scan('app', FILES) + scan('storefront', SHOP) + checkBodyGroups(FILES.filter((rel) => rel !== 'app.html'));
process.exit(bad ? 1 : 0);
