'use strict';
/**
 * guards-list.test.cjs — the offline guard list (scripts/guards-list.cjs and its four parts) is one array, in order, with no loss.
 * OWNS      unit checks of scripts/guards-list.cjs, guards-list-1.cjs, guards-list-2.cjs, guards-list-3.cjs, guards-list-4.cjs and tests/support/guards-list-text.cjs: the joined list is the four parts in order, no name twice, every name a test file that exists, each part under 500 lines, the text helper lists the same names, a missing part throws.
 * CALLED BY scripts/guards.cjs (enrolled in the list itself, offline) · CI guards job.
 * FLOW      require the parts and the join ──▶ compare name by name ──▶ compare with the text the enrolment tests read
 * CARD      qa/offline-guards
 * MIN unit-test
 */
const fs = require('fs');
const path = require('path');
const SCRIPTS = path.join(__dirname, '..', 'scripts');
const TESTS = __dirname;
const { GUARDS } = require('../scripts/guards-list.cjs');
const parts = [
  require('../scripts/guards-list-1.cjs').GUARDS_PART,
  require('../scripts/guards-list-2.cjs').GUARDS_PART,
  require('../scripts/guards-list-3.cjs').GUARDS_PART,
  require('../scripts/guards-list-4.cjs').GUARDS_PART,
];
const { guardsListText } = require('./support/guards-list-text.cjs');

let pass = 0;
let fail = 0;
const check = (name, ok, why) => {
  if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  XX  ' + name + (why ? '\n        ' + why : '')); }
};

console.log('\nguards list · four parts, one array');
check('the joined list is the four parts in order, nothing lost', JSON.stringify(GUARDS) === JSON.stringify([].concat(...parts)), GUARDS.length + ' vs ' + [].concat(...parts).length);
check('the list holds the offline guards (over 1000 names)', GUARDS.length > 1000, String(GUARDS.length));
const seen = new Set();
const twice = GUARDS.filter((name) => (seen.has(name) ? true : (seen.add(name), false)));
/* 10 names were already listed twice before the split (each runs twice, kept as it was: same guard results); a new double fails here */
check('no new guard is listed twice (10 old doubles stay as they were)', twice.length <= 10, twice.join(', '));
check('every entry is a test file name', GUARDS.every((name) => /^[^/\\]+\.test\.(js|cjs)$/.test(name)));
const absent = GUARDS.filter((name) => !fs.existsSync(path.join(TESTS, name)));
check('every listed guard exists in tests/', absent.length === 0, absent.join(', '));
check('this test is itself listed', GUARDS.indexOf('guards-list.test.cjs') >= 0);
const tooLong = [1, 2, 3, 4].filter((n) => fs.readFileSync(path.join(SCRIPTS, 'guards-list-' + n + '.cjs'), 'utf8').split('\n').length > 500);
check('each part stays under 500 lines (the filesize ratchet holds a new file there)', tooLong.length === 0, tooLong.join(', '));
const text = guardsListText();
const named = (text.match(/^\s*'([^']+\.test\.(?:js|cjs))'/gm) || []).map((line) => line.match(/'([^']+)'/)[1]);
check('the text the enrolment tests read lists the same names (as a set)', JSON.stringify([...new Set(named)].sort()) === JSON.stringify([...new Set(GUARDS)].sort()), named.length + ' vs ' + GUARDS.length);
check('the text opens and closes like one array', text.indexOf('const GUARDS = [') > 0 && /\n\];\n$/.test(text));

let loud = false;
const original = fs.readFileSync;
fs.readFileSync = function (file, ...rest) {
  if (String(file).endsWith('guards-list-2.cjs')) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
  return original.call(this, file, ...rest);
};
try { guardsListText(); } catch (err) { loud = err.code === 'ENOENT'; } finally { fs.readFileSync = original; }
check('a missing part throws, never an empty list', loud);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n  ' + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
