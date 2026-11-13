/**
 * tests/fn-size-adopted.test.cjs — scripts/fn-size.cjs skips the long-function count for ADOPTED engine files (header on
 * line 1 only); a hand-written file, or one with the header lower down, still counts. No DB, no network.
 */
'use strict';
const path = require('path');
const { isAdopted, LIMIT } = require(path.join(__dirname, '..', 'scripts', 'fn-size.cjs'));
const { functions } = require('./support/js-scan.cjs');
let pass = 0, fail = 0;
const t = (name, ok) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  XX  ' + name); } };

const HEAD = '/* ADOPTED from chitbridge-engines v1.76.0 · ledger · sha256 ' + 'a'.repeat(64) + ' — DO NOT EDIT HERE. */';
const LONG = 'function big(x) {\n' + '  x += 1;\n'.repeat(LIMIT + 5) + '  return x;\n}\n';
const count = (src) => (isAdopted(src) ? 0 : functions(src).filter((f) => f.lines > LIMIT).length);

console.log('\nfn-size · adopted files');
t('the long function parses as long', functions(LONG).some((f) => f.lines > LIMIT));
t('adopted file with a long function is skipped', count(HEAD + '\n' + LONG) === 0);
t('hand-written file with the same function is counted', count(LONG) === 1);
t('header on line 3 is counted', count('// a\n// b\n' + HEAD + '\n' + LONG) === 1);
t('ADOPTED mentioned in a comment on line 1 is counted', count('/* ADOPTED later */\n' + LONG) === 1);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
