-- b908_identities_auth_fail_grant.sql — give cb_app the column grants b900's two new identities columns need on a database that carries SEC-186 (batch 1128).
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres), SIT first. Safe to repeat (a GRANT that already holds is a no-op). Touches no row, no policy, no table.
-- ⛔ RUN BEFORE the 1128 api goes live on any database that has b900 and RUN-2026-11-16-sec-186-revoke-credential-columns.sql. Without it EVERY sign-in fails: "permission denied for table identities".
-- RUN ORDER  AFTER b900_identity_failure_budget.sql (the columns must exist; this file refuses to guess and skips quietly if they do not). Before or after SEC-186 is fine.
-- WHY  SEC-186 revoked cb_app's table-level SELECT on identities and granted SELECT column by column (all but pin_hash, otp_code, otp_code_hash). A column added later has no grant, so
--      lib/account-budget.js (SELECT auth_fail_count, auth_fail_at ... ; UPDATE ... SET auth_fail_count = ... + 1, which READS the column) is refused on the first sign-in.
--      UPDATE is granted by column too, for a DB where the table-level UPDATE was ever narrowed; on the usual DB table-level UPDATE already holds and this is redundant.
-- SAFE ON BOTH KINDS OF DB  PostgreSQL (GRANT, "Description"): a column-level privilege is additive to table-level ones; if the role already holds the privilege on the whole table, granting it
--      on a column changes nothing and raises no error. So a database without SEC-186 (table-level SELECT still there) is unaffected, one with it gets exactly the two columns, never the credential columns.
-- ROLL BACK: REVOKE SELECT (auth_fail_count, auth_fail_at), UPDATE (auth_fail_count, auth_fail_at) ON public.identities FROM cb_app;  (only if b900 is also rolled back; else sign-in breaks again on a SEC-186 DB)
-- CHECK (read-only): SELECT has_column_privilege('cb_app','public.identities','auth_fail_count','SELECT') AND has_column_privilege('cb_app','public.identities','auth_fail_at','SELECT');   (t)   or  \dp identities
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'identities' AND column_name = 'auth_fail_count')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'identities' AND column_name = 'auth_fail_at') THEN
    GRANT SELECT (auth_fail_count, auth_fail_at), UPDATE (auth_fail_count, auth_fail_at) ON public.identities TO cb_app;
  END IF;
END
$g$;
COMMIT;
