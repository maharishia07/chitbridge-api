/**
 * ── ⭐⭐ [REV-19] "the RLS tripwire covers 19 tables; 67 have policies" ─────────────────────────────────────────
 *
 * External review, 2026-09-25, on db/index.js's RLS_TENANT_TABLES: measured against db/rls-baseline.json, 48
 * protected tables were absent from the guard. That list and tests/rls-context.test.cjs's own separate FORCE-RLS
 * list had both drifted the same way — each grew one paragraph at a time as a table was added, and nobody came
 * back to check either against what the database actually enforces once the paragraph was written.
 *
 * db/rls-baseline.json is already the committed source of truth for a DIFFERENT purpose (scripts/rls-census.cjs
 * catches a table LOSING protection). This test points it at the guard lists instead, so GAINING a table nobody
 * told the guard about fails here too — the "CI check comparing the guard to the baseline" the review asked for.
 *
 * ⚠️ This only catches what the baseline itself already knows. Refresh it — `railway run node
 * scripts/rls-census.cjs --save` — after a migration adds RLS to a new table, same as rls-census.cjs's own use.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'db', 'rls-baseline.json'), 'utf8')).tables;

/** every table the baseline says is FORCE RLS right now — the set neither guard list may fall behind. */
const forced = Object.keys(baseline).filter((t) => baseline[t].rls && baseline[t].forced).sort();

let pass = 0, fail = 0;
const ok = (name, cond, why) => {
  if (cond) { pass++; console.log('   ok   ' + name); }
  else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); }
};

console.log('\n══ THE GUARD LISTS MATCH THE BASELINE, NOT JUST THEIR OWN LAST EDIT ══\n');

ok('the baseline has a plausible number of FORCE-RLS tables', forced.length >= 40,
  'only ' + forced.length + ' — db/rls-baseline.json may not have been refreshed since --save last ran');

// ── db/index.js's RLS_TENANT_TABLES ──────────────────────────────────────────────────────────────────────────
const dbIndexSrc = fs.readFileSync(path.join(ROOT, 'db', 'index.js'), 'utf8');
const dbIndexMatch = dbIndexSrc.match(/const RLS_TENANT_TABLES = \[([\s\S]*?)\];/);
ok('db/index.js declares RLS_TENANT_TABLES', !!dbIndexMatch, 'the array literal shape changed — update the regex above');
const dbIndexTables = dbIndexMatch
  ? Array.from(dbIndexMatch[1].matchAll(/'([^']+)'/g)).map((m) => m[1])
  : [];
const missingFromDbIndex = forced.filter((t) => !dbIndexTables.includes(t));
ok('every FORCE-RLS table in the baseline is in db/index.js\'s guard', missingFromDbIndex.length === 0,
  'missing: ' + missingFromDbIndex.join(', ') + ' — add to RLS_TENANT_TABLES in db/index.js');

// ── tests/rls-context.test.cjs's own embedded RLS list ───────────────────────────────────────────────────────
const rlsContextSrc = fs.readFileSync(path.join(ROOT, 'tests', 'rls-context.test.cjs'), 'utf8');
const rlsContextMatch = rlsContextSrc.match(/const RLS = `([\s\S]*?)`\.split/);
ok('tests/rls-context.test.cjs declares its RLS list', !!rlsContextMatch, 'the template-literal shape changed — update the regex above');
const rlsContextTables = rlsContextMatch ? rlsContextMatch[1].split(/\s+/).filter(Boolean) : [];
const missingFromRlsContext = forced.filter((t) => !rlsContextTables.includes(t));
ok('every FORCE-RLS table in the baseline is in rls-context.test.cjs\'s list', missingFromRlsContext.length === 0,
  'missing: ' + missingFromRlsContext.join(', ') + ' — add to the RLS template literal in tests/rls-context.test.cjs');

console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
