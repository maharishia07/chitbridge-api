-- b222_rls_cast_guard.sql — NULLIF the entity cast on every policy that is missing it.
--
-- ⚠️⚠️ NOT RUN. Athi runs migrations. Read this first — it rewrites RLS policies on live tables.
--
-- ── WHAT IS WRONG ─────────────────────────────────────────────────────────────────────────────────────────────
-- 14 policies across 12 migrations cast the entity setting without guarding it:
--
--     entity_id = current_setting('app.current_entity', true)::uuid          -- what they say
--     entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid   -- what the other 51 say
--
-- ⭐ THE DIFFERENCE ONLY BITES BECAUSE OF HOW WE SET IT. `current_setting(..., true)` returns NULL when the
-- setting was never made, and NULL::uuid is NULL, so the predicate is false and the policy FAILS CLOSED — which
-- is correct. But db/index.js sets the value to an EMPTY STRING when there is no entity
-- (`entityId == null ? '' : String(entityId)`), and ''::uuid raises 22P02 invalid input syntax for type uuid.
--
-- ⚠️ SO THIS IS A ROBUSTNESS FAULT, NOT A LEAK, AND CALLING IT A BREACH WOULD BE WRONG. Nobody sees another
-- tenant's rows; a query in a null-entity transaction ERRORS instead of returning none. Under FORCE row level
-- security that is a 500 where there should have been an empty list — and on `definition` (b160) that is the
-- test board, the tax slabs, the reward programmes and every other authored rule.
--
-- ⚠️⚠️ AND THIS WAS NEVER A SECRET. tests/entity-cast-guard.test.cjs has carried a BASELINE of 32 unguarded
-- casts in 14 migrations since it was written — "latent since b132", in its own words — deliberately capped as
-- known debt rather than fixed. The guard has been doing its job the whole time. What it caught on 2026-09-11
-- is that b203 ADDED to the debt, which is the one thing the cap forbids.
--
-- ⭐ So the story here is not a hidden fault. It is that a red line in a suite of twenty-seven reds is
-- indistinguishable from stale tooling until somebody reads every one of them — which is the argument for the
-- whole test board, and the reason this migration exists at all.
--
-- ⚠️ AFTER RUNNING THIS: lower the baseline in tests/entity-cast-guard.test.cjs to zero. The guard fails when a
-- file drops below its baseline, on purpose — "a stale baseline is the same failure as a stale backlog row".
--
-- ⭐ Found 2026-09-11 by tests/entity-cast-guard.test.cjs, which flagged the NEWEST one (b203) and was right.
-- The other 11 are older and were never flagged, because that guard only looks at new migrations.
--
-- ── WHAT THIS DOES ────────────────────────────────────────────────────────────────────────────────────────────
-- Drops and recreates each policy below with the identical predicate plus NULLIF. No table, column, grant or
-- row is touched. ⚠️ Between the DROP and the CREATE inside one transaction the table has no policy — which is
-- why it is one transaction, and why it should not be run while a batch job is mid-flight.

BEGIN;

-- b203_catalogue_item_schedule_APPLY.sql
DROP POLICY IF EXISTS catalogue_item_schedule_isolation ON catalogue_item_schedule;
CREATE POLICY catalogue_item_schedule_isolation ON catalogue_item_schedule
  USING       (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK  (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- b146_catalogue_item_version.sql
DROP POLICY IF EXISTS catalogue_item_version_isolation ON catalogue_item_version;
CREATE POLICY catalogue_item_version_isolation ON catalogue_item_version
  USING       (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK  (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- b137_chit_amendment.sql
DROP POLICY IF EXISTS chit_amendment_isolation ON chit_amendment;
CREATE POLICY chit_amendment_isolation ON chit_amendment
  USING       (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK  (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- b142_chit_line.sql
DROP POLICY IF EXISTS chit_line_isolation ON chit_line;
CREATE POLICY chit_line_isolation ON chit_line
  USING       (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK  (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- b138_line_amendment.sql
DROP POLICY IF EXISTS chit_line_amendment_isolation ON chit_line_amendment;
CREATE POLICY chit_line_amendment_isolation ON chit_line_amendment
  USING       (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK  (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- b143_line_assignment.sql
DROP POLICY IF EXISTS chit_line_assign_isolation ON chit_line_assignment;
CREATE POLICY chit_line_assign_isolation ON chit_line_assignment
  USING       (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK  (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- b145_line_cost.sql
DROP POLICY IF EXISTS chit_line_cost_isolation ON chit_line_cost;
CREATE POLICY chit_line_cost_isolation ON chit_line_cost
  USING       (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK  (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- b144_line_delivery.sql
DROP POLICY IF EXISTS chit_line_delivery_isolation ON chit_line_delivery;
CREATE POLICY chit_line_delivery_isolation ON chit_line_delivery
  USING       (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK  (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- b147_service_sla.sql
DROP POLICY IF EXISTS chit_sla_isolation ON chit_sla;
CREATE POLICY chit_sla_isolation ON chit_sla
  USING       (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK  (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- b147_service_sla.sql
DROP POLICY IF EXISTS chit_sla_pause_isolation ON chit_sla_pause;
CREATE POLICY chit_sla_pause_isolation ON chit_sla_pause
  USING       (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK  (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- b160_definitions.sql
DROP POLICY IF EXISTS definition_isolation ON definition;
CREATE POLICY definition_isolation ON definition
  USING       (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK  (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- b160_definitions.sql
DROP POLICY IF EXISTS definition_version_isolation ON definition_version;
CREATE POLICY definition_version_isolation ON definition_version
  USING       (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK  (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- b132_folder_rules.sql
DROP POLICY IF EXISTS folder_rule_isolation ON folder_rule;
CREATE POLICY folder_rule_isolation ON folder_rule
  USING       (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK  (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- b135_wholesaler_stores.sql
DROP POLICY IF EXISTS wholesaler_store_isolation ON wholesaler_store;
CREATE POLICY wholesaler_store_isolation ON wholesaler_store
  USING       (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK  (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

COMMIT;

-- VERIFICATION, after the commit. Expect ZERO rows: no policy left casting without NULLIF.
SELECT schemaname, tablename, policyname
  FROM pg_policies
 WHERE (qual LIKE '%current_setting%' OR with_check LIKE '%current_setting%')
   AND COALESCE(qual, '') NOT LIKE '%NULLIF%'
   AND COALESCE(with_check, '') NOT LIKE '%NULLIF%'
 ORDER BY tablename, policyname;
