'use strict';
// @type: unit
const assert = require('assert'), { guardDecision: g } = require('./guard.cjs');
const H = ['localhost:5173', 'localhost:3000'];
assert.strictEqual(g('POST', 'http://localhost:3000/api/chits', H, false).act, 'abort');
assert.strictEqual(g('DELETE', 'http://localhost:5173/api/x', H, false).act, 'abort');
assert.strictEqual(g('GET', 'http://localhost:3000/api/chits', H, false).act, 'fallback');
assert.strictEqual(g('GET', 'https://evil.example/x', H, true).act, 'abort');
assert.strictEqual(g('GET', 'https://cdn.example/x.js', H, false).act, 'fallback');
assert.strictEqual(g('POST', 'http://localhost:5173/page', H, false).act, 'fallback');
console.log('proof guard: PASS');
