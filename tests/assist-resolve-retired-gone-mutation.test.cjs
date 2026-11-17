#!/usr/bin/env node
// @type: unit
/**
 * assist-resolve-retired-gone-mutation.test.cjs — API-49 mutation check: put the retired POST /resolve back into a copy of routes/assist.js
 * and tests/assist-resolve-retired-gone.test.cjs MUST go red. A broken copy is written beside the real file, the test runs against it, the copy is deleted.
 * RUN       node tests/assist-resolve-retired-gone-mutation.test.cjs
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ANCHOR = "router.get('/whoami'";
const BACK = "router.post('/resolve', auth, async (req, res) => { res.status(410).json({ ok: false }); });\n";
const source = fs.readFileSync(path.join(ROOT, 'routes', 'assist.js'), 'utf8');
const broken = source.replace(ANCHOR, BACK + ANCHOR);
const copy = 'routes/_mutant-assist.js';
let red = null;
if (broken !== source) {
  fs.writeFileSync(path.join(ROOT, copy), broken);
  try {
    const ran = spawnSync(process.execPath, [path.join(__dirname, 'assist-resolve-retired-gone.test.cjs')], { env: { ...process.env, ASSIST_ROUTE: copy }, encoding: 'utf8' });
    red = ran.status === 1 && /FAIL routes\/assist\.js registers no router\.post/.test(ran.stdout);
  } finally {
    fs.unlinkSync(path.join(ROOT, copy));
  }
}
console.log((red === true ? 'ok   ' : 'FAIL ') + 'the route put back makes assist-resolve-retired-gone.test.cjs go red' + (red === null ? ' (the mutation did not apply)' : ''));
process.exit(red === true ? 0 : 1);
