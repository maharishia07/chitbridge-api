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

console.log('\n-- b189 repairs the silent-empty-table class --');
const rd = (f) => fs.existsSync(path.join(DIR, f)) ? fs.readFileSync(path.join(DIR, f), 'utf8') : '';
const b189dry = rd('b189_rls_without_policy_dryrun.sql');
const b189app = rd('b189_rls_without_policy_apply.sql');
/* ⭐ THE CLASS: RLS enabled with no policy returns ZERO ROWS to every non-owner, silently. The owner is exempt
   unless FORCE is set, so it looks correct in the SQL editor and empty in the app. */
t('the audit finds RLS-on-with-no-policy, not just one table',
  /relrowsecurity/.test(b189dry) && /pg_policy/.test(b189dry) && /needs_policy/.test(b189dry));
/* ⚠️ It must scan every table, or it answers a narrower question than the one asked. */
t('  ...across all of public, not a named list',
  /nspname = 'public'/.test(b189dry) && !/register_attachable/.test(b189dry.replace(/--.*$/gm, '')));
t('the fix is a policy, so the intent is visible in the database',
  /CREATE POLICY register_attachable_read_all/.test(b189app) && /FOR SELECT/.test(b189app));
/* ⚠️ Read-only: nothing writes this table but a migration, so a WITH CHECK would grant more than intended. */
t('  ...read-only, with no WITH CHECK', !/WITH CHECK/i.test(b189app.replace(/--.*$/gm, '')));
t('  ...and re-runnable', /DROP POLICY IF EXISTS/.test(b189app));
/* ⭐ The apply must not quietly stand in for the audit — it reports whether anything else is still affected. */
t('the apply reports whether other tables are still unreadable',
  /STILL UNREADABLE TO THE APP/.test(b189app) && /pg_policy/.test(b189app) && /relrowsecurity/.test(b189app));

console.log('\n  == ' + pass + ' passed - ' + fail + ' failed ==\n');
process.exitCode = fail ? 1 : 0;
