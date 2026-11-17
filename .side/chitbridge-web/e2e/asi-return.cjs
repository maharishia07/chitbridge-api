/**
 * e2e/asi-return.cjs — nothing may sit between `return` and the value it returns.
 *
 * ⚠️⚠️ THE BUG THIS EXISTS FOR. `_locPendingBar()` — the "Not saved yet" bar on Settings › Localisation —
 * was written as:
 *
 *     return /* a three-line explanation of the colour choice … *\/
 *       '<div data-testid="loc-pending" …'
 *
 * A block comment containing a newline counts as a LINE TERMINATOR, so AUTOMATIC SEMICOLON INSERTION rewrote
 * the statement as a bare `return;`. The function returned `undefined`, every line of the bar below it became
 * unreachable, and `_locPendingBar() + _localeSettingsBody()` rendered the literal word **"undefined"** at the
 * top of the pane.
 *
 * ⭐ NOTHING THREW AND NOTHING LOGGED. The code parses, lints clean, and reads correctly to a human — the
 * comment is exactly where a careful author would put it. Only the runtime disagrees.
 *
 * ⭐⭐ AND IT PICKED THE WORST POSSIBLE FUNCTION. The bar is the confirmation that a change is HELD AND NOT
 * YET SAVED. Staging still worked, so the change was real; the only thing missing was the part that said so.
 * You would change a setting, see no confirmation, and reasonably conclude it had already saved.
 *
 * ⚠️ THE PLAIN FORM IS THE SAME BUG — `return` then a newline then a value — and is the one every style guide
 * warns about. This checks both, because the comment form is the one that survives review.
 */
const fs = require('fs');
const path = require('path');

const W = path.join(__dirname, '..', 'public');
const files = ['app.html'].concat(
  fs.readdirSync(path.join(W, 'app')).filter((f) => f.endsWith('.js')).map((f) => path.join('app', f)));

let pass = 0, fail = 0;
const bad = [];

for (const rel of files) {
  const src = fs.readFileSync(path.join(W, rel), 'utf8');
  const lines = src.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    /* a line that is itself comment text (a header comment ending in the word "return") is prose, not a statement */
    if (/^\s*(\*|\/\/)/.test(line)) continue;

    /**
     * ⚠️ `return` MUST BE THE WHOLE STATEMENT to be suspicious. `return x;`, `return {…}` and `return (` are
     * all fine — the value is on the same line. Only a `return` with nothing of substance after it is a
     * candidate, and then only when the next real token sits on a LATER line.
     */
    const m = line.match(/(^|[\s;{}()])return[ \t]*(\/\*.*)?$/);
    if (!m) continue;

    /* an intentional bare `return;` is not a bug */
    if (/(^|[\s;{}()])return[ \t]*;/.test(line)) continue;

    /* find the next line carrying anything other than comment text */
    let j = i + 1, guard = 0;
    while (j < lines.length && guard++ < 60) {
      const t = lines[j].trim();
      if (!t || t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) { j++; continue; }
      break;
    }
    if (j >= lines.length) continue;
    const next = lines[j].trim();

    /**
     * ⚠️ A CLOSING BRACE MEANS THE `return` REALLY WAS BARE — `return\n}` is an early exit someone wrote
     * without a semicolon. Flagging it would bury the real finding in noise.
     */
    if (/^[})\]]/.test(next)) continue;

    bad.push(rel + ':' + (i + 1) + '  return … then line ' + (j + 1) + ': ' + next.slice(0, 70));
  }
}

console.log('\n── `return` and its value must share a line ──');
if (!bad.length) {
  pass++;
  console.log('  ✓ every return keeps hold of what it returns   ' + files.length + ' file(s) scanned');
} else {
  fail++;
  console.error('  ✗ ' + bad.length + ' return statement(s) the parser will cut short:');
  bad.forEach((b) => console.error('      ' + b));
  console.error('\n    Move the value up to the `return`, or wrap it in parentheses. A block comment counts');
  console.error('    as a line terminator, so putting one after `return` has the same effect as a newline.');
}

/**
 * ⚠️ AND THE GUARD ITSELF MUST BE CHECKED AGAINST A KNOWN ANSWER — every scan I wrote today was wrong before
 * it was right, always by under-matching, and an under-matching scan reports its own blindness as a clean
 * bill of health. This feeds it the exact broken shape and fails if it comes back clean.
 */
console.log('\n── the scanner catches the shape it was built for ──');
const SPECIMEN = [
  'function f() {',
  '  return /* an explanation',
  '     that runs over lines */',
  "    '<div>value</div>';",
  '}',
].join('\n');
const specLines = SPECIMEN.split('\n');
let caught = false;
for (let i = 0; i < specLines.length; i++) {
  if (!/(^|[\s;{}()])return[ \t]*(\/\*.*)?$/.test(specLines[i])) continue;
  if (/(^|[\s;{}()])return[ \t]*;/.test(specLines[i])) continue;
  let j = i + 1;
  while (j < specLines.length) {
    const t = specLines[j].trim();
    if (!t || t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) { j++; continue; }
    break;
  }
  if (j < specLines.length && !/^[})\]]/.test(specLines[j].trim())) caught = true;
}
if (caught) { pass++; console.log('  ✓ a planted `return` + multi-line comment is reported'); }
else { fail++; console.error('  ✗ the planted specimen was NOT reported — this scan proves nothing'); }

console.log('\n  ══ ' + pass + ' passed · ' + fail + ' failed ══\n');
process.exit(fail ? 1 : 0);
