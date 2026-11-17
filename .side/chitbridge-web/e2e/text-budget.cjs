/**
 * text-budget.cjs — how much of this product is a LABEL, and how much is an EXPLANATION?
 *
 * USAGE  node e2e/text-budget.cjs                 the console report (unchanged)
 *        node e2e/text-budget.cjs --json <out>    the same report, and per-file rows written to <out>:
 *                                                 { generated, files: [{ file, strings, labels, long_labels, explanations, words, over_budget }] }
 *        Both come from ONE pass: the buckets below are counted once, and the JSON is a per-file filter over them.
 *
 * Athi, 2026-08-19: *"this product is not supposed to have a lot of text inside. It should be simple like a
 * mailbox, no explanation whatsoever… without giving explanation how should people be able to understand how to
 * operate. That is where the challenge is going to be."*
 *
 * ⭐⭐ THE TRANSLATION BACKLOG IS MOSTLY AN EXPLANATION BACKLOG. Every sentence of explanation is a sentence that
 * has to be wrapped, translated into every language, reviewed by a native speaker, and kept in step forever. A
 * sentence deleted costs nothing in any language. So the cheapest way to finish localisation is to find the copy
 * that should not exist, and the second cheapest is to translate what is left.
 *
 * ⚠️ THIS COUNTS, IT DOES NOT DELETE. Which explanations earn their place is a product judgement and Athi's call
 * — a mailbox has no manual, but it does have an empty state. The tool's job is to make the size of the problem
 * visible, not to decide it.
 */
const fs = require('fs');
const path = require('path');

/* --json <out>: parsed up front so a bad call fails before the walk reads the whole source tree. */
const jsonFlag = process.argv.indexOf('--json');
const jsonOut = jsonFlag >= 0 ? process.argv[jsonFlag + 1] : null;
if (jsonFlag >= 0 && !jsonOut) { console.error('usage: text-budget.cjs --json <out>'); process.exit(2); }

/**
 * ⚠️⚠️ THE CATALOGUE IS THE WRONG INPUT AND THE FIRST RUN OF THIS TOOL PROVED IT. strings.catalogue.json holds
 * only the LABEL bucket — 468 entries — because strings-extract deliberately sets prose and fragments aside as
 * "needs reassembling first". Measuring explanations against it reported 4%, which is not a small number, it is
 * a wrong one: it excluded the very bucket the explanations live in.
 *
 * So this reads the SOURCE. Every run of text between tags, in every HTML string, whatever bucket it would fall
 * into. That is what a reader actually sees.
 */
const ROOT = path.join(__dirname, '..', 'public');
const FILES = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) { if (!/node_modules|illustrations|docs|vendor|_design/.test(f.name)) walk(p); }
    else if (/^(app\.html|cap-.*\.js|shop\.html|store\.html)$/.test(f.name) || /\/app\//.test(p.replace(/\\/g, '/'))) {
      if (/\.(html|js)$/.test(f.name) && !/\.min\./.test(f.name)) FILES.push(p);
    }
  }
})(ROOT);

const entries = [];
const seen = new Set();
for (const f of FILES) {
  const relf = path.relative(ROOT, f).replace(/\\/g, '/');
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (/^\s*(\*|\/\/|\/\*)/.test(line)) return;              // comments are not the product
    const RE = />([^<>{}`'"]{3,200})</g;
    let m;
    while ((m = RE.exec(line))) {
      const t = m[1].trim();
      if (!/[A-Za-z]/.test(t) || t.length < 3) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      entries.push({ msgid: t, source: relf + ':' + (i + 1) });
    }
  });
}

/**
 * A LABEL names a thing you can act on. An EXPLANATION is a sentence about it.
 *
 * The tell is grammatical, not length: an explanation has a finite verb and terminal punctuation. "Assignment
 * model" is a label; "Grouping is not a separate switch" is a claim about the world.
 */
const VERB = /\b(is|are|was|were|be|been|has|have|had|does|do|did|can|cannot|will|would|should|must|may|might|means|shows|keeps|stays|belongs|lives|counts|follows|changes|converts|translates|picks|needs)\b/i;

function classify(s) {
  const words = s.trim().split(/\s+/).length;
  const sentence = /[.!?](\s|$)/.test(s.trim()) || (VERB.test(s) && words >= 4);
  if (sentence) return 'EXPLANATION';
  if (words <= 4) return 'LABEL';
  return 'LONG LABEL';
}

/**
 * ⭐⭐ TRIM THE MAILBOX, KEEP THE MANUAL — the split that makes this number actionable (L3, 2026-08-22).
 *
 * The first version reported one pile of 579 explanations and read as an instruction to delete them all. But
 * **cap-legend.js alone holds 69, and the Legend is the screen whose entire job is to explain.** Trimming
 * there is not tightening the product, it is deleting its documentation — and `cap-readiness` (what a standard
 * requires) and `cap-network` (a design tool you reason inside) are the same kind of surface.
 *
 * ⚠️ SO A BIG TOTAL WAS THE WRONG TARGET. Athi's rule is "mailbox not manual": the screens a person works in
 * every day must be terse, and the ones they visit to LEARN are allowed prose. Only the first group is debt.
 *
 * ⚠️ THIS LIST IS A JUDGEMENT AND SHOULD BE ARGUED WITH, not treated as measurement. It is here so the
 * judgement is visible and revisable rather than applied silently inside a trim.
 */
const MANUAL = [
  'cap-legend.js',      /* the capability map — it exists to explain */
  'cap-readiness.js',   /* what a standard demands, and why */
  'cap-network.js',     /* a design tool: you reason inside it, you do not run your day in it */
  'cap-help.js',        /* the help itself */
  'cap-assist.js',      /* the assistant's own copy */
];
const isManual = (src) => MANUAL.some((m) => String(src).indexOf(m) >= 0);

const bucket = { LABEL: [], 'LONG LABEL': [], EXPLANATION: [] };
for (const e of entries) bucket[classify(e.msgid)].push(e);

const mailboxProse = bucket.EXPLANATION.filter((e) => !isManual(e.source));
const manualProse  = bucket.EXPLANATION.filter((e) => isManual(e.source));

const words = (arr) => arr.reduce((a, e) => a + e.msgid.trim().split(/\s+/).length, 0);
const total = entries.length;
const pct = (n) => String(Math.round((n / total) * 100)).padStart(3) + '%';

console.log('\n  WHAT THE ON-SCREEN TEXT ACTUALLY IS\n  ' + '-'.repeat(62));
for (const k of ['LABEL', 'LONG LABEL', 'EXPLANATION']) {
  console.log('  ' + k.padEnd(13) + String(bucket[k].length).padStart(4) + '  ' + pct(bucket[k].length)
    + '   ' + String(words(bucket[k])).padStart(5) + ' words');
}
console.log('  ' + '-'.repeat(62));
console.log('  TOTAL        ' + String(total).padStart(4) + '   100%   ' + String(words(entries)).padStart(5) + ' words');

/* ⭐ The number that is actually work, separated from the number that is the product doing its job. */
console.log('\n  AND OF THE EXPLANATIONS\n  ' + '-'.repeat(62));
console.log('  MAILBOX      ' + String(mailboxProse.length).padStart(4) + '         ' + String(words(mailboxProse)).padStart(5)
  + ' words   ← the debt: screens worked in daily');
console.log('  MANUAL       ' + String(manualProse.length).padStart(4) + '         ' + String(words(manualProse)).padStart(5)
  + ' words   ← legend · readiness · network · help (prose IS the job)');
console.log('  ' + '-'.repeat(62));

/* the worst offenders — longest explanations, which cost the most in every language */
const worst = mailboxProse
  .slice()
  .sort((a, b) => b.msgid.length - a.msgid.length)
  .slice(0, 15);
console.log('\n  THE LONGEST MAILBOX EXPLANATIONS — the trim list (the manual is left alone)\n');
worst.forEach((e) => console.log('   ' + e.source.padEnd(30) + e.msgid.slice(0, 88)));

const byFile = {};
for (const e of bucket.EXPLANATION) {
  const f = e.source.split(':')[0];
  byFile[f] = (byFile[f] || 0) + 1;
}
console.log('\n  WHERE THE EXPLANATIONS LIVE\n');
Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 10)
  .forEach(([f, n]) => console.log('   ' + String(n).padStart(4) + '  ' + f));
console.log('');

/* --json: per-file rows from the SAME buckets above. No second walk and no second classify call.
 * over_budget: the guard has no per-file threshold (this tool only prints totals), so it is LONG LABEL + MAILBOX
 * explanations for that file — the two piles the trim list acts on. Change it here when a real threshold exists. */
if (jsonOut) {
  const rows = {};
  const row = (f) => rows[f] || (rows[f] = { file: f, strings: 0, labels: 0, long_labels: 0, explanations: 0, words: 0, mailbox: 0 });
  const FIELD = { LABEL: 'labels', 'LONG LABEL': 'long_labels', EXPLANATION: 'explanations' };
  for (const k of Object.keys(bucket)) {
    for (const e of bucket[k]) {
      const r = row(e.source.split(':')[0]);
      r.strings++;
      r.words += e.msgid.trim().split(/\s+/).length;
      r[FIELD[k]]++;
    }
  }
  for (const e of mailboxProse) row(e.source.split(':')[0]).mailbox++;
  const files = Object.values(rows)
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
    .map((r) => ({
      file: r.file, strings: r.strings, labels: r.labels, long_labels: r.long_labels,
      explanations: r.explanations, words: r.words, over_budget: r.long_labels + r.mailbox,
    }));
  fs.writeFileSync(jsonOut, JSON.stringify({ generated: new Date().toISOString(), files }, null, 2) + '\n');
}
