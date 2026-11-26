/* RW3-18: one default name per counter id (hand-computed): C2 -> "Counter 2", c10 -> "Counter 10", a code that is not a number is kept whole. */
const assert = require('assert');
const { counterName } = require('../lib/counters-store');
assert.strictEqual(counterName('C2'), 'Counter 2');
assert.strictEqual(counterName('c10'), 'Counter 10');
assert.strictEqual(counterName('DQLG'), 'Counter DQLG');
console.log('rw3-counter-name: ok');
