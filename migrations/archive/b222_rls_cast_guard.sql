-- b222_rls_cast_guard.sql — NULLIF the entity cast on every policy that is missing it.
--
-- ⭐ RAN 2026-09-11 by Athi. Re-running is safe: every statement is DROP IF EXISTS + CREATE.
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
-- ⭐ RAN 2026-09-11. AFTER RUNNING THIS the guard settles itself: tests/entity-cast-guard.test.cjs now asks
-- whether a LATER migration gave each table a guarded policy, instead of being told the answer.
--
-- ⚠️ MY ORIGINAL INSTRUCTION HERE WAS WRONG and said "lower the baseline to zero" by hand. That makes the guard
-- agree with ME rather than with the tree, and the next unguarded cast in an old file would then read as new
-- debt. Deriving it also turned up that the baseline had been overstating by FOUR since August: b172 and b174
-- were listed at 2 each and b175_fix_rls_predicate.sql had already guarded both. Nobody looked, because the
-- number only ever had to stop going up.
--
-- ⭐ Found 2026-09-11 by tests/entity-cast-guard.test.cjs, which flagged the NEWEST one (b203) and was right.
-- The other 11 are older and were never flagged, because that guard only looks at new migrations.
--
-- ── WHAT THIS DOES ────────────────────────────────────────────────────────────────────────────────────────────
-- Drops and recreates each policy below with the identical predicate plus NULLIF. No table, column, grant or
-- row is touched. ⚠️ Between the DROP and the CREATE inside one transaction the table has no policy — which is
-- why it is one transaction, and why it should not be run while a batch job is mid-flight.

BEGIN;

-- ── ⚠️⚠️ AND IT HARD-FAILED ON A TABLE THAT IS NOT ON EVERY DATABASE ─────────────────────────────────────────
--
-- Athi, 2026-09-11, running it: `ERROR: 42P01: relation "chit_amendment" does not exist`.
--
-- ⚠️ THE MIGRATION WAS WRITTEN AGAINST THE SCHEMA I COULD SEE and named all fourteen tables outright, so the
-- first one this database has not got aborted the whole transaction — and because it is one transaction, the
-- thirteen that WOULD have applied did not. A migration that stops at the first absent table is a migration
-- that can only run on the machine it was written on.
--
-- ⭐ SO IT SKIPS WHAT IS NOT THERE AND SAYS SO. Each policy is applied only if its table exists; anything
-- missing is raised as a NOTICE, not an error. That is the same self-healing rule lib/regional.js already
-- follows ("degrades to just the container content if b81 isn't applied") — a migration should fix what it
-- can reach and report what it cannot, never refuse to start.
--
-- ⚠️ A SKIPPED TABLE IS NOT A FIXED TABLE. If a NOTICE names one, that table's migration was never applied
-- here; run it, then run this again. Re-running is safe — every statement is DROP IF EXISTS + CREATE.
DO $b222$
DECLARE
  skipped   text[] := '{}';
  applied   int := 0;
  policies  text[][] := ARRAY[
    ['catalogue_item_schedule_isolation', 'catalogue_item_schedule', 'entity_id'],
    ['catalogue_item_version_isolation', 'catalogue_item_version', 'entity_id'],
    ['chit_amendment_isolation', 'chit_amendment', 'entity_id'],
    ['chit_line_isolation', 'chit_line', 'entity_id'],
    ['chit_line_amendment_isolation', 'chit_line_amendment', 'entity_id'],
    ['chit_line_assign_isolation', 'chit_line_assignment', 'entity_id'],
    ['chit_line_cost_isolation', 'chit_line_cost', 'entity_id'],
    ['chit_line_delivery_isolation', 'chit_line_delivery', 'entity_id'],
    ['chit_sla_isolation', 'chit_sla', 'entity_id'],
    ['chit_sla_pause_isolation', 'chit_sla_pause', 'entity_id'],
    ['definition_isolation', 'definition', 'entity_id'],
    ['definition_version_isolation', 'definition_version', 'entity_id'],
    ['folder_rule_isolation', 'folder_rule', 'entity_id'],
    ['wholesaler_store_isolation', 'wholesaler_store', 'owner_entity_id']
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(policies, 1) LOOP
    IF to_regclass(policies[i][2]) IS NULL THEN
      skipped := skipped || policies[i][2];
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', policies[i][1], policies[i][2]);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (%I = NULLIF(current_setting(''app.current_entity'', true), '''')::uuid)'
      || ' WITH CHECK (%I = NULLIF(current_setting(''app.current_entity'', true), '''')::uuid)',
      policies[i][1], policies[i][2], policies[i][3], policies[i][3]);
    applied := applied + 1;
  END LOOP;

  RAISE NOTICE 'b222: % policy/policies guarded', applied;
  IF array_length(skipped, 1) IS NOT NULL THEN
    RAISE NOTICE 'b222: SKIPPED (table not on this database) — %', array_to_string(skipped, ', ');
    RAISE NOTICE 'b222: those migrations were never applied here. Run them, then run b222 again.';
  END IF;
END
$b222$;

COMMIT;

-- VERIFICATION, after the commit. Expect ZERO rows: no policy left casting without NULLIF.
SELECT schemaname, tablename, policyname
  FROM pg_policies
 WHERE (qual LIKE '%current_setting%' OR with_check LIKE '%current_setting%')
   AND COALESCE(qual, '') NOT LIKE '%NULLIF%'
   AND COALESCE(with_check, '') NOT LIKE '%NULLIF%'
 ORDER BY tablename, policyname;
