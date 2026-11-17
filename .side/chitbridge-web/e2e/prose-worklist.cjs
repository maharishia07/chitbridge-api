/**
 * e2e/prose-worklist.cjs — the L3 reassembly worklist: which SENTENCES are broken into fragments, and where.
 *
 * `strings-extract.cjs` reports 154 prose + 964 fragments and stops there, correctly: it refuses to wrap a
 * fragment, because "A chit is a" translated alone comes back as confident nonsense.
 *
 * ⚠️⚠️ BUT A COUNT IS NOT A WORKLIST. 964 fragments reads as 964 jobs; it is not. Fragments are only ever
 * fragments OF something, and the something is a single line of HTML — `The <b>quantity</b> is fixed.` is one
 * sentence that the scanner sees as two or three strings. **Grouped by their line, the real job is the number
 * of SENTENCES, which is far smaller and is the unit a person actually rewrites.**
 *
 * ⭐ AND THE FIX PER SENTENCE IS ALREADY DEFINED: `txf(english, vars)` — one string with `{placeholders}`, so a
 * translator receives the whole sentence and may reorder it freely, which is the entire point in languages
 * where the verb does not sit where English puts it.
 *
 *     before   'The <b>quantity</b> is fixed.'                       ← 2 fragments, untranslatable
 *     after    txf('The {q} is fixed.', { q: '<b>' + qty + '</b>' }) ← 1 sentence, reorderable
 *
 * ⚠️ MAILBOX FIRST, exactly as with the trim. The Legend, readiness, network and help exist to explain; their
 * prose is the product working. This ranks the screens people use daily and leaves the manual until last.
 *
 * Read-only. It writes nothing and decides nothing — reassembly is editorial work on the source.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public');
const MANUAL = ['cap-legend.js', 'cap-readiness.js', 'cap-network.js', 'cap-help.js', 'cap-assist.js'];

const FILES = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) { if (!/node_modules|illustrations|docs|vendor|_design/.test(f.name)) walk(p); }
    else if (/\.(html|js)$/.test(f.name) && !/\.min\./.test(f.name)) FILES.push(p);
  }
})(ROOT);

/** A line that renders more than one run of words between tags is a sentence cut by markup. */
const lines = [];
for (const f of FILES) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const all = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  all.forEach((line, i) => {
    if (/^\s*(\*|\/\/|\/\*)/.test(line)) return;
    /**
     * ⭐⭐ INLINE MARKUP SPLITS A SENTENCE; BLOCK MARKUP SEPARATES TWO OF THEM. This is the distinction the
     * word-based tests kept missing. `The <b>quantity</b> is fixed.` is one sentence cut by an inline tag.
     * `<div>Invite ready</div><div>User ID</div><div>Share these — they set a PIN.</div>` is three finished
     * things that happen to share a source line, and gluing them into one `txf()` would hand a translator a
     * string they cannot split — the same mistake as forcing the welcome bullets together.
     *
     * ⚠️ SO THE SEPARATOR IS READ, NOT JUST THE TEXT. Runs are collected in groups, and a block-level
     * boundary between two runs starts a new group. Only a group with more than one run is a broken sentence.
     */
    const BLOCK = /<\/?(div|p|li|ul|ol|tr|td|th|table|section|button|h[1-6]|br)\b/i;
    const groups = [];
    let cur = [], lastEnd = 0;
    const RE = />([^<>{}`'"]{2,200})</g;
    let m;
    while ((m = RE.exec(line))) {
      const t = m[1].trim();
      if (!/[A-Za-z]{2}/.test(t)) continue;
      const between = line.slice(lastEnd, m.index);
      if (cur.length && BLOCK.test(between)) { groups.push(cur); cur = []; }
      cur.push(t);
      lastEnd = m.index + m[0].length;
    }
    if (cur.length) groups.push(cur);
    const runs = groups.sort((a, b) => b.length - a.length)[0] || [];
    if (runs.length < 2) return;                      /* one run = already a whole string */
    /**
     * ⚠️⚠️ A LINE THAT ALREADY CALLS txf() IS DONE, AND THIS COUNTED IT AS OUTSTANDING. The placeholder VALUES
     * of a finished reassembly — `{ bp: '<b>blueprint</b>', products: '<b>products</b>' }` — look exactly like
     * the fragments they replaced, because they ARE the same markup, now passed as arguments instead of
     * spliced into a sentence.
     *
     * ⭐ So the count could never reach zero: every sentence fixed added itself straight back to the worklist.
     * A tracker that reports completed work as remaining is worse than no tracker — it makes finishing look
     * impossible, and the natural response is to stop believing the number.
     */
    /* ⚠️ AND THE CALL USUALLY OPENS ON AN EARLIER LINE — a reassembly is written as `txf('…',` then the
       placeholder object beneath it, so the args line carries the markup and none of the call. Looking only at
       the line itself skipped none of them. */
    const near = [line, all[i - 1] || '', all[i - 2] || '', all[i - 3] || ''].join('\n');
    if (/\btxf\(/.test(near)) return;
    /* ⚠️ AND IT MUST LOOK LIKE PROSE, not a row of buttons. A sentence has terminal punctuation somewhere in
       it, or a run that is clearly mid-sentence (starts lowercase). Three <button> labels on one line are
       three labels, not a broken sentence — counting those would inflate the job with work that does not
       exist. */
    /**
     * ⚠️⚠️ `OR` COUNTED 43 LABEL ROWS AS BROKEN SENTENCES IN app.html ALONE. "Recipients · To acts · is
     * informed · = on behalf of" is a legend strip: four separate labels sharing one source line, each already
     * a whole translatable unit. Reassembling it into a `txf()` would invent a sentence nobody wrote.
     *
     * ⭐ THE TEST IS `AND`, and both halves are load-bearing. Terminal punctuation says a sentence exists on
     * this line; a run STARTING LOWERCASE says a sentence was CUT — "…is informed" cannot be the beginning of
     * anything. Either alone is a guess; together they describe the actual fault.
     *
     * ⚠️ IT WILL MISS SOME — a sentence split so that every part happens to start with a capital reads as
     * labels. Under-counting the job is the safe direction here: the cost of a miss is one sentence left in
     * English, and the cost of a false positive is prose invented on a screen.
     */
    const joined = runs.join(' ');
    const looksProse = /[.!?]/.test(joined) && runs.some((r) => /^[a-z]/.test(r));
    if (!looksProse) return;
    lines.push({ rel, n: i + 1, runs, words: joined.split(/\s+/).length });
  });
}

/**
 * ⚠️ THE DEMO PAGES ARE NOT THE PRODUCT. `design-mock`, `iot-howitworks`, `know-your-business`, `cart-design`
 * and friends are standalone showcase HTML — pitch surfaces, opened deliberately, never part of anyone's
 * working day. Counting their 40-odd sentences as translation debt inflates the job by a sixth with work
 * that would never be worth doing: nobody needs the IoT explainer in Tamil before the chit list.
 */
const DEMO = /^(?!app\.html$)(?!app\/).*\.html$/;
const isDemo = (rel) => DEMO.test(rel);
const isManual = (rel) => MANUAL.some((m) => rel.indexOf(m) >= 0);
const demo = lines.filter((l) => isDemo(l.rel));
const mailbox = lines.filter((l) => !isDemo(l.rel) && !isManual(l.rel));
const manual = lines.filter((l) => !isDemo(l.rel) && isManual(l.rel));
const frags = (arr) => arr.reduce((a, l) => a + l.runs.length, 0);

console.log('\n  THE REASSEMBLY JOB, AS SENTENCES RATHER THAN FRAGMENTS\n  ' + '-'.repeat(64));
console.log('  MAILBOX   ' + String(mailbox.length).padStart(4) + ' sentences   ' + String(frags(mailbox)).padStart(4)
  + ' fragments   ' + String(mailbox.reduce((a, l) => a + l.words, 0)).padStart(5) + ' words');
console.log('  MANUAL    ' + String(manual.length).padStart(4) + ' sentences   ' + String(frags(manual)).padStart(4)
  + ' fragments   ' + String(manual.reduce((a, l) => a + l.words, 0)).padStart(5) + ' words');
console.log('  DEMO      ' + String(demo.length).padStart(4) + ' sentences   ' + String(frags(demo)).padStart(4) + ' fragments   ' + String(demo.reduce((a, l) => a + l.words, 0)).padStart(5) + ' words   ← showcase pages, not the product');
console.log('  ' + '-'.repeat(64));
console.log('  TOTAL     ' + String(lines.length).padStart(4) + ' sentences   ' + String(frags(lines)).padStart(4) + ' fragments\n');

const byFile = {};
mailbox.forEach((l) => { byFile[l.rel] = (byFile[l.rel] || 0) + 1; });
console.log('  WHERE THE MAILBOX SENTENCES ARE\n');
Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 10)
  .forEach(([f, n]) => console.log('   ' + String(n).padStart(4) + '  ' + f));

console.log('\n  WORST FIRST — most fragments in one sentence\n');
mailbox.slice().sort((a, b) => b.runs.length - a.runs.length).slice(0, 12).forEach((l) => {
  console.log('   ' + (l.rel + ':' + l.n).padEnd(26) + l.runs.length + ' parts   ' + l.runs.join(' ¦ ').slice(0, 84));
});
console.log('');
