/**
 * missing-functions.cjs — a CALL to a function that is not there anywhere.
 *
 * ── ⚠️⚠️⚠️ WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────────────
 *
 * On 2026-09-13 Athi asked *"in the screen incident 2, but couldn't click the link for incident and see what
 * those are?"* The count was fine. `testRaisedHTML` DID NOT EXIST — a patch the day before had replaced a whole
 * REGION of cap-testing.js between two anchors and the function was sitting inside it. Never edited, never
 * mentioned in the commit, never missed.
 *
 * ⚠️⚠️ AND EVERY GUARD PASSED. `node --check` is happy: a call to a missing function is perfectly valid
 * JavaScript until the line runs. dup-functions.cjs looks for two of a name, not none. Sixteen Playwright specs
 * were green because not one of them ever opened that tab. The only symptom was a tab that did nothing when
 * pressed, and the only person who found it was the user.
 *
 * ⭐⭐ THE SHAPE THAT MAKES THIS CHECKABLE is the codebase's own naming: these files are full of `testX`, `catX`,
 * `wlX` families declared at column zero and called by name across files that share one window. So a call to
 * `somethingLikeThis(` that matches NO declaration and NO known global is a real finding rather than noise.
 *
 * ⚠️ DELIBERATELY NARROW, because a broad checker gets switched off. It only looks at calls whose name matches a
 * PREFIX that this codebase declares functions under, and it knows the browser and library globals. Anything
 * it cannot be sure about it stays quiet on: the cost of a false alarm here is that the next person stops
 * reading the output, and then the guard is worth nothing.
 *
 * Run: node e2e/missing-functions.cjs      (exit 1 on any call with no declaration)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'public');
const FILES = ['app.html'].concat(
  fs.readdirSync(path.join(WEB, 'app')).filter((f) => f.endsWith('.js')).map((f) => 'app/' + f)
);

const DECL = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;

/**
 * ⚠️ THE FIRST VERSION OF THIS GUARD CRIED WOLF THREE TIMES OUT OF SEVEN, and that is the failure mode that
 * matters most here: a checker with false alarms gets skimmed, then ignored, then deleted, and the real
 * finding it was written for goes out with it. So it now knows the four other ways this codebase brings a
 * name into the world:
 *
 *   const f = (a) => …        an indented arrow — cap-legend.js's govChips
 *   root.f = function …       exported onto an object rather than declared — cbMediaGallery
 *   X.f = function …          the same, on any holder
 *   f = function …            plain assignment
 *
 * ⭐ AND A CALL GUARDED BY `typeof f === 'function'` IS NOT A FAULT, it is the codebase asking politely
 * whether an optional capability has been loaded yet. Reporting those would mean reporting the correct
 * pattern as an error.
 */
const ASSIGN = [
  /(?:^|[^.\w$])(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=/,
  /(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\()/,
  /\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\()/,
  /\.([A-Za-z_$][\w$]*)\s*=/,
];

/**
 * ⭐ THE FAMILIES THIS CODEBASE NAMES ITS GLOBALS AFTER. A call is only checked when it starts with one of
 * these, so `map(`, `filter(`, `t(` and every local helper are out of scope by construction rather than by a
 * list of exceptions that would need maintaining.
 */
const FAMILIES = /^(test|cat|catset|wl|cart|till|prod|chit|sup|nav|screen|stamp|code|modal|toast|api|cb|spec|gov|offer|promo|rpl|assist|shot|inc|req|plat)[A-Z]/;

/**
 * what the page genuinely provides from somewhere this scan cannot see, plus the keywords that look like calls.
 *
 * ⚠️ THIS SET WAS DELETED BY A REGION REPLACE while I was writing the comment above warning about region
 * replaces, and the guard crashed on its own next run. Left here as the shortest possible argument for the
 * rule: the mistake is not a lapse in care, it is what the technique does.
 */
const KNOWN = new Set([
  'apiBase', 'catch', 'if', 'for', 'while', 'switch', 'return', 'function', 'typeof', 'new',
]);

/**
 * ── ⚠️⚠️ PROSE IS NOT CODE, AND IN THIS CODEBASE THERE IS A LOT OF PROSE ──────────────────────────────────────
 *
 * The three findings left after the assignment forms were understood were ALL comments:
 *
 *   "⚠️ testModeRowHTML() was here and is gone: Testing now sits beside Laptop · Mobile · Spec"
 *   "This is everything supOpenProfile() used to hide behind a Details › chip"
 *   "governedBy (mechanisms in force) · govGap (= the L4 lever)"
 *
 * Every one of them a note explaining why something is NOT there — which is exactly the writing this codebase
 * does most of, so a guard that reads comments would be loudest about the best-documented code.
 *
 * ⚠️ `//` INSIDE A STRING IS NOT A COMMENT. `'https://…'` would otherwise swallow the rest of the line and hide
 * real calls after it — a checker that goes quiet is worse than one that shouts, because nobody can see it
 * happen. So a `//` only starts a comment when the quotes before it on that line are balanced.
 */
function decomment(src) {
  const out = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return out.split('\n').map((line) => {
    let q = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; continue; }
      if (c === '/' && line[i + 1] === '/') return line.slice(0, i);
    }
    return line;
  }).join('\n');
}

function collect() {
  const declared = new Set();
  const optional = new Set();          /* asked for with typeof — absence is expected, not a fault */
  const calls = new Map();             // name → [{file, line}]
  for (const rel of FILES) {
    const lines = decomment(fs.readFileSync(path.join(WEB, rel), 'utf8')).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const d = DECL.exec(line);
      if (d) declared.add(d[1]);
      /* nested declarations count too: the question here is "does this name exist at all", not "is it
         global" — whether two of them collide is dup-functions.cjs's question */
      const nested = line.match(/(?:^|[^.\w$])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
      if (nested) declared.add(nested[1]);
      for (const re of ASSIGN) { const a = re.exec(line); if (a) declared.add(a[1]); }
      /* every name bound in a var/let/const LIST counts, not only the first: `var c = kit.c, codeBook = kit.codeBook` (the vendored
         tax bundle, 13 Oct) declares codeBook — the old pattern saw only `c` and called codeBook() undeclared */
      const vl = line.replace(/\r$/, '').match(/\b(?:var|let|const)\s+(.*)$/);
      if (vl) { const re = /(?:^|,)\s*([A-Za-z_$][\w$]*)\s*=(?!=)/g; let m; while ((m = re.exec(vl[1]))) declared.add(m[1]); }

      const t = line.match(/typeof\s+([A-Za-z_$][\w$]*)/g) || [];
      t.forEach((x) => optional.add(x.replace(/typeof\s+/, '')));

      /* ⚠️ NOT after a dot: `x.testFoo()` is a method on an object and says nothing about a global */
      const re = /(?:^|[^.\w$'"`])([A-Za-z_$][\w$]*)\s*\(/g;
      let m;
      while ((m = re.exec(line))) {
        const n = m[1];
        if (!FAMILIES.test(n) || KNOWN.has(n)) continue;
        const at = calls.get(n) || [];
        at.push({ file: rel, line: i + 1 });
        calls.set(n, at);
      }
    }
  }
  return { declared, optional, calls };
}
const { declared, optional, calls } = collect();
const missing = [...calls.entries()].filter(([n]) => !declared.has(n) && !optional.has(n));

console.log('\n══ CALLS WITH NO FUNCTION BEHIND THEM ══');
console.log('  ' + declared.size + ' name(s) declared, ' + calls.size + ' checked call name(s), '
  + FILES.length + ' file(s)\n');
for (const [name, at] of missing) {
  console.log('  ✗ ' + name + '() is called ' + at.length + ' time(s) and declared nowhere');
  at.slice(0, 6).forEach((a) => console.log('      ' + a.file + ':' + a.line));
  console.log('      whatever runs this line throws ReferenceError and stops there\n');
}
if (!missing.length) console.log('  ✓ every call in these families has a function behind it\n');
process.exit(missing.length ? 1 : 0);
