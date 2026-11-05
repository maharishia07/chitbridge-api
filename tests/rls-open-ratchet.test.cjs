'use strict';
/**
 * tests/rls-open-ratchet.test.cjs — SEC-75: the tables cb_app can read with row level security OFF are each CLASSIFIED, and the count that
 * is not a dictionary may only fall.
 * CARD 28-platform-and-operations/rls-census
 *
 * OWNS       the rule on db/rls-baseline.json: every open, readable table says what it is — dictionary (platform-wide reference, no shop key:
 *            no RLS is right, with the reason) · entity (one shop's rows: RLS is owed) · shared (either side of a row reads it: the unit
 *            named in `why` decides) · platform-private (no shop key, not reference: needs another design). The number of open tables that are
 *            NOT dictionaries may not rise above CEILING; a PR that closes tables lowers CEILING to the new count in the same change.
 * CALLED BY  scripts/guards.cjs (offline: reads the committed baseline and migrations/, no database).
 * FLOW       baseline → open set → class + reason present → count ≤ CEILING → each `fix` names a migration that ENABLEs and FORCEs RLS
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'db', 'rls-baseline.json'), 'utf8')).tables;

/** open non-dictionary tables: 33 at the 26 Sep census; 20 after Athi ran b779 + b783 in production (29 Oct, no rows) and the baseline was re-saved. Lower it when a migration has run and the baseline is re-saved. */
const CEILING = 19;
const CLASSES = ['dictionary', 'entity', 'shared', 'platform-private'];

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ ' + name + (extra ? '   ' + extra : '')); }
};

const open = Object.keys(baseline).filter((name) => !baseline[name].rls && baseline[name].app_reads);
const unclassified = open.filter((name) => CLASSES.indexOf(baseline[name].class) < 0);
check('every open, readable table has a class (' + open.length + ' tables)', unclassified.length === 0, unclassified.join(', '));

const noReason = open.filter((name) => !String(baseline[name].why || '').trim());
check('every open table says why in one line', noReason.length === 0, noReason.join(', '));

const notDictionary = open.filter((name) => baseline[name].class !== 'dictionary');
check('open tables that are not dictionaries: ' + notDictionary.length + ' ≤ ' + CEILING + ' (the count may only fall)', notDictionary.length <= CEILING);

const claimed = Object.keys(baseline).filter((name) => baseline[name].class === 'dictionary' && baseline[name].rls);
check('a dictionary has RLS off (a table with RLS on is not one)', claimed.length === 0, claimed.join(', '));

/** a `fix` is a migration in migrations/ that ENABLEs and FORCEs RLS on that table and creates a policy for it */
const badFix = Object.keys(baseline).filter((name) => {
  const file = baseline[name].fix;
  if (!file) return false;
  const full = path.join(ROOT, 'migrations', file);
  if (!fs.existsSync(full)) return true;
  const sql = fs.readFileSync(full, 'utf8');
  const onTable = (verb) => new RegExp('ALTER TABLE (public[.])?' + name + ' ' + verb + ' ROW LEVEL SECURITY').test(sql);
  const policyTables = (sql.match(/CREATE POLICY [a-z_]+ ON (?:public[.])?[a-z_]+/g) || []).map((m) => m.split(' ').pop().replace('public.', ''));
  return !(onTable('ENABLE') && onTable('FORCE') && policyTables.indexOf(name) >= 0);
});
check('every `fix` names a migration that ENABLEs, FORCEs and adds a policy', badFix.length === 0, badFix.join(', '));

/* a table with a fix but no probe-row recipe has no isolation proof in the fresh-db job */
const PROBES = require('./rls-sec75-tables.cjs');
const unproved = Object.keys(baseline).filter((name) => baseline[name].fix && !PROBES[name]);
check('every table with a `fix` has a probe-row recipe for the fresh-db isolation test', unproved.length === 0, unproved.join(', '));

const fixed =Object.keys(baseline).filter((name) => baseline[name].fix && !baseline[name].rls).length;
console.log('\n  ' + fixed + ' open table(s) have a migration written, waiting for Athi to run it.');
console.log('\n  ' + (fail ? '✗ ' + fail + ' failed' : '✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
