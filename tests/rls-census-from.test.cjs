'use strict';
/**
 * tests/rls-census-from.test.cjs — scripts/rls-census.cjs --from reads Athi's editor paste the way it reads the live database (DB-1, 19 Oct).
 * CARD 28-platform-and-operations/rls-census
 *
 * OWNS       the proof that a pasted census (migrations/READ-2026-10-19-1-rls-grants-census.sql → one JSON cell) compares against
 *            db/rls-baseline.json with the same verdicts as a live read: the baseline itself passes, a table that lost RLS fails.
 * CALLED BY  scripts/guards.cjs (offline: no database, no network; --save is never used, so the baseline is never written).
 * FLOW       baseline → a paste with the same tables (+ an ops.* row it must ignore) → exit 0 · one table's rls off → exit 1 · bad file → exit 2
 */
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');

const API = path.join(__dirname, '..');
const SCRIPT = path.join(API, 'scripts', 'rls-census.cjs');
const BASELINE = JSON.parse(fs.readFileSync(path.join(API, 'db', 'rls-baseline.json'), 'utf8')).tables;
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rls-census-'));

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ ' + name + (extra ? '   ' + extra : '')); }
};

/** run the census on a paste shaped like the editor's single cell: {census: {tables: {...}}} */
function runOnPaste(tables) {
  const file = path.join(workDir, 'paste-' + (pass + fail) + '.json');
  fs.writeFileSync(file, JSON.stringify({ census: { census: 'READ-2026-10-19-1 rls + grants', tables } }));
  return spawnSync(process.execPath, [SCRIPT, '--from', file], { encoding: 'utf8' });
}

const same = {};
Object.keys(BASELINE).forEach((name) => { same[name] = Object.assign({ app: 'SELECT', anon_reads: false }, BASELINE[name]); });
same['ops.population'] = { rls: false, forced: false, policies: 0, app_reads: true };   // not public: the baseline is public only
const ok = runOnPaste(same);
check('the baseline pasted back passes (exit 0)', ok.status === 0, (ok.stderr || ok.stdout).slice(-300));
check('  ...and an ops.* table is ignored, not reported as new and open', !/ops\.population/.test(ok.stdout));

const victim = Object.keys(BASELINE).find((name) => BASELINE[name].rls);
const lost = Object.assign({}, same, { [victim]: Object.assign({}, same[victim], { rls: false }) });
const bad = runOnPaste(lost);
check('a table that lost RLS fails (exit 1) and is named', bad.status === 1 && bad.stdout.indexOf(victim) >= 0, 'status ' + bad.status);

const broken = path.join(workDir, 'not-json.json');
fs.writeFileSync(broken, 'ERROR: 42P01');
const err = spawnSync(process.execPath, [SCRIPT, '--from', broken], { encoding: 'utf8' });
check('a paste that is not the census says so (exit 2)', err.status === 2 && /cannot read the pasted census/.test(err.stderr));

fs.rmSync(workDir, { recursive: true, force: true });
console.log('\n  ' + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
