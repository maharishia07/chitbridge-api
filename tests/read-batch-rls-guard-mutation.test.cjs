#!/usr/bin/env node
// @type: unit
/**
 * read-batch-rls-guard-mutation.test.cjs — OPS-27 mutation checks: break db/index.js two ways and tests/read-batch-rls-guard.test.cjs MUST go red each time.
 *   1. the exemption removed (readBatch guards every statement again — the old false warnings / silent fallback)
 *   2. the exemption too wide (every batch exempt — an unscoped batch would no longer be guarded)
 *   3. the decision reverted to the BATCH entity alone (batch 'shop-1' + a statement {entity:''} would run unguarded under no shop)
 * A broken copy is written beside db/index.js, the test is run against it, the copy is deleted. Proves the test can fail, in BOTH directions.
 * RUN       node tests/read-batch-rls-guard-mutation.test.cjs
 * CARD      13-inventory-stock-and-traceability (OPS-27)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const EXEMPT = 'if (!scopedStatement(bound)) rlsGuardCheck(s.text);';
const BATCH_ONLY = 'if (!scopedStatement(entityId)) rlsGuardCheck(s.text);';   /* the decision reverted to the batch entity alone */
const ALWAYS_GUARD = 'rlsGuardCheck(s.text);';
const NEVER_GUARD = 'if (false) rlsGuardCheck(s.text);';

/** wentRed(edit) — write the edited db copy, run the test against it, delete the copy; true when the test went red, null when the edit did not apply */
function wentRed(edit) {
  const source = fs.readFileSync(path.join(ROOT, 'db/index.js'), 'utf8');
  const broken = edit(source);
  if (broken === source) return null;
  const copy = 'db/_mutant-index.js';
  fs.writeFileSync(path.join(ROOT, copy), broken);
  try {
    const ran = spawnSync(process.execPath, [path.join(__dirname, 'read-batch-rls-guard.test.cjs')], { env: { ...process.env, READ_BATCH_DB: copy }, encoding: 'utf8' });
    return ran.status === 1 && /FAIL /.test(ran.stdout);
  } finally {
    fs.unlinkSync(path.join(ROOT, copy));
  }
}

const cases = [
  ['the exemption removed (every batch guarded again)', wentRed((src) => src.replace(EXEMPT, ALWAYS_GUARD))],
  ['the exemption too wide (an unscoped batch no longer guarded)', wentRed((src) => src.replace(EXEMPT, NEVER_GUARD))],
  ['the decision taken from the batch entity alone (a statement switched to "" slips through)', wentRed((src) => src.replace(EXEMPT, BATCH_ONLY))]
];
let bad = 0;
cases.forEach(([label, red]) => {
  if (red !== true) bad++;
  console.log((red === true ? 'ok   ' : 'FAIL ') + label + (red === null ? ' (the mutation did not apply)' : ' makes read-batch-rls-guard.test.cjs go red'));
});
process.exit(bad ? 1 : 0);
