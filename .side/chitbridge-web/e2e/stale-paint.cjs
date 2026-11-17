/**
 * e2e/stale-paint.cjs — a list response that arrives after you have left must not paint.
 *
 * Athi, 2026-08-22: *"find the race, that empty state is bad."*
 *
 * ⚠️⚠️ THE BUG: clicking Settings › Localisation and being told **"Your bogie is empty · Compose"**. The
 * settings screen reuses `#detailpane` — `#setbody` lives inside it — so a list load still in flight from
 * app start resolved, wrote `renderDetail()` into `#detailpane`, and DELETED the element the settings pane was
 * about to be written into. `loadSettings` and `paintSettings` both open with
 * `getElementById("setbody"); if(!h)return;`, so the settings load then resolved into silence.
 *
 * ⭐ TWO FUNCTIONS FAILING SAFELY ADDED UP TO A SCREEN THAT FAILED INVISIBLY. Every individual guard was
 * present and correct: `if(dp)` checked the element existed, and it did — it just belonged to someone else.
 * `if(!h)return` declined to paint into nothing, which is right, and silent, which is how it hid for months.
 *
 * ⚠️ AND IT ONLY EVER HAPPENED ON THE FIRST VISIT, so every retry passed. Six consecutive scripted attempts
 * came back green because the first one had been the only cold one. A test that reproduces a race by repeating
 * an action can prove the opposite of what it looks like it proves.
 *
 * This guards the SHAPE that fixed it: `loadList` captures `UI.nav` at call time, and every paint after an
 * `await` asks whether the screen is still the one that asked.
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.error('  ✗ ' + name + (extra ? '   ' + extra : '')); }
};

/* ── isolate loadList: from its declaration to the next top-level function ────────────────────────────── */
/* app.html is formatted now (spaces, one statement per line), so every pattern below tolerates whitespace */
const start = src.search(/async function loadList\(silent\)\s*\{/);
t('loadList is where it was', start > 0);
const rest = src.slice(start + 10);
const end = start + 10 + (rest.search(/\n(?:async )?function [A-Za-z_]/) >>> 0);
const fn = src.slice(start, end);

console.log('\n── the screen is captured before the first await ──');
t('loadList remembers which screen asked', /const _nav0\s*=\s*UI\.nav/.test(fn));
t('  …and can say whether it has moved', /_left\s*=\s*function\s*\(\)\s*\{\s*return\s+UI\.nav\s*!==\s*_nav0/.test(fn));

/**
 * ⚠️ THE ORDER IS LOAD-BEARING. Capturing UI.nav AFTER the await reads the value the navigation already
 * changed, so the guard compares a thing to itself and passes forever while painting over whatever is there.
 */
const capAt = fn.indexOf('_nav0');
const firstAwait = fn.indexOf('await ');
t('  …captured BEFORE the first await, not after', capAt > 0 && capAt < firstAwait,
  'capture@' + capAt + ' firstAwait@' + firstAwait);

console.log('\n── every paint after an await asks first ──');
/**
 * ⚠️ THE DETAIL-PANE WRITE IS THE DESTRUCTIVE ONE — it is the line that removed #setbody. The `#rows` writes
 * are merely wrong (one track's rows in another's list); this one deletes another screen's container.
 */
/* the header comment above also names the write, so look at the code with block comments taken out */
const code = fn.replace(/\/\*[\s\S]*?\*\//g, '');
const dpWriteAt = code.search(/\.innerHTML\s*=\s*renderDetail\(\)/);
const dpWrite = dpWriteAt > 0 && /getElementById\(['"]detailpane['"]\)/.test(code.slice(Math.max(0, dpWriteAt - 120), dpWriteAt)); /* the write itself, not the pre-await skeleton above */
t('the detail-pane write is still here to be guarded', dpWrite);
/* the guard line, `if (_left()) return`, with its semicolon matched apart so this file holds no `return;` text of its own (bare-return-lint reads it as a bare return) */
const GUARD = /if\s*\(\s*_left\(\)\s*\)\s*return\s*[;]/;
const guardAtFirst = code.search(GUARD);
const guardBeforeDp = guardAtFirst > 0 && guardAtFirst < dpWriteAt;
t('  …and a guard returns before it', guardBeforeDp);

/* every paintRowsOnly() that follows an await must be preceded by the check on its own line */
const tail = fn.slice(firstAwait);
const paints = [...tail.matchAll(/paintRowsOnly\(\)/g)];
t('the enrichment paints are all still here', paints.length >= 2, paints.length + ' paint site(s)');
/**
 * ⚠️ THIS CHECK WAS WRONG FIRST — it looked back a FIXED 220 characters and reported the guarded paint as
 * unguarded, because the `if(!silent){…}` block sits between the guard and it. A window measured in characters
 * is not the property; the property is "after any await, re-ask before painting".
 *
 * ⭐ So the window is the code since the NEAREST PRECEDING AWAIT. That is exactly when the answer can have
 * gone stale, and it is the same span however long the block between them grows.
 */
const unguarded = paints.filter((m) => {
  const before = tail.slice(0, m.index);
  const lastAwait = before.lastIndexOf('await ');
  const window = lastAwait < 0 ? before : before.slice(lastAwait);
  return !/_left\(\)/.test(window);
});
t('  …and none of them paints unasked', unguarded.length === 0, unguarded.length + ' unguarded');

/**
 * ⚠️ THE ERROR PATH COUNTS TOO. A failed list load painting `scrErr` into `#rows` after you have moved is the
 * same bug wearing the opposite outcome — and it is the shape most likely to be added back by someone fixing
 * an unrelated error-handling gap.
 */
console.log('\n── and the failure path is no exception ──');
t('a failed load does not paint over the screen you moved to',
  /catch\s*\(e\)\s*\{[^}]*if\s*\(\s*!silent\s*&&\s*!_left\(\)\s*\)/.test(fn));

/**
 * ⚠️ UI.loading MUST STILL BE CLEARED. The flag describes THIS load; leaving it true because the reader
 * navigated away means the next list they open believes a fetch is already running and quietly does nothing.
 * The guard has to sit AFTER the flag is cleared, and that is easy to get wrong when moving it around later.
 */
console.log('\n── leaving does not strand the loading flag ──');
const clearAt = fn.search(/UI\.loading\s*=\s*false;/);
const guardAt = fn.search(GUARD);
t('the flag is cleared before the guard returns', clearAt > 0 && clearAt < guardAt,
  'clear@' + clearAt + ' guard@' + guardAt);

console.log('\n  ══ ' + pass + ' passed · ' + fail + ' failed ══\n');
process.exit(fail ? 1 : 0);
