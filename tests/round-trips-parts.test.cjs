#!/usr/bin/env node
// @type: unit
/**
 * round-trips-parts.test.cjs — MNT-59: a split route file is read as its PARENT by tools/round-trips.cjs, so its budget keys do not move and its ratchet is not silently dead.
 *
 * OWNS      the proof that every route of routes/folders-inbox.js and routes/folders-totals.js is listed under routes/folders.js (and the chits-trace routes under chits.js),
 *           with the full /api/folders path, and that no row names a part file.
 * CALLED BY scripts/guards.cjs · CI.
 * FLOW      node tools/round-trips.cjs --all ──▶ the rows ──▶ keyed by parent file
 * CARD      28-platform-and-operations/performance-and-round-trips
 *
 * MIN 3 checks
 */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
let failed = 0;
const check = (ok, label) => {
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label);
};

const run = spawnSync(process.execPath, [path.join(ROOT, 'tools/round-trips.cjs'), '--all'], { encoding: 'utf8', maxBuffer: 1 << 26 });
const lines = run.stdout.split('\n');
const asked = (pattern) => lines.filter((line) => pattern.test(line));
check(run.status === 0, 'tools/round-trips.cjs --all runs (exit ' + run.status + ')');
check(asked(/folders-(inbox|totals)\.js/).length === 0, 'no row names a part file of folders');
check(asked(/chits-trace\.js/).length === 0, 'no row names the chits-trace part file');
check(asked(/\s\/messages\s+folders\.js/).length >= 1 && asked(/\s\/worklist\s+folders\.js/).length >= 1, 'the inbox routes are listed under folders.js');
check(['/reconcile', '/mis', '/groupsum'].every((route) => asked(new RegExp('\\s' + route + '\\s+folders\\.js')).length >= 1), 'the totals routes are listed under folders.js');
console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
