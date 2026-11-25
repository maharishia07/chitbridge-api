#!/usr/bin/env node
/**
 * signoffw-till-chips.test.cjs — FW-40 (walk 25 Nov): a "Counter 2" chip over "0 counters", a red "108 h old" prices chip over an empty catalogue.
 * OWNS    the proof, on the till MASTER (tools/tally-connector/till.html), that counterName() takes the shop's register as the one source of the counter count
 *         and that the stale-prices chip and bill warning are not raised when there are no items to price. The functions are cut out of the page and run.
 * CALLED BY CI (tests/*.test.cjs). No database, no browser.
 */
'use strict';
const fs = require('fs'); const path = require('path'); const assert = require('assert'); const vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8');
const cut = (name) => { const i = src.indexOf('function ' + name + '('); assert.ok(i > 0, name + ' found'); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } };
function counterNameWith(claim, id, person) {
  const ctx = { TILL_CLAIM: claim, ls: { get: (k, d) => (k === 'cb_till_id' ? id : d) }, shopLs: (k) => k, tillId: () => id, personOn: () => !!person, cbQuiet() {}, String, Number, RegExp };
  vm.runInNewContext(cut('counterName') + ';this.out = counterName();', ctx); return ctx.out;
}
assert.strictEqual(counterNameWith(null, 'C2'), 'Counter 2', 'no answer from the shop yet: as before');
assert.strictEqual(counterNameWith({ counters: 3 }, 'C2'), 'Counter 2', 'the shop holds counters: the numbered name');
assert.strictEqual(counterNameWith({ counters: 0 }, 'C2'), 'Counter', 'the shop says it holds none: a leftover id is not named');
assert.strictEqual(counterNameWith({ counters: 0 }, 'C2', true), 'Counter 2', 'a person device is not in the key register: unchanged');
const dayWarn = (items, h) => { const ctx = { S: { at: 'x', items }, dayStatus: () => ({ state: 'open' }), DAY: () => ({ priceAge: () => h }), cbQuiet() {}, Date }; vm.runInNewContext(cut('dayWarnWords') + ';this.out = dayWarnWords();', ctx); return ctx.out; };
assert.strictEqual(dayWarn([], 108), '', 'no items, no stale-prices warning');
assert.strictEqual(dayWarn([{}], 108), 'prices 108 h old', 'items: the warning stays');
assert.ok(/!\(\(S\.items \|\| \[\]\)\.length\)\) \{ age\.textContent = 'no items yet'/.test(src), 'the bar chip is quiet for an empty catalogue');
console.log('signoffw-till-chips: ok');
