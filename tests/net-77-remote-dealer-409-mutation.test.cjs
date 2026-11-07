#!/usr/bin/env node
// @type: unit
/**
 * net-77-remote-dealer-409-mutation.test.cjs — NET-77 mutation checks: break the refusal two ways and tests/net-77-remote-dealer-409.test.cjs MUST go red each time.
 *   1. the call removed (the way main was: the ask to a remote stub is saved as a hub-only edge)
 *   2. the remote test turned round (a local business is refused instead)
 * A broken copy is written beside the real file, the test is run against it, the copy is deleted. Proves the test can fail.
 * RUN       node tests/net-77-remote-dealer-409-mutation.test.cjs
 * CARD      04-network/connections-and-invitations
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SERVICE = 'src/services/network.js';
const CALL = '  await refuseRemote([parent, child]);\n';
const TEST = '!(await ctpaddress.resolve(who.identity_id)).local';

/** wentRed(edit) — write the edited copy, run the test with NET77_SERVICE pointing at it, delete the copy; true when the test went red, null when the edit did not apply */
function wentRed(edit) {
  const source = fs.readFileSync(path.join(ROOT, SERVICE), 'utf8');
  const broken = edit(source);
  if (broken === source) return null;
  const copy = 'src/services/_mutant-network.js';
  fs.writeFileSync(path.join(ROOT, copy), broken);
  try {
    const ran = spawnSync(process.execPath, [path.join(__dirname, 'net-77-remote-dealer-409.test.cjs')], { env: { ...process.env, NET77_SERVICE: copy }, encoding: 'utf8' });
    return ran.status === 1 && /FAIL /.test(ran.stdout);
  } finally {
    fs.unlinkSync(path.join(ROOT, copy));
  }
}

const cases = [
  ['the refusal call removed (the ask is saved as a hub-only edge)', wentRed((src) => src.replace(CALL, ''))],
  ['the remote test turned round (a local business is refused)', wentRed((src) => src.replace(TEST, TEST.slice(1)))]
];
let bad = 0;
cases.forEach(([label, red]) => {
  if (red !== true) bad++;
  console.log((red === true ? 'ok   ' : 'FAIL ') + label + (red === null ? ' (the mutation did not apply)' : ' makes net-77-remote-dealer-409.test.cjs go red'));
});
process.exit(bad ? 1 : 0);
