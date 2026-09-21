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
/**
 * ⚠⚠ AND `var` IS THE SAME FAULT WITH A DIFFERENT KEYWORD (2026-09-18, the second one in a day). Building
 * MaintV2's "changed-today with undo" I declared `var CHANGED = []` — and the counter has had
 * `var CHANGED = { stock: [], price: [] }` since the Price-change screen was folded into Maintenance. Two
 * declarations in one scope: the second assignment wins, `CHANGED.price` becomes undefined, and the pane that
 * already worked throws on `.length`. Caught by reading the file, which is not a method.
 *
 * ⚠ A `var` redeclaration is legal JavaScript and silent — exactly like the function case above — so the only
 * thing that can see it is something that COUNTS the names. [[feedback-duplicate-function-hoisting]]
 * ⚠ Multiple names per statement are read (`var a = 1, b = 2;`), because that is how this file declares most
 * of its state and a reader that missed them would pass while the fault sat in front of it.
 */
/**
 * ⚠⚠⚠ STRIP THE COMMENTS BEFORE READING THE CODE — the FIFTH time a guard here has read prose as code
 * (scripts/vendor-till.cjs carries the same note about the other four). One perfectly ordinary line —
 * a `var` declaration whose trailing comment happened to contain a comma — was split ON THAT COMMA, and
 * the words after it were read as a second declaration. The guard reported a name declared twice that
 * exists nowhere in the file. It was right that something looked doubled; it was wrong about the universe.
 *
 * ⚠ LINE NUMBERS ARE PRESERVED: a stripped comment becomes spaces, never nothing, so the message this
 * prints still points at the line a person can open. [[feedback-name-vs-behaviour]]
 */
function stripComments(src) {
  const NL = String.fromCharCode(10);
  const block = new RegExp('/\\*[\\s\\S]*?\\*/', 'g');
  const line = new RegExp('([^:])//[^' + NL + ']*', 'g');
  return src.replace(block, (m) => m.replace(new RegExp('[^' + NL + ']', 'g'), ' '))
            .replace(line, '$1');
}

function topLevelNames(rawSrc) {
  const src = stripComments(rawSrc);
  const seen = new Map();
  const note = (name, n) => { const at = seen.get(name) || []; at.push(n + 1); seen.set(name, at); };
  src.split('\n').forEach((line, n) => {
    const fn = /^function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(line);
    if (fn) { note(fn[1], n); return; }
    /* ⚠ column 0 only — an indented var is inside something, and shadowing there is ordinary and correct */
    const v = /^var\s+(.+)$/.exec(line);
    if (!v) return;
    /* take the declared NAMES only: split on commas that are not inside brackets, then the identifier before = */
    let depth = 0, buf = '', parts = [];
    for (const ch of v[1]) {
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      if (ch === ',' && depth === 0) { parts.push(buf); buf = ''; continue; }
      buf += ch;
    }
    parts.push(buf);
    parts.forEach((p) => {
      const id = /^\s*([A-Za-z_$][\w$]*)/.exec(p);
      if (id) note(id[1], n);
    });
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
    /* ⚠ the var half, planted the same way — including the real shape that caused it */
    const vars = topLevelNames('var CHANGED = { stock: [], price: [] };\nvar x = 1, y = 2;\n  var x = 9;\nvar CHANGED = [];\n');
    assert.deepStrictEqual(vars.get('CHANGED'), [1, 4], 'the two CHANGED declarations must both be counted');
    assert.deepStrictEqual(vars.get('y'), [2], 'a second name in one statement must be seen');
    assert.deepStrictEqual(vars.get('x'), [2], 'the indented var must NOT count — it is nested');
  });
});

it('⭐ and it is looking at a real file with real functions in it', () => {
  const names = topLevelNames(scriptOf(FILES[0][1]));
  assert.ok(names.size > 200, 'only ' + names.size + ' top-level names found — the reader is probably broken');
  assert.ok(names.has('paintCart'), 'paintCart not seen — the reader is not reading the counter');
  assert.ok(names.has('CHANGED'), 'CHANGED not seen — the var half of the reader is not working');
  assert.ok(names.has('CART'), 'CART not seen — a var declared alongside others on one line is being missed');
});

console.log('  ' + pass + ' checks');
