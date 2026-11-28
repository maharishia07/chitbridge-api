'use strict';
/**
 * tests/one-ageing-set.test.cjs — RC11 (Athi 28 Nov 2026: "due date default with MSME view for India"): ONE ageing calculation, TWO NAMED bucket sets, both in the engine
 * (CBLedger AGE_SETS_: 'followup' by due date, 'msme' by bill date). This guard fails when a second bucket set (its keys) is written anywhere in lib/ or routes/
 * outside the adopted engine file, so a copy of the 0-30 / 31-45 / 46-60 / 60+ edges cannot come back. Undo test: put the old `const BUCKETS = ['0_30', …]` back in
 * lib/books-payables.js and this goes red.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const KEYS = /['"`](0_30|31_45|46_60|60_plus|d0_30|d31_60|d61_90|d90_plus)['"`]/;
let bad = [];
for (const dir of ['lib', 'routes']) {
  for (const f of fs.readdirSync(path.join(ROOT, dir))) {
    if (!/\.(js|cjs)$/.test(f)) continue;
    const text = fs.readFileSync(path.join(ROOT, dir, f), 'utf8');
    if (text.startsWith('/* ADOPTED from chitbridge-engines')) continue; /* an adopted engine file IS the engine */
    text.split('\n').forEach((line, i) => { if (KEYS.test(line)) bad.push(dir + '/' + f + ':' + (i + 1)); });
  }
}
if (bad.length) { console.log('  FAIL a bucket key is spelled outside the engine (use CBLedger.AGE_FOLLOWUP / AGE_MSME):\n    ' + bad.join('\n    ')); process.exit(1); }
const ledger = fs.readFileSync(path.join(ROOT, 'lib', 'ledger.js'), 'utf8');
if (!/msme: \{ receivable: AGE_MSME/.test(ledger) || !/followup: \{ receivable: AGE_FOLLOWUP/.test(ledger)) { console.log('  FAIL the engine no longer names both sets'); process.exit(1); }
console.log('  ok  no bucket key outside the engine; the engine names both sets\n\n1 passed');
