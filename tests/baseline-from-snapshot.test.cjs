#!/usr/bin/env node
/**
 * tests/baseline-from-snapshot.test.cjs — THE EDITS THAT TURN PRODUCTION'S DUMP INTO THE BASELINE (DB-3, 21 Oct 2026). No database, no network.
 *
 * OWNS     the offline half of the re-baseline: each text edit of tools/baseline-from-snapshot.cjs on a small synthetic dump, and the
 *          committed baseline file's shape (what must not be in it, what must be in it, in which order). The replay against a real
 *          PostgreSQL is by hand (migrations/MANIFEST.md "Proven").
 * CALLED BY  scripts/guards.cjs (every tests/*.test.cjs). CARD  28-platform-and-operations/migrations-and-schema
 * FLOW     synthetic dump → publicPart → asserts · baseline file → shape asserts
 */
'use strict';
const fs = require('fs'), path = require('path');
const { publicPart, splitOps, dropsSupabaseRole } = require('../tools/baseline-from-snapshot.cjs');
const mig = require('../tools/migrate.cjs');

let checks = 0, failed = 0;
const check = (what, ok, extra) => { checks++; if (!ok) failed++; console.log((ok ? '  ✓ ' : '  ✗ ') + what + (ok || !extra ? '' : '   ' + extra)); };

console.log('\n── the edits on a synthetic dump ──');
const dump = [
  '\\restrict abc123', 'SET transaction_timeout = 0;', "SELECT pg_catalog.set_config('search_path', '', false);", 'CREATE SCHEMA public;',
  "    CONSTRAINT t_status_check CHECK (((status)::text = ANY ((ARRAY['a'::character varying, 'b'::character varying])::text[]))),",
  'GRANT ALL ON TABLE public.t TO service_role;', 'GRANT SELECT,INSERT ON TABLE public.t TO cb_app;', 'GRANT SELECT ON TABLE public.t TO cb_backup;',
  'GRANT USAGE ON SCHEMA public TO anon;', 'REVOKE ALL ON FUNCTION public.f() FROM PUBLIC;',
  'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;',
  'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;',
  'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,INSERT ON TABLES TO cb_app;', '\\unrestrict abc123', '',
].join('\n');
const out = publicPart(dump);
check('\\restrict and \\unrestrict lines are gone', !/restrict/.test(out));
check('SET transaction_timeout is gone (PostgreSQL 16 does not know it)', !/transaction_timeout/.test(out));
check('CREATE SCHEMA public is gone', !/CREATE SCHEMA public/.test(out));
check('search_path is pg_catalog, public', /set_config\('search_path', 'pg_catalog, public', false\)/.test(out));
check('a varchar CHECK loses the outer ::text[] cast, keeps its values', /= ANY \(ARRAY\['a'::character varying, 'b'::character varying\]\)/.test(out) && !/\)::text\[\]/.test(out));
check('grants to service_role / anon / postgres and supabase_admin defaults are dropped', !/service_role|\banon\b|supabase_admin/.test(out) && !/TO postgres/.test(out));
check('grants to cb_app / cb_backup, REVOKE FROM PUBLIC and the cb_app default privileges stay',
  /TO cb_app;/.test(out) && /TO cb_backup;/.test(out) && /FROM PUBLIC;/.test(out) && /GRANT SELECT,INSERT ON TABLES TO cb_app/.test(out));
check('dropsSupabaseRole leaves a cb_app statement alone', dropsSupabaseRole('GRANT ALL ON TABLE public.t TO service_role;') && !dropsSupabaseRole('GRANT ALL ON TABLE public.t TO cb_app;'));
const ops = splitOps('CREATE SCHEMA ops;\n--\n-- Name: v; Type: VIEW; Schema: ops; Owner: -\n--\n\nCREATE VIEW ops.v AS SELECT 1;\n\n\n--\n-- Name: p; Type: TABLE; Schema: ops; Owner: -\n--\n\nCREATE TABLE ops.p (a int);\n');
check('ops: the table goes in the first part, the view in the second', /CREATE TABLE ops\.p/.test(ops.early) && !/CREATE VIEW/.test(ops.early) && /CREATE VIEW ops\.v/.test(ops.late) && !/CREATE TABLE/.test(ops.late));

console.log('\n── the committed baseline ──');
const baselinePath = path.join(__dirname, '..', 'migrations', mig.BASELINE[0]);
const sql = fs.existsSync(baselinePath) ? fs.readFileSync(baselinePath, 'utf8') : '';
const at = (needle) => sql.indexOf(needle);
check('no Supabase-only role is granted anything', !/^(GRANT|REVOKE|ALTER DEFAULT PRIVILEGES).* (TO|FROM) (service_role|anon|authenticated|postgres);$/m.test(sql) && !/FOR ROLE supabase_/.test(sql));
check('no \\restrict, no SET transaction_timeout, no CREATE SCHEMA public', !/^\\(un)?restrict /m.test(sql) && !/^SET transaction_timeout/m.test(sql) && !/^CREATE SCHEMA public;/m.test(sql));
check('no placeholder is left in it', !/@@\w+@@/.test(sql));
check('it covers b767: usage_ledger is SELECT, INSERT only for cb_app (b767) and cb_backup exists (RUN-2026-10-20-0)',
  /GRANT SELECT,INSERT ON TABLE public\.usage_ledger TO cb_app;/.test(sql) && /GRANT SELECT ON TABLE public\.usage_ledger TO cb_backup;/.test(sql));
check('the roles come first, then ops tables, then public, then metrics, then the reference rows',
  at('CREATE ROLE cb_backup') > 0 && at('CREATE ROLE cb_backup') < at('CREATE TABLE ops.population') && at('CREATE TABLE ops.population') < at('CREATE TABLE public.identities') &&
  at('CREATE TABLE public.identities') < at('CREATE VIEW metrics.') && at('CREATE VIEW metrics.') < at('SET session_replication_role = replica'));
check('the reference rows are loaded with triggers off and the setting is put back', /SET session_replication_role = replica;[\s\S]*INSERT INTO[\s\S]*RESET session_replication_role;/.test(sql));
check('production\'s drift is not smuggled in: the blueprint_source table is not created', !/CREATE TABLE public\.blueprint_source/.test(sql));

console.log('\n  ' + checks + ' checks');
process.exit(failed ? 1 : 0);
