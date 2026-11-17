-- b219 · THE TEST LEDGER — who tested what, on which run, and what happened
-- ============================================================================================================
-- Athi, 2026-09-11: *"in the PDF we cannot update pass or fail. Can we have a simple application from our
-- framework itself to create the test cases and update the status and the result, so we know that each of the
-- test cases passed and who has tested? And we can always append the use case. Also we can qualify with engine,
-- transport, web, capability etc."* — then: *"so you can also update the test cases and give pass/fail status for
-- each run: unit test / T1 / T2 / regression and so on, manual and so on."*
--
-- ⭐⭐ NOTHING NEW IS INVENTED HERE, and b213 is the precedent being followed deliberately.
--
--   THE TEST CASE  is a `definition` of kind 'testcase' — authored, named, versioned, exactly like a reward
--                  programme or a tax slab. It is the same KIND of thing: a rule somebody declares that has to be
--                  quotable months later against a result it produced. It costs no new table, no new write path
--                  (POST /api/definitions already exists), no new RLS policy, and no new screen to author one.
--   THE RESULT     is the only new thing, because results ACCUMULATE and a definition does not. Same shape as
--                  reward_ledger, same append-only grant, same reasoning.
--
-- ⭐⭐⭐ AND THE VERSION IS WHY THIS SHAPE IS RIGHT RATHER THAN MERELY CONVENIENT. A test case gets edited — a step
-- is clarified, an expected result is corrected. If a result pointed only at "CTR-01" it would claim that today's
-- wording passed on a day it did not exist. `definition_version` already solves this for offers and slabs, so the
-- result records WHICH VERSION was in front of the tester, and a case edited after a run does not retroactively
-- rewrite what was verified.
--
-- ── ⭐ WHY APPEND-ONLY, WHEN A RESULT LOOKS SO EDITABLE ───────────────────────────────────────────────────────
-- A re-test writes a NEW ROW; the latest row for a case wins. Nothing is ever updated in place. This is the same
-- rule as the points ledger and for the same reason: a status you can quietly edit is not a result, it is an
-- opinion. "CTR-05 failed on Thursday and passed on Friday" is the useful sentence, and it only exists if Thursday
-- survives. It also means a flaky case is VISIBLE — pass, fail, pass is a different fact from pass.
--
-- ── ⭐⭐ TWO AXES, BECAUSE HE ASKED FOR TWO DIFFERENT THINGS ───────────────────────────────────────────────────
--   run_kind  HOW it was tested  — manual · unit · t0 · t1 · t2 · t3 · regression
--                                  (the testing ladder we already work to, not a new vocabulary)
--   layer     WHAT it exercises  — engine · transport · web · capability · db · connector
--                                  (the same words the capability legend and inventory.cjs already use)
-- ⚠️ `layer` is recorded on the RESULT, not only on the case, because one case is often provable at two levels:
-- the offer engine's arithmetic is checked by a unit test AND by a person at the counter, and those are different
-- evidence. Storing it only on the case would force a choice between them.
--
-- ⭐ WITH RLS — entity-isolated on app.current_entity, ENABLE + FORCE, like every other entity-data table.
-- Supabase -> SQL Editor -> paste -> Run. Step 1 only looks. Idempotent; safe to re-run.
-- ============================================================================================================

-- ── 1 · LOOK FIRST. Expect 0 rows the first time; one row named test_result on a re-run.
SELECT c.relname AS table_name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'test_result';

-- and what already exists as a test case (0 the first time)
SELECT count(*) AS testcase_definitions FROM definition WHERE kind = 'testcase';

-- ── 2 · THE TABLE.
BEGIN;

CREATE TABLE IF NOT EXISTS test_result (
  result_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       uuid NOT NULL,                   -- whose testing this is. Two businesses never see each other's.

  -- ── WHICH CASE, and which wording of it ────────────────────────────────────────────────────────────────────
  -- ⚠️ definition_id is NOT a foreign key on purpose: a case can be retired, and retiring a case must never
  -- destroy the evidence that it once passed. The same reasoning definition_version already uses for a frozen
  -- citation — the record outlives the rule it cited.
  definition_id   uuid,
  case_version    integer,                         -- WHICH wording was in front of the tester
  case_key        text NOT NULL,                   -- 'CTR-01' — the human name, kept readable without a join
  module_key      text,                            -- 'CTR' — so a module can be totalled without parsing the key

  -- ── WHAT HAPPENED ──────────────────────────────────────────────────────────────────────────────────────────
  status          text NOT NULL,                   -- pass | fail | blocked | skipped
  -- ⚠️ 'blocked' is NOT 'fail'. A case that could not be reached because a prior step is broken tells you nothing
  -- about the case itself, and counting it as a failure produces a red board that nobody can act on. 'skipped'
  -- is the deliberate one — not applicable to this run.

  -- ── HOW, AND AT WHAT LEVEL ─────────────────────────────────────────────────────────────────────────────────
  run_kind        text NOT NULL,                   -- manual | unit | t0 | t1 | t2 | t3 | regression
  layer           text,                            -- engine | transport | web | capability | db | connector

  -- ── WHO, AND WHEN ──────────────────────────────────────────────────────────────────────────────────────────
  -- ⚠️ BOTH the id and the name. The id is the truth; the NAME is what the board shows, and a person who has
  -- since left must still be readable months later without a join to a row that may be gone. The same reason a
  -- chit carries the sender's display name beside the id.
  tested_by       uuid,
  tester_name     text,
  at              timestamptz NOT NULL DEFAULT now(),

  -- ── THE RUN THIS BELONGS TO ────────────────────────────────────────────────────────────────────────────────
  -- A run groups results the way a bill groups lines. It is an id and a label, not a table: a run has no life of
  -- its own beyond the results in it, and a table would mean an empty run could exist.
  run_id          uuid NOT NULL,
  run_label       text,                            -- 'v2.0 before release' — what a person would call this sitting

  -- ── EVIDENCE ───────────────────────────────────────────────────────────────────────────────────────────────
  note            text,                            -- what the tester saw, in their words
  evidence        text,                            -- a spec name, a bill number, a screenshot filename
  build           text,                            -- which build was in front of them

  CONSTRAINT test_result_status_chk   CHECK (status   IN ('pass','fail','blocked','skipped')),
  CONSTRAINT test_result_kind_chk     CHECK (run_kind IN ('manual','unit','t0','t1','t2','t3','regression')),
  CONSTRAINT test_result_layer_chk    CHECK (layer IS NULL OR layer IN
                                        ('engine','transport','web','capability','db','connector')),
  CONSTRAINT test_result_case_key_chk CHECK (length(btrim(case_key)) > 0)
);

-- ⚠️⚠️ AN AUTOMATED RUN MUST NOT DOUBLE-WRITE. The guard suite and the specs post their results here, and a
-- re-run of the same suite under the same run_id is a retry, not a second opinion. One row per (run, case, layer);
-- the insert says ON CONFLICT DO NOTHING and a replay is a quiet no-op. The same rule the counter's queue needs.
-- ⚠️ COALESCE on layer because NULL is never equal to NULL, so a unique index over a nullable column does not
-- constrain the rows that need it most.
CREATE UNIQUE INDEX IF NOT EXISTS uq_test_result_once
  ON test_result (run_id, case_key, COALESCE(layer, ''));

-- the query the board runs: this entity's latest word on every case
CREATE INDEX IF NOT EXISTS idx_test_result_case ON test_result (entity_id, case_key, at DESC);
-- and the one a run summary needs
CREATE INDEX IF NOT EXISTS idx_test_result_run  ON test_result (entity_id, run_id, at DESC);
-- totals by module, the headline number on the board
CREATE INDEX IF NOT EXISTS idx_test_result_module ON test_result (entity_id, module_key, at DESC);

ALTER TABLE test_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_result FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_entity ON test_result;
CREATE POLICY rls_entity ON test_result
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- ⭐⭐ THE APPEND-ONLY GRANT. This is the line that makes the board trustworthy.
GRANT SELECT, INSERT ON test_result TO cb_app;
REVOKE UPDATE, DELETE ON test_result FROM cb_app;

DO $$
BEGIN
  RAISE NOTICE 'b219: test_result created — append-only for cb_app, entity-isolated, FORCE RLS.';
  RAISE NOTICE 'b219: a re-test is a NEW ROW. The latest row for a case wins; the earlier one stays readable.';
  RAISE NOTICE 'b219: the CASES themselves are definitions of kind ''testcase'' — no new table, no new write path.';
END $$;

COMMIT;

-- ── 3 · WHAT YOU SHOULD SEE
SELECT 'test_result' AS table_name,
       (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
         WHERE c.relname = 'test_result') AS policies,
       (SELECT count(*) FROM information_schema.role_table_grants
         WHERE table_name = 'test_result' AND grantee = 'cb_app'
           AND privilege_type IN ('UPDATE','DELETE')) AS must_be_zero;
