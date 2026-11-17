#!/usr/bin/env node
/**
 * tools/baseline-from-snapshot.cjs — builds migrations/000_baseline_2026-10-21.sql out of production's own schema dump (DB-3, Athi 21 Oct 2026).
 *
 *   node tools/baseline-from-snapshot.cjs --snapshot <pg_dump --schema-only --no-owner -n public> --ops <pg_dump -s -n ops>
 *        --metrics <pg_dump -s -n metrics> --data <pg_dump -a --column-inserts of the seeded tables> --out migrations/000_baseline_2026-10-21.sql
 *
 * OWNS       the text edits that turn a production dump into a baseline a fresh database can load; nothing else.
 * CALLED BY  nobody at run time: it is how the file was made (and can be made again from a newer snapshot); tests/baseline-from-snapshot.test.cjs.
 * FLOW       read the five dumps → edit the public one → split ops → fill tools/baseline-template.sql → write the baseline.
 * CARD       28-platform-and-operations/migrations-and-schema
 * The snapshot stays OUTSIDE git (it names every table and policy of production); the baseline is its public-schema text, edited only as follows:
 *   - `\restrict` / `\unrestrict` lines removed (psql 17.6+ only; older psql and the Supabase editor refuse them)
 *   - `SET transaction_timeout` removed (a PostgreSQL 17 setting: the local stack still runs 16)
 *   - `CREATE SCHEMA public;` removed (every database already has it)
 *   - search_path `pg_catalog, public` instead of empty (a trigger WHEN compares ltree values with an operator pg_dump cannot qualify)
 *   - varchar CHECKs `= ANY ((ARRAY[..])::text[])` written `= ANY (ARRAY[..])` (same meaning; re-parses to the dumped tree)
 *   - every GRANT / REVOKE / ALTER DEFAULT PRIVILEGES aimed at a Supabase-only role (service_role anon authenticated postgres supabase_*)
 *   - tools/baseline-template.sql holds the header, the roles and the order: roles, ltree, the ops tables go BEFORE the dump (identities points at
 *     ops.population); ops views/functions/triggers, metrics (views over public) and the reference rows go AFTER it. ops and metrics are NOT in the snapshot (the app role is closed out of ops): they come from the
 *     migration files, through a scratch database, and are marked "not compared with live" in the file.
 */
'use strict';
const fs = require('fs'),
  path = require('path');

const SUPABASE_ROLES = /\b(service_role|anon|authenticated|postgres|supabase_[a-z_]+)\b/;
const argOf = (name) => { const at = process.argv.indexOf('--' + name); if (at < 0) throw new Error('missing --' + name); return process.argv[at + 1]; };
const read = (name) => fs.readFileSync(argOf(name), 'utf8').replace(/\r\n/g, '\n');
const withoutPgDumpNoise = (sql) => sql.split('\n').filter((line) => !/^\\(un)?restrict /.test(line) && !/^SET transaction_timeout/.test(line)).join('\n');

/** is this one-line statement a privilege statement that names a Supabase-only role? (ALTER DEFAULT … FOR ROLE postgres … TO cb_app stays) */
function dropsSupabaseRole(line) {
  if (/^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_/.test(line)) return true;
  const target = /^(?:GRANT .* TO|REVOKE .* FROM|ALTER DEFAULT PRIVILEGES .* (?:TO|FROM)) (.*);$/.exec(line);
  return Boolean(target) && SUPABASE_ROLES.test(target[1]);
}
/** pg_dump writes a varchar CHECK as `= ANY ((ARRAY[..])::text[])`, which the parser reads back as ARRAY[(..)::text] and dumps differently.
 *  Written without the outer cast it re-parses to exactly production's tree (proved on PostgreSQL 17.11). Same meaning, 20 constraints. */
const VARCHAR_ARRAY_CHECK = /= ANY \(\((ARRAY\[[^\]]*\])\)::text\[\]\)/g;
function publicPart(snapshot) {
  const kept = withoutPgDumpNoise(snapshot).split('\n').filter((line) => !dropsSupabaseRole(line));
  return kept.join('\n').replace(VARCHAR_ARRAY_CHECK, '= ANY ($1)').replace(/^CREATE SCHEMA public;\n/m, '')
    .replace("SELECT pg_catalog.set_config('search_path', '', false);", "SELECT pg_catalog.set_config('search_path', 'pg_catalog, public', false);");
}
/** a dump with its own header (SET lines, \restrict) cut off: from the first CREATE on */
const bodyOf = (dump) => withoutPgDumpNoise(dump).replace(/^[\s\S]*?(?=^CREATE SCHEMA)/m, '').replace(/^CREATE SCHEMA \w+;\n/m, '');
/** ops split in two: its tables, keys and indexes go before the public dump (identities points at ops.population); its views, functions and
 *  triggers go after it (they read public tables and call public functions) */
const OPS_TABLE_PART = /^-- Name: [^;]*; Type: (TABLE|CONSTRAINT|INDEX|DEFAULT|SEQUENCE[A-Z ]*);/;
function splitOps(dump) {
  const blocks = bodyOf(dump).split(/^--\n(?=-- Name: )/m).filter((block) => block.trim());
  const early = blocks.filter((block) => OPS_TABLE_PART.test(block)), late = blocks.filter((block) => !OPS_TABLE_PART.test(block));
  const join = (list) => list.map((block) => '--\n' + block).join('');
  return { early: join(early), late: join(late) };
}
const dataOf = (dump) => withoutPgDumpNoise(dump).replace(/^[\s\S]*?(?=^INSERT INTO|^SELECT pg_catalog.setval)/m, '');

/** the template with each `-- @@NAME@@` line replaced by its part → the baseline text */
function assemble(parts) {
  const template = fs.readFileSync(path.join(__dirname, 'baseline-template.sql'), 'utf8').replace(/\r\n/g, '\n');
  return template.replace(/^-- @@(\w+)@@$/gm, (line, name) => parts[name]).replace(/\n{3,}/g, '\n\n');
}
if (require.main === module) {
  const opsParts = splitOps(read('ops'));
  const out = assemble({ OPS_EARLY: opsParts.early, PUBLIC: publicPart(read('snapshot')), OPS_LATE: opsParts.late, METRICS: bodyOf(read('metrics')), DATA: dataOf(read('data')) });
  fs.writeFileSync(argOf('out'), out);
  console.log('wrote ' + argOf('out') + ' (' + out.split('\n').length + ' lines)');
}
module.exports = { publicPart, splitOps, dataOf, bodyOf, assemble, dropsSupabaseRole };
