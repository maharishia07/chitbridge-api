#!/usr/bin/env node
// @type: unit
/**
 * rail-173-mutation.test.cjs — RAIL-173 mutation check: take the guard out of lib/rail-status.js statusGate (a copy written beside it, deleted after) and BOTH
 * tests/acc-223-238-cancel.test.cjs (the status door) and tests/rail-173-assign.test.cjs (PUT /assign pull + push) MUST go red on their RAIL-173 cases.
 * Proves the tests can fail. The copy is chosen by RAIL173_RAIL_STATUS (a path under the repo) in each test.
 * RUN  BOOKS_ENGINES_SRC=<engines>/src node tests/rail-173-mutation.test.cjs      CARD 01-rail-core-the-chit/status-the-one-status-writer
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const GUARD = /^[ \t]*if \(verdict\.ok && \(await revivesTakenBack\([^\n]*\n/m;

const source = fs.readFileSync(path.join(ROOT, 'lib', 'rail-status.js'), 'utf8');
const broken = source.replace(GUARD, '');
if (broken === source) { console.log('FAIL the guard line was not found in lib/rail-status.js (the mutation did not apply)\n\n1 checks'); process.exit(1); }
const copy = 'lib/_mutant-rail-status.js';
const redOf = (file) => {
  const ran = spawnSync(process.execPath, [path.join(__dirname, file)], { env: { ...process.env, RAIL173_RAIL_STATUS: copy }, encoding: 'utf8', timeout: 240000 });
  return { ran, red: String(ran.stdout).split('\n').filter((line) => /FAIL .*RAIL-173/.test(line)) };
};
let door, assign;
fs.writeFileSync(path.join(ROOT, copy), broken);
try {
  door = redOf('acc-223-238-cancel.test.cjs');
  assign = redOf('rail-173-assign.test.cjs');
} finally {
  fs.unlinkSync(path.join(ROOT, copy));
}
if (/SKIP:/.test(door.ran.stdout)) { console.log('SKIP: the books engines are not here\n\n0 checks'); process.exit(0); }
const checks = [
  ['guard removed: the status-door test exits red', door.ran.status === 1],
  ['…the cancelled and the rejected door cases both fail (' + door.red.length + ' lines)', door.red.some((l) => /cancelled after post/.test(l)) && door.red.some((l) => /rejected after post/.test(l))],
  ['guard removed: the PUT /assign test exits red', assign.ran.status === 1],
  ['…pull and push both fail (' + assign.red.length + ' lines)', assign.red.some((l) => /assign pull/.test(l)) && assign.red.some((l) => /assign push/.test(l))]
];
checks.forEach(([label, good]) => console.log((good ? 'ok   ' : 'FAIL ') + label));
console.log('\n' + checks.length + ' checks');
process.exit(checks.every((c) => c[1]) ? 0 : 1);
