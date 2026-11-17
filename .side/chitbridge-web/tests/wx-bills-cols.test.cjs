'use strict';
/* WX-O2C (2026-10-13): Unpaid bills shows the Bill no and the Date by default. CBList's default is the top three by prio (list-ctl.js
   defaultCols), which hid the number a shopkeeper reads a bill by — at 1366 px, beside ~350 px of empty row. Run: node tests/wx-bills-cols.test.cjs */
const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(__dirname + '/../public/accounts.html', 'utf8');
const mount = /CBList\.mount\(\$\('bkl_bills'\), \{[\s\S]*?defaultCols: (\[[^\]]*\])/.exec(html);
assert(mount, 'the bills list names its default columns');
const cols = JSON.parse(mount[1].replace(/'/g, '"'));
assert.deepStrictEqual(cols, ['who', 'no', 'amount', 'date', 'step'], 'all five, the bill number among them');
const declared = [...html.slice(html.indexOf('function accBillCols'), html.indexOf('function accBillNext')).matchAll(/key: '([a-z]+)'/g)].map((m) => m[1]);
cols.forEach((k) => assert(declared.includes(k), k + ' is a declared column'));
console.log('  ok  Unpaid bills: ' + cols.join(' · ') + ' by default');
