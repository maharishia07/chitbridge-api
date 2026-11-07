#!/usr/bin/env node
// @type: unit
/**
 * itemmatch-corpus-mutation.test.cjs — CAT-75: with the tolerance replaced by exact-match the corpus MUST go red.
 * A broken copy of lib/itemmatch.js is written beside the real file, tests/itemmatch-corpus.test.cjs is run against it
 * (ITEMMATCH_MODULE), the copy is deleted. Proves the corpus can fail.
 * RUN  node tests/itemmatch-corpus-mutation.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const REAL = path.join(ROOT, 'lib', 'itemmatch.js');
const COPY = path.join(ROOT, 'lib', 'itemmatch.mutant.tmp.js');
const TOL = 'const tolFor = (s) => (s.length <= 4 ? 1 : s.length <= 7 ? 2 : 3);';
const src = fs.readFileSync(REAL, 'utf8');
if (!src.includes(TOL)) { console.error('FAILED - the tolerance line moved; update this test'); process.exit(1); }
fs.writeFileSync(COPY, src.replace(TOL, 'const tolFor = () => -1;'));
let red;
try {
  red = spawnSync(process.execPath, [path.join(__dirname, 'itemmatch-corpus.test.cjs')], { env: { ...process.env, ITEMMATCH_MODULE: COPY }, encoding: 'utf8' }).status !== 0;
} finally { fs.unlinkSync(COPY); }
console.log(red ? 'ok - 1 checks, corpus went red with exact-match tolerance' : 'FAILED - corpus stayed green without the tolerance');
process.exit(red ? 0 : 1);
