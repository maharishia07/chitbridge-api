/**
 * tests/sql-no-concat.test.cjs — API hygiene (ASVS L2 V5.3.4, OWASP API Top 10 2023): no VALUE is concatenated into SQL text in the route files that once failed the register's parameterised_query column.
 * Proves: in each of those files every query/run/runQuery/queryAs call is placeholder-only or interpolates only an UPPER_CASE constant, a $${n} placeholder number or frag(..) (lib/sql-frag.js, a built fragment a human traced to literals) ·
 * frag is exactly String() · pick answers an own key only (?sort=constructor cannot reach the prototype) · the scan flags a bare value and one planted beside a frag.
 * Run: node tests/sql-no-concat.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const reported = require('../tools/api-reported.cjs');
const { frag, pick } = require('../lib/sql-frag');
const API = path.join(__dirname, '..');
const FILES = ['actors', 'assist', 'chits', 'chits-trace', 'entities', 'folders', 'folders-inbox', 'notifications', 'relationships', 'testing', 'till', 'schemas', 'connectors', 'integrations'].map((name) => 'routes/' + name + '.js');

let pass = 0;
let fail = 0;
const check = (name, ok, extra) => {
  if (ok) pass++;
  else {
    fail++;
    console.log('  FAIL ' + name + (extra ? '\n       ' + extra : ''));
  }
};

FILES.forEach((file) => {
  const found = reported.sqlCallsIn(fs.readFileSync(path.join(API, file), 'utf8'));
  check(file + ': no query call builds its SQL from a bare value (' + found.calls + ' calls)', found.built === 0, found.built + ' built; mark a fragment the code built with frag(..), pass a value as a $n parameter');
});
const D = '$';
check('the scan flags a bare value', reported.sqlCallsIn('await query(`SELECT * FROM t WHERE a = ' + D + '{a}`);').built === 1);
check('the scan lets frag(..) through', reported.sqlCallsIn('await query(`SELECT * FROM t WHERE ' + D + '{frag(where)}`, p);').built === 0);
check('the scan still flags a value beside a frag(..)', reported.sqlCallsIn('await query(`SELECT * FROM t WHERE ' + D + '{frag(where)} AND a = ' + D + '{a}`, p);').built === 1);
check('quoted literals joined with + are one fixed text, not built', reported.sqlCallsIn("await db.query('SELECT a ' + 'FROM t WHERE b = $1', [b]);").built === 0);
check('a quoted literal joined with a variable is built', reported.sqlCallsIn("await db.query('SELECT a ' + 'FROM t WHERE b = ' + b);").built === 1);
check('frag is exactly String()', frag('x') === 'x' && frag(undefined) === 'undefined' && frag('') === '');
check('pick answers an own key', pick({ date: 'created_at' }, 'date') === 'created_at');
check('pick refuses constructor, __proto__, toString and a non-string', ['constructor', '__proto__', 'toString', 'hasOwnProperty'].every((key) => pick({ date: 'created_at' }, key) === undefined) && pick({ date: 'x' }, ['date']) === undefined);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
