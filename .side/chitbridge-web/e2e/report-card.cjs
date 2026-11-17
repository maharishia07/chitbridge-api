'use strict';
/**
 * report-card.cjs — WHICH SCREEN IS WORST, AND WHY?
 *
 * Athi, 2026-09-01: *"do you have any product assessment tool… to look into each aspect of the build and
 * highlight issues in terms of usability and suggest better way of using the same?"*
 *
 * ⚠️⚠️ THE ANSWER WAS "PARTS, NOT A TOOL". Fourteen audits exist and each answers ONE question across the whole
 * tree: contrast, tooltip length, empty states, dead functions, reads per screen. Every one is useful and not
 * one of them can say *which screen a person will struggle with*, because none of them groups by screen.
 *
 * ⭐⭐ THAT GAP IS NOT THEORETICAL. Three defects this week came from asking exactly this question by hand and
 * none had a tool behind it: an empty state that offered a form and then refused it; an optimisation that only
 * ran on the path nobody takes; and a register whose scores all sat off the right edge. Each was found by a
 * person looking at one screen properly.
 *
 * ⚠️ IT DOES NOT CALL THE OTHER AUDITS. Shelling out to fourteen tools and parsing their prose would make this
 * break whenever any of them changed a line of output. It asks a DIFFERENT question — per screen, not per rule —
 * and computes what it needs directly. Where a number already exists as data (screen-reads.json) it is read,
 * not recomputed.
 *
 * ⚠️⚠️ ITS NUMBERS ARE FOR RANKING, NOT FOR QUOTING. Where this and a dedicated audit measure the same thing
 * they will disagree, because they define it differently and both definitions are defensible:
 *
 *   prose vs label     text-budget.cjs counts ~4,300 explanation words; this counts ~250. text-budget reads
 *                      template literals and tx() calls across every surface; this counts only quoted strings
 *                      that unambiguously read as human sentences, because a rank spoiled by CSS fragments is
 *                      worse than a rank that undercounts. ⭐ For the absolute number, ask text-budget.
 *   inherited colour   guard-static finds 4 inline surfaces; this finds more, because it flags any inline
 *                      background without a colour beside it rather than only the ones on a themed token.
 *
 * ⭐ So: use this to decide WHICH SCREEN to open, then use the specific audit for what exactly is wrong with
 * it. A ranking that argues with its own sources about absolute values is still a useful ranking; one that
 * claims to replace them is a third opinion nobody asked for.
 *
 * ⚠️ AND IT IS A DESCRIPTION, NOT A VERDICT. There is no pass/fail: a screen with lots of explanation may be
 * the one screen that needs it. It ranks, it names, and a person decides. A tool that failed the build on prose
 * would be deleted within a week.
 *
 *   node report-card.cjs            every screen, worst first
 *   node report-card.cjs --top 5    just the worst five
 *   node report-card.cjs --screen catalogue
 */
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'public');
const APP = path.join(WEB, 'app');
const ARGS = process.argv.slice(2);
const argOf = (k, d) => { const i = ARGS.indexOf(k); return i >= 0 ? ARGS[i + 1] : d; };
const TOP = parseInt(argOf('--top', '0'), 10) || 0;
const ONLY = argOf('--screen', '');

/* ── what counts as a screen ────────────────────────────────────────────────────────────────────────────────
 * One capability module is one screen. app.html is the shell and carries several, so it is reported as a
 * single row named for what it is rather than pretending to split it. */
function screens() {
  const out = [];
  for (const f of fs.readdirSync(APP)) {
    if (!/^cap-.*\.js$/.test(f)) continue;
    out.push({ name: f.replace(/^cap-|\.js$/g, ''), file: path.join(APP, f), rel: 'app/' + f });
  }
  out.push({ name: '(shell)', file: path.join(WEB, 'app.html'), rel: 'app.html' });
  return out;
}

/* ── the measurements ───────────────────────────────────────────────────────────────────────────────────── */

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const words = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/**
 * ⭐ LABEL vs EXPLANATION. A label names a thing you act on; anything that reads as a sentence is teaching.
 *
 * ⚠️ THE FILTER HAS TO BE STRICT OR THE NUMBER IS A LIE. A first version counted every quoted string and
 * reported 5,503 "label words" in the shell — most of them CSS fragments, SQL, ids and JSON keys. A confident
 * wrong number is worse than no number, so a string only counts as human text if it reads like human text:
 * letters and ordinary punctuation, at least one space, and none of the characters that mean code.
 */
const CODEY = /[{}<>$();=|\\/\[\]#@]|::|--|\.\w+\(|^\s*[a-z-]+:\s/;
function textSplit(src) {
  const lits = strip(src).match(/'[^'\\n]{6,240}'|"[^"\\n]{6,240}"/g) || [];
  let label = 0, prose = 0, longest = '';
  for (const raw of lits) {
    const t = raw.slice(1, -1).trim();
    if (!t || !/\s/.test(t)) continue;
    if (CODEY.test(t)) continue;                       // css, sql, selectors, template fragments
    if (!/^[A-Za-z\u00C0-\u024F]/.test(t)) continue;   // must start like a sentence or a label
    if ((t.match(/[A-Za-z]/g) || []).length < t.length * 0.6) continue;   // mostly letters, or it is data
    const w = words(t);
    /* Prose is a sentence: five or more words AND punctuation that ends or joins clauses. */
    if (w >= 5 && /[.!?]$|\.\s|,\s|—/.test(t)) { prose += w; if (t.length > longest.length) longest = t; }
    else label += w;
  }
  return { label, prose, longest };
}

/**
 * ⚠️ An onclick naming a function that exists NOWHERE in either tree is a control that cannot work.
 *
 * ⚠️ KEYWORDS ARE NOT FUNCTIONS. `onclick="if(x)…"` and `onclick="return false"` matched the first version's
 * regex and were reported as broken controls — the tool's own false positive, and the loudest line it printed.
 */
const KEYWORD = new Set(['if','for','while','return','typeof','void','new','delete','switch','try','catch',
  'function','this','do','else','in','of','instanceof','yield','await','throw']);
function deadControls(src, universe) {
  const found = [];
  const re = /on(?:click|change|input|submit)\s*=\s*(?:"|\\"|')([a-zA-Z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(src))) if (!KEYWORD.has(m[1]) && !universe.has(m[1])) found.push(m[1]);
  return [...new Set(found)];
}

/** ⭐ An empty state that names no next step leaves the reader to go and find the button. */
function emptyStates(src) {
  const calls = (src.match(/emptyState\s*\(/g) || []).length;
  const withAction = (src.match(/emptyState\s*\([^)]{0,400}?(action|onclick|cta)/g) || []).length;
  return { calls, withAction };
}

/** ⚠️ Below 11px is under the floor the type scale respects everywhere else. */
function tinyText(src) {
  return (src.match(/font-size:\s*(?:9|10|10\.5)px/g) || []).length;
}

/** ⚠️ A background with no colour beside it renders one theme's text on another theme's ground. */
function inheritedColour(src) {
  const re = /style\s*=\s*(?:"|\\"|')[^"']{0,200}background:[^"';]{2,60}[^"']{0,200}(?:"|\\"|')/g;
  let m, n = 0;
  while ((m = re.exec(src))) if (!/color:/.test(m[0])) n++;
  return n;
}

function testids(src) {
  const ids = (src.match(/data-testid\s*=\s*(?:\?"|')([^"']+)/g) || [])
    .map((s) => s.replace(/.*?(?:\?"|')/, ''));
  const seen = {}, dupes = [];
  ids.forEach((i) => { seen[i] = (seen[i] || 0) + 1; });
  Object.keys(seen).forEach((k) => { if (seen[k] > 1) dupes.push(k + '×' + seen[k]); });
  return { total: ids.length, dupes };
}

/* Reads to paint — read from the ratchet's own data rather than recomputed. */
function readsFor(name) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'screen-reads.json'), 'utf8'));
    const keys = Object.keys(j).filter((k) => k.toLowerCase().indexOf(name.toLowerCase()) >= 0);
    return keys.reduce((a, k) => a + (j[k] || 0), 0);
  } catch (_) { return null; }
}

/* ── the card ───────────────────────────────────────────────────────────────────────────────────────────── */

const universe = new Set();
(function build() {
  const files = [path.join(WEB, 'app.html'), ...fs.readdirSync(APP).map((f) => path.join(APP, f))];
  for (const f of files) {
    if (!/\.(js|html)$/.test(f)) continue;
    const s = fs.readFileSync(f, 'utf8');
    (s.match(/function\s+([a-zA-Z_$][\w$]*)/g) || []).forEach((d) => universe.add(d.split(/\s+/)[1]));
    (s.match(/(?:var|let|const)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s*)?function/g) || [])
      .forEach((d) => universe.add(d.replace(/(?:var|let|const)\s+/, '').split(/\s*=/)[0]));
  }
  ['alert','confirm','print','open','close','fetch','eval'].forEach((n) => universe.add(n));
})();

const cards = screens().map((sc) => {
  const src = fs.readFileSync(sc.file, 'utf8');
  const t = textSplit(src);
  const es = emptyStates(src);
  const ti = testids(src);
  const dead = deadControls(src, universe);
  const tiny = tinyText(src);
  const inh = inheritedColour(src);
  const reads = readsFor(sc.name);
  /**
   * ⭐ THE SCORE IS STATED, NOT HIDDEN. Every weight is a judgement and is written here so it can be argued
   * with: a control that cannot work is the worst thing on a screen, prose is the most common, and the rest
   * are small. It orders the list; it is not a grade.
   */
  const friction =
      dead.length * 40
    + (t.prose > t.label ? 25 : 0)
    + Math.min(30, Math.round(t.prose / 40))
    + (es.calls - es.withAction) * 6
    + tiny * 4
    + inh * 3
    + ti.dupes.length * 2
    + (reads != null ? Math.max(0, reads - 1) * 5 : 0);
  return { ...sc, t, es, ti, dead, tiny, inh, reads, friction };
}).sort((a, b) => b.friction - a.friction);

/* ── printing ───────────────────────────────────────────────────────────────────────────────────────────── */

const C = { dim: '\u001b[90m', red: '\u001b[31m', amb: '\u001b[33m', ok: '\u001b[32m', b: '\u001b[1m', off: '\u001b[0m' };
const pad = (s, n) => String(s).padEnd(n);

let shown = cards.filter((c) => !ONLY || c.name.indexOf(ONLY) >= 0);
if (TOP) shown = shown.slice(0, TOP);

console.log('\n' + C.b + '══ SCREEN REPORT CARD ══' + C.off);
console.log(C.dim + '  Which screen will a person struggle with, and why. Worst first.' + C.off);
console.log(C.dim + '  Not a verdict: a screen with a lot of explanation may be the one that needs it.' + C.off + '\n');

console.log('  ' + pad('SCREEN', 14) + pad('PROSE/LABEL', 16) + pad('READS', 7) + pad('EMPTY', 8) + 'FLAGS');
console.log('  ' + '-'.repeat(86));

for (const c of shown) {
  const ratio = c.t.label ? (c.t.prose / c.t.label) : (c.t.prose ? 99 : 0);
  const wcol = c.t.prose + ' / ' + c.t.label;
  const flags = [];
  if (c.dead.length) flags.push(C.red + c.dead.length + ' control(s) with no handler' + C.off);
  if (ratio > 1) flags.push(C.amb + 'more prose than labels' + C.off);
  if (c.es.calls - c.es.withAction > 0) flags.push((c.es.calls - c.es.withAction) + ' empty state(s) name no next step');
  if (c.tiny) flags.push(c.tiny + ' size(s) under 11px');
  if (c.inh) flags.push(c.inh + ' surface(s) inherit their colour');
  if (c.ti.dupes.length) flags.push(c.ti.dupes.length + ' duplicate testid(s)');
  const tone = c.friction >= 60 ? C.red : c.friction >= 25 ? C.amb : C.ok;
  console.log('  ' + tone + pad(c.name, 14) + C.off + pad(wcol, 16)
    + pad(c.reads == null ? '—' : c.reads, 7)
    + pad(c.es.withAction + '/' + c.es.calls, 8)
    + (flags.length ? flags.join(' · ') : C.dim + 'nothing flagged' + C.off));
}

/* ⭐ The one number worth acting on, said in words rather than left in a column. */
const worst = shown[0];
if (worst) {
  console.log('\n' + C.b + '  WORST: ' + worst.name + C.off);
  if (worst.dead.length) {
    console.log('   ' + C.red + '⚠ ' + worst.dead.length + ' control(s) call a function that exists nowhere: '
      + worst.dead.slice(0, 4).join(', ') + C.off);
    console.log('     A control that does nothing is worse than no control — the reader assumes they used it wrongly.');
  }
  if (worst.t.longest) {
    console.log('   longest sentence on it (' + words(worst.t.longest) + ' words):');
    console.log('     ' + C.dim + '"' + worst.t.longest.slice(0, 150) + (worst.t.longest.length > 150 ? '…' : '') + '"' + C.off);
  }
}

const totalDead = cards.reduce((a, c) => a + c.dead.length, 0);
const totalProse = cards.reduce((a, c) => a + c.t.prose, 0);
const totalLabel = cards.reduce((a, c) => a + c.t.label, 0);
console.log('\n  ' + cards.length + ' screens · ' + totalProse + ' words of prose against ' + totalLabel
  + ' of labels · ' + totalDead + ' control(s) with no handler');
console.log(C.dim + '  Weights are stated in the source so they can be argued with. This ranks; a person decides.' + C.off + '\n');

/* ⚠️ A REPORT, NOT A GATE. It exits 0 even when everything is red: failing a build on prose gets the tool
   deleted, and the findings here need reading, not blocking. --strict is there for a caller that wants a gate
   on the one thing that is unambiguous — a control that cannot possibly work. */
if (ARGS.indexOf('--strict') >= 0 && totalDead > 0) process.exitCode = 1;
