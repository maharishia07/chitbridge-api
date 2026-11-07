#!/usr/bin/env node
// @type: unit
/**
 * itemmatch-corpus-mutation.test.cjs — CAT-75 / CAT-261: the corpus MUST go red under each deliberate break.
 * A broken copy of lib/itemmatch.js is written beside the real file, tests/itemmatch-corpus.test.cjs is run against it
 * (ITEMMATCH_MODULE), the copy is deleted. Proves the corpus can fail.
 *   1 · tolerance replaced by exact-match (CAT-75)
 *   2 · CAT-261: numbers, units, sizes and grades go back to the old per-token tolerance (exactTokens finds none),
 *       so "paracetamol 600mg", "pencil 2b", "cotton shirt xl" and the rest resolve again and the six `ask` cases go red
 * RUN  node tests/itemmatch-corpus-mutation.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const REAL = path.join(ROOT, 'lib', 'itemmatch.js');
const COPY = path.join(ROOT, 'lib', 'itemmatch.mutant.tmp.js');
const src = fs.readFileSync(REAL, 'utf8');
const MUTANTS = [
  ['exact-match tolerance', 'return word.length <= 4 ? 1 : word.length <= 7 ? 2 : 3;', 'return -1;', null],
  ['old per-token tolerance on numbers and sizes', 'function exactTokens(phrase) {', 'function exactTokens(phrase) {\n  return [];', /must ASK.*pencil 2b/],
  ['stage-3 substring without subsetExact (CAT-261 review)', ' && subsetExact(foldedPhrase, foldedName)', '', /must ASK.*folic 10000/],
  ['stage-3 substring cuts a short code mid-token (CAT-261 review)', 'function containsWhole(big, small) {', 'function containsWhole(big, small) {\n  return big.includes(small);', /must ASK.*linen shirt xll/],
  ['no unit alias table (CAT-261 review)', 'UNIT_ALIAS[word] ?', 'false ?', /MUST match.*milk 1 ltr/]
];

/** run(mutant) — the corpus output and exit code against one broken copy. */
function run([label, from, to]) {
  if (!src.includes(from)) { console.error('FAILED - "' + label + '": the line moved; update this test'); process.exit(1); }
  fs.writeFileSync(COPY, src.replace(from, () => to));
  try {
    return spawnSync(process.execPath, [path.join(__dirname, 'itemmatch-corpus.test.cjs')], { env: { ...process.env, ITEMMATCH_MODULE: COPY }, encoding: 'utf8' });
  } finally { fs.unlinkSync(COPY); }
}

let bad = 0;
for (const m of MUTANTS) {
  const r = run(m);
  const ok = r.status !== 0 && (!m[3] || m[3].test(r.stderr));
  if (!ok) { bad++; console.error('FAILED - corpus stayed green (or the case the break must redden did not) under: ' + m[0]); }
}
console.log(bad ? 'FAILED' : 'ok - ' + MUTANTS.length + ' checks, corpus went red under each break, on the case each break must redden');
process.exit(bad ? 1 : 0);
