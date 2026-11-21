/**
 * tests/reviews1-boolean-words.test.cjs — reviews1 EL rail F1: the words BOOLEAN_LIKE lets through ('false', '0', '1', 1) read the SAME way in every handler (lib/chits-input isTrue).
 * Before: is_draft "false" saved a draft (truthy), is_dispute 1 posted a plain external message (strict). CALLED BY by hand.
 * CARD      04-chits-and-the-rail
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { isTrue } = require('../lib/chits-input');
assert.strictEqual(typeof isTrue, 'function', 'one normaliser exists');
for (const v of [true, 'true', '1', 1]) assert.strictEqual(isTrue(v), true, String(v) + ' is true');
for (const v of [false, 'false', '0', 0, undefined, null, '']) assert.strictEqual(isTrue(v), false, JSON.stringify(v) + ' is false');
const src = require('../tools/chits-files.cjs').read(path.join(__dirname, '..')); /* the ONE list of chits files */
assert.ok(!/!!req\.body\.is_draft|req\.body\.is_dispute === true|chit_wide \? 'chit_wide'/.test(src), 'no handler reads these keys by plain truthiness or a private strict test any more');
console.log('reviews1-boolean-words: ok, 13 checks'); /* 1 + 4 true words + 7 false words + 1 source scan; the guards runner reads the number */
