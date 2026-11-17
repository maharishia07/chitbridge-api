/**
 * prose-scan.cjs — how much of L3 is EDITORIAL and how much is just source line-wrapping?
 *
 * ⚠️ THE DISTINCTION THIS EXISTS TO MAKE, and getting it wrong would have cost days. My first extractor
 * reported "1,138 fragments" and I read that as 1,138 sentences broken by inline markup. Looking at the actual
 * source, most are nothing of the kind:
 *
 *     + 'These settings change the <b>chrome</b> — labels, buttons, and how figures '
 *     + 'are written. They never touch what people wrote.'
 *
 * Those two literals are ONE logical string that wraps across source lines for readability. The markup is
 * INSIDE the string, where gettext wants it — a translator sees `<b>chrome</b>` and moves it. Joining them is
 * mechanical and needs no judgement at all.
 *
 * The genuinely editorial case is when an EXPRESSION sits between two literals:
 *
 *     + 'You have ' + esc(n) + ' products in ' + esc(cat)
 *
 * There the sentence cannot be reassembled without inventing a placeholder form, and word order differs by
 * language — which is the real L3 work.
 *
 * So: JOINABLE = adjacent literals with nothing between them. INTERPOLATED = literals with an expression
 * between them. Only the second needs a human.
 *
 * Run: node e2e/prose-scan.cjs [--list] [--file <name>]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'public');
const FILES = ['app.html'].concat(
  fs.readdirSync(path.join(WEB, 'app')).filter((f) => f.endsWith('.js')).map((f) => 'app/' + f)
);

/** Blank out comments in place so offsets and line numbers stay honest. */
const blank = (m) => m.replace(/[^\n]/g, ' ');

const stats = {};
const chains = [];
const interp = [];

FILES.forEach((name) => {
  const raw = fs.readFileSync(path.join(WEB, name), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/^([ \t]*)\/\/.*$/gm, blank);
  const s = { joinable: 0, interpolated: 0, lone: 0 };

  /**
   * Walk `+`-joined runs of single-quoted literals. ⚠️ Deliberately narrow: only `'…'` literals, only when the
   * joiner between them is whitespace or `+`. A template literal or a double-quoted string is left alone —
   * this is a MEASUREMENT, and over-reaching would inflate the number it exists to establish.
   */
  const LIT = /'((?:[^'\\]|\\.)*)'/g;
  let m, prevEnd = -1, run = [], runStart = 0;

  const flush = () => {
    if (run.length >= 2) {
      const text = run.join('');
      /* Only count it as PROSE if the joined result reads like a sentence rather than a style attribute. */
      if (/[a-z]{3}.*[a-z]{3}/.test(text) && !/^[a-z-]+:|;\s*[a-z-]+:/.test(text) && text.length > 25) {
        s.joinable++;
        chains.push({ name, line: src.slice(0, runStart).split('\n').length, parts: run.length, text });
      }
    }
    run = [];
  };

  while ((m = LIT.exec(src))) {
    const between = prevEnd >= 0 ? src.slice(prevEnd, m.index) : null;
    if (between !== null && /^[\s+]*$/.test(between) && between.includes('+')) {
      run.push(m[1]);
    } else {
      flush();
      run = [m[1]];
      runStart = m.index;
    }
    prevEnd = m.index + m[0].length;
  }
  flush();

  /* Interpolated sentences: a literal, an expression, then a literal — where both literals carry words. */
  const INTERP = /'((?:[^'\\]|\\.)*[a-z]{3}[^'\\]*)'\s*\+\s*([A-Za-z_$][\w$.()\[\]'" ]{0,60}?)\s*\+\s*'([^'\\]*[a-z]{3}(?:[^'\\]|\\.)*)'/g;
  while ((m = INTERP.exec(src))) {
    if (/^\s*<|style=|px|var\(--/.test(m[1] + m[3])) continue;   // markup or css, not prose
    s.interpolated++;
    interp.push({ name, line: src.slice(0, m.index).split('\n').length, a: m[1], expr: m[2], b: m[3] });
  }

  stats[name] = s;
});

const tot = { joinable: 0, interpolated: 0 };
Object.values(stats).forEach((s) => { tot.joinable += s.joinable; tot.interpolated += s.interpolated; });

console.log('\n══ L3 · WHAT IS ACTUALLY EDITORIAL ══\n');
console.log('  JOINABLE      ' + String(tot.joinable).padStart(5) + '   adjacent literals, nothing between — one logical sentence');
console.log('                        wrapped for source width. Mechanical: join and wrap. NO judgement.');
console.log('  INTERPOLATED  ' + String(tot.interpolated).padStart(5) + '   an expression sits between two halves of a sentence.');
console.log('                        Needs a placeholder form and a word-order decision. THIS is the L3 work.\n');

const rows = Object.entries(stats).filter(([, s]) => s.joinable || s.interpolated)
  .sort((a, b) => (b[1].interpolated - a[1].interpolated) || (b[1].joinable - a[1].joinable));
console.log('  ' + 'file'.padEnd(26) + 'joinable  interpolated');
rows.forEach(([n, s]) => console.log('  ' + n.padEnd(26) + String(s.joinable).padStart(6) + String(s.interpolated).padStart(12)));

/* ⚠️ THIS is the L3 work-list — the only cases that need a human. Everything in `chains` is joinable by a
   script; everything here needs a placeholder form and a word-order decision. */
if (process.argv.includes('--interp')) {
  /* ⚠️ indexOf returns -1 when the flag is absent, so `argv[-1 + 1]` is argv[0] — the node binary path — and
     the filter below then matched nothing. A missing flag has to mean "no filter", not "filter on argv[0]". */
  const fi = process.argv.indexOf('--file');
  const only = fi >= 0 ? process.argv[fi + 1] : null;
  console.log('\n── INTERPOLATED · the editorial work-list ──');
  interp.filter((c) => !only || c.name === only).forEach((c) =>
    console.log('  ' + (c.name + ':' + c.line).padEnd(28) + JSON.stringify(c.a.slice(-42))
      + '  [' + c.expr.trim() + ']  ' + JSON.stringify(c.b.slice(0, 42))));
}

if (process.argv.includes('--list')) {
  const only = process.argv[process.argv.indexOf('--file') + 1];
  console.log('\n── JOINED SENTENCES ──');
  chains.filter((c) => !only || c.name === only).slice(0, 40).forEach((c) =>
    console.log('\n  ' + c.name + ':' + c.line + '  (' + c.parts + ' parts)\n    ' + c.text.slice(0, 220)));
}
console.log('');
