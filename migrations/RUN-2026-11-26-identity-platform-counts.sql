-- RUN-2026-11-26-identity-platform-counts.sql — SEC-198 (cb-security, idreads-1131). FOR cb-db / Athi to run; NOT run by anyone else, never part of the chain (RUN- prefix).
-- WHY  b860 puts row security on identities: a count that spans shops (everything a root governs, everything public under a handle) sees 0 rows under any one shop's binding.
--      Each count gets ONE narrow door: a SECURITY DEFINER function that returns only the NUMBER, fixed search_path, EXECUTE to cb_app only (Athi decision 2026-11-26, PM/ATHI-DECISIONS.md).
-- ORDER  run this file BEFORE b860. The api (lib/platform-count.js) uses the function when it exists and falls back to the old read, logged, until then.
-- Run as postgres (a role that bypasses row security): the definers must see every row.
BEGIN;

DO $owner$
BEGIN
  IF NOT COALESCE((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), false) THEN
    RAISE EXCEPTION 'identity-platform-counts: run this file as postgres (rolsuper or rolbypassrls); the definers must bypass row security' USING ERRCODE = '42501';
  END IF;
END
$owner$;

/* how many identities a root governs (routes/governance.js countEntities) */
CREATE OR REPLACE FUNCTION ops.identities_governed_count(p_root uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT count(*)::int FROM public.identities WHERE governed_by = p_root
$fn$;

/* how many active, public-catalogue shops sit under a handle: user_id starts with `p_handle` + '.' (routes/entities.js network_public_count); LIKE metacharacters in the handle are escaped here */
CREATE OR REPLACE FUNCTION ops.identities_public_under(p_handle text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT count(*)::int FROM public.identities
   WHERE p_handle IS NOT NULL AND length(p_handle) > 0
     AND lower(user_id) LIKE replace(replace(replace(lower(p_handle), '\', '\'), '%', '\%'), '_', '\_') || '.%' ESCAPE '\'
     AND identity_type = 'entity' AND status = 'active' AND catalogue_visibility = 'public'
$fn$;

REVOKE ALL ON FUNCTION ops.identities_governed_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.identities_public_under(text) FROM PUBLIC;
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION ops.identities_governed_count(uuid) FROM anon;
    REVOKE ALL ON FUNCTION ops.identities_public_under(text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION ops.identities_governed_count(uuid) FROM authenticated;
    REVOKE ALL ON FUNCTION ops.identities_public_under(text) FROM authenticated;
  END IF;
END
$do$;
GRANT USAGE ON SCHEMA ops TO cb_app;
GRANT EXECUTE ON FUNCTION ops.identities_governed_count(uuid) TO cb_app;
GRANT EXECUTE ON FUNCTION ops.identities_public_under(text) TO cb_app;
COMMIT;
