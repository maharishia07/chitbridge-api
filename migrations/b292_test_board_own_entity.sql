-- b292_test_board_own_entity.sql — the test board gets its OWN entity, and every result carries a PROJECT.
--
-- Athi, 2026-10-07: "from now on each test to record under test entity and we can check the results and we can
-- delete the record, also it has to run against a project or something so we can group against a sprint or project."
--
-- Today the shared board (TEST_BOARD_ENTITY on Railway) is Tally Test Shop c2837d52-47f2-47e2-9fcd-b98c68a49e45,
-- a shop that also trades in tests. This moves the board's rows to a business that holds nothing else.
--
-- ── RUN ORDER ─────────────────────────────────────────────────────────────────────────────────────────────────
--   0. In the app: register a new business "ChitBridge Test Board" the normal way (so every related row exists).
--      Copy its entity id (Profile, or: SELECT identity_id, display_name FROM identities WHERE identity_type = 'entity' AND display_name ILIKE '%Test Board%').
--   1. Replace NEW-ENTITY-UUID below (ONE place, in step 1) with that id.
--   2. Run STEP 1 (preview, read-only). Check the numbers.
--   3. Run STEP 2 (the move, one transaction). It refuses if the new entity is wrong.
--   4. Railway → chitbridge-api → Variables: set TEST_BOARD_ENTITY to the new id. Redeploys by itself.
--   5. Run STEP 3 (check). Open testing.html: same cases, same results.
--   Undo before step 4: re-run STEP 2 with the two ids swapped. After step 4: swap them AND set the variable back.
--
-- What moves: definition rows of the SHARED kinds only ('testcase', 'cmdb' — lib/testboard.js SHARED_KINDS) and
-- their definition_version rows · every test_result row · every test_result_month row. Nothing else of Tally Test
-- Shop moves (its offers, products, specs, chits stay).
--
-- ⭐ NEW: test_result.project — the sprint/project a run belongs to ("2026-10 build · Stage 1"). Text, optional,
-- written with the run like run_label. Old rows get '(before projects)'.
-- ⭐ DELETING: results stay append-only for the app (cb_app has no DELETE — b219). Deleting is the owner's, here,
-- by project or by run — see STEP 4 at the bottom. Nothing in the app can delete a result.

-- ═════ STEP 1 · PREVIEW (read-only) ═══════════════════════════════════════════════════════════════════════════
WITH ids AS (SELECT 'c2837d52-47f2-47e2-9fcd-b98c68a49e45'::uuid AS old_e,
                    'NEW-ENTITY-UUID'::uuid                        AS new_e)
SELECT 'new entity'               AS what, (SELECT display_name || ' · is_test=' || is_test FROM identities, ids
                                              WHERE identities.identity_id = ids.new_e AND identities.identity_type = 'entity') AS value
UNION ALL SELECT 'definitions to move (testcase+cmdb)', count(*)::text FROM definition, ids
           WHERE entity_id = ids.old_e AND kind IN ('testcase','cmdb')
UNION ALL SELECT 'definition_versions to move', count(*)::text FROM definition_version dv JOIN definition d USING (definition_id), ids
           WHERE d.entity_id = ids.old_e AND d.kind IN ('testcase','cmdb')
UNION ALL SELECT 'test_result rows to move', count(*)::text FROM test_result, ids WHERE entity_id = ids.old_e
UNION ALL SELECT 'test_result_month rows to move', count(*)::text FROM test_result_month, ids WHERE entity_id = ids.old_e
UNION ALL SELECT 'already on the new entity (must be 0)',
           ((SELECT count(*) FROM definition, ids WHERE entity_id = ids.new_e AND kind IN ('testcase','cmdb'))
          + (SELECT count(*) FROM test_result, ids WHERE entity_id = ids.new_e))::text;

-- ═════ STEP 2 · THE MOVE (one transaction) ════════════════════════════════════════════════════════════════════
BEGIN;

CREATE TEMP TABLE _b292 ON COMMIT DROP AS
  SELECT 'c2837d52-47f2-47e2-9fcd-b98c68a49e45'::uuid AS old_e,
         'NEW-ENTITY-UUID'::uuid                        AS new_e;

DO $$
DECLARE o uuid; n uuid; t boolean; clash int;
BEGIN
  SELECT old_e, new_e INTO o, n FROM _b292;
  IF o = n THEN RAISE EXCEPTION 'b292: old and new entity are the same'; END IF;
  SELECT is_test INTO t FROM identities WHERE identity_id = n AND identity_type = 'entity';
  IF t IS NULL THEN RAISE EXCEPTION 'b292: % is not a registered business — register it in the app first', n; END IF;
  SELECT count(*) INTO clash FROM definition d
    WHERE d.entity_id = n AND d.kind IN ('testcase','cmdb')
      AND EXISTS (SELECT 1 FROM definition x WHERE x.entity_id = o AND x.kind = d.kind AND x.name = d.name);
  IF clash > 0 THEN RAISE EXCEPTION 'b292: % case names already exist on the new entity — it has pressed Load cases; stop', clash; END IF;
END $$;

-- the board's business is a TEST business (b246: one-way, real → test only)
UPDATE identities SET is_test = true WHERE identity_id = (SELECT new_e FROM _b292) AND identity_type = 'entity' AND is_test = false;

-- the project column, before the move so the backfill covers every row once
ALTER TABLE test_result ADD COLUMN IF NOT EXISTS project text;
COMMENT ON COLUMN test_result.project IS
  'The sprint or project a run belongs to (e.g. "2026-10 build · Stage 1"). Written with the run, like run_label. b292.';
UPDATE test_result SET project = '(before projects)'
 WHERE project IS NULL AND entity_id = (SELECT old_e FROM _b292);
CREATE INDEX IF NOT EXISTS idx_test_result_project ON test_result (entity_id, project, at DESC);

UPDATE definition_version dv SET entity_id = b.new_e
  FROM definition d, _b292 b
 WHERE dv.definition_id = d.definition_id AND d.entity_id = b.old_e AND d.kind IN ('testcase','cmdb')
   AND dv.entity_id = b.old_e;
UPDATE definition d SET entity_id = b.new_e
  FROM _b292 b WHERE d.entity_id = b.old_e AND d.kind IN ('testcase','cmdb');
UPDATE test_result r SET entity_id = b.new_e FROM _b292 b WHERE r.entity_id = b.old_e;
UPDATE test_result_month m SET entity_id = b.new_e FROM _b292 b WHERE m.entity_id = b.old_e;

DO $$ BEGIN RAISE NOTICE 'b292: moved. Now set TEST_BOARD_ENTITY on Railway to the new id, then run STEP 3.'; END $$;
COMMIT;

-- ═════ STEP 3 · CHECK (read-only; after the Railway variable) ═════════════════════════════════════════════════
WITH ids AS (SELECT 'c2837d52-47f2-47e2-9fcd-b98c68a49e45'::uuid AS old_e,
                    'NEW-ENTITY-UUID'::uuid                        AS new_e)
SELECT 'cases on the board'        AS what, count(*) AS n FROM definition, ids WHERE entity_id = ids.new_e AND kind = 'testcase'
UNION ALL SELECT 'results on the board', count(*) FROM test_result, ids WHERE entity_id = ids.new_e
UNION ALL SELECT 'left on Tally Test (must be 0)',
  (SELECT count(*) FROM definition, ids WHERE entity_id = ids.old_e AND kind IN ('testcase','cmdb'))
+ (SELECT count(*) FROM test_result, ids WHERE entity_id = ids.old_e)
UNION ALL SELECT 'test_result has project column (must be 1)',
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'test_result' AND column_name = 'project')
UNION ALL SELECT 'cb_app UPDATE/DELETE on test_result (must be 0)',
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_name = 'test_result' AND grantee = 'cb_app' AND privilege_type IN ('UPDATE','DELETE'));

-- ═════ STEP 4 · DELETING RESULTS (the owner's, by hand — run only when you mean it) ═════════════════════════
-- Look first:
--   SELECT project, run_label, run_id, min(at), count(*) FROM test_result
--    WHERE entity_id = 'NEW-ENTITY-UUID' GROUP BY 1,2,3 ORDER BY 4 DESC;
-- Delete one project:
--   DELETE FROM test_result WHERE entity_id = 'NEW-ENTITY-UUID' AND project = '<the project>';
-- Delete one run:
--   DELETE FROM test_result WHERE entity_id = 'NEW-ENTITY-UUID' AND run_id = '<the run id>';
-- (test_result_month keeps monthly totals; it is not grouped by project and is left as it is.)
