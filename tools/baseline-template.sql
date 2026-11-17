-- ============================================================================================================
-- 000_baseline_2026-10-21.sql — THE ONE BASELINE (DB-3 re-baseline, Athi 21 Oct 2026; DECISIONS 2026-10-18: "one baseline = production
-- schema now; only numbered migrations after it").
--
-- WHAT     production's own public schema as it stood on 21 Oct 2026 06:46 IST (PostgreSQL 17.6, pg_dump 17.11, --schema-only --no-owner
--          -n public: tables, columns, defaults, constraints, indexes, RLS enable + force, policies, triggers, functions, views,
--          sequences, grants, default privileges), plus the ops and metrics schemas and the reference rows a fresh database needs.
-- COVERS   everything up to and including b767 and RUN-2026-10-20-0..4 (backup role, public-role revokes, column grants, add-only
--          grants). The files that made it are kept unchanged in migrations/archive/ and never run on a new database.
-- NOT IN   Supabase-only roles' grants (service_role anon authenticated postgres) and Supabase's own schemas (auth storage realtime);
--          the purge / vacuum data runs RUN-2026-10-20-8..11 (they change rows, not schema).
-- NOT COMPARED WITH LIVE   ops (the app role is closed out of it), metrics, and the reference rows: production's dump did not include
--          them; they come from the migration files. Everything else equals the snapshot (see migrations/MIGRATIONS-LOG.md).
-- RULE     a new database = this file, then ONLY the numbered migrations after b767, each logged in migrations/MIGRATIONS-LOG.md.
--          Never edit this file: a change is a new bNNN.
-- PROD     production already HAS this schema: do NOT run this file there. Record it (node tools/migrate.cjs --record).
-- ROLES    cb_app, cb_ops, cb_metrics, cb_backup are made here if missing, as the files that made them (b48, b224, b151, RUN-2026-10-20-0).
--          cb_ops / cb_metrics / cb_backup get a placeholder or NOLOGIN: no password lives in git; the owner sets one where it is used.
-- ============================================================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cb_app') THEN
    CREATE ROLE cb_app LOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cb_ops') THEN
    EXECUTE 'CREATE ROLE cb_ops LOGIN PASSWORD ' || quote_literal('CHANGE-ME-' || md5(random()::text || clock_timestamp()::text)) ||
            ' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cb_metrics') THEN
    CREATE ROLE cb_metrics NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cb_backup') THEN
    -- read-only backup role; BYPASSRLS because pg_dump refuses RLS tables otherwise (RUN-2026-10-20-0). NOLOGIN until the owner sets a password.
    CREATE ROLE cb_backup NOLOGIN BYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('cb_app','cb_ops','cb_metrics') AND rolbypassrls) THEN
    RAISE EXCEPTION '000_baseline: cb_app / cb_ops / cb_metrics must NOT have BYPASSRLS';
  END IF;
END $$;

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', 'pg_catalog, public', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

CREATE EXTENSION IF NOT EXISTS ltree WITH SCHEMA public;

CREATE SCHEMA ops;
CREATE SCHEMA metrics;

-- ══ ops, first part (tables, keys, indexes): from the migration files (b224 and after), NOT compared with live (the app role is closed out of ops by design) ══
-- @@OPS_EARLY@@

-- ══ public: production schema as dumped 21 Oct 2026 06:46 IST (PostgreSQL 17.6, pg_dump 17.11), edited as tools/baseline-from-snapshot.cjs says ══
-- @@PUBLIC@@

-- ══ ops, second part: views, functions, triggers, grants ══
-- @@OPS_LATE@@

-- ══ metrics: from the migration files (b151 and after), NOT compared with live ══
-- @@METRICS@@

-- ══ reference rows: the tables the old chain seeded (blueprints, standards, assist Q&A, platform identities …), NOT compared with live ══
-- triggers off while the rows go in (a catalogue trigger would add version rows the dump already carries; identities points at itself)
SET session_replication_role = replica;
-- @@DATA@@
RESET session_replication_role;
