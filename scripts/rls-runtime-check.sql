-- rls-runtime-check.sql — READ ONLY. Does the isolation guarantee hold IN THE DATABASE, right now?
--
-- WHY THIS EXISTS, stated plainly: `tests/engine-boundary.test.js` checks that every table has both ENABLE and
-- FORCE ROW LEVEL SECURITY — but it reads the MIGRATION FILES. A migration that was written, committed, deployed
-- and never applied still passes that test. b114 sat unapplied for days while the code shipped, so this is not a
-- hypothetical. **The test asserts intent. This file asserts reality.** Run it after any migration, and any time
-- you want to know rather than assume.
--
-- Needs a role that can read pg_catalog — any normal login will do. Changes nothing.

\echo '=== A · THE HEADLINE — does every RLS table have BOTH flags? ==='
SELECT
  count(*) FILTER (WHERE relrowsecurity AND relforcerowsecurity)      AS fully_protected,
  count(*) FILTER (WHERE relrowsecurity AND NOT relforcerowsecurity)  AS enabled_but_NOT_forced,
  count(*) FILTER (WHERE NOT relrowsecurity)                          AS no_rls_at_all
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r';
--
-- `enabled_but_NOT_forced` must be 0. ENABLE alone does NOT apply to the table OWNER — so if the app ever connects
-- as the owner, or a migration runs as it, every row is readable across every entity. FORCE is what closes that.
-- `no_rls_at_all` will be non-zero legitimately: reference tables (region_layer, plans) hold no entity data.

\echo ''
\echo '=== B · THE FAILURE LIST — tables that are half-protected ==='
SELECT c.relname AS table_name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND c.relrowsecurity AND NOT c.relforcerowsecurity
ORDER BY 1;
-- EXPECT ZERO ROWS. Any row here is an entity-data table that the owning role can read straight through.

\echo ''
\echo '=== C · DRIFT — what the migrations intend vs what the database has ==='
-- The 24 tables the migrations put under RLS, as of 2026-08-04. If a name here comes back missing or unprotected,
-- a migration did not apply. If a NEW entity-data table exists that is not in this list, add it to the list AND to
-- tests/engine-boundary.test.js — a table nobody classified is a table nobody protected.
WITH expected(table_name) AS (VALUES
  ('capture'),('catalogue_adoption'),('catalogue_face'),('catalogue_items'),('cb_attachment'),
  ('chit_detail'),('chit_disputes'),('chit_header'),('chit_messages'),('chit_status'),
  ('connector_receipt'),('customer_list'),('entity_compliance'),('entity_governance'),('entity_profile'),
  ('entity_wallet'),('erp_handoff'),('folder'),('form_instance'),('idempotency_key'),
  ('kyb_field_cache'),('network_design'),('state_log'),('usage_ledger'))
SELECT
  e.table_name,
  (c.oid IS NOT NULL)                          AS table_exists,
  COALESCE(c.relrowsecurity, false)            AS enabled,
  COALESCE(c.relforcerowsecurity, false)       AS forced,
  CASE
    WHEN c.oid IS NULL                                        THEN '❌ MISSING — migration not applied?'
    WHEN NOT c.relrowsecurity                                 THEN '❌ NO RLS — entity data is cross-readable'
    WHEN NOT c.relforcerowsecurity                            THEN '⚠ ENABLE only — owner bypasses'
    ELSE '✓'
  END AS verdict
FROM expected e
LEFT JOIN pg_class c ON c.relname = e.table_name
     AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname='public')
ORDER BY (c.oid IS NULL) DESC, COALESCE(c.relforcerowsecurity,false), e.table_name;

\echo ''
\echo '=== D · UNGUARDED — entity-data tables the list does not know about ==='
-- A table with an `entity_id` column and no RLS is the shape of a leak. This finds new tables nobody classified.
SELECT c.relname AS table_name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'entity_id' AND a.attnum > 0 AND NOT a.attisdropped
WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
ORDER BY 1;
-- EXPECT ZERO ROWS. Anything here holds per-entity data with no row isolation.

\echo ''
\echo '=== E · POLICIES — RLS on with no policy means DENY ALL, which is a different bug ==='
SELECT c.relname AS table_name, count(p.polname) AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
GROUP BY 1 HAVING count(p.polname) = 0
ORDER BY 1;
-- EXPECT ZERO ROWS. RLS enabled with zero policies denies everything — the app breaks loudly rather than leaking,
-- so it is the safer failure, but it is still a failure and it looks like "the feature is broken" not "RLS is off."

\echo ''
\echo '=== F · WHO ARE WE CONNECTED AS? — the question that invalidates everything above ==='
SELECT current_user, session_user,
       (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypasses_rls,
       (SELECT rolsuper      FROM pg_roles WHERE rolname = current_user) AS is_superuser;
-- If `bypasses_rls` or `is_superuser` is true, THIS SESSION sees every row regardless of the results above. That is
-- expected for an admin connection running this check. It is NOT acceptable for the application's connection —
-- verify the app's role separately, because a superuser app role silently voids every policy in this file.
