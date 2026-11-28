'use strict';
/**
 * tests/one-ageing-set.test.cjs — RC11 (Athi 28 Nov 2026: "due date default with MSME view for India"): ONE ageing calculation, TWO NAMED bucket sets, both in the engine
 * (CBLedger AGE_SETS_: 'followup' by due date, 'msme' by bill date). This guard fails when a second bucket set (its keys) is written anywhere in lib/ or routes/
 * outside the adopted engine files, so a copy of the 0-30 / 31-45 / 46-60 / 60+ edges cannot come back. Undo test: put the old `const BUCKETS = ['0_30', …]` back in
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
    if (text.startsWith('/* ADOPTED')) continue; /* an adopted engine file IS the engine */
    text.split('\n').forEach((line, i) => { if (KEYS.test(line)) bad.push(dir + '/' + f + ':' + (i + 1)); });
  }
}
if (bad.length) { console.log('  FAIL a bucket key is spelled outside the engine and the pack (use the engine set and pack.ageingSets):\n    ' + bad.join('\n    ')); process.exit(1); }
const ledger = fs.readFileSync(path.join(ROOT, 'lib', 'ledger.js'), 'utf8'), regIn = fs.readFileSync(path.join(ROOT, 'lib', 'reg-in.js'), 'utf8');
if (!/followup: \{ receivable: AGE_FOLLOWUP/.test(ledger) || !/ageingSets: \{ msme/.test(regIn)) { console.log('  FAIL the neutral follow-up set is the engine set and msme is the IN pack set'); process.exit(1); }
console.log('  ok  no bucket key outside the engine; follow-up is the engine set, msme is the IN pack set\n\n1 passed');
