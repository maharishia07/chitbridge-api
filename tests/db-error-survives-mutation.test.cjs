#!/usr/bin/env node
// @type: unit
/**
 * db-error-survives-mutation.test.cjs — PLT-86 mutation checks: remove each handler and tests/db-error-survives.test.cjs MUST go red.
 *   1. src/db.js: the pool 'error' listener removed
 *   2. db/index.js: the client 'error' listener removed (withTransaction)
 *   3. db/index.js: the dead client released plainly (back to client.release())
 *   4. db/index.js: removeListener deleted (handlers would stack on a pooled client)
 *   5. src/db.js: withTx removeListener deleted
 * A broken copy is written beside the real file, the test is run against it, the copy is deleted. Proves the test can fail.
 * RUN       node tests/db-error-survives-mutation.test.cjs
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

/** wentRed(file, edit, envName) — run the test against an edited copy; true when it went red, null when the edit did not apply */
function wentRed(file, edit, envName) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const broken = edit(source);
  if (broken === source) return null;
  const copy = path.join(path.dirname(file), '_mutant-' + path.basename(file));
  fs.writeFileSync(path.join(ROOT, copy), broken);
  try {
    const ran = spawnSync(process.execPath, [path.join(__dirname, 'db-error-survives.test.cjs')], { env: { ...process.env, [envName]: copy.split(path.sep).join('/') }, encoding: 'utf8', timeout: 120000 });
    return ran.status === 1 && /FAIL /.test(ran.stdout);
  } finally {
    fs.unlinkSync(path.join(ROOT, copy));
  }
}

const noPoolListener = (src) => src.replace("pool.on('error',", "(() => {})('error',");
const noClientListener = (src) => src.replace("client.on('error', onClientError);", '');
const plainRelease = (src) => src.replace('client.release(clientDied || undefined);', 'client.release();');
const noClientRemove = (src) => src.replace("client.removeListener('error', onClientError);", '');
const noTxRemove = (src) => src.replace("c.removeListener('error', onError);", '');
const cases = [
  ['src/db.js without the pool error listener', wentRed('src/db.js', noPoolListener, 'DB_ERR_SRC_DB')],
  ['withTransaction without the client error listener', wentRed('db/index.js', noClientListener, 'DB_ERR_INDEX')],
  ['withTransaction releasing the dead client plainly', wentRed('db/index.js', plainRelease, 'DB_ERR_INDEX')],
  ['withTransaction without removeListener', wentRed('db/index.js', noClientRemove, 'DB_ERR_INDEX')],
  ['src/db.js withTx without removeListener', wentRed('src/db.js', noTxRemove, 'DB_ERR_SRC_DB')]
];
let bad = 0;
cases.forEach(([label, red]) => {
  if (red !== true) bad++;
  console.log((red === true ? 'ok   ' : 'FAIL ') + label + (red === null ? ' (the mutation did not apply)' : ' makes db-error-survives.test.cjs go red'));
});
process.exit(bad ? 1 : 0);
