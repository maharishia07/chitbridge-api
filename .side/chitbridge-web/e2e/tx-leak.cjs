'use strict';
/**
 * e2e/tx-leak.cjs — SOURCE CODE MUST NOT LEAK ONTO A SCREEN.
 *
 * ⚠️⚠️ THE FAULT THIS EXISTS FOR, found 2026-09-11 by a tester agent reading the live app:
 *
 * The theme picker showed, under every colour swatch, the literal characters
 *
 *     ' + tx('Aa') + '
 *
 * where a sample "Aa" should have been. Settings → Standards showed `' + tx('Accept-Language') + '` and
 * `' + tx('Intl') + '` the same way. Three screens, printing their own source at the reader.
 *
 * ── ⭐ WHY IT HAPPENED, AND WHY IT WILL HAPPEN AGAIN WITHOUT THIS ─────────────────────────────────────────────
 *
 * The string layer wraps every user-visible label in `tx(...)` so it can be translated. Inside a SINGLE-quoted
 * string, `'...' + tx('Aa') + '...'` is correct concatenation and there are 890 of them in this codebase, all
 * fine. Inside a DOUBLE-quoted string it is not concatenation at all — it is four literal characters, a call
 * that never runs, and four more literal characters, printed verbatim.
 *
 * ⚠️ THE TWO FORMS ARE INDISTINGUISHABLE TO THE EYE, which is exactly why a person wrapping four hundred
 * labels by hand gets a few wrong, and why grepping for `' + tx(` finds 890 hits of which three are bugs. This
 * walks the quoting instead of pattern-matching it.
 *
 * ⭐ IT IS NOT ABOUT tx(). Any concatenation marooned inside the wrong quote prints itself; tx() is simply the
 * one that happened, because it was applied mechanically across the whole codebase in one pass.
 *
 * Run: node e2e/tx-leak.cjs   · no network, no browser.
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

/**
 * Walk one line, tracking which quote (if any) we are inside, and report a concatenation that is stranded
 * within a differently-quoted string.
 *
 * ⚠️ Line by line, deliberately. A real parse would handle strings spanning lines and would also drag in a
 * dependency and a great deal of behaviour to be wrong about. Every instance of this fault has been on one
 * line, because it comes from a mechanical per-label edit.
 */
function leaksIn(line) {
  const out = [];
  let quote = null;          /* the character that opened the string we are inside, or null */
  let interp = 0;            /* brace depth inside a template literal's ${ … } */
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\') { i++; continue; }                 /* an escaped anything is never a delimiter */
      /**
       * ⚠️⚠️ ${ … } INSIDE A TEMPLATE LITERAL IS CODE, NOT TEXT — and missing that made the first run report
       * sixteen leaks, every one of them a perfectly good `${ '…' + tx('x') + '…' }`. A guard that fires on
       * sixteen healthy lines to catch three sick ones gets switched off, and then it is not there on the day
       * it is right.
       */
      if (quote === '`' && c === '$' && line[i + 1] === '{') { interp++; i++; continue; }
      if (interp) {
        if (c === '{') interp++;
        else if (c === '}') interp--;
        continue;                                        /* everything in here is code; nothing is printed */
      }
      if (c === quote) { quote = null; continue; }
      /* inside a string: is a concatenation written here in the OTHER quote? */
      if (c !== quote && (c === "'" || c === '"')) {
        const ahead = line.slice(i, i + 7);
        if (/^['"]\s*\+\s*\w/.test(ahead)) out.push(line.slice(Math.max(0, i - 12), i + 34).trim());
      }
      /**
       * ── ⚠️⚠️ THE OTHER FORM OF THIS FAULT IS DELIBERATELY *NOT* CHECKED HERE ───────────────────────────────
       *
       * `${…}` interpolates ONLY inside a backtick; written inside a quoted string it is ordinary characters
       * and the whole expression prints. That form produced the worst instance found on 2026-09-11: a
       * PERMANENT-DELETE confirmation whose explanatory line was ninety characters of
       * `${txf('Only {drafts} can be purged…', { drafts: '<b>' + tx('drafts') …` shown verbatim, at the one
       * moment a person most needs to read what they are about to destroy. It is fixed.
       *
       * ⚠️ BUT IT CANNOT BE CHECKED LINE BY LINE. Template literals span lines, so a scan starting mid-template
       * sees an HTML attribute's `"` as opening a string and reports every `class="${…}"` in the codebase. The
       * attempt produced EIGHTEEN false positives against one true one. ⭐ A narrow guard that is trusted beats
       * a broad one that gets switched off — so this half needs a real parse, and until then it is a known,
       * written-down blind spot rather than a silent one.
       */
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
  }
  return out;
}

let bad = [];
files.forEach((f) => {
  fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    /**
     * ⚠️ COMMENTS ARE NOT SCREENS. `cap-traceability.js:15` documents the old bug in prose —
     * "WAS `'₹' + toLocaleString('en-IN')`" — and the first run reported that explanation as a fault. A guard
     * that cannot tell a note about a bug from the bug is a guard that makes people delete their notes.
     */
    if (/^\s*(\*|\/\/)/.test(line) || /^\s*\/\*/.test(line)) return;
    /* ⚠ only lines that actually contain a call being concatenated — otherwise an apostrophe in prose
       ("don't + more text") reads as a leak and the guard cries wolf */
    if (!/['"]\s*\+\s*\w+\s*\(/.test(line)) return;
    leaksIn(line).forEach((hit) => {
      if (!/\+\s*\w+\s*\(/.test(hit)) return;
      const rel = path.relative(PUB, f).split(path.sep).join('/');
      bad.push({ key: rel + '  ' + hit, show: rel + ':' + (i + 1) + '  ' + hit });
    });
  });
});

/* QA-154: findings are recorded in e2e/scanner-known.json; only a NEW one fails, the known ones stay counted on screen */
const R = require('./lib/known-findings.cjs').ratchet('tx-leak', bad, { owner: 'connect' });
console.log('\n— a screen must not print its own source —\n');
if (R.known) console.log(R.line + '\n');
bad = R.fresh;
if (bad.length) {
  console.log('  ✗ ' + bad.length + ' NEW concatenation(s) stranded inside the wrong quote, printed verbatim:\n');
  bad.slice(0, 20).forEach((b) => console.log('      ' + b.show));
  console.log('\n  ⚠ Inside a single-quoted string this form is correct and there are hundreds of them. Inside a');
  console.log('    double-quoted one it is literal text. Close the outer string, or use the other quote.\n');
  process.exitCode = 1;
} else {
  console.log('  ✓ no new source leaks onto a screen   ' + files.length + ' file(s) walked\n');
}
