/* ⚠️ CRLF-tolerant (2026-09-28): a Windows checkout (autocrlf) hands back \r\n, and patterns anchored on \n went red on line endings alone */
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
/* DB-REBASE (18 Oct): the SQL as written lives in migrations/archive/ (before the one baseline) and migrations/ (after it);
   the baseline itself is a pg_dump, proven by the rebase fingerprint, so it is not read here */
const WRITTEN = new Map(require('../tools/migrate.cjs').writtenSqlFiles().map((x) => [x.name, x.path]));
const at = (f) => WRITTEN.get(f) || path.join(DIR, f);

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.error('  ✗ ' + name + (extra ? '   ' + extra : '')); }
};

const files = [...WRITTEN.keys()].filter((f) => f.endsWith('.sql')).sort();

console.log('\n-- ⚠️⚠️ every dollar-quoted block must CLOSE --');
/* SCHEMA-FIX1 (16 Oct): b185 was FIXED IN PLACE (`END $$;`) so an empty database builds — nothing is accepted any more.
   The guard still refuses any file, old or new, that carries the shape. */
const ACCEPTED_QUOTES = [];
const badQuotes = [];
for (const f of files) {
  const src = fs.readFileSync(at(f), 'utf8').replace(/\r\n/g, '\n');
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
t('  ...and b185 no longer carries the shape', !badQuotes.some((b) => b.indexOf('b185_register.sql') === 0));

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
  /* ⚠️⚠️ ACCEPTED 2026-09-28 WITH A FIX WAITING, not as history that was checked. These eight were red here since they
     landed and nobody ran this test in the gate. Their keys are added separately, idempotently (NOT VALID, then
     VALIDATE) by docs/drafts/fk_b250_b262_b264_draft.sql — the b186 step for them. Until Athi runs it, production
     MAY lack these constraints. When it has run and moved to migrations/, change this note to "bNNN adds them". */
  'b250_work_routing_by_kind.sql -> entity_work_routing',
  'b262_quick_key_groups.sql -> quick_key_group', 'b262_quick_key_groups.sql -> quick_key_group_item',
  'b262_quick_key_groups.sql -> counter_quick_key_state', 'b262_quick_key_groups.sql -> counter_hidden_item',
  'b262_quick_key_groups.sql -> device_screen_config', 'b262_quick_key_groups.sql -> quick_key_audit',
  'b264_signup_context.sql -> signup_context',
];
const found = [];
for (const f of files) {
  const src = fs.readFileSync(at(f), 'utf8').replace(/\r\n/g, '\n');
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

console.log('\n-- ⚠️ an insert-only GRANT must REVOKE the rest beside it --');
/* ⭐ b765 (18 Oct): `GRANT SELECT, INSERT ON move_in_import TO cb_app` read as insert-only, but the DEFAULT PRIVILEGES had already handed
   cb_app UPDATE and DELETE — a GRANT only adds. Live needed an extra REVOKE. So a GRANT to cb_app that names INSERT and not UPDATE/DELETE
   (an append-only table) must carry `REVOKE … UPDATE, DELETE … ON <table> FROM cb_app` in the same file.
   ⚠️ BASELINE, like the one above: the files below were written before the rule. Whether live holds UPDATE/DELETE on them is a database
   fact this file cannot see — listed, never assumed fixed. A NEW one fails. */
const ACCEPTED_GRANTS = [
  'b79_source_penetration.sql -> source_penetration', 'b80_container_model.sql -> product_version', 'b81_regional_scatter.sql -> resolved_blueprint',
  'b82_erp_handoff.sql -> erp_handoff', 'b99_ai_usage.sql -> usage_ledger', 'b107_kyb_field_cache.sql -> kyb_field_cache',
  'b160_definitions.sql -> definition_version', 'b249_population_as_a_value.sql -> ops.population', 'b265_signup_context_rls.sql -> signup_context',
  'b268_definition_status_log.sql -> definition_status_log', 'b269_ai_usage_force_rls.sql -> ai_usage', 'b309_books_compare.sql -> books_compare_part',
  'b391_fx_rates.sql -> fx_rate',
];
/** every GRANT to cb_app that adds INSERT without UPDATE/DELETE, and those of them with no REVOKE of UPDATE + DELETE on the same table */
function insertOnlyGrants() {
  const all = [], unrevoked = [];
  for (const f of files) {
    const code = fs.readFileSync(at(f), 'utf8').replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
    const re = /GRANT\s+([A-Z ,]+?)\s+ON\s+(?:TABLE\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s+TO\s+cb_app\b/gi;
    let m;
    while ((m = re.exec(code))) {
      const privs = m[1].toUpperCase().split(/\s*,\s*/).map((x) => x.trim());
      if (!privs.includes('INSERT') || privs.some((x) => x === 'ALL' || x === 'UPDATE' || x === 'DELETE')) continue;
      const table = m[2], key = f + ' -> ' + table;
      all.push(key);
      const revoke = new RegExp('REVOKE\\s+[A-Z ,]*\\bUPDATE\\b[A-Z ,]*\\bDELETE\\b[A-Z ,]*\\s+ON\\s+(?:TABLE\\s+)?' + table.replace('.', '\\.') + '\\s+FROM\\s+cb_app\\b', 'i');
      if (!revoke.test(code)) unrevoked.push(key);
    }
  }
  return { all, unrevoked };
}
const grants = insertOnlyGrants();
const B765 = 'b765_move_in_import.sql -> move_in_import';
const newUnrevoked = grants.unrevoked.filter((x) => ACCEPTED_GRANTS.indexOf(x) < 0);
t('no NEW insert-only GRANT to cb_app without its REVOKE', newUnrevoked.length === 0, newUnrevoked.join(' | '));
t('  ...and b765 carries its REVOKE', grants.all.indexOf(B765) >= 0 && grants.unrevoked.indexOf(B765) < 0);
t('  ...and the baseline names nothing since fixed or gone', ACCEPTED_GRANTS.every((x) => grants.unrevoked.indexOf(x) >= 0),
  ACCEPTED_GRANTS.filter((x) => grants.unrevoked.indexOf(x) < 0).join(' | '));

console.log('\n-- b189 repairs the silent-empty-table class --');
const rd = (f) => fs.existsSync(at(f)) ? fs.readFileSync(at(f), 'utf8').replace(/\r\n/g, '\n') : '';
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

console.log('\n-- DB-9 / DB-36: a new column speaks the vocabulary and is not a near-duplicate --');
/* K-DB (21 Oct 2026). The vocabulary is C:/dev/PM/NAMING-AND-MEANING.md section 2 (Athi, 18 Oct: "the meaning should be same across
   everywhere"): a new column never uses a word listed there as a forbidden synonym. The column inventory is C:/dev/schema-inventory.cjs
   read over THIS migrations/ folder (the baseline + the numbered files): a new column whose name differs from an existing one only by
   underscores, case or a trailing s (retention_sources beside retention_source) is a near-duplicate, and a live column is never renamed.
   Both files live in the docs repo beside this one (C:/dev, or ../chitbridge-docs in the cloud runner); where it is absent (GitHub CI)
   the check SAYS it was not run, never passes in silence. */
const DOCS = [path.join(__dirname, '..', '..'), path.join(__dirname, '..', '..', 'chitbridge-docs')].find((dir) =>
  fs.existsSync(path.join(dir, 'schema-inventory.cjs')) && fs.existsSync(path.join(dir, 'PM', 'NAMING-AND-MEANING.md')));
/** the snake_case names section 2 forbids in new code (the backticked words of its "Forbidden synonyms" column) */
function forbiddenWords(doc) {
  const words = new Set();
  const section = doc.split(/\n## 2\. /)[1] || '';
  for (const row of section.split(/\n## /)[0].split('\n').filter((line) => line.startsWith('|'))) {
    const cells = row.split('|');
    for (const m of (cells[4] || '').matchAll(/`([a-z][a-z0-9_]*)`/g)) words.add(m[1]);
  }
  return words;
}
/**
 * A column that ALREADY RAN in production keeps its name (a live column is never renamed, checked below), so the vocabulary rule cannot be satisfied by renaming it; each such column is named here WITH
 * ITS REASON. An entry nobody needs any more fails the stale check, so this list only shrinks. (F4, critic 25 Oct)
 */
const VOCABULARY_ALLOWED = {
  'chit_proposal.currency_code': 'b796 already ran in PRODUCTION: the column carries the same value as chit_header/chit_detail.currency_code on the chit it proposes for (one name across the chit tables); never renamed',
  'chit_proposal.note': 'b796 already ran in PRODUCTION: the round’s own one-line note, a different fact from the chit’s notes column; never renamed',
  'membership_certificate.note': 'b790 already ran in PRODUCTION (25 Oct): the certificate’s one-line operator note (why it was suspended or revoked), a different fact from any chit notes column; never renamed (DB-85)'
};
const nearKey = (name) => name.toLowerCase().replace(/_/g, '').replace(/s$/, '');
/** the problems with these new columns against the existing ones → ['table.column: why'] */
function vocabularyProblems(fresh, existing, forbidden) {
  const byKey = new Map(existing.map((name) => [nearKey(name), name]));
  const out = [];
  for (const { table, column } of fresh) {
    if (!/^[a-z][a-z0-9_]*$/.test(column)) out.push(table + '.' + column + ': not snake_case');
    if (forbidden.has(column)) out.push(table + '.' + column + ': a forbidden synonym (NAMING-AND-MEANING section 2)');
    const twin = byKey.get(nearKey(column));
    if (twin && twin !== column) out.push(table + '.' + column + ': near-duplicate of the existing column ' + twin);
  }
  return out;
}
if (!DOCS) console.log('  - vocabulary and near-duplicate check NOT RUN: schema-inventory.cjs / PM/NAMING-AND-MEANING.md not beside the repo');
else {
  const inventory = require(path.join(DOCS, 'schema-inventory.cjs')).read(DIR);
  const forbidden = forbiddenWords(fs.readFileSync(path.join(DOCS, 'PM', 'NAMING-AND-MEANING.md'), 'utf8'));
  const BASE = require('../tools/migrate.cjs').BASELINE[0].replace(/\.sql$/, '');
  const existing = [...new Set(inventory.filter((x) => x.born === BASE).flatMap((x) => x.cols))];
  const fresh = inventory.flatMap((x) => (x.born === BASE ? [] : x.cols).concat(x.added).map((column) => ({ table: x.name, column })));
  t('the vocabulary has forbidden words to check against', forbidden.has('shop_id') && forbidden.has('product_id'), forbidden.size + ' words');
  const problemsAll = vocabularyProblems(fresh, existing, forbidden);
  const found = problemsAll.filter((line) => !Object.keys(VOCABULARY_ALLOWED).some((key) => line.startsWith(key + ':')));
  t('no new column after the baseline breaks the vocabulary or near-duplicates one', found.length === 0, fresh.length + ' new · ' + found.join(' | '));
  t('every allowed column has a reason of a sentence and is still a problem the rule would raise (the list only shrinks)',
    Object.entries(VOCABULARY_ALLOWED).every(([key, why]) => why.length > 40 && problemsAll.some((line) => line.startsWith(key + ':'))),
    Object.keys(VOCABULARY_ALLOWED).filter((key) => !problemsAll.some((line) => line.startsWith(key + ':'))).join(', '));
  t('  ...the rule fires on a planted near-duplicate (retention_sources)',
    vocabularyProblems([{ table: 'chit_status', column: 'retention_sources' }], existing.concat(['retention_source']), forbidden).length === 1);
  t('  ...and on a planted forbidden synonym (shop_id)', vocabularyProblems([{ table: 'x', column: 'shop_id' }], existing, forbidden).length === 1);
  const renames = require('../tools/migrate.cjs').chainFiles().filter((f) => /\bRENAME\s+COLUMN\b/i.test(fs.readFileSync(at(f), 'utf8').replace(/--.*$/gm, '')));
  t('no numbered migration renames a live column', renames.length === 0, renames.join(' | '));
}

console.log('\n  == ' + pass + ' passed - ' + fail + ' failed ==\n');
console.log('  ' + pass + ' checks');   /* the gate (scripts/guards.cjs) reads "<n> checks" */
process.exitCode = fail ? 1 : 0;
