#!/usr/bin/env node
// @type: unit
/**
 * rail-173-mutation.test.cjs — RAIL-173 mutation check: take the guard out of lib/chit-move.js (a copy written beside it, deleted after) and
 * tests/acc-223-238-cancel.test.cjs MUST go red on the RAIL-173 cases (a bill the books took back is moved back to accepted / pending / ...).
 * Proves the test can fail. The copy is chosen by RAIL173_CHIT_MOVE (a path under the repo) in the cancel test.
 * RUN  BOOKS_ENGINES_SRC=<engines>/src node tests/rail-173-mutation.test.cjs      CARD 01-rail-core-the-chit/chit-move
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const GUARD = /^\s*if \(await revivesTakenBack\([^\n]*\n/m;

const source = fs.readFileSync(path.join(ROOT, 'lib', 'chit-move.js'), 'utf8');
const broken = source.replace(GUARD, '');
if (broken === source) { console.log('FAIL the guard line was not found in lib/chit-move.js (the mutation did not apply)\n\n1 checks'); process.exit(1); }
const copy = 'lib/_mutant-chit-move.js';
fs.writeFileSync(path.join(ROOT, copy), broken);
let ran;
try {
  ran = spawnSync(process.execPath, [path.join(__dirname, 'acc-223-238-cancel.test.cjs')], { env: { ...process.env, RAIL173_CHIT_MOVE: copy }, encoding: 'utf8', timeout: 240000 });
} finally {
  fs.unlinkSync(path.join(ROOT, copy));
}
if (/SKIP:/.test(ran.stdout)) { console.log('SKIP: the books engines are not here\n\n0 checks'); process.exit(0); }
const red = String(ran.stdout).split('\n').filter((line) => /FAIL .*RAIL-173/.test(line));
const checks = [
  ['with the guard removed the cancel test exits red', ran.status === 1],
  ['…and the RAIL-173 cases are the ones that fail (' + red.length + ' lines)', red.length >= 4],
  ['…a refused move now moves (the cancelled and rejected cases both go red)', red.some((l) => /cancelled after post/.test(l)) && red.some((l) => /rejected after post/.test(l))]
];
checks.forEach(([label, good]) => console.log((good ? 'ok   ' : 'FAIL ') + label));
console.log('\n' + checks.length + ' checks');
process.exit(checks.every((c) => c[1]) ? 0 : 1);
