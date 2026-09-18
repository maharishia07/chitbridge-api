/**
 * one-name-one-function.test.cjs — TWO FUNCTIONS, ONE NAME, AND THE LOSER VANISHES (2026-09-18).
 *
 * ⚠️⚠️ THE BUG THIS EXISTS FOR. A helper was added to till.html called `offerWords(i)` — the MRP gap in three
 * words, for the quick-key tiles. There was already an `offerWords(st, shown)` four hundred lines further down,
 * about whether an OFFER reaches a product. Both are top-level `function` declarations in one script, so the
 * second hoisted over the first and every key on the counter printed
 *
 *     "off — the offer does not reach this product"
 *
 * under its price. Nothing threw. Nothing was logged. The page parsed cleanly, the guards passed, the vendored
 * copy matched its master, and the only reason it was caught is that Athi was looking at the screen.
 *
 * ⚠️ WHY NO OTHER GUARD SEES THIS. A syntax check is happy — redeclaring a function is legal JavaScript. A
 * grep for the new name finds it. The failure lives in which of two identical names WINS, and that is only
 * visible if something counts them. [[feedback-duplicate-function-hoisting]] [[feedback-silence-is-the-bug]]
 *
 * Run: node tests/one-name-one-function.test.cjs   · no DB, no network.
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');

let pass = 0;
const it = (what, fn) => {
  try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; }
};

/** the one inline <script> the counter carries */
function scriptOf(file) {
  const html = fs.readFileSync(file, 'utf8');
  const blocks = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(blocks.length, file + ' has no inline script');
  return blocks.join('\n');
}

/**
 * Top-level `function name(` declarations only — a nested one is scoped and shadows nothing outside itself.
 * Column 0 is the whole test: everything in this file that means to be callable from an onclick is written flush
 * left, and anything indented is inside something else.
 */
function topLevelNames(src) {
  const seen = new Map();
  src.split('\n').forEach((line, n) => {
    const m = /^function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(line);
    if (!m) return;
    const at = seen.get(m[1]) || [];
    at.push(n + 1);
    seen.set(m[1], at);
  });
  return seen;
}

const FILES = [
  ['the counter (master)', path.join(API, 'tools', 'tally-connector', 'till.html')],
  ['the counter (vendored)', path.join(API, '..', 'chitbridge-web', 'public', 'till.html')],
];

console.log('— one name, one function —');

FILES.forEach(([label, file]) => {
  if (!fs.existsSync(file)) { console.log('  --  ' + label + ' is not here, skipped'); return; }
  const names = topLevelNames(scriptOf(file));

  it('⚠️⚠️ ' + label + ' declares no name twice', () => {
    const dupes = [...names.entries()].filter(([, at]) => at.length > 1);
    assert.strictEqual(dupes.length, 0,
      'these names are declared more than once, and only the LAST one runs:\n      '
      + dupes.map(([nm, at]) => nm + '  (lines ' + at.join(', ') + ')').join('\n      '));
  });

  it('⭐ ' + label + ' — the guard can actually see a clash', () => {
    /* ⚠️ BREAK IT BEFORE TRUSTING IT. A counter that always reports zero is not a guard.
       [[feedback-whitelist-drops-silently]] */
    const planted = topLevelNames('function a(){}\nfunction b(){}\n  function a(){}\nfunction a(){}\n');
    assert.deepStrictEqual(planted.get('a'), [1, 4], 'the indented one must NOT count — it is nested');
    assert.strictEqual(planted.get('b').length, 1);
  });
});

it('⭐ and it is looking at a real file with real functions in it', () => {
  const names = topLevelNames(scriptOf(FILES[0][1]));
  assert.ok(names.size > 200, 'only ' + names.size + ' top-level functions found — the reader is probably broken');
  assert.ok(names.has('paintCart'), 'paintCart not seen — the reader is not reading the counter');
});

console.log('  ' + pass + ' checks');
