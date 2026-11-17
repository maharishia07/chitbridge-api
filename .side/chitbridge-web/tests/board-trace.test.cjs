'use strict';
/* K-BOARD / QUAL-1: the traceability line (QA-24, CAT-50), the not-evidence mark (QA-72) and the kept verdict (ACC-97).
 * Run: node tests/board-trace.test.cjs */
const assert = require('assert'), fs = require('fs'), path = require('path');
const { testIsEvidence, testCiteLine } = require('../public/app/test-verdict.js');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };

ok(testCiteLine({ cites: { standard: 'ASVS', clause: '8.2.2', level: 1 } }).text === 'ASVS · §8.2.2 · level 1', 'a cited clause prints standard, clause, level');
ok(testCiteLine({ covers: 'FR-12' }).source === 'covers', 'a case with no clause but a @covers prints the covers');
const none = testCiteLine({ case_key: 'chitbridge-web/e2e/tests/price.spec.js', note: 'price' });
ok(none.cited === false && none.text === 'Not cited', 'no cite and no covers prints "Not cited"');
ok(testCiteLine({ case_key: 'price-requirement.spec.js' }).cited === false, 'a requirement is never inferred from a file name');
ok(!testIsEvidence('chitbridge-web/e2e/fixtures/walkthrough.js') && !testIsEvidence('x/engine-manifest.js'), 'walkthrough.js and engine-manifest.js are not evidence');
ok(!testIsEvidence('api/scripts/seed-demo-shop.cjs') && !testIsEvidence('web\\e2e\\narrated-proof.cjs'), 'seeds, demos and narrated proofs (either slash) are not evidence');
ok(testIsEvidence('chitbridge-web/e2e/tests/one-board.spec.js') && testIsEvidence(''), 'a real spec stays evidence');

/* ACC-97: the failure branch of testMark keeps the verdict in the notice; the toast alone is the old fault */
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'cap-testing.js'), 'utf8');
const mark = src.slice(src.indexOf('async function testMark('), src.indexOf('async function testRetryUnsent'));
const lost = src.slice(src.indexOf('function testMarkLost('), src.indexOf('async function testMark('));
ok(/testMarkLost\(key, status, \w+\)/.test(mark) && /CBTEST\.unsent\[key\]/.test(lost) && /CBTEST\.notice = \{\s*tone: 'bad'/.test(lost), 'a failed testMark keeps the verdict and raises a sticky notice');
ok(/async function testRetryUnsent/.test(src) && /testRetryUnsent\(\)/.test(lost), 'the notice has a Send again that calls testRetryUnsent');
/* SEC-122: a 403 from the shared board is one plain line, not a fault; every other failure keeps its reason */
const fail = src.slice(src.indexOf('function testReadFailure('), src.indexOf('async function testLoad('));
const readFailure = new Function('esc', 'tx', fail + '; return testReadFailure;')((t) => String(t), (t) => t);
ok(readFailure({ status: 403, message: 'x' }) === 'The test board is for builders.' && fail.includes("tx('The test board is for builders.')"), 'a 403 says one plain line through the string layer (tx, locale), never the server words');
ok(readFailure({ status: 500, message: 'down' }) === 'Could not read the test cases \u2014 down'.replace('\u2014', String.fromCharCode(8212)), 'any other failure keeps the Could not read words and the reason');
ok(!/#[0-9a-f]{3,6}|rgb\(/i.test(fail) && src.includes('text: testReadFailure(e)'), 'the line paints in the notice, so the theme (cream and dark, 1366 and 390) and its contrast (a11y, AA) stay the notice own');

console.log(n + ' passed');
