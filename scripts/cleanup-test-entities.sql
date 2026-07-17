-- cleanup-test-entities.sql — sweep the data the e2e suite creates. DESTRUCTIVE. Run in the Supabase SQL Editor (as the
-- postgres role). Every e2e identity is created with a @test.example email (the fixtures use it exclusively), so that is
-- the ONLY thing this touches — real entities are never matched.
--
-- HOW TO USE: run PART 1 first, read the counts. If they look right, run PART 2. Nothing deletes until PART 2.
-- ⚠️ NEVER run this against a production database. It is for the dev/test environment only.

SET row_security = off;   -- so FORCE-RLS tables (kyb_field_cache, form_instance, idempotency_key) are swept too (postgres/BYPASSRLS)

-- ============================ PART 1 · DRY RUN (review before deleting) ============================
WITH e AS (SELECT identity_id FROM identities WHERE email LIKE '%@test.example')
SELECT
  (SELECT count(*) FROM identities WHERE email LIKE '%@test.example')                              AS test_entities,
  (SELECT count(*) FROM identities WHERE parent_entity_id IN (SELECT identity_id FROM e))          AS their_actors,
  (SELECT count(*) FROM chit_header WHERE entity_id IN (SELECT identity_id FROM e))                AS chits,
  (SELECT count(*) FROM entity_schemas WHERE entity_id IN (SELECT identity_id FROM e))             AS schemas;

-- Preview the entities themselves (so you can eyeball they're all test rows):
-- SELECT identity_id, bridge_id, display_name, email, created_at FROM identities WHERE email LIKE '%@test.example' ORDER BY created_at DESC;

-- ============================ PART 2 · DELETE (only after reviewing PART 1) ============================
DO $$
DECLARE tbl text; eids uuid[];
BEGIN
  SELECT array_agg(identity_id) INTO eids FROM identities WHERE email LIKE '%@test.example';
  IF eids IS NULL THEN RAISE NOTICE 'No test entities found — nothing to clean.'; RETURN; END IF;

  -- schema_fields hang off entity_schemas by schema_id (no entity_id) — clear them first to avoid a FK block.
  BEGIN
    DELETE FROM schema_fields WHERE schema_id IN (SELECT schema_id FROM entity_schemas WHERE entity_id = ANY(eids));
  EXCEPTION WHEN undefined_table THEN NULL; END;

  -- Schema-adaptive: delete from EVERY table that has an entity_id column, scoped to the test entities. Covers chit_header,
  -- chit_messages, cb_attachment, catalogue_items, entity_schemas, entity_governance, entity_wallet, usage_ledger,
  -- form_instance, idempotency_key, kyb_field_cache, relationships, connections, folders, connectors, captures, etc.
  FOR tbl IN
    SELECT table_name FROM information_schema.columns
    WHERE column_name = 'entity_id' AND table_schema = 'public' AND table_name <> 'identities'
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE entity_id = ANY($1)', tbl) USING eids;
  END LOOP;

  -- the co-assists (actors) that hang off these entities, then the entities themselves.
  DELETE FROM identities WHERE parent_entity_id = ANY(eids);
  DELETE FROM identities WHERE identity_id      = ANY(eids);

  RAISE NOTICE 'Cleaned % test entities (+ their actors and all @test.example data).', array_length(eids, 1);
END $$;
