-- RUN-2026-11-14-b862-entity-schemas-rls.sql (migration number b862) — SEC-75 step 2 of 2 (14 Nov 2026): row level security on entity_schemas and schema_fields, FORCE. SHIPS LAST.
--
-- FILE NAME: the RUN- prefix keeps tools/migrate.cjs (CHAIN_SKIP) and the CI fresh-db build from applying it on its own (b797 / b860 precedent); the fresh-db job applies b861 then this file explicitly.
-- ⚠️ DRAFT · NOT RUN anywhere · Athi runs it AS postgres, on SIT first, then production. RUN ORDER, no other:
--    1. RUN-2026-11-14-b861-entity-schemas-fns.sql, and its CHECK row all true.
--    2. the api that carries SEC-75 is deployed and live (every own-shop read is bound, the three other-shop reads go through the b861 functions; it refused to boot otherwise).
--    3. node tools/identities-sweep.cjs --check prints entity_schemas and schema_fields at open 0, THEN
--    4. THIS file once, then the CHECK below, then `node scripts/rls-census.cjs --save`.
--    Run it BEFORE 1-3 and own-shop reads that were never bound return no row (a silent empty list).
--
-- WHO MAY SEE / WRITE A ROW (key: app.current_entity, set by withEntity / queryAs; NULLIF(current_setting(..., true), '')::uuid)
--   entity_schemas  rls_entity                 FOR ALL     the row's shop only, USING and WITH CHECK           -> own reads and every write
--   entity_schemas  entity_schemas_public_read FOR SELECT  visibility = 'public' AND status = 'active'        -> the shop window, any shop, bound or not
--   schema_fields   rls_entity                 FOR ALL     the parent schema is the bound shop's (no shop column of its own)
--   schema_fields   schema_fields_public_read  FOR SELECT  the parent schema is public AND active
--   The public clause is a SEPARATE FOR SELECT policy (the b851 finding): inside one FOR ALL policy its USING would let UPDATE and DELETE reach another shop's public row.
--   BROADER THAN b851 ON PURPOSE: catalogue_items_public_read also needs is_default; this does not, so a public active non-default schema is readable (the shop window shows it).
--   A draft, restricted or private schema is never readable across shops. Unbound = only the public active rows, never anything else; an unbound INSERT fails (WITH CHECK).
--   schema_fields also holds default_value, xref, via, leg: the row policy exposes them for public schemas; lib/catalogue-view selects six explicit columns (guard T8).
-- RLS: ENABLE + FORCE on both, literal statements (db-85 rule). Privileges unchanged.
-- ROLL BACK (restores the open state exactly; the policies may stay, with RLS off they do nothing; the b861 functions are harmless and stay until the previous api is live):
--    ALTER TABLE schema_fields NO FORCE ROW LEVEL SECURITY;  ALTER TABLE schema_fields DISABLE ROW LEVEL SECURITY;
--    ALTER TABLE entity_schemas NO FORCE ROW LEVEL SECURITY; ALTER TABLE entity_schemas DISABLE ROW LEVEL SECURITY;
-- CHECK (read-only): SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, count(p.polname) AS policies
--      FROM pg_class c LEFT JOIN pg_policy p ON p.polrelid = c.oid
--     WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('entity_schemas', 'schema_fields') GROUP BY 1,2,3 ORDER BY 1;
--      Expect: entity_schemas, true, true, 2  and  schema_fields, true, true, 2.

BEGIN;
SET LOCAL lock_timeout = '5s';   -- ALTER takes ACCESS EXCLUSIVE: fail fast instead of queueing behind a long read; a failed run changed nothing and is safe to run again

ALTER TABLE entity_schemas ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_schemas FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_entity ON entity_schemas;
CREATE POLICY rls_entity ON entity_schemas
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

DROP POLICY IF EXISTS entity_schemas_public_read ON entity_schemas;
CREATE POLICY entity_schemas_public_read ON entity_schemas FOR SELECT
  USING (visibility = 'public' AND status = 'active');

ALTER TABLE schema_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_fields FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_entity ON schema_fields;
CREATE POLICY rls_entity ON schema_fields
  USING      (EXISTS (SELECT 1 FROM entity_schemas s WHERE s.schema_id = schema_fields.schema_id
                        AND s.entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM entity_schemas s WHERE s.schema_id = schema_fields.schema_id
                        AND s.entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid));

DROP POLICY IF EXISTS schema_fields_public_read ON schema_fields;
CREATE POLICY schema_fields_public_read ON schema_fields FOR SELECT
  USING (EXISTS (SELECT 1 FROM entity_schemas s WHERE s.schema_id = schema_fields.schema_id
                   AND s.visibility = 'public' AND s.status = 'active'));

COMMIT;
