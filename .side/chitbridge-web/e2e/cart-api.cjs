/**
 * cart-api.cjs — `lines()` is a COUNT. Anything treating it as an array is a dead feature.
 *
 * ⚠️⚠️ WHY THIS EXISTS: THE SAME BUG, TWICE, EIGHTEEN DAYS APART, IN TWO SCREENS.
 *
 *   worklist  `(cart.lines() || []).map(...)`      → "map is not a function" on a number, into its own catch.
 *                                                    Pressing "Add to this line" recorded nothing and flashed a
 *                                                    failure toast. The commit never worked at all.
 *   own stock `cart.lines().length ? null : ...`   → `.length` of a number is undefined, so the guard was falsy
 *                                                    whatever the cart held. The primary button could never
 *                                                    enable: the row showed a quantity, the bar said "1 ₹100",
 *                                                    and the footer went on saying "Add at least one item."
 *
 * ⭐ THE FIRST ONE WAS DOCUMENTED AND NOT GUARDED. `app/pick.js` carries a careful paragraph explaining exactly
 * this, and the next branch written repeated it anyway — because the next author was reading the CART's API, not
 * the picker's comment. A comment protects the file it is in. This protects every file.
 *
 * ⚠️ AND BOTH FAIL SILENTLY, which is what makes the class worth a build failure rather than a note: neither
 * threw anywhere a person would see. One swallowed its exception, the other simply never enabled a button. There
 * is no stack trace to follow back — the screen just quietly does nothing, and reads as "it hangs".
 *
 *   lines()    → a COUNT   (Object.keys(sel).length)      — truthiness tests only
 *   selected() → the ROWS  (priced, with quantities)      — anything that maps, filters or reads a field
 *
 * Run: node e2e/cart-api.cjs        (exit 1 on any misuse)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'public');
const FILES = ['app.html'].concat(
  fs.readdirSync(path.join(WEB, 'app')).filter((f) => f.endsWith('.js')).map((f) => 'app/' + f)
);

/* Any member access or call on the RESULT of lines(). A count has no members worth reading — `.length`, `.map`,
   `.filter`, `.forEach`, `[0]` are all the array mistake wearing different clothes. */
const DIRECT = /\.lines\(\)\s*(?:\.\s*[A-Za-z_$][\w$]*|\[)/;

/**
 * ⚠️ AND THE WORKLIST'S ACTUAL SHAPE SLIPS PAST THAT ONE, which I found only by testing the guard against the two
 * lines it exists to catch. In `(cart.lines() || []).map(...)` the `.map` attaches to the PARENTHESIS, not to the
 * call, so nothing follows `lines()` at all. A guard written from the description of a bug rather than from its
 * source catches the bug you imagined.
 *
 * ⭐ `|| []` is the tell, and it needs no lookahead: defaulting a COUNT to an ARRAY is wrong on its own terms,
 * whatever is done with it afterwards. Nobody writes that except when they believe rows are coming back.
 */
const DEFAULTED = /\.lines\(\)\s*\)?\s*\|\|\s*\[/;
const MISUSE = (s) => DIRECT.test(s) || DEFAULTED.test(s);

const bad = [];
for (const rel of FILES) {
  const lines = fs.readFileSync(path.join(WEB, rel), 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    /* ⚠️ The guard's own prose names the pattern it forbids — skip comments, or the file that explains the bug
       becomes the file that fails the build. */
    if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) continue;
    if (MISUSE(lines[i])) bad.push({ rel, line: i + 1, src: lines[i].trim().slice(0, 110) });
  }
}

console.log('\n══ CART API ══');
console.log('  ' + FILES.length + ' file(s) scanned for lines() used as though it returned rows\n');
for (const b of bad) {
  console.log('  ✗ ' + b.rel + ':' + b.line);
  console.log('      ' + b.src);
  console.log('      lines() is a count — use selected() for the rows\n');
}
if (!bad.length) console.log('  ✓ every lines() is read as the count it is\n');
process.exit(bad.length ? 1 : 0);
