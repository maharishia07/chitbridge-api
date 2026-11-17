-- RUN-2026-11-16-sec-186-revoke-credential-columns.sql — SEC-186 step 2 of 2 (16 Nov 2026): cb_app can no longer SELECT pin_hash, otp_code, otp_code_hash on identities.
--
-- ⚠️ NOT RUN anywhere · Athi runs it AS postgres. RUN- prefix: tools/migrate.cjs and the CI fresh-db build skip it (like b860). RUN ORDER, no other:
--    1. b874_identity_secret_view.sql is run (ops.identity_secret exists), AND
--    2. the api that carries SEC-186 is live (every credential read goes through ops.identity_secret; every whole-row read of identities (to_jsonb(i)) is gone), THEN
--    3. THIS file, THEN b860 (identities row security), THEN RUN-2026-11-16-identities-read-grant-party.sql.
--    Run it BEFORE 2 and sign-in, PIN change and the staff list fail with "permission denied for table identities".
-- WHAT  a column privilege only bites when the table-level SELECT is gone, so: REVOKE table-level SELECT, then GRANT SELECT on every column EXCEPT the three. INSERT, UPDATE, DELETE are untouched
--       (a write of the three columns needs no SELECT; a WHERE or RETURNING that names one does, and the api no longer does).
-- ⚠️ A column ADDED to identities later is not readable by cb_app until it is granted: every ALTER TABLE identities ADD COLUMN needs
--       GRANT SELECT (<column>) ON identities TO cb_app;   tests/sec-186-identity-credentials.realstack.cjs fails when a column is missing from cb_app's grants.
-- Other roles (cb_backup, cb_ops, cb_metrics) keep what they have; postgres is the owner. whole-row reads (to_jsonb(i), SELECT *, i.*) by cb_app now fail by design.
-- ROLL BACK: GRANT SELECT ON identities TO cb_app;
-- CHECK (read-only): SELECT column_name FROM information_schema.columns c WHERE table_schema='public' AND table_name='identities'
--       AND NOT has_column_privilege('cb_app', 'public.identities', column_name, 'SELECT');   expect exactly: otp_code, otp_code_hash, pin_hash.
BEGIN;
SET LOCAL lock_timeout = '5s';
REVOKE SELECT ON identities FROM cb_app;
DO $sec$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO cols
    FROM pg_attribute a
   WHERE a.attrelid = 'public.identities'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname NOT IN ('pin_hash', 'otp_code', 'otp_code_hash');
  EXECUTE format('GRANT SELECT (%s) ON public.identities TO cb_app', cols);
END
$sec$;
COMMIT;
