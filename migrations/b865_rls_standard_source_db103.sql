-- b865_rls_standard_source_db103.sql — DB-103 (15 Nov 2026): row level security on standard_source, the last shared table b855 left open ("owner writes, subscribers read").
--
-- ⚠️⚠️ DRAFT — NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres) AFTER the api that carries this change is deployed, in this order:
--    1. deploy the api (lib/source.js registerSource now binds the new source entity for its one write: set_config('app.current_entity') inside its transaction)
--    2. run THIS file once on SIT, then on production (safe to re-run: ENABLE/FORCE are idempotent, every policy is DROP POLICY IF EXISTS then CREATE; touches no rows, no grants)
--    3. read-only CHECK below, then `node scripts/rls-census.cjs --save` (aimed at the database Athi names) so db/rls-baseline.json shows standard_source as RLS on
--    Run it BEFORE the deploy and POST /api/governance/source (register a source) fails closed on the standard_source write.
--
-- WHO MAY SEE / WRITE A ROW (key: app.current_entity, set by withEntity / set_config; the shape of b855 catalogue_source and product_container)
--   read    everyone (USING true): every shop's standards resolve against these rows (lib/conformance, readiness, workpattern, profile, boilerplate, instruments read with no shop bound or any shop bound)
--   write   only the owning source entity (owner_entity_id = current entity). The one writer is lib/source.js registerSource (platform role, POST /api/governance/source), which binds the source entity it just found or minted.
--   ⚠️ DELIBERATELY NO "claim an ownerless row" policy (b855 has one for catalogue_source / product_container): the ten platform-seeded standards (haccp, fssai, reach, tsca, sds, bis, phyto, eu-health ...) have owner_entity_id NULL
--   and every shop resolves its compliance template from them. A claim policy would let any shop set itself owner of one and rewrite the template for all shops. With no policy a NULL-owner row can be changed only by the owner
--   role (this editor, scripts run as postgres); registerSource on a seeded key therefore raises a row-level-security error instead of upserting (platform-only edge, no shop path reaches it).
-- RLS: ENABLE + FORCE, literal statements (db-85 rule). Privileges unchanged (cb_app keeps SELECT, INSERT, UPDATE, DELETE; a grant change needs a code grep first, none made here).
--
-- ROLL BACK (restores the open state exactly; the policies may stay: with RLS disabled they do nothing):
--    ALTER TABLE standard_source NO FORCE ROW LEVEL SECURITY; ALTER TABLE standard_source DISABLE ROW LEVEL SECURITY;
-- CHECK (read-only): SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, count(p.polname) AS policies
--      FROM pg_class c LEFT JOIN pg_policy p ON p.polrelid = c.oid
--     WHERE c.relnamespace = 'public'::regnamespace AND c.relname = 'standard_source' GROUP BY 1,2,3;
--      Expect: standard_source, true, true, 2.

BEGIN;
SET LOCAL lock_timeout = '5s';   -- ALTER takes ACCESS EXCLUSIVE: fail fast instead of queueing behind a long read; a failed run changed nothing and is safe to run again

ALTER TABLE standard_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE standard_source FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS standard_source_read_all ON standard_source;
CREATE POLICY standard_source_read_all ON standard_source FOR SELECT USING (true);
DROP POLICY IF EXISTS rls_entity ON standard_source;
CREATE POLICY rls_entity ON standard_source
  USING      (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

COMMIT;
