-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b247 — A TEST ENTITY NEVER TRANSACTS WITH A PRODUCTION ENTITY
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-09-14: *"yes, clearly, that is the distinction we have to make — test entity never transact with
-- production entity."*
--
-- ⭐⭐ THIS IS THE RULE WITH TEETH. b246 gave us a column that SAYS which population an entity belongs to. This
-- is what makes the word "never" true. Without it a tester's shop sends one chit to a real shop and there is
-- test data in a real business's books — permanently, because a chit is evidence and evidence is not deleted.
-- No filter on any screen undoes that; the only fix is to stop it happening.
--
-- ── ⚠️⚠️ WHY A TRIGGER AND NOT A CHECK IN THE ROUTE ─────────────────────────────────────────────────────────────
--
-- The same lesson as b246, one level up. A route check is a DETECTOR: it guards the door it is written on.
-- Chits are written from the compose path, the counter, the connector, channel capture, the e2e harness and
-- scripts — and each of those is a door somebody can add another beside. A trigger guards the TABLE, so the
-- rule holds for code that has not been written yet. [[feedback-stay-in-the-construct]]
--
-- ── ⭐ WHAT "TRANSACT" MEANS HERE ───────────────────────────────────────────────────────────────────────────────
--
-- `chit_header` holds ONE ROW PER PARTICIPANT COPY: `entity_id` is whose copy this is, `sender_entity_id` is
-- who sent it. So a crossing is exactly a row where those two entities disagree about their population — which
-- is a single comparison, evaluated on the one table every chit must pass through, whichever door it came in.
--
-- ⚠️ NOT a check on supplier_list / customer_list. Naming a counterparty is not transacting with one, and D-056
-- deliberately lets a shop add anybody without consent. Blocking that would break a working feature to enforce
-- a rule about a different thing. If the lists should be separated too, that is its own decision.
--
-- ── ⚠️ EXISTING CROSSINGS ARE REPORTED, NOT DELETED ─────────────────────────────────────────────────────────────
--
-- The first query below counts what has already happened. Whatever it finds stays: deleting chits to make a new
-- rule look clean is exactly the kind of tidying that destroys evidence. The trigger stops the NEXT one.
--
-- Supabase → SQL Editor → paste → Run. Idempotent.
-- ⚠️ REQUIRES b246.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ⚠️ fail loudly rather than create a trigger that reads a column which is not there
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='identities' AND column_name='is_test') THEN
    RAISE EXCEPTION 'b247 needs b246 — identities.is_test does not exist yet. Run b246 first.';
  END IF;
END $$;

-- ── ① what has already crossed, before anything is enforced ────────────────────────────────────────────────────
SELECT count(DISTINCT h.chit_id)::int AS chits_that_already_cross
  FROM chit_header h
  JOIN identities me ON me.identity_id = h.entity_id
  JOIN identities sender ON sender.identity_id = h.sender_entity_id
 WHERE me.is_test IS DISTINCT FROM sender.is_test;

-- ── ② the rule ─────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION chit_populations_must_match() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  mine   boolean;
  theirs boolean;
BEGIN
  /* ⚠️ a chit with no sender recorded is not a crossing — it is an older row shape, and rejecting it would
     block writes that have nothing to do with this rule. */
  IF NEW.sender_entity_id IS NULL OR NEW.entity_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.sender_entity_id = NEW.entity_id THEN RETURN NEW; END IF;   /* the sender's own copy */

  SELECT is_test INTO mine   FROM identities WHERE identity_id = NEW.entity_id;
  SELECT is_test INTO theirs FROM identities WHERE identity_id = NEW.sender_entity_id;

  /* ⚠️ an identity we cannot find is not evidence of a crossing. Refusing here would turn a missing row into a
     failed send, which is a worse fault than the one being prevented. */
  IF mine IS NULL OR theirs IS NULL THEN RETURN NEW; END IF;

  IF mine IS DISTINCT FROM theirs THEN
    RAISE EXCEPTION 'a % entity cannot trade with a % entity',
      CASE WHEN theirs THEN 'test' ELSE 'production' END,
      CASE WHEN mine   THEN 'test' ELSE 'production' END
      USING HINT = 'Test data must never reach a real business''s books. Use a test counterparty.',
            ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS chit_header_population_boundary ON chit_header;
CREATE TRIGGER chit_header_population_boundary
  BEFORE INSERT ON chit_header
  FOR EACH ROW EXECUTE FUNCTION chit_populations_must_match();

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ⭐ PROVE IT — both directions, because a guard that only blocks one is a guard with a way round it.
-- ⚠️ Everything here is rolled back.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  real_id uuid; test_id uuid; got boolean;
BEGIN
  SELECT identity_id INTO real_id FROM identities
   WHERE identity_type='entity' AND NOT is_test AND coalesce(status,'active')<>'erased' LIMIT 1;
  SELECT identity_id INTO test_id FROM identities
   WHERE identity_type='entity' AND is_test AND coalesce(status,'active')<>'erased' LIMIT 1;

  IF real_id IS NULL OR test_id IS NULL THEN
    RAISE NOTICE 'b247: need one entity of each population to prove this — trigger installed but UNPROVEN.';
    RETURN;
  END IF;

  got := false;
  BEGIN
    INSERT INTO chit_header (chit_id, entity_id, sender_entity_id, purpose)
    VALUES (gen_random_uuid(), real_id, test_id, 'b247 probe');
    got := true;
  EXCEPTION
    WHEN check_violation THEN RAISE NOTICE 'b247: ✓ test → production refused.';
    WHEN others          THEN RAISE NOTICE 'b247: ⚠ could not probe (%) — check manually.', SQLERRM;
  END;
  IF got THEN RAISE EXCEPTION 'b247: ✗ A TEST ENTITY CAN STILL SEND TO A REAL ONE.'; END IF;

  got := false;
  BEGIN
    INSERT INTO chit_header (chit_id, entity_id, sender_entity_id, purpose)
    VALUES (gen_random_uuid(), test_id, real_id, 'b247 probe');
    got := true;
  EXCEPTION
    WHEN check_violation THEN RAISE NOTICE 'b247: ✓ production → test refused.';
    WHEN others          THEN RAISE NOTICE 'b247: ⚠ could not probe (%) — check manually.', SQLERRM;
  END;
  IF got THEN RAISE EXCEPTION 'b247: ✗ A REAL ENTITY CAN STILL SEND TO A TEST ONE.'; END IF;

  RAISE EXCEPTION 'b247: probes complete and rolled back (this exception is deliberate).';
END $$;
