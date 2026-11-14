-- RUN-2026-11-14-b861-entity-schemas-fns.sql (migration number b861) — SEC-75 step 1 of 2 (14 Nov 2026): the two narrow doors the code needs BEFORE row security goes on entity_schemas and schema_fields.
--
-- FILE NAME: the RUN- prefix keeps tools/migrate.cjs (CHAIN_SKIP) and the CI fresh-db build from applying it on their own (b797 and RUN-2026-11-14-b860 precedent); the fresh-db job applies it explicitly, FIRST of the two.
-- ⚠️ DRAFT · NOT RUN anywhere · Athi runs it AS postgres (Supabase SQL editor), on SIT first, then production. RUN ORDER, no other:
--    1. THIS file (b861), then its CHECK row (every column true).
--    2. deploy the api that carries SEC-75 (PR "SEC-75 entity_schemas build"): the api REFUSES TO BOOT without both functions (lib/db-role.js entityDoorVerdict).
--    3. node tools/identities-sweep.cjs --check shows entity_schemas and schema_fields at open 0, THEN
--    4. RUN-2026-11-14-b862-entity-schemas-rls.sql (the policies). Run b862 before 1-3 and a read of another shop's schema returns no row.
--    Lands AFTER api #1275 (SEC-185: queryAs, the sweep, lib/db-role.js).
-- Additive: creates two functions and their grants. No row, no policy, no table is touched; harmless without b862.
--
-- WHY. The policies in b862 make another shop's schema invisible unless it is public + active. Four api sites need a fact about a shop that is NOT the caller, whatever its visibility:
--      · ops.shop_has_catalogue(shop)   lib/business-search.js, routes/relationships.js (2 sites): "has this shop a default catalogue" (one boolean).
--      · ops.shop_default_schema(shop)  routes/catalogue.js order freeze (A10): the shop's active default schema_id and schema_version (two values). A private shop on the payload
--        pipeline (forms, enquiries) can be ordered from, so the public route cannot bind as the shop, and under the policy the read would return 0 rows and the freeze would be lost silently.
--    Same pattern as b857: SECURITY DEFINER runs as postgres (BYPASSRLS), schema ops (not exposed to PostgREST: ATHI CONFIRMS Settings > API > Exposed schemas does NOT list ops, as for b857),
--    SET search_path = '', every object schema-qualified, no dynamic SQL, REVOKE from PUBLIC / anon / authenticated in the SAME transaction as the CREATE, EXECUTE to cb_app only.
--    Callable by any bound shop for any uuid: that is today's has_catalogue meaning and today's freeze read, not a new door.
-- TYPE GUARD. entity_schemas.schema_version is integer on main (migrations/000_baseline_2026-10-21.sql:3497; chit_header.schema_version is the varchar(20) one). A function whose declared type
--    differs from the column fails at CREATE; this file also stops with words when the column is not integer, so a drifted database is found here and not at the first order.
-- ROLL BACK:   (only AFTER the previous api release is deployed, since the new api calls both)   DROP FUNCTION IF EXISTS ops.shop_has_catalogue(uuid);  DROP FUNCTION IF EXISTS ops.shop_default_schema(uuid);
-- CHECK (read-only, two rows; every column true):
--    SELECT p.proname, p.prosecdef AS definer, EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c = 'search_path=""') AS pinned_path,
--           NOT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_closed, NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_closed,
--           has_function_privilege('cb_app', p.oid, 'EXECUTE') AS app_open,
--           (SELECT rolbypassrls FROM pg_roles WHERE rolname = pg_get_userbyid(p.proowner)) AS owner_bypasses
--      FROM pg_proc p WHERE p.oid IN ('ops.shop_has_catalogue(uuid)'::regprocedure, 'ops.shop_default_schema(uuid)'::regprocedure);
-- RLS: unchanged. entity_schemas and schema_fields stay without row security until b862.

BEGIN;

DO $guard$
BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'entity_schemas' AND column_name = 'schema_version') IS DISTINCT FROM 'integer' THEN
    RAISE EXCEPTION 'b861: entity_schemas.schema_version is not integer in this database; fix the declared type of ops.shop_default_schema first' USING ERRCODE = '42804';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION ops.shop_has_catalogue(p_entity uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.entity_schemas s WHERE s.entity_id = p_entity AND s.status = 'active' AND s.is_default = true)
$fn$;

-- RETURNS TABLE cannot change its row type under CREATE OR REPLACE (42P13), so a re-run drops first; the REVOKE/GRANT below put the grants back in the same transaction.
DROP FUNCTION IF EXISTS ops.shop_default_schema(uuid);
CREATE OR REPLACE FUNCTION ops.shop_default_schema(p_entity uuid)
RETURNS TABLE (schema_id uuid, schema_version integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT s.schema_id, s.schema_version FROM public.entity_schemas s
   WHERE s.entity_id = p_entity AND s.status = 'active' AND s.is_default = true
   ORDER BY s.created_at DESC LIMIT 1
$fn$;

REVOKE ALL ON FUNCTION ops.shop_has_catalogue(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.shop_default_schema(uuid) FROM PUBLIC;
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION ops.shop_has_catalogue(uuid) FROM anon;
    REVOKE ALL ON FUNCTION ops.shop_default_schema(uuid) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION ops.shop_has_catalogue(uuid) FROM authenticated;
    REVOKE ALL ON FUNCTION ops.shop_default_schema(uuid) FROM authenticated;
  END IF;
END
$do$;
GRANT USAGE ON SCHEMA ops TO cb_app;
GRANT EXECUTE ON FUNCTION ops.shop_has_catalogue(uuid) TO cb_app;
GRANT EXECUTE ON FUNCTION ops.shop_default_schema(uuid) TO cb_app;

COMMIT;
