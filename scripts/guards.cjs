/**
 * guards.cjs — RUN THE CHECKS THAT NEED NOTHING, AND SAY ONE NUMBER.
 *
 * `npm test` needs a server running; these do not. They are what must pass before anything is pushed — no database, no network,
 * a few seconds — and until now the way to run them was to remember nine filenames.
 *
 * ⚠️ WHY A SCRIPT AND NOT A SHELL LOOP. The VS Code task was first written as a cmd.exe `for %t in (…)` loop, and VS Code's
 * terminal on Windows is PowerShell, where that is a syntax error. A task nobody can run is a task nobody runs. One node script
 * behaves the same from PowerShell, cmd, Git Bash and CI.
 *
 * ⚠️⚠️ AND WHY A DECLARED LIST RATHER THAN A GLOB. The first version ran everything matching tests/*.test.js — 95 files — and
 * reported 13 failures. Most were not failures at all: traceability needs a live server ("fetch failed"), several need a
 * database. A runner that reports red for the wrong reason gets ignored within a week, and then it is reporting nothing.
 * So GUARDS is a list somebody chose. `--all` runs the rest and is honest that some of it needs a server.
 *
 *   node scripts/guards.cjs         the offline set — safe anywhere, seconds
 *   node scripts/guards.cjs --all   every test file, including the ones that need a server or a database
 */
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const TESTS = path.join(__dirname, '..', 'tests');

/** the offline set: no DB, no network, no server. Add one here the day it becomes true, not before. */
const GUARDS = [
  'pages-parse.test.js',      // every inline script in app.html, till.html and promo.html parses
  'till-vendor.test.js',      // the counter and its vendored engines agree, byte for byte
  'snapshot-wire.test.js',    // what a counter receives AFTER JSON — the Map that cost the shop its tax
  'rewards.test.js',          // what a point is worth, and what a ledger may do — it touches money
  'reward-cycle.test.js',     // the SEQUENCE: earn, come back, encash, expire, register — against the real store
  'sql-runner.test.js',       // a tool that runs SQL at production: its WITH/WITHOUT RLS line must be true
  'stock-cycle.test.js',      // the log and the cache must stay in step — through a replay, a minus, and a corrupted balance
  /* ⚠️⚠️ IT WAS NOT IN THIS LIST until 2026-09-10, so the one guard that asks 'is every module classified,
     and does everything unreachable say so' only ran when somebody remembered to. It caught an unclassified
     lib the same minute it was added here. A guard outside the suite is a guard nobody runs. */
  'engine-boundary.test.js',  // every lib declared engine or not; anything unreachable carries an @stage
  'adopt.test.js',            // what one shop may take into its catalogue from another's delivery
  'search-engine.test.js',    // one search, three copies
  'lotfields.test.js',        // what a vertical must capture about a consignment
  'printer.test.js',          // the slip bytes
  'kit-update.test.js',       // a kit that does not parse is never swapped in
  'speech.test.js',           // the seam, not the vendor
  'key-scopes.test.js',       // what every API key may reach — the authorisation matrix
  'column-home.test.cjs',     // where a column actually lives
  'connector-kit.test.js',
  'tax-vendor.test.js',
];

const all = process.argv.indexOf('--all') >= 0;
const files = all
  ? fs.readdirSync(TESTS).filter((f) => /\.test\.(js|cjs)$/.test(f)).sort()
  : GUARDS.filter((f) => { if (fs.existsSync(path.join(TESTS, f))) return true;
      console.log('  ⚠️  ' + f + ' is listed but missing — renamed, or deleted without updating this list'); return false; });

let total = 0, failed = [], started = Date.now();
console.log(all ? '— every test file (some need a server) —' : '— the guards —');

for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(TESTS, f)], { encoding: 'utf8', timeout: 120000 });
  const out = (r.stdout || '') + (r.stderr || '');
  /* every guard ends with "<n> checks"; take the LAST one, because a stray warning can print after it */
  const m = out.match(/(\d+)\s+checks/g);
  const n = m ? Number(String(m[m.length - 1]).match(/\d+/)[0]) : 0;
  const bad = (r.status !== 0) || /\bFAIL\b/.test(out);
  total += n;
  if (bad) failed.push(f);
  console.log('  ' + (bad ? 'FAIL' : ' ok ') + '  ' + f.replace(/\.test\.(js|cjs)$/, '').padEnd(22) + String(n).padStart(4) + ' checks');
  if (bad) console.log(out.split('\n').filter((l) => /FAIL|Error|expected/i.test(l)).slice(0, 5)
    .map((l) => '          ' + l.trim()).join('\n'));
}

console.log('  ' + '─'.repeat(40));
console.log('  ' + total + ' checks · ' + files.length + ' files · ' + (Math.round((Date.now() - started) / 100) / 10) + 's · '
  + (failed.length ? failed.length + ' FAILED: ' + failed.join(', ') : 'all passed'));
process.exit(failed.length ? 1 : 0);
