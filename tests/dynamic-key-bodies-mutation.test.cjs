#!/usr/bin/env node
// @type: unit
/**
 * dynamic-key-bodies-mutation.test.cjs — API-48 mutation checks: remove the closing of a body and tests/dynamic-key-bodies.test.cjs MUST go red.
 *   1. entities contract: closedBody no longer closes (additionalProperties false dropped)
 *   2. integrations contract: PUT /streams back to its open map (any key, typed values)
 * The real file is swapped for the broken text, the test is run, the real text is put back (always). Proves the test can fail.
 * RUN       node tests/dynamic-key-bodies-mutation.test.cjs
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OPEN_STREAMS = "additionalProperties: { type: ['string', 'null', 'boolean'] } })";

/** wentRed(file, edit) — run the test with the edited text in place of the file; true when it went red, null when the edit did not apply */
function wentRed(file, edit, testFile) {
  const full = path.join(ROOT, file);
  const source = fs.readFileSync(full, 'utf8');
  const broken = edit(source);
  if (broken === source) return null;
  fs.writeFileSync(full, broken);
  try {
    const ran = spawnSync(process.execPath, [path.join(__dirname, testFile || 'dynamic-key-bodies.test.cjs')], { encoding: 'utf8' });
    return ran.status === 1 && /FAIL /.test(ran.stdout);
  } finally {
    fs.writeFileSync(full, source);
  }
}

const cases = [
  ['entities: closedKeysBody left open', wentRed('lib/entities-contract.js', (src) => src.replace('additionalProperties: false });\nconst PREFS_NOTE', 'additionalProperties: true });\nconst PREFS_NOTE'))],
  ['integrations: PUT /streams back to an open map', wentRed('lib/integrations-contract.js', (src) => src.replace(/properties: Object\.fromEntries\(STREAM_IDS[^\n]*?additionalProperties: false \}\)/, OPEN_STREAMS))]
  ,
  ['entities: the per-kind key check removed (a locale key on ui)', wentRed('routes/entities.js', (src) => src.replace('const foreign = Object.keys(req.body || {}).find((key) => !set.keys.includes(key));', 'const foreign = null;'), 'prefs-merge.test.cjs')],
  ['policy: the frozen unknown-flag words dropped', wentRed('lib/entities-contract.js', (src) => src.replace("{ error: 'Policy update failed', message: 'Unknown", "{ error: 'Validation failed', message: 'Unknown"))]
];
let bad = 0;
cases.forEach(([label, red]) => {
  if (red !== true) bad++;
  console.log((red === true ? 'ok   ' : 'FAIL ') + label + (red === null ? ' (the mutation did not apply)' : ' makes its test go red'));
});
process.exit(bad ? 1 : 0);
