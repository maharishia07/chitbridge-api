-- b857_signin_candidates_definer.sql — SEC-184 step A (13 Nov 2026): ONE read-only sign-in lookup that does not depend on row security.
--
-- ⚠️ DRAFT · NOT RUN anywhere · Athi runs it AS postgres (Supabase SQL editor), on SIT first, then production, EITHER SIDE of the api deploy.
--    Additive: creates one function and its grants. No row, no policy, no table is touched. The api is correct BEFORE it runs (lib/signin-lookup.js
--    falls back to today's read with one logged warning when the function is missing) and AFTER (it reads through the function).
--    ⚠️ Do NOT run b858 (the row-security policies on identities, step B, HOLD) before this file AND the api that uses it are live: every login would fail closed.
--
-- WHY. identities has no row security today because a login looks a person up by what they TYPED (e-mail, handle, name, mobile, a verified contact) before any shop is
--    bound (db/rls-baseline.json: class "shared"). Row security on that table (SEC-184 step B) needs ONE door that still works for the sign-in lookup.
--    SECURITY DEFINER runs as the owner (postgres, BYPASSRLS), so FORCE ROW LEVEL SECURITY does not bind it. So the door is narrow:
--      · six exact-match kinds, no LIKE / ILIKE / wildcard: 'email' 'handle' 'name' 'phone' 'contact', and 'doc' (a VERIFIED PHONE or EMAIL identity document by SCHEME:hash[,hash]; any other scheme, PAN or GSTIN, finds nothing, up to the 10 hashes the spellings of one contact make).
--        'doc' reads identity_documents, which is already FORCE RLS (entity policy idoc_tenant): a pre-binding sign-in cannot read it as cb_app.
--      · a key shorter than 3 characters answers no rows; an unknown kind raises 22023.
--      · eight columns only: no otp_code, otp_code_hash, pin_hash, pin_attempts, policy_flags, connector_config, no phone. Credentials are read afterwards BY ID.
--      · ORDER BY identity_id LIMIT 10: no dump is possible (an ambiguous name needs 2).
--      · STABLE, SET search_path = '' and every object schema-qualified (Postgres CREATE FUNCTION, "Writing SECURITY DEFINER Functions Safely").
-- SCHEMA. ops, NOT public: Supabase's Data API (PostgREST) exposes only the schemas under Settings > API > "Exposed schemas" (default: public and graphql_public); a definer
--    function in an exposed schema is callable at /rest/v1/rpc/... and Supabase says never to put one there. ops already exists (baseline: GRANT USAGE to cb_app and cb_ops).
--    ⚠️ ATHI CONFIRMS before running: Dashboard > Settings > API > Exposed schemas does NOT list ops. If it does, take it off, or move this function to a new private schema first.
-- GRANTS. PostgreSQL gives EXECUTE to PUBLIC on a new function and Supabase also to anon and authenticated: all three are revoked here, in the SAME transaction as the
--    CREATE (never a moment where it is callable), and EXECUTE goes to cb_app only, the role the api connects as. (anon/authenticated are skipped when the database has no such role, as a fresh CI database.)
-- ROLL BACK:   DROP FUNCTION IF EXISTS ops.signin_candidates(text, text);      (the api then falls back to the direct read, with one logged warning)
-- CHECK (read-only, one row; every column true):
--    SELECT p.prosecdef AS definer, EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c = 'search_path=""') AS pinned_path,
--           NOT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_closed, NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_closed,
--           has_function_privilege('cb_app', p.oid, 'EXECUTE') AS app_open,
--           (SELECT NOT rolbypassrls FROM pg_roles WHERE rolname = 'cb_app') AS app_role_bites,
--           (SELECT rolbypassrls FROM pg_roles WHERE rolname = pg_get_userbyid(p.proowner)) AS owner_bypasses
--      FROM pg_proc p WHERE p.oid = 'ops.signin_candidates(text,text)'::regprocedure;
--    And on the api's own connection: SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname = current_user;  must say false (the api logs it at boot: lib/db-role.js).
-- RLS: unchanged. identities stays without row security until step B.

BEGIN;
-- RETURNS TABLE cannot change its row type under CREATE OR REPLACE (42P13), so a re-run drops first; the REVOKE/GRANT below put the grants back (same transaction).
DROP FUNCTION IF EXISTS ops.signin_candidates(text, text);

CREATE OR REPLACE FUNCTION ops.signin_candidates(p_kind text, p_key text)
RETURNS TABLE (identity_id uuid, identity_type text, parent_entity_id uuid, bridge_id text, display_name text, user_id text, email text, status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
#variable_conflict use_column
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('email', 'handle', 'name', 'phone', 'contact', 'doc') THEN
    RAISE EXCEPTION 'ops.signin_candidates: unknown kind' USING ERRCODE = '22023';
  END IF;
  IF p_key IS NULL OR pg_catalog.length(pg_catalog.btrim(p_key)) < 3 THEN
    RETURN;
  END IF;

  IF p_kind = 'email' THEN
    RETURN QUERY SELECT i.identity_id, i.identity_type::text, i.parent_entity_id, i.bridge_id::text, i.display_name::text, i.user_id::text, i.email::text, i.status::text
      FROM public.identities i WHERE i.email = pg_catalog.lower(p_key) ORDER BY i.identity_id LIMIT 10;
  ELSIF p_kind = 'handle' THEN
    RETURN QUERY SELECT i.identity_id, i.identity_type::text, i.parent_entity_id, i.bridge_id::text, i.display_name::text, i.user_id::text, i.email::text, i.status::text
      FROM public.identities i WHERE pg_catalog.lower(i.user_id) = pg_catalog.lower(p_key) ORDER BY i.identity_id LIMIT 10;
  ELSIF p_kind = 'name' THEN
    RETURN QUERY SELECT i.identity_id, i.identity_type::text, i.parent_entity_id, i.bridge_id::text, i.display_name::text, i.user_id::text, i.email::text, i.status::text
      FROM public.identities i
      WHERE pg_catalog.lower(i.display_name) = pg_catalog.lower(p_key) AND i.identity_type = 'entity' AND i.status = 'active' ORDER BY i.identity_id LIMIT 10;
  ELSIF p_kind = 'phone' THEN
    RETURN QUERY SELECT i.identity_id, i.identity_type::text, i.parent_entity_id, i.bridge_id::text, i.display_name::text, i.user_id::text, i.email::text, i.status::text
      FROM public.identities i WHERE i.identity_type = 'customer' AND (i.phone = p_key OR i.phone = '+' || p_key) ORDER BY i.identity_id LIMIT 10;
  ELSIF p_kind = 'contact' THEN
    RETURN QUERY SELECT i.identity_id, i.identity_type::text, i.parent_entity_id, i.bridge_id::text, i.display_name::text, i.user_id::text, i.email::text, i.status::text
      FROM public.identities i WHERE i.identity_type = 'customer' AND i.otp_contact = p_key ORDER BY i.identity_id LIMIT 10;
  ELSIF p_kind = 'doc' THEN
    RETURN QUERY SELECT i.identity_id, i.identity_type::text, i.parent_entity_id, i.bridge_id::text, i.display_name::text, i.user_id::text, i.email::text, i.status::text
      FROM public.identities i
      WHERE i.identity_id IN (SELECT d.identity_id FROM public.identity_documents d
                              WHERE d.scheme IN ('PHONE', 'EMAIL') AND d.scheme = pg_catalog.split_part(p_key, ':', 1)
                                AND d.value_hash = ANY ((pg_catalog.string_to_array(pg_catalog.substr(p_key, pg_catalog.strpos(p_key, ':') + 1), ','))[1:10])
                                AND d.status = 'verified' AND d.verified_at IS NOT NULL)
      ORDER BY i.identity_id LIMIT 10;
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION ops.signin_candidates(text, text) FROM PUBLIC;
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION ops.signin_candidates(text, text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION ops.signin_candidates(text, text) FROM authenticated;
  END IF;
END
$do$;
GRANT USAGE ON SCHEMA ops TO cb_app;
GRANT EXECUTE ON FUNCTION ops.signin_candidates(text, text) TO cb_app;

COMMIT;
