#!/usr/bin/env node
/**
 * tests/schema-lint.test.cjs — A NEW MIGRATION INDEXES ITS FOREIGN KEYS, FORCES ITS RLS, USES timestamptz AND NO NATIONAL DEFAULT, KEYS ITS
 * ONCE-ONLY FACTS, AND APPLIES ON AN EMPTY DATABASE (SCHEMA-ASSESSMENT-2026-10-16 "The GUARD"; SCHEMA-FIX1). No database, no network.
 *
 * OWNS     the gate over migrations/. The reading is tools/schema-replay.cjs (one copy); the chain order and skip rules are tools/migrate.cjs's.
 * RULES    R1 FK without index · R2 entity_id table without ENABLE+FORCE+POLICY · R3 entity_id without a leading index · R4 timestamp without tz
 *          · R5 money in text/float/numeric(p,2) · R6 DEFAULT 'IN'/'INR'/… · R7 once-only key without a unique · R8 index repeats/prefixes another
 *          · R9 CREATE TABLE IF NOT EXISTS with a foreign key · R10 unterminated $$ · R11 alter of a table no earlier file creates
 *          · R12 a DO block that raises on missing production data · R13 CONCURRENTLY inside BEGIN · R14 jsonb column with no FIELDS.md row
 *          · R15 DROP/TRUNCATE/DELETE without `-- DESTRUCTIVE: approved <who> <date>` · R16 new table without `-- OWNER: <module>` · R17 file name.
 *          The fresh-database proof of R11 is the CI job `fresh-db` (an empty Postgres), not this file.
 * BASELINE migrations/schema-lint.baseline.json: the files that existed on 16 Oct and `file|rule|object` for each violation in them. A file
 *          NOT in the baseline is new and must pass every rule. The violation list may only SHRINK: a fixed entry that is still listed fails
 *          here (take it out); `--write-baseline` refuses to add one. An exception is a header line `-- schema-lint: allow R5 <reason>`:
 *          printed and counted below, like ALLOWED in migration-rls.test.js.
 * FLOW     self-test of each rule on a snippet → replay migrations/ → new files clean · baseline files add nothing · baseline has no stale line
 */
'use strict';
const fs = require('fs'), path = require('path');
const { replay, keyOf, readFile, Model, RULES, allowedRules } = require('../tools/schema-replay.cjs');

const BASELINE_FILE = path.join(__dirname, '..', 'migrations', 'schema-lint.baseline.json');
let checks = 0, failed = 0;
const check = (what, ok, extra) => { checks++; if (!ok) failed++; console.log((ok ? '  ✓ ' : '  ✗ ') + what + (extra ? '   ' + extra : '')); };

/** one snippet through the same rules: which rules fire on it */
function rulesFiredBy(sql, header) {
  const src = (header || '') + sql, model = new Model(), facts = readFile(model, src);
  ['users', 'parent', 'ledger'].forEach((t) => model.known.add(t));
  return Object.keys(RULES).filter((r) => RULES[r](facts, model, { source: src, fileName: 'b900_x.sql', fieldsText: '' }).length);
}

/** each row: the rule, a snippet it must catch, and a clean snippet it must let through */
const SELF_TESTS = [
  ['R1', 'CREATE TABLE a (id int PRIMARY KEY, parent_id int REFERENCES parent(id));', 'CREATE TABLE a (id int PRIMARY KEY, parent_id int REFERENCES parent(id)); CREATE INDEX a_p ON a (parent_id);'],
  ['R2', 'CREATE TABLE a (entity_id uuid);', 'CREATE TABLE a (entity_id uuid); ALTER TABLE a ENABLE ROW LEVEL SECURITY; ALTER TABLE a FORCE ROW LEVEL SECURITY; CREATE POLICY p ON a USING (true);'],
  ['R3', 'CREATE TABLE a (id int, entity_id uuid);', 'CREATE TABLE a (id int, entity_id uuid); CREATE INDEX a_e ON a (entity_id, id);'],
  ['R4', 'CREATE TABLE a (id int, made timestamp);', 'CREATE TABLE a (id int, made timestamptz);'],
  ['R5', 'CREATE TABLE a (id int, price numeric(18,2));', 'CREATE TABLE a (id int, price_minor bigint);'],
  ['R6', "CREATE TABLE a (id int, country text DEFAULT 'IN');", 'CREATE TABLE a (id int, country text);'],
  ['R7', 'CREATE TABLE a (id int, client_ref text);', 'CREATE TABLE a (id int, client_ref text UNIQUE);'],
  ['R8', 'CREATE TABLE a (id int, b int, c int); CREATE INDEX a_bc ON a (b, c); CREATE INDEX a_b ON a (b);', 'CREATE TABLE a (id int, b int, c int); CREATE INDEX a_b ON a (b); CREATE INDEX a_bc ON a (b, c);'],
  ['R9', 'CREATE TABLE IF NOT EXISTS a (id int, p int REFERENCES parent(id));', 'CREATE TABLE a (id int, p int);'],
  ['R10', 'DO $$ BEGIN PERFORM 1; END $;', 'DO $$ BEGIN PERFORM 1; END $$;'],
  ['R11', 'ALTER TABLE ghost ADD COLUMN x int;', 'ALTER TABLE users ADD COLUMN x int;'],
  ['R12', 'DO $$ BEGIN SELECT 1 FROM users; IF NOT FOUND THEN RAISE EXCEPTION $m$none$m$; END IF; END $$;', 'DO $$ BEGIN PERFORM 1; END $$;'],
  ['R13', 'BEGIN; CREATE INDEX CONCURRENTLY i ON users (x); COMMIT;', 'CREATE INDEX i ON users (x);'],
  ['R14', 'ALTER TABLE users ADD COLUMN zzz_unlisted jsonb;', 'ALTER TABLE users ADD COLUMN x int;'],
  ['R15', 'DROP TABLE users;', 'SELECT 1;'],
  ['R16', 'CREATE TABLE a (id int);', 'CREATE TABLE a (id int);', '-- OWNER: lib/x.js\n'],
  ['R17', 'SELECT 1;', 'SELECT 1;']
];
console.log('\n── each rule fires on its own bad snippet, and stays quiet on the good one ──');
for (const [rule, bad, good, header] of SELF_TESTS) {
  if (rule === 'R17') { check('R17 a name outside bNNN_*.sql is refused', RULES.R17({}, null, { fileName: 'weird name.sql' }).length === 1 && !RULES.R17({}, null, { fileName: 'b9_x.sql' }).length); check('R17 a hand-run RUN-* file is a known name', !RULES.R17({}, null, { fileName: 'RUN-2026-10-20-0-x.sql' }).length); continue; }
  const fired = rulesFiredBy(bad), clean = rulesFiredBy(good, header);
  check(rule + ' fires on its bad snippet', fired.includes(rule), 'fired: ' + fired.join(' '));
  check(rule + ' is quiet on the good one', !clean.includes(rule), 'fired: ' + clean.join(' '));
}
check('an allow header names the rules it excuses', [...allowedRules('-- schema-lint: allow R5 R6 because\nSELECT 1;').rules].join() === 'R5,R6');

console.log('\n── migrations/ replayed in chain order ──');
const { files, violations, allows, baselineTables } = replay();
const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
const baselineFiles = new Set(baseline.files), baselineViolations = new Set(baseline.violations);
const live = violations.filter((v) => !v.allowed);

if (process.argv.includes('--write-baseline')) {
  const keys = live.filter((v) => baselineFiles.has(v.file)).map(keyOf);
  const added = keys.filter((k) => !baselineViolations.has(k));
  if (added.length && !process.argv.includes('--init')) { console.error('  ✗ the baseline may only shrink; would add:\n    ' + added.join('\n    ')); process.exit(1); }
  fs.writeFileSync(BASELINE_FILE, JSON.stringify({ _: baseline._, files: baseline.files, violations: keys.sort() }, null, 1) + '\n');
  console.log('  baseline written: ' + keys.length + ' violation(s)'); process.exit(0);
}

const newFiles = files.filter((f) => !baselineFiles.has(f));
const fromNew = live.filter((v) => !baselineFiles.has(v.file));
const grown = live.filter((v) => baselineFiles.has(v.file) && !baselineViolations.has(keyOf(v)));
const stale = [...baselineViolations].filter((k) => !live.some((v) => keyOf(v) === k));
const gone = baseline.files.filter((f) => !files.includes(f));

check('every NEW migration (' + newFiles.length + ') passes every rule', fromNew.length === 0, fromNew.slice(0, 8).map(keyOf).join(' | '));
check('no file in the baseline picked up a violation it did not have', grown.length === 0, grown.slice(0, 8).map(keyOf).join(' | '));
check('the baseline holds nothing already fixed (it only shrinks)', stale.length === 0, stale.slice(0, 5).join(' | ') + (stale.length > 5 ? ' …' : '') + '  → node tests/schema-lint.test.cjs --write-baseline');
check('every file the baseline names still exists', gone.length === 0, gone.join(', '));
/* DB-REBASE (18 Oct): the old chain is in migrations/archive/; the one baseline is read into the model, not judged. A new file is
   judged against every table the baseline makes — so the model must hold them all (158 on 18 Oct), or R11 would wave through anything. */
check('the one baseline was read into the model', baselineTables >= 150, baselineTables + ' tables · ' + files.length + ' file(s) judged after it');
console.log('\n  ' + allows.length + ' allow header(s):' + (allows.length ? '\n    ' + allows.join('\n    ') : ' none'));
console.log('\n  ' + checks + ' checks');
process.exit(failed ? 1 : 0);
