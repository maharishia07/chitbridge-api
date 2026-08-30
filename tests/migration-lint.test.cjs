/**
 * tests/migration-lint.test.cjs — the two ways a hand-run migration fails SILENTLY.
 *
 * ⚠️⚠️ WHY THIS FILE EXISTS. b185 opened `DO $$` and closed `END $;`. Postgres reads `$$` as the opening
 * delimiter and then looks for another `$$` to close it — `$;` is not one — so the block swallows the rest of
 * the file as an unterminated string. The migration cannot be run whole. What actually happened is worse than
 * an error: it got run in pieces to get past it, and one piece — the INSERT that seeds register_attachable —
 * was never run at all. The app then reported "nothing may be attached" for a day.
 *
 * These migrations are run BY HAND in the Supabase SQL editor, so there is no runner to catch either mistake.
 * This file is the runner.
 */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'migrations');

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.error('  ✗ ' + name + (extra ? '   ' + extra : '')); }
};

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

console.log('\n-- ⚠️⚠️ every dollar-quoted block must CLOSE --');
/* ⚠️ BASELINED, NOT FIXED. b185 is left exactly as it was run — a migration is a record of what was run, and
   editing one so a checker passes falsifies the history it exists to keep. Its postscript says what went wrong.
   The guard points FORWARD: no NEW migration may carry the shape. */
const ACCEPTED_QUOTES = ['b185_register.sql'];
const badQuotes = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(DIR, f), 'utf8');
  const code = src.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
  /* Every dollar-quote delimiter: $$ or $tag$. They must pair up. */
  const tags = code.match(/\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/g) || [];
  const counts = {};
  for (const tag of tags) counts[tag] = (counts[tag] || 0) + 1;
  const odd = Object.keys(counts).filter((k) => counts[k] % 2 !== 0);
  /* ⚠️ The b185 shape specifically: a block ended with a bare `$;` instead of the delimiter. Postgres reads
     `$$` as the opener and looks for another `$$`; `$;` is not one, so the rest of the file becomes an
     unterminated string and the migration CANNOT BE RUN WHOLE. What follows is worse than an error — it gets
     run in pieces to get past it, and on 2026-08-30 one piece, a seed INSERT, was never run at all. */
  const strayEnd = /\bEND\s+\$\s*;/.test(code);
  if (odd.length || strayEnd) badQuotes.push(f + (strayEnd ? ' (END $; — not a delimiter)' : ' (unpaired ' + odd.join(',') + ')'));
}
const newBad = badQuotes.filter((b) => ACCEPTED_QUOTES.indexOf(b.split(' ')[0]) < 0);
t('no NEW migration has an unterminated DO block', newBad.length === 0, newBad.join(' | '));
t('  ...across every migration on disk', files.length > 100, files.length + ' files scanned');
/* Anti-rot: the baseline must keep naming a real occurrence, or it is decoration. */
t('  ...and b185 is still on record as the one that did',
  badQuotes.some((b) => b.indexOf('b185_register.sql') === 0));

console.log('\n-- ⚠️ a table created with IF NOT EXISTS may silently skip its constraints --');
/* ⭐ THE b185 SUBJECT BUG. `CREATE TABLE IF NOT EXISTS x (... REFERENCES y ...)` is a NO-OP when x already
   exists — and the FOREIGN KEY written inside it is then never created, with nothing said. The table reads
   correctly in the file and is wrong in the database, which is why b185's gap stayed invisible for a day:
   opening a register against an EMPTY registry succeeded, where the foreign key would have refused it.

   ⚠️ WHETHER IT BITES CANNOT BE SEEN FROM THE FILE — it depends on whether the table already existed when the
   migration ran, which is history, not source. So this is a BASELINE, the same shape as the query-shape budget:
   the occurrences below are accepted history, and a NEW one fails. Adding a table this way is still fine; what
   is not fine is adding one silently, without deciding whether the constraint needs its own guarded ALTER. */
const ACCEPTED = [
  /* the original schema and the simulator — created once, never re-run */
  'net01_network.sql -> cb_edge', 'net02_chit.sql -> cb_chit', 'net02_chit.sql -> cb_chit_item',
  'net03_full_schema.sql -> cb_city', 'net03_full_schema.sql -> cb_device',
  'net03_full_schema.sql -> cb_entity_employee', 'net03_full_schema.sql -> cb_contact',
  'net03_full_schema.sql -> cb_catalogue_category', 'net03_full_schema.sql -> cb_catalogue_item',
  'net03_full_schema.sql -> cb_chit_log', 'net03_full_schema.sql -> cb_task',
  'net03_full_schema.sql -> cb_transaction_history', 'net03_full_schema.sql -> cb_consumer_traction',
  'net03_full_schema.sql -> cb_external_reference',
  'sim01_simulator.sql -> sim_items', 'sim01_simulator.sql -> sim_feedback',
  /* later tables, each created once and confirmed carrying its key */
  'b60_blueprint_catalogue.sql -> blueprint_template', 'b61_chit_reads.sql -> chit_reads',
  'b63_folders.sql -> folder', 'b111_network_design.sql -> network_design',
  'b112_catalogue_face.sql -> catalogue_face', 'b132_folder_rules.sql -> folder_rule',
  'b172_access_events.sql -> access_events', 'b174_identity_documents.sql -> identity_documents',
  'b177_supplier_readiness_acceptance.sql -> supplier_readiness_acceptance',
  'b182_line_raida.sql -> chit_line_raida',
  /* ⚠️ THE ONE THAT ACTUALLY BIT, kept here so the count is honest. b186 adds the constraint separately. */
  'b185_register.sql -> register_subject',
];
const found = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(DIR, f), 'utf8');
  const code = src.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
  const re = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\n\)\s*;/gi;
  let m;
  while ((m = re.exec(code))) if (/\bREFERENCES\b/i.test(m[2])) found.push(f + ' -> ' + m[1]);
}
const isNew = found.filter((x) => ACCEPTED.indexOf(x) < 0);
t('no NEW migration hides a foreign key inside CREATE TABLE IF NOT EXISTS', isNew.length === 0, isNew.join(' | '));
/* ⚠️ Anti-rot, borrowed from the query-shape budget: a baseline that names things which no longer exist stops
   being a record of accepted risk and becomes decoration. */
const stale = ACCEPTED.filter((x) => found.indexOf(x) < 0);
t('  ...and the baseline names nothing that has since gone', stale.length === 0, stale.join(' | '));
t('  ...covering every occurrence on disk', found.length === ACCEPTED.length, found.length + ' occurrences');

console.log('\n-- b186 repairs exactly what b185 left --');
const b186 = fs.existsSync(path.join(DIR, 'b186_register_seed_apply.sql'))
  ? fs.readFileSync(path.join(DIR, 'b186_register_seed_apply.sql'), 'utf8') : '';
t('the seed is re-runnable', /INSERT INTO register_attachable/.test(b186) && /ON CONFLICT \(type_key\) DO NOTHING/.test(b186));
t('the skipped foreign key is added separately', /ALTER TABLE register_subject[\s\S]{0,200}ADD CONSTRAINT/.test(b186));
/* ⚠️ It must not error on a database where a subject already carries an unknown kind — it reports instead. */
t('  ...and only when nothing would violate it', /NOT EXISTS \([\s\S]{0,300}register_subject s/.test(b186));
t('it changes nothing that exists', !/\bUPDATE\s+register_|\bDELETE\s+FROM\s+register_/i.test(b186));
/* ⚠️ THE MISTAKE THIS CATCHES, made 2026-08-30: the first b186 dry run opened with
   `SELECT count(*) FROM register_attachable` and died with 42P01 on the very question it existed to answer.
   A script that reports whether a table is usable must read the CATALOG, never the table. */
const dry = fs.existsSync(path.join(DIR, 'b186_register_seed_dryrun.sql'))
  ? fs.readFileSync(path.join(DIR, 'b186_register_seed_dryrun.sql'), 'utf8') : '';
const dryCode = dry.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
t('the dry run reads the catalog, never the table it is checking for',
  !!dry && !/\bFROM\s+register_/i.test(dryCode));
t('  ...and still reports rows, schema and privilege',
  /query_to_xml/.test(dryCode) && /nspname/.test(dryCode) && /has_table_privilege/.test(dryCode));
/* ⭐ The apply must not create a second copy in public when one already exists in another schema. */
t('the apply resolves through the search path before creating anything',
  /to_regclass\('register_attachable'\) IS NULL/.test(b186));

console.log('\n-- ⚠️⚠️ a GRANT to a role that does not exist rolls back the WHOLE migration --');
/* ⭐⭐ THE ROOT CAUSE OF THE b185 EPISODE. `GRANT ... TO cb_app` raises 42704 — the role does not exist on this
   database. The Supabase editor runs a script as ONE TRANSACTION, so that single error rolls back everything
   the file did. The only way past it is to run the file in fragments, and a fragment then goes missing: here it
   was the INSERT seeding register_attachable, which left the registry empty for a day.

   ⚠️ Isolation never rested on these grants. The register tables are FORCE ROW LEVEL SECURITY, which applies
   the policy even to the table's owner — the case that matters when the app connects as the owner.

   BASELINED, NOT FIXED: 68 files already carry this and they are the record of what was run. The guard points
   FORWARD — a NEW migration must wrap the GRANT in a pg_roles check, the way b186 does. */
const grantFiles = files.filter((f) => {
  const code = fs.readFileSync(path.join(DIR, f), 'utf8')
    .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
  if (!/\bTO\s+cb_app\b/i.test(code)) return false;
  /* Guarded if the file checks pg_roles anywhere — b186's shape. */
  return !/pg_roles[\s\S]{0,120}cb_app/i.test(code);
});
const ACCEPTED_GRANTS = 50;
t('no NEW migration grants to cb_app unguarded',
  grantFiles.length <= ACCEPTED_GRANTS, grantFiles.length + ' unguarded (baseline ' + ACCEPTED_GRANTS + ')');
/* Anti-rot: if the count drops the baseline should come down with it, or it stops meaning anything. */
t('  ...and the baseline has not drifted above the truth',
  grantFiles.length === ACCEPTED_GRANTS, grantFiles.length + ' files');
t('b186 guards its own grant', /pg_roles[\s\S]{0,120}cb_app/i.test(b186));



console.log('\n  == ' + pass + ' passed - ' + fail + ' failed ==\n');
process.exitCode = fail ? 1 : 0;
