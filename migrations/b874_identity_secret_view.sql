-- b874_identity_secret_view.sql — SEC-186 step 1 of 2 (16 Nov 2026): the ONE read door for the three credential columns of identities. Additive; no row, policy or privilege on identities changes.
--
-- ⚠️ NOT RUN anywhere · Athi runs it AS postgres. Safe either side of the api deploy (nothing reads the view until the api that carries SEC-186 is live; old code still reads the columns).
-- WHY  cb_app can SELECT identities.pin_hash (bcrypt of a short PIN), otp_code (plain, legacy) and otp_code_hash. b860's counterparty arm and the grant-party arm let a shop read WHOLE rows of other
--      shops' people, credentials included. Step 2 (RUN-2026-11-16-sec-186-revoke-credential-columns.sql) takes the three columns from cb_app; this view is how the auth path still reads them.
-- WHO  the view is owned by the owner (bypasses RLS: the same owner-owned door as ops.signin_candidates, b857). It answers ONLY for the identity the session is bound to (app.current_entity) and that
--      identity's own people (parent_entity_id = bound): exactly the rows b860's identities_own_tree arm opens. A shop session reads its own staff's credentials as before and NEVER another shop's person.
--      Unbound (no entity, '' or unset): no row. Sign-in finds a person through ops.signin_candidates, then binds that identity (db.queryAs) or its shop to read its credentials.
--      Residual, same tenant only: a compromised session of a shop can still read that shop's own staff PIN hashes (own tree), as it can write them.
-- Columns: for_identity and for_parent key the row (named so a join to identities never makes identity_id ambiguous); has_pin and has_code are booleans, no secret.
-- otp_code_hash is the b781 column; IF NOT EXISTS makes this file correct whether or not b781 was run.
-- ROLL BACK: DROP VIEW ops.identity_secret;  (the api would then fail closed on sign-in; revert the api first)
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE identities ADD COLUMN IF NOT EXISTS otp_code_hash varchar(64);

DROP VIEW IF EXISTS ops.identity_secret;
CREATE VIEW ops.identity_secret WITH (security_barrier = true) AS
  SELECT i.identity_id        AS for_identity,
         i.parent_entity_id   AS for_parent,
         i.pin_hash           AS pin_hash,
         i.otp_code           AS otp_code,
         i.otp_code_hash      AS otp_code_hash,
         (i.pin_hash IS NOT NULL)                                AS has_pin,
         (i.otp_code IS NOT NULL OR i.otp_code_hash IS NOT NULL) AS has_code
    FROM public.identities i
   WHERE i.identity_id      = NULLIF(pg_catalog.current_setting('app.current_entity', true), '')::uuid
      OR i.parent_entity_id = NULLIF(pg_catalog.current_setting('app.current_entity', true), '')::uuid;

REVOKE ALL ON ops.identity_secret FROM PUBLIC;
GRANT USAGE ON SCHEMA ops TO cb_app;
GRANT SELECT ON ops.identity_secret TO cb_app;

-- ops.spend_shopper_code(p_identity uuid, p_code text): the ORD-FIX O7 compare-and-clear (two confirms racing with one code: one wins). It cannot be a WHERE on otp_code once cb_app has no SELECT on it, and an EXISTS on the view
-- would read the statement snapshot, not the row the loser waited for: the compare must be inside the UPDATE. Definer, bound-only: it acts for the identity the session is bound to and nobody else.
DROP FUNCTION IF EXISTS ops.spend_shopper_code(uuid, text);
CREATE FUNCTION ops.spend_shopper_code(p_identity uuid, p_code text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE done integer;
BEGIN
  IF p_identity IS NULL OR p_code IS NULL OR p_identity IS DISTINCT FROM NULLIF(pg_catalog.current_setting('app.current_entity', true), '')::uuid THEN
    RETURN false;
  END IF;
  UPDATE public.identities SET status = 'active', otp_code = NULL, otp_expires_at = NULL, otp_attempts = 0, last_active_at = pg_catalog.now()
   WHERE identity_id = p_identity AND COALESCE(status, '') NOT IN ('erased', 'closed') AND otp_code = p_code;
  GET DIAGNOSTICS done = ROW_COUNT;
  RETURN done > 0;
END
$fn$;
REVOKE ALL ON FUNCTION ops.spend_shopper_code(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.spend_shopper_code(uuid, text) TO cb_app;
COMMIT;
