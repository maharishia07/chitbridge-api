-- b879_signin_pending.sql — SEC-112 P0 (17 Nov 2026): the short-lived store a provider round trip needs (start state, handoff code, connect ticket, link-start), three uses in one table, behind three narrow doors.
--
-- ⚠️ NOT RUN anywhere · Athi runs it AS postgres, SIT first. Safe to repeat. Additive: one table, three functions. The api is correct BEFORE and AFTER it runs: until it runs no provider is offered
--    (lib/signin-pending.js answers "store missing"; GET /api/signin/providers answers an empty list).
-- NUMBER. b879, after b878 (same batch); cb-db confirms on the day.
-- OWNER: lib/signin-pending.js (the only caller of the three doors)
-- WHAT IT IS. ops.signin_pending: ref_hash (SHA-256 of a 32-byte random reference: the reference itself is never stored) · kind ('start' 10 min | 'handoff' 60 s | 'ticket' 10 min | 'linkstart' 5 min) · payload jsonb
--    (the nonce, the PKCE verifier, the device id, the checked claims: nothing a provider sent beyond that, no token) · attempts · expires_at.
-- RLS: ENABLE, NO policy, NO grant to cb_app (or anyone but the owner): the table is closed to every non-owner role. The three functions are SECURITY DEFINER, owned by the table's owner (postgres), so they reach it;
--    FORCE is NOT set, because it would bind the owner and so the doors too. No tenant data lives here; a row is found only by the hash of a secret the browser holds.
--      ops.signin_pending_put(kind, ref_hash, payload, ttl_seconds)  first DELETEs every expired row (the sweep: no job needed), then INSERTs. ttl is clamped 1..900 s.
--      ops.signin_pending_take(kind, ref_hash)                      DELETE ... RETURNING payload: ONE statement = single use. NULL when spent, expired, unknown or of another kind.
--      ops.signin_pending_try(ref_hash)                             a ticket only: attempts + 1 while attempts < 5, returns the payload; the sixth try answers NULL and the ticket is dead.
-- GRANTS: each function revoked from PUBLIC, anon, authenticated in the same transaction as the CREATE; EXECUTE to cb_app only (the b857 pattern).
-- ROLL BACK:  DROP FUNCTION IF EXISTS ops.signin_pending_put(text, text, jsonb, integer); DROP FUNCTION IF EXISTS ops.signin_pending_take(text, text); DROP FUNCTION IF EXISTS ops.signin_pending_try(text);
--             DROP TABLE IF EXISTS ops.signin_pending;
-- CHECK (read-only, every row ok = true):
--    SELECT 'table: RLS on, no policy, no cb_app privilege' AS what, (SELECT relrowsecurity FROM pg_class WHERE oid = 'ops.signin_pending'::regclass)
--           AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'ops' AND tablename = 'signin_pending') AND NOT has_table_privilege('cb_app', 'ops.signin_pending', 'SELECT') AS ok
--    UNION ALL SELECT 'three doors: definer, closed to anon, open to cb_app', count(*) = 3 AND bool_and(p.prosecdef AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('cb_app', p.oid, 'EXECUTE'))
--      FROM pg_proc p WHERE p.pronamespace = 'ops'::regnamespace AND p.proname IN ('signin_pending_put', 'signin_pending_take', 'signin_pending_try');

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS ops.signin_pending (
  ref_hash   text        PRIMARY KEY CHECK (ref_hash ~ '^[0-9a-f]{64}$'),
  kind       text        NOT NULL CHECK (kind IN ('start', 'handoff', 'ticket', 'linkstart')),
  payload    jsonb       NOT NULL,
  attempts   smallint    NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS signin_pending_expires_idx ON ops.signin_pending (expires_at);
ALTER TABLE ops.signin_pending ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ops.signin_pending FROM PUBLIC;
DO $r$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON ops.signin_pending FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON ops.signin_pending FROM authenticated; END IF;
END $r$;

CREATE OR REPLACE FUNCTION ops.signin_pending_put(p_kind text, p_ref_hash text, p_payload jsonb, p_ttl_seconds integer)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('start', 'handoff', 'ticket', 'linkstart') THEN
    RAISE EXCEPTION 'ops.signin_pending_put: unknown kind' USING ERRCODE = '22023';
  END IF;
  IF p_ref_hash IS NULL OR p_ref_hash !~ '^[0-9a-f]{64}$' OR p_payload IS NULL THEN
    RAISE EXCEPTION 'ops.signin_pending_put: bad argument' USING ERRCODE = '22023';
  END IF;
  DELETE FROM ops.signin_pending WHERE expires_at < pg_catalog.now();
  INSERT INTO ops.signin_pending (ref_hash, kind, payload, expires_at)
    VALUES (p_ref_hash, p_kind, p_payload, pg_catalog.now() + pg_catalog.make_interval(secs => GREATEST(1, LEAST(900, COALESCE(p_ttl_seconds, 60)))));
END
$fn$;

CREATE OR REPLACE FUNCTION ops.signin_pending_take(p_kind text, p_ref_hash text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v jsonb;
BEGIN
  IF p_kind IS NULL OR p_ref_hash IS NULL OR p_ref_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  DELETE FROM ops.signin_pending WHERE ref_hash = p_ref_hash AND kind = p_kind AND expires_at > pg_catalog.now() RETURNING payload INTO v;
  RETURN v;
END
$fn$;

CREATE OR REPLACE FUNCTION ops.signin_pending_try(p_ref_hash text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v jsonb;
BEGIN
  IF p_ref_hash IS NULL OR p_ref_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  UPDATE ops.signin_pending SET attempts = attempts + 1
    WHERE ref_hash = p_ref_hash AND kind = 'ticket' AND expires_at > pg_catalog.now() AND attempts < 5 RETURNING payload INTO v;
  RETURN v;
END
$fn$;

REVOKE ALL ON FUNCTION ops.signin_pending_put(text, text, jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.signin_pending_take(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.signin_pending_try(text) FROM PUBLIC;
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION ops.signin_pending_put(text, text, jsonb, integer) FROM anon;
    REVOKE ALL ON FUNCTION ops.signin_pending_take(text, text) FROM anon;
    REVOKE ALL ON FUNCTION ops.signin_pending_try(text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION ops.signin_pending_put(text, text, jsonb, integer) FROM authenticated;
    REVOKE ALL ON FUNCTION ops.signin_pending_take(text, text) FROM authenticated;
    REVOKE ALL ON FUNCTION ops.signin_pending_try(text) FROM authenticated;
  END IF;
END
$do$;
GRANT USAGE ON SCHEMA ops TO cb_app;
GRANT EXECUTE ON FUNCTION ops.signin_pending_put(text, text, jsonb, integer) TO cb_app;
GRANT EXECUTE ON FUNCTION ops.signin_pending_take(text, text) TO cb_app;
GRANT EXECUTE ON FUNCTION ops.signin_pending_try(text) TO cb_app;

COMMIT;
