/**
 * ── tests/exports-exist.test.cjs · A MODULE'S CALLERS MUST FIND WHAT THEY CALL ────────────────────────────────
 *
 * ⚠️⚠️ THE FAULT THIS EXISTS FOR, found 2026-09-11 and live in production for six days:
 *
 * On 2026-08-17 `lib/units.js` gained `normUnit()` and a multilingual alias table, on Athi's approval, because
 * `கிலோ` and `kg` were two different units to every totalling path and SIX ITEMS ON THE LIVE SHOP were wrong.
 * On 2026-09-05 the file was rewritten around UN/ECE Rec 20 and GST UQC codes — a good change — and `normUnit`
 * went with it. `lib/consolidate.js` still called `uom.normUnit()` at three places, so every wholesaler
 * consolidation threw `TypeError: uom.normUnit is not a function`, on a path `routes/capture.js` reaches from
 * every WhatsApp message that arrives.
 *
 * ⭐⭐ NOTHING CAUGHT IT, AND THREE THINGS SHOULD HAVE. Two tests went red that day — and stayed red among
 * twenty-six other reds, where a genuine regression is indistinguishable from stale tooling until somebody
 * reads all of them. JavaScript gives no error for reading a missing property; you get `undefined`, and the
 * failure arrives later, somewhere else, as a TypeError.
 *
 * ⭐ SO THIS IS THE CHEAPEST POSSIBLE TYPE CHECK, AND IT IS ENOUGH. For every one of our own modules that
 * another file requires under a name, every property called on that name must actually be exported. It cannot
 * check argument types, return shapes or anything subtle — it catches exactly the class above, which is the
 * class that has actually happened.
 *
 * Run: node tests/exports-exist.test.cjs   · no network, no DB.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const API = path.join(__dirname, '..');
let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };

/**
 * ⚠️ LOADED, NOT PARSED. `module.exports` is assembled in half a dozen shapes here — an object literal, a
 * spread, a getter (`get pool()`), properties bolted on afterwards. Reading the text would mean reimplementing
 * JavaScript badly; requiring the module asks it what it exports and gets the truth.
 */
function exportsOf(rel) {
  const p = path.join(API, rel);
  if (!fs.existsSync(p)) return null;
  try {
    const m = require(p);
    if (!m || (typeof m !== 'object' && typeof m !== 'function')) return null;
    const keys = new Set(Object.keys(m));
    /* a function module (module.exports = fn) still has properties hung off it */
    Object.getOwnPropertyNames(m).forEach((k) => keys.add(k));
    return keys;
  } catch (_) {
    /* ⚠️ a module that cannot load here (needs a live DB, a key) is SKIPPED and reported, never assumed fine */
    return null;
  }
}

/** every `const NAME = require('../lib/x')` in a file, as [localName, relativeModulePath] */
function importsIn(src) {
  const out = [];
  /**
   * ⚠️ THE TRAILING PROPERTY MATTERS. `const eng = require('../lib/offers-engine').CBOffers` binds `eng` to
   * CBOffers, not to the module — so checking `eng.evaluate` against the MODULE's exports reported three
   * faults that were not. The import only counts when the require ends the expression.
   */
  /**
   * ⚠️⚠️ AND IT MUST SEE A SIBLING. The first version only matched `../lib/x`, so it missed every require
   * INSIDE lib/ — where a sibling is `./x`. That is exactly where the bug was: `lib/consolidate.js` does
   * `require('./units')`. The red-check caught this: removing `normUnit` from the exports produced no failure
   * at all, which is the only reason I know the guard was decoration. ⭐ Run the red-check. Always.
   */
  const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"](\.\.?\/[a-z0-9\-/]+)['"]\s*\)\s*(?=[;\n]|$)/g;
  let m;
  while ((m = re.exec(src))) out.push([m[1], m[2]]);
  return out;
}

const scan = [];
['lib', 'routes'].forEach((dir) => {
  const d = path.join(API, dir);
  if (!fs.existsSync(d)) return;
  fs.readdirSync(d).filter((f) => /\.(js|cjs)$/.test(f))
    .forEach((f) => scan.push(path.join(dir, f)));
});

const missing = [];
const skipped = [];
/* ⚠ comments are full of prose like "normUnit, NOT norm" — stripping them first, or every note becomes a bug */
const code = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

scan.forEach((rel) => {
  const src = code(fs.readFileSync(path.join(API, rel), 'utf8'));
  importsIn(src).forEach(([local, mod]) => {
    /* ⚠ resolved against the FILE's own directory, which is the only way `./units` from inside lib/ lands on
       lib/units.js rather than on a path that does not exist */
    const target = path.relative(API, path.resolve(path.join(API, path.dirname(rel)), mod)).split(path.sep).join('/');
    if (!/^(lib|middleware)\//.test(target)) return;        /* our own modules only, not node_modules or db */
    const keys = exportsOf(target + '.js');
    if (!keys) { skipped.push(rel + ' → ' + target); return; }
    /**
     * ⚠️⚠️ TWO NARROWINGS, BOTH LEARNED FROM THE FIRST RUN, WHICH REPORTED FIFTEEN FAULTS AND HAD NONE.
     *
     * 1 · ONLY A CALL. `access.rows` and `identity.display_name` are properties of a query RESULT and a row;
     *     they merely happen to share a name with an imported module. Requiring `(` after the property means
     *     this looks at functions being invoked, which is the thing that throws.
     * 2 · NOT A SHADOWED NAME. If the file declares that identifier again anywhere — `const eng = ...` inside a
     *     handler — then every use of it might be the local one, and this guard cannot tell which. It skips,
     *     rather than guessing: a guard that cries wolf on fifteen good files gets switched off, and then it is
     *     not there on the day it is right.
     */
    const declared = (src.match(new RegExp('(?:const|let|var)\\s+' + local.replace(/\$/g, '\\$') + '\\s*=', 'g')) || []).length;
    if (declared > 1) { skipped.push(rel + ' → ' + target + ' (name reused locally)'); return; }
    const used = new Set();
    const re = new RegExp('\\b' + local.replace(/\$/g, '\\$') + '\\.([A-Za-z_$][\\w$]*)\\s*\\(', 'g');
    let m;
    while ((m = re.exec(src))) used.add(m[1]);
    used.forEach((k) => {
      if (!keys.has(k)) missing.push(rel + ':  ' + local + '.' + k + '()  — ' + target + '.js does not export ' + k);
    });
  });
});

console.log('— every property called on one of our modules is a property it exports —');

it('⭐⭐⭐ no file calls a function its dependency does not export', () => {
  assert.deepStrictEqual(missing, [],
    'JavaScript will not tell you about these — you get undefined, and a TypeError later, somewhere else');
});

it('⚠️ and the modules this could not check are named, not assumed fine', () => {
  /* ⚠️ A guard that silently skips what it cannot load reports green over an unknown. Naming them is the
     difference between "checked" and "did not check". */
  const unique = [...new Set(skipped)];
  console.log('        ' + scan.length + ' files scanned · ' + unique.length + ' import(s) unreadable here'
    + (unique.length ? ':' : ''));
  unique.slice(0, 8).forEach((s) => console.log('          ' + s));
  assert.ok(unique.length < scan.length, 'nothing could be loaded — the check is not running at all');
});

console.log('\n  ' + pass + ' checks\n');
