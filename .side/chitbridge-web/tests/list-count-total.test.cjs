'use strict';
/* tests/list-count-total.test.cjs — E15 (Fable e2e walk): the "n shown" count of the list library skips a row flagged _total.
 * HAND-COMPUTED  Who owes whom paints 3 parties and one total row (_total: true): "3 shown", not "4 shown". Filtered to 2 of the 3 parties (total row kept): "2 shown of 3".
 *   A remote list whose server total is 3 and holds the 3 parties + total row reads "3 shown".  OWNS the guard of list-ctl.js countText.  CARD 12-ux-locale */
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../public/app/list-ctl.js', 'utf8');
const a = src.indexOf('  function itemCount(rows)') >= 0 ? src.indexOf('  function itemCount(rows)') : src.indexOf('  function countText(I, m)');
const b = src.indexOf('  /* ── ⚑ NEEDS YOU');
const T = (I, s, v) => s.replace('{n}', v && v.n);
const remote = (I) => !!I.o.remote, val = (x) => (typeof x === 'function' ? x() : x);
const countText = new Function('T', 'remote', 'val', src.slice(a, b) + '; return countText;')(T, remote, val);
const parties = [{ id: 1 }, { id: 2 }, { id: 3 }], total = { _total: true };
let pass = 0;
const ok = (n, f) => { f(); pass++; console.log('  ok   ' + n); };
ok('3 parties + a total row: 3 shown', () => assert.strictEqual(countText({ o: {} }, { rows: parties.concat(total), all: parties.concat(total) }), '3 shown'));
ok('filtered to 2 of 3 (total row kept): 2 shown of 3', () => assert.strictEqual(countText({ o: {} }, { rows: parties.slice(0, 2).concat(total), all: parties.concat(total) }), '2 shown of 3'));
ok('remote: server total 3, page holds 3 + total row: 3 shown', () => assert.strictEqual(countText({ o: { remote: { total: 3 } } }, { rows: parties.concat(total), all: [] }), '3 shown'));
ok('a list with no total row reads as before', () => assert.strictEqual(countText({ o: {} }, { rows: parties, all: parties }), '3 shown'));
console.log('\n' + pass + ' passed');
