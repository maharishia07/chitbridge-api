const assert = require('assert');
const S = require('../lib/schedule');
const d = S.diff({ name: 'Rice', price: { amount: 100, currency: 'INR' }, desc: 'x' }, { name: 'Rice', price: { amount: 120, currency: 'INR' }, desc: 'x', hsn: '1006' });
assert.deepStrictEqual(d, { price: { amount: 120, currency: 'INR' }, hsn: '1006' }, 'only what changed travels');
assert.deepStrictEqual(S.diff({ a: 1 }, { a: 1 }), {}, 'nothing changed → empty patch');
console.log('schedule.diff: 2 passed');
