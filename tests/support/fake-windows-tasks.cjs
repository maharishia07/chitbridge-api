/**
 * tests/support/fake-windows-tasks.cjs — a node --require preload for tests/ord-25-connector-task.test.cjs.
 * OWNS      makes the process say it is win32 and records every schtasks call (argv as JSON, one per line, to FAKE_SCHTASKS_LOG) instead of running it; answers status 0.
 * CALLED BY tests/ord-25-connector-task.test.cjs (node -r this-file tools/tally-connector/index.js install ...)
 * FLOW      index.js install -> spawnSync('schtasks', args) -> this recorder -> the test reads the log
 */
'use strict';
const fs = require('fs');
const cp = require('child_process');
Object.defineProperty(process, 'platform', { value: 'win32' });
const real = cp.spawnSync;
cp.spawnSync = function (cmd, args, opts) {
  if (String(cmd).toLowerCase() === 'schtasks') {
    fs.appendFileSync(process.env.FAKE_SCHTASKS_LOG, JSON.stringify(args) + '\n');
    return { status: 0, stdout: 'SUCCESS', stderr: '' };
  }
  return real.apply(this, arguments);
};
