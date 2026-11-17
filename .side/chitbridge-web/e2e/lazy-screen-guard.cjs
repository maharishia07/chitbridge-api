'use strict';
/**
 * lazy-screen-guard.cjs — A LAZY SCREEN IS NEVER CALLED BEFORE IT EXISTS.
 *
 * Athi, 2026-08-23: *"I have moved from task tab to coassist tab, right side still showing task data.
 * Co-assist data should come in the right side — the same consistency issue here."*
 *
 * ⚠️⚠️ ELEVEN OF SIXTEEN LAZY SCREENS CALLED THEIR RENDERER WITH NO GUARD. `cap-workforce.js` and its
 * siblings load on demand, so the FIRST visit to any of those screens evaluated an undeclared identifier and
 * threw a ReferenceError **mid-render**. The shell and the nav had already painted — which is why the left
 * half looked right — and the body never completed, so the PREVIOUS screen's `#detailpane` survived on the
 * right. Clicking a row then worked, because by that point the capability had arrived.
 *
 * ⭐ That signature is worth remembering: **left updates, right is stale, and interacting fixes it** means a
 * first-paint failure, not a screen rendering the wrong data. It reads like a data bug and is a timing bug.
 *
 * ⚠️ `typeof fn === 'function'` CANNOT SAVE YOU HERE and that is the subtle part — evaluating the identifier
 * in order to test it is the thing that throws. Only a lookup by NAME on the global object is safe to ask
 * before the script exists, which is why `capScreen('fooScreen')` takes a string.
 */
const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');

const m = /const CAP_OF = \{([^}]*)\}/.exec(APP);
if (!m) { console.error('  x could not find CAP_OF — has the lazy-screen contract moved?'); process.exit(1); }
const navs = [...m[1].matchAll(/(\w+)\s*:\s*'[\w-]+'/g)].map((x) => x[1]);

const fails = [];
let checked = 0;

for (const nav of navs) {
  const re = new RegExp('UI\\.nav===["\']' + nav + '["\'][^\\n]*', 'g');
  for (const line of (APP.match(re) || [])) {
    if (!/return\s+\w+Screen\s*\(/.test(line)) continue;      // not a render line
    checked++;
    /* Safe forms: capScreen("name"), or an explicit typeof test on the same line. */
    if (/capScreen\(\s*["']/.test(line)) continue;
    if (/typeof\s+\w+Screen\s*===\s*["']function["']/.test(line)) continue;
    fails.push(`${nav}: calls its renderer unguarded — ${line.trim().slice(0, 90)}`);
  }
}

console.log('\n── a lazy screen is never called before it exists ──');
console.log(`  ${navs.length} lazy screens declared in CAP_OF · ${checked} render lines checked`);
fails.forEach((f) => console.error('  x ' + f));
if (!fails.length) console.log('  OK — every lazy screen renders through capScreen() or a typeof test\n');
else console.error('\n  Use capScreen("fooScreen"). Evaluating the identifier to test it is what throws.\n');

process.exit(fails.length ? 1 : 0);
