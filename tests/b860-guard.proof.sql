-- tests/b860-guard.proof.sql - proof for the in-file guard of migrations/RUN-2026-11-14-b860-identities-rls.sql (VERIFY-EL-DB A2).
-- Run on a THROWAWAY database holding a schema-only dump of SIT, AS a superuser, from the api root:
--   psql -X -q -v mutant=false -f tests/b860-guard.proof.sql      (expect RESULT PASS)
--   psql -X -q -v mutant=true -v noguard=/tmp/b860-noguard.sql -f tests/b860-guard.proof.sql      (noguard = the file with the DO guard block cut out by sed; guard stripped: b860 applies while otp_code is readable -> RESULT FAIL, which proves the proof bites)
\set ON_ERROR_STOP off
CREATE TEMP TABLE proof (what text, ok boolean);
-- state 1: SEC-186 NOT run. Credential columns still selectable by cb_app.
GRANT SELECT ON identities TO cb_app;
\if :mutant
\o /dev/null
\i :noguard
\o
\else
\o /dev/null
\i migrations/RUN-2026-11-14-b860-identities-rls.sql
\o
\endif
SELECT c.relrowsecurity AS rls_on FROM pg_class c WHERE c.oid = 'public.identities'::regclass \gset
INSERT INTO proof VALUES ('SEC-186 not run: b860 did NOT turn row security on (it raised and rolled back)', NOT :'rls_on'::boolean);
-- state 2: SEC-186 run (the three columns taken from cb_app): b860 applies.
\if :mutant
ALTER TABLE identities DISABLE ROW LEVEL SECURITY; ALTER TABLE identities NO FORCE ROW LEVEL SECURITY;
\endif
REVOKE SELECT ON identities FROM cb_app;
GRANT SELECT (identity_id, bridge_id, identity_type, display_name, parent_entity_id, created_by) ON identities TO cb_app;
\o /dev/null
\i migrations/RUN-2026-11-14-b860-identities-rls.sql
\o
SELECT c.relrowsecurity AS rls_on2 FROM pg_class c WHERE c.oid = 'public.identities'::regclass \gset
INSERT INTO proof VALUES ('SEC-186 run: b860 applies (row security on)', :'rls_on2'::boolean);
SELECT * FROM proof;
SELECT CASE WHEN bool_and(ok) THEN 'RESULT PASS' ELSE 'RESULT FAIL' END FROM proof;
