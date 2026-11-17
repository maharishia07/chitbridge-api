#!/usr/bin/env node
/**
 * ord-25-connector-task.test.cjs — ORD-25 (proof 2026-11-14): the setup registers a Task Scheduler task so the kit restarts with nobody there.
 * @type regression
 * OWNS      the proof on the real tools/tally-connector/index.js (run as a child with schtasks recorded, never executed): `install` makes ONE schtasks /Create /F task, repeating every 5 minutes
 *           (/SC MINUTE /MO 5: Task Scheduler's default does not start a second copy, so it fires only when the watcher is NOT running - a crash, a reboot, a closed window all heal within 5 minutes),
 *           named for the config file, running `index.js watch` through the windowless wscript runner (cmd /c where wscript.exe is absent); `install --till` registers the counter (till.js) under its own name; installing twice replaces
 *           (/F, same name); `uninstall` deletes that task by name; the answer says it restarts after a crash, reboot or closed window.
 *           ⚠️ The backlog line says "at logon / restart on failure"; the built mechanism is this 5-minute repeat (no /SC ONLOGON trigger), which covers both. Pinned as built.
 * CALLED BY scripts/guards.cjs · CI. No Windows, no Task Scheduler: a preload fakes win32 and records the schtasks calls.
 * FLOW      node -r fake-windows-tasks index.js install|uninstall -> schtasks argv log -> hand-computed expectations
 *   node tests/ord-25-connector-task.test.cjs
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { API, ok, done } = require('./lib/cat-proof-kit.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ord25-'));
const cfg = path.join(dir, 'connector.json');
fs.writeFileSync(cfg, '{}');
const log = path.join(dir, 'schtasks.log');
const run = (...args) => {
  const r = spawnSync(process.execPath, ['-r', path.join(__dirname, 'support', 'fake-windows-tasks.cjs'), path.join(API, 'tools', 'tally-connector', 'index.js'), ...args, '--config', cfg],
    { encoding: 'utf8', env: Object.assign({}, process.env, { FAKE_SCHTASKS_LOG: log }) });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  fs.rmSync(log, { force: true });
  return { out: r.stdout + r.stderr, calls };
};
const at = (args, flag) => args[args.indexOf(flag) + 1];

try {
  const a = run('install');
  const c = a.calls[0] || [];
  ok('one schtasks call, a /Create', a.calls.length === 1 && c[0] === '/Create', JSON.stringify(a.calls));
  ok('forced (/F): installing again replaces, never stacks', c.includes('/F'), JSON.stringify(c));
  ok('repeats every 5 minutes: /SC MINUTE /MO 5', at(c, '/SC') === 'MINUTE' && at(c, '/MO') === '5', JSON.stringify(c));
  ok('named for the config file: "ChitBridge connector <folder> - connector <6 hex>"', /^ChitBridge connector .+ - connector [0-9a-f]{6}$/.test(at(c, '/TN') || ''), at(c, '/TN'));
  ok('runs the watcher (index.js watch) for that config', /index\.js watch/.test(at(c, '/TR') || '') && (at(c, '/TR') || '').includes(cfg), at(c, '/TR'));
  ok('started with no console window where wscript exists (run-hidden.vbs), else by cmd /c node (the fallback the answer warns about)', /run-hidden\.vbs/.test(at(c, '/TR') || '') || /cmd \/c cd \/d .*node index\.js watch/.test(at(c, '/TR') || ''), at(c, '/TR'));
  ok('the answer says it restarts after a crash, reboot or closed window', /every 5 minutes whenever it is not running \(crash, reboot, closed window\)/.test(a.out), a.out);

  const again = run('install');
  ok('installing twice asks for the SAME task name (so /F replaces it)', at(again.calls[0] || [], '/TN') === at(c, '/TN'), JSON.stringify(again.calls));

  const t = run('install', '--till');
  const tc = t.calls[0] || [];
  ok('the counter (--till) registers till.js under its own name "ChitBridge counter ..."', /^ChitBridge counter /.test(at(tc, '/TN') || '') && /till\.js/.test(at(tc, '/TR') || '') && at(tc, '/MO') === '5', JSON.stringify(tc));

  const u = run('uninstall');
  const del = u.calls.find((x) => x[0] === '/Delete' && at(x, '/TN') === at(c, '/TN'));
  ok('uninstall deletes that task by name', !!del && del.includes('/F'), JSON.stringify(u.calls));
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
done();
