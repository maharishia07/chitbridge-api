/**
 * guards.cjs — RUN THE CHECKS THAT NEED NOTHING, AND SAY ONE NUMBER.
 * `npm test` needs a server running; these do not. They are what must pass before anything is pushed — no database, no network,
 * a few seconds — and until now the way to run them was to remember nine filenames.
 * behaves the same from PowerShell, cmd, Git Bash and CI.
 * reported 13 failures. Most were not failures at all: traceability needs a live server ("fetch failed"), several need a
 * database. A runner that reports red for the wrong reason gets ignored within a week, and then it is reporting nothing.
 * So GUARDS is a list somebody chose. `--all` runs the rest and is honest that some of it needs a server.
 *   node scripts/guards.cjs         the offline set — safe anywhere, seconds
 *   node scripts/guards.cjs --all   every test file, including the ones that need a server or a database
 *   node scripts/guards.cjs --junit test-results/guards.xml
 *                                   also write a JUnit report, one <testcase> per file, named by the board's key
 *                                   (`chitbridge-api/tests/<file>`) — CI posts it to the test board (ci.yml)
 * OWNS      the entry that picks the files to run (the offline list from scripts/guards-list.cjs, or --all) and hands them to scripts/guards-run.cjs.
 * CALLED BY .github/workflows/ci.yml (guards job, every push), the VS Code task, by hand before every push.
 * FLOW      GUARDS ──▶ spawn each tests/<file> ──▶ read its last "<n> checks" ──▶ ok / FAIL per file ──▶ --junit ──▶ exit 1 on any FAIL
 * CARD      qa/offline-guards
 */
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const TESTS = path.join(__dirname, '..', 'tests');
const { GUARDS } = require('./guards-list.cjs');
const all = process.argv.indexOf('--all') >= 0;
const files = all
  ? fs
      .readdirSync(TESTS)
      .filter((item) => /\.test\.(js|cjs)$/.test(item))
      .sort()
  : GUARDS.filter((item) => {
      if (fs.existsSync(path.join(TESTS, item))) return true;
      console.log('  ⚠️  ' + item + ' is listed but missing — renamed, or deleted without updating this list');
      return false;
    });
/* The tests that load the engines repo (and the CI skip rule) live in scripts/guards-needs-engines.cjs. */
const { NEEDS_ENGINES } = require('./guards-needs-engines.cjs');
const ENGINES_ABSENT = !fs.existsSync(path.join(__dirname, '..', '..', 'chitbridge-engines'));
const SKIP_ENGINES = ENGINES_ABSENT && process.env.CB_ENGINES_ABSENT_OK === '1';
/**
 * ⭐⭐ THE BOARD HEARS ABOUT IT (2026-10-07). Athi opened the test board and saw 0 results, while this gate ran green on
 * every push. `--junit <file>` writes what ran as JUnit — lib/junitresults.write, the same module that READS it on the
 * server — and CI posts that file (ci.yml, guards job). ⚠️ The testcase NAME is the board's case key, exactly as
 * data/test-cases.json spells it (`chitbridge-api/tests/<file>`), so the post uses key_from 'name' and nothing is guessed.
 * A skip is written as a skip, never a pass; a failure carries the lines this script already prints for it.
 */
const junitAt = process.argv.indexOf('--junit');
const JUNIT = junitAt >= 0 ? path.resolve(process.argv[junitAt + 1] || 'test-results/guards.xml') : null;
const KEY = (f) => 'chitbridge-api/tests/' + f;
require('./guards-run.cjs').runGuards({ files, all, TESTS, NEEDS_ENGINES, SKIP_ENGINES, JUNIT, KEY });
