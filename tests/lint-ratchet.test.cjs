/**
 * tests/lint-ratchet.test.cjs — the lint ratchet only goes down, and a new file with warnings is flagged (MNT-1).
 * Run: node tests/lint-ratchet.test.cjs
 */
'use strict';
const assert = require('assert');
const { tighten, judge, inlineScripts } = require('../tools/lint-ratchet.cjs');

const rows = { 'a.js': { warnings: 3, prettierOk: false }, 'b.js': { warnings: 1, prettierOk: true }, 'c.js': { warnings: 2, prettierOk: true } };
const ratchet = { 'a.js': { warnings: 5, prettierOk: false }, 'b.js': { warnings: 0, prettierOk: true } };

const next = tighten(['a.js', 'b.js', 'c.js'], rows, ratchet);
assert.strictEqual(next['a.js'].warnings, 3, 'a row is lowered when the file improved');
assert.strictEqual(next['b.js'].warnings, 0, 'a row never rises');
assert.strictEqual(next['c.js'].warnings, 2, 'a new file takes today\'s count');

const verdict = judge(['a.js', 'b.js', 'c.js'], rows, ratchet);
assert.deepStrictEqual(verdict.above, ['b.js']);
assert.deepStrictEqual(verdict.fresh, ['c.js']);
assert.deepStrictEqual(judge(['c.js'], rows, {}).fresh, [], 'no ratchet yet: nothing is "new"');

const page = '<script src="x.js"></script><script>var one;</script><script type="application/json">{}</script><script type="module">let two;</script>';
assert.deepStrictEqual(inlineScripts(page), ['var one;', 'let two;'], 'only inline javascript is linted');
console.log('lint-ratchet: ok');
