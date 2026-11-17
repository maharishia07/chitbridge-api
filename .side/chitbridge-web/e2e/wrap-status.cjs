/**
 * e2e/wrap-status.cjs — which translatable labels are actually wrapped in tx(), and which are still bare.
 *
 * L3, second half. `strings-extract.cjs` decides WHAT is translatable and sorts it into LABEL (safe to wrap
 * today) · PROSE · FRAGMENT. It does not say whether the label has been wrapped yet — so "99 safe to wrap"
 * has been read for weeks as "99 to do" when some were already done.
 *
 * ⭐ THE ENGLISH IS THE KEY (gettext). `tx('Save')` looks up 'Save' in the active pack and returns the English
 * when there is no entry — so WRAPPING IS SAFE ON ITS OWN. A wrapped-but-untranslated label is exactly what it
 * was before, and becomes translatable the moment a pack learns the key. Wrapping and translating are two
 * jobs, and only the first one is mechanical.
 *
 * ⚠️⚠️ AND THE FIRST VERSION OF THIS FILE ASKED A QUESTION THAT COULD ONLY HAVE ONE ANSWER. It reported
 * "0 wrapped, 99 bare" and I nearly published that as a finding. The extractor matches `>text<` where the text
 * contains no `{`, `}`, quote or backtick — so `${tx('Save')}` can NEVER appear in the catalogue. **Every entry
 * is unwrapped by construction**, and measuring that proves nothing.
 *
 * ⭐ A CHECK WHOSE RESULT IS DETERMINED BY ITS INPUT FILTER IS NOT A MEASUREMENT. It is the same species as a
 * scan that under-matches and reports its blindness as fact — this one just fails in the tidy direction, where
 * the number looks precise.
 *
 * ⭐ SO IT REPORTS THE RATIO INSTEAD: how many `tx(` call sites exist against how many bare labels remain.
 * That IS progress, because the two numbers come from different places and neither constrains the other.
 */
const fs = require('fs');
const path = require('path');

const CAT = path.join(__dirname, 'strings.catalogue.json');
const W = path.join(__dirname, '..', 'public');

if (!fs.existsSync(CAT)) {
  console.error('  run strings-extract.cjs first — no catalogue at ' + CAT);
  process.exit(1);
}
const entries = JSON.parse(fs.readFileSync(CAT, 'utf8'));

const cache = {};
const lines = (f) => cache[f] || (cache[f] = fs.readFileSync(path.join(W, f), 'utf8').split(/\r?\n/));

/* ── how much IS wrapped: count real tx() call sites across the shipped source ────────────────────────── */
const SRC = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) { if (!/node_modules|vendor|illustrations/.test(f.name)) walk(p); }
    else if (/\.(html|js)$/.test(f.name) && !/\.min\./.test(f.name)) SRC.push(p);
  }
})(W);
let calls = 0;
for (const f of SRC) calls += (fs.readFileSync(f, 'utf8').match(/\btx\(/g) || []).length;

/* the catalogue is the bare set by construction — see the note above; it is a WORKLIST, not a verdict */
const bare = entries.slice();

console.log('\n  THE WRAP, AS A RATIO\n');
console.log('    tx() call sites   ' + String(calls).padStart(5) + '   already speaking through the string layer');
console.log('    bare labels       ' + String(bare.length).padStart(5) + '   ← the worklist: mechanical, no judgement needed');
console.log('    share wrapped     ' + String(Math.round((calls / (calls + bare.length)) * 100)).padStart(4) + '%\n');

if (bare.length) {
  console.log('  STILL BARE\n');
  const byFile = {};
  bare.forEach((e) => {
    const f = e.source.slice(0, e.source.lastIndexOf(':'));
    (byFile[f] = byFile[f] || []).push(e);
  });
  Object.entries(byFile).sort((a, b) => b[1].length - a[1].length).forEach(([f, list]) => {
    console.log('   ' + String(list.length).padStart(3) + '  ' + f);
    list.slice(0, 6).forEach((e) => console.log('        ' + e.source.split(':').pop().padStart(6) + '  ' + JSON.stringify(e.msgid)));
    if (list.length > 6) console.log('        ' + '     …'.padStart(6) + '  and ' + (list.length - 6) + ' more');
  });
}
console.log('');
