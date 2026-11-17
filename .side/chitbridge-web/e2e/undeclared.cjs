'use strict';
/**
 * e2e/undeclared.cjs — A NAME THAT IS USED AND NEVER DECLARED.
 *
 * ⚠️⚠️ THE FAULT THIS EXISTS FOR, 2026-09-11: `matrixHTML()` in testing.html referenced `KINDS` three times.
 * The function declares `COLS`. I had patched it from memory of an older version, so every call to
 * `paintSummary()` threw `KINDS is not defined`, the Summary tab never repainted, and it kept showing whatever
 * was last drawn — the Cases table.
 *
 * ⭐⭐⭐ AND ATHI REPORTED IT TWICE BEFORE I BELIEVED HIM. *"Are you building the summary tab? It is showing
 * same / similar tab cases?"* was not an opinion about duplication. It was a bug report, in plain words, about
 * a tab rendering the wrong content. I argued about design, deleted a working view over it, and only found the
 * real cause when he asked a third time whether it had been deployed.
 *
 * ⚠️ NOTHING WE HAD COULD CATCH IT. An undefined variable is perfectly valid JavaScript — `app-syntax.cjs` and
 * `html-syntax.cjs` both parse the file clean, and they are right to. It fails only when the function RUNS.
 *
 * ⭐ SO THIS IS THE CHEAPEST CHECK THAT WOULD HAVE. It looks for SHOUTING_CASE identifiers — the convention this
 * codebase uses for module-level tables and constants — that are READ somewhere and declared nowhere. That is a
 * narrow rule, and narrow is the point: it catches the exact mistake with almost no chance of crying wolf.
 *
 * ⚠️ IT IS NOT A LINTER AND MUST NOT GROW INTO ONE. It cannot see a misspelt local, a typo'd property, or a
 * name declared in another file and legitimately shared. A real answer is a parser with scope analysis; this is
 * the ten-line version that catches the class that has actually happened.
 *
 * Run: node e2e/undeclared.cjs   · no network, no browser.
 */
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const files = [];
['', 'app'].forEach((sub) => {
  const d = path.join(PUB, sub);
  if (!fs.existsSync(d)) return;
  fs.readdirSync(d).filter((f) => /\.(js|html)$/.test(f)).forEach((f) => files.push(path.join(d, f)));
});

/** every browser and language global a SHOUTING name might legitimately be */
const KNOWN = new Set(['JSON', 'Math', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'RegExp',
  'Map', 'Set', 'Promise', 'Error', 'TypeError', 'NaN', 'Infinity', 'URL', 'Intl', 'Symbol', 'BigInt',
  'WeakMap', 'WeakSet', 'Proxy', 'Reflect', 'ArrayBuffer', 'DataView', 'XMLHttpRequest', 'FormData',
  'FileReader', 'Blob', 'Image', 'Audio', 'Notification', 'MutationObserver', 'IntersectionObserver',
  'ResizeObserver', 'AbortController', 'TextEncoder', 'TextDecoder', 'CustomEvent', 'Event', 'Node',
  'HTMLElement', 'DOMParser', 'Worker', 'IDBKeyRange', 'CSS', 'SVGElement']);

/**
 * ⚠️⚠️ A CAPABILITY FILE SHARES app.html's SCOPE, and that is the design, not an accident. cap-*.js is
 * loaded INTO the page, so UI, SESSION and MSG are declared there and used here — perfectly correct, and the
 * narrowed check reported all three. ⭐ Whatever app.html declares is therefore declared for every app/ file.
 */
const SHARED = (function () {
  try {
    var src = fs.readFileSync(path.join(PUB, 'app.html'), 'utf8');
    var out = new Set();
    /* ⚠ s, not s — the backslash was eaten writing this file, so the pattern read "functions" and
       matched nothing. Which is why SESSION and MSG were still reported when app.html declares both. */
    (src.match(/(?:var|let|const|function)s+([A-Z][A-Z0-9_]{1,})/g) || [])
      /* ⚠ the THIRD backslash eaten in this one file: /.*s/ greedily ate "const" and left " MSG" with a
         leading space, so the shared name never matched. Split on whitespace instead of trimming with a
         regex — there is nothing to get wrong. */
      .forEach(function (d) { out.add(d.trim().split(/s+/).pop()); });
    return out;
  } catch (_) { return new Set(); }
})();

/* QA-71 · measured 19 Oct 2026 on main. May only go down. */
const BASELINE = Number(process.env.CB_UNDECLARED_BASELINE || 77);
let bad = [];
/**
 * A SPLIT MODULE IS ONE UNIT (shrink W2, 2026-11-17). A size split moved declarations into sibling part files
 * (cap-books.js -> cap-books-tree.js, cap-books-cheques.js ...) that the page loads right after the parent in
 * one scope, so a name a part reads is declared in the parent or another part. The unit of a file is the
 * shortest app/ prefix (split on '-') that is a real file, plus every app/ file starting with that prefix + '-'.
 * Declarations are gathered per file first, then a name counts as declared if ANY file of the unit declares it.
 */
const UNIT_ROOT = (function () {
  const names = new Set(fs.readdirSync(path.join(PUB, 'app')).filter((n) => /\.js$/.test(n)).map((n) => n.slice(0, -3)));
  return function (f) {
    if (path.basename(path.dirname(f)) !== 'app') return null;
    const seg = path.basename(f, '.js').split('-');
    for (let i = 1; i <= seg.length; i++) { const p = seg.slice(0, i).join('-'); if (names.has(p)) return p; }
    return null;
  };
})();
const scanned = new Map();   /* file -> { code, DECLARED, used } */
const unitOf = new Map();    /* unit root -> [files] */
files.forEach((f) => { const u = UNIT_ROOT(f); if (u) { if (!unitOf.has(u)) unitOf.set(u, []); unitOf.get(u).push(f); } });
files.forEach((f) => {
  let src = fs.readFileSync(f, 'utf8');
  /**
   * ⚠️ AN .html FILE IS NOT JAVASCRIPT, AND SCANNING ALL OF IT REPORTED CSS AS CODE. `F6ECD8`, `E0EBF8`,
   * `D8E4F4` are hex colours in the <style> block; SELECT and SUP came out of markup. ⭐ Only the <script>
   * contents are code, so only those are read.
   */
  if (/\.html$/.test(f)) {
    src = (src.match(/<script\b[^>]*>([\s\S]*?)<\/script>/g) || []).join('\n');
  }
  /**
   * ⚠️ COMMENTS AND STRINGS BOTH HAVE TO GO, and the first run proved why by reporting `F6ECD8`, `API`, `RLS`
   * and `SMS` as undeclared names. Comments here are full of SHOUTED prose; strings are full of hex colours and
   * acronyms. An identifier can live in neither, so both are removed before anything is counted.
   *
   * ⚠️ Stripping template literals whole is a known blind spot: a name used inside `${…}` becomes invisible to
   * this check. That is the trade — a guard that fires on twelve healthy lines to catch one sick one is a guard
   * somebody switches off, and then it is not there on the day it is right.
   */
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/`(?:[^`\\]|\\.)*`/g, ' " " ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, ' " " ')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, ' " " ');

  /* a SHOUTING_CASE name: at least two characters, capitals, digits and underscores only */
  /**
   * ⚠️ A THRESHOLD, BECAUSE ONE MENTION IS NOISE AND THREE IS A VARIABLE. Scanning for any SHOUTING name used
   * once produced a hundred and twenty hits across healthy files — CTX, DKP, BETA, FAIL: acronyms in markup
   * and one-off labels. A name genuinely in use as a table or constant is READ repeatedly; KINDS was read
   * three times. ⭐ A guard that fires on a hundred healthy lines to catch one sick one is a guard somebody
   * switches off, and then it is not there on the day it is right.
   */
  const count = {};
  let m;
  /* ⭐ USED AS A TABLE — NAME. or NAME[ — which is what a missing constant actually breaks. A bare SHOUTING
     word is an enum value, a label or an acronym; CART, TIMER and PLAYING were all of those. KINDS was read
     as KINDS.filter(...) and KINDS.forEach(...), and that is the shape this looks for. */
  const useRe = /\b([A-Z][A-Z0-9_]{1,})\s*(?:\.|\[)/g;
  while ((m = useRe.exec(code))) count[m[1]] = (count[m[1]] || 0) + 1;
  const used = new Set(Object.keys(count).filter(function (k) { return count[k] >= 3; }));

  /**
   * ⭐ EVERY NAME A var/let/const STATEMENT INTRODUCES, commas included. The statement is read up to its
   * terminator and each clause's head is taken — which is what a declaration list actually is.
   * ⚠️ It over-collects rather than under-collects on purpose: a name wrongly believed declared costs a missed
   * warning, a name wrongly believed undeclared costs the guard's credibility, and only one of those is fatal.
   */
  const DECLARED = new Set();
  /**
   * ⚠️ AND THE FIRST FIX STOPPED AT THE INITIALISER. Reading the statement up to a terminator meant
   * `var NOTES = {}, FOOT = '', MATURITY = null;` was captured as "NOTES = " — the `{}` ended the match — so
   * the second and third names were still invisible and MATURITY was still reported on the line declaring it.
   *
   * ⭐ A declaration in this codebase is a LINE. So the line is taken and its comma clauses are read, which is
   * the shape the code actually has, rather than a regex trying to know where a statement ends.
   */
  code.split('\n').forEach(function (line) {
    const kw = line.match(/\b(?:var|let|const|function)\s+/);
    if (!kw) return;
    line.slice(kw.index + kw[0].length).split(',').forEach(function (clause) {
      const head = clause.trim().split(/[\s=:(){}[\]]/)[0];
      if (/^[A-Za-z_$][\w$]*$/.test(head)) DECLARED.add(head);
    });
  });

  /* ITER1 (MNT-4): the formatter puts each declarator of `let A = 1, B = 2;` on its own line, so the line reading above misses B. Read the whole
     statement up to its `;` at bracket depth 0 and take the head of every top-level comma clause (over-collecting, as above). */
  {
    const kwRe = /\b(?:var|let|const)\s+/g;
    let km;
    while ((km = kwRe.exec(code))) {
      let depth = 0, clause = '', i = km.index + km[0].length;
      const heads = [];
      for (; i < code.length; i++) {
        const ch = code[i];
        if ('([{'.indexOf(ch) >= 0) depth++;
        else if (')]}'.indexOf(ch) >= 0) { if (depth === 0) break; depth--; }
        if (depth === 0 && (ch === ';' || ch === ',')) { heads.push(clause); clause = ''; if (ch === ';') break; continue; }
        clause += ch;
      }
      heads.push(clause);
      heads.forEach(function (c) { const head = c.trim().split(/[\s=:(){}[\]]/)[0]; if (/^[A-Za-z_$][\w$]*$/.test(head)) DECLARED.add(head); });
    }
  }

  scanned.set(f, { code, DECLARED, used });
});
files.forEach((f) => {
  const { code, DECLARED, used } = scanned.get(f);
  const u = UNIT_ROOT(f);
  const parts = (u && unitOf.get(u).length > 1 ? unitOf.get(u) : []).filter((g) => g !== f).map((g) => scanned.get(g));
  used.forEach((name) => {
    if (KNOWN.has(name)) return;
    const declRe = new RegExp('\\b' + name + '\\s*[:=]\\s*(?:function|\\{|\\[)');
    if (parts.some((p) => p.DECLARED.has(name) || declRe.test(p.code))) return;   /* declared in a part of the same unit */
    if (SHARED.has(name)) return;   /* declared in app.html, shared into every capability */
    /* declared here in any of the shapes this codebase uses? */
    /**
     * ⚠️⚠️ A COMMA LIST IS A DECLARATION, AND THIS DID NOT KNOW THAT. It required the keyword immediately
     * before the name, so `var NOTES = {}, FOOT = '', MATURITY = null;` declared three names and this guard
     * recognised one. It reported MATURITY as undeclared on the line that declares it.
     *
     * ⭐ Which is the failure mode this file's own header warns about: a guard that fires on healthy code is a
     * guard somebody switches off, and then it is not there on the day it is right. So DECLARED is gathered
     * once per file — every name introduced by a var/let/const statement, commas included — instead of being
     * re-guessed with a regex per name.
     */
    if (DECLARED.has(name)) return;
    const decl = new RegExp('\\b' + name + '\\s*[:=]\\s*(?:function|\\{|\\[)');
    if (decl.test(code)) return;
    /* a property (x.NAME) or a string key is not a free identifier */
    const free = new RegExp('(?:^|[^.\\w$\'"])' + name + '\\s*(?:[.,;)\\]}]|\\[|\\.|\\s*\\+)');
    if (!free.test(code)) return;
    bad.push(path.relative(PUB, f).split(path.sep).join('/') + '  ' + name);
  });
});

console.log('\n— a name that is read and never declared —\n');
if (bad.length) {
  console.log('  ✗ ' + bad.length + ' name(s) used with no declaration in the same file:\n');
  bad.slice(0, 20).forEach((b) => console.log('      ' + b));
  console.log('\n  ⚠ Valid JavaScript, so every parser passes it. It throws when the function runs, and the');
  console.log('    screen that calls it silently keeps whatever it drew last.\n');
  /**
   * ⚠️⚠️ REPORT-ONLY, AND DELIBERATELY NOT A GATE. This never fails the suite.
   *
   * It took nine passes to get from 120 false positives to 1, and the last change put it back to 47 — the
   * shared-globals set is still not right. ⭐ A guard that oscillates is not nearly-working, it is unfinished,
   * and shipping it as a gate would add a permanent red to a suite whose whole problem this week was reds
   * nobody reads. Exactly the stale tooling we spent the day diagnosing.
   *
   * ⚠️ IT IS KEPT, NOT DELETED, because the fault it exists for is real and cost an afternoon: KINDS used three
   * times, declared nowhere, paintSummary() throwing on every render, and the Summary tab silently showing the
   * Cases table. No parser catches that. Finishing this needs scope analysis, not another regex.
   */
  /**
   * QA-71 (19 Oct 2026) · A RATCHET, NOT A GATE ON THE OSCILLATION. The reason above stands (the count moved
   * 120 -> 1 -> 47 while the shared-globals set was wrong), so the number is BASELINED at today's count and may
   * only go DOWN: it fails when the count RISES, and when it FALLS without BASELINE being lowered. Never edit a
   * file to reach the number; lower the number when a real fix lands.
   */
  if (bad.length > BASELINE) {
    console.log('  ✗ the count ROSE: ' + bad.length + ' > baseline ' + BASELINE + ' — a name is used and never declared; fix it\n');
    process.exitCode = 1;
  } else if (bad.length < BASELINE) {
    console.log('  ✗ the count FELL to ' + bad.length + ' — lower BASELINE in e2e/undeclared.cjs so it cannot creep back\n');
    process.exitCode = 1;
  } else {
    console.log('  ✓ at the baseline (' + BASELINE + ') — report-only reason kept above\n');
  }
} else if (BASELINE !== 0) {
  console.log('  ✗ the count FELL to 0 — set BASELINE to 0 in e2e/undeclared.cjs\n');
  process.exitCode = 1;
} else {
  console.log('  ✓ every SHOUTING_CASE name is declared where it is used   ' + files.length + ' file(s)\n');
}
