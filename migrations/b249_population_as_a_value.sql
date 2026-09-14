-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b249 — POPULATION IS A VALUE, NOT A FLAG. And some entities serve them all.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-09-14, reading b246 back:
--
--   *"population header is the true or false value. For some reason, if we want to create another population,
--    then if that become a flag, we should be able to create many populations — is that correct? And it never
--    over cross the boundary?"*
--
-- ⭐⭐ CORRECT ON BOTH COUNTS, AND IT IS THE SAME LESSON A THIRD TIME. A boolean bakes in "exactly two, forever".
-- The class dropdown was a partition used as an axis; `entity_kind='test'` was an axis crammed into a partition;
-- `is_test` is an open set crammed into a boolean. Each time the fix is the same: let the thing have as many
-- values as it actually has.
--
-- ⭐ THE RULE NEEDED NO CHANGE AT ALL. b247 already compares the two parties with IS DISTINCT FROM, which works
-- for any number of values. Only the storage was binary. And as a bonus the rule gets STRONGER: "both parties
-- must share a population" also forbids demo↔training, a crossing the two-value version could not even express.
--
-- ── ⭐ WHY NOW, AND NOT LATER ───────────────────────────────────────────────────────────────────────────────────
--
-- Two code files and three migrations read `is_test`, and all five were written today. The moment a report, an
-- export, the counting surface or the till starts reading it, this stops being a morning's work.
--
-- ── ⭐ is_test SURVIVES AS A GENERATED COLUMN ───────────────────────────────────────────────────────────────────
--
-- Every existing reader keeps working and CANNOT drift, because it is computed rather than copied — the same
-- trick as b243's root_path. Only the four WRITERS move to the new column.
--
-- ── ⚠️⚠️ AND THE CONSEQUENCE ATHI HAD TO DECIDE FIRST ───────────────────────────────────────────────────────────
--
-- b247 blocks test → live. `cbincroot` is live. So the moment a test shop raises a support incident to us —
-- which is exactly what DESIGN-SUPPORT-LIFECYCLE.md says every shop does — that chit is refused. It is also how
-- you would test the support loop itself.
--
-- Athi chose (a): population-neutral entities. `serves_all_populations` — true for the operator and the
-- standards, which are not counterparties in a trade but infrastructure.
--
-- ⚠️ AND IT IS GUARDED, because it is a hole if anybody can grant it to themselves: a CHECK restricts it to
-- entities that are already `internal`. A shop cannot become population-neutral by setting a flag.
--
-- ⚠️ REQUIRES b246, b247, b248.
-- Supabase → SQL Editor → paste → Run. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='identities' AND column_name='is_test') THEN
    RAISE EXCEPTION 'b249 needs b246/b247/b248 first — identities.is_test does not exist.';
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS ops;

-- ── ① THE REGISTRY — adding a population is a row, not a migration ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ops.population (
  -- ⚠️ a slug, not free text: it is stored on every identity and appears in URLs and query strings.
  code     text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,23}$'),
  label    text NOT NULL,
  is_live  boolean NOT NULL DEFAULT false,   -- ⚠️ exactly one may be true; see the constraint below
  note     text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE ops.population IS
  'The populations an entity may belong to. Exactly one is live. Two entities may only transact if they share '
  'a population — so every row here is a sealed world, and adding one is a decision, not a convenience.';

INSERT INTO ops.population (code, label, is_live, note) VALUES
  ('live', 'Live',  true,
   'Real businesses doing real trade. The only population whose numbers mean anything commercially.'),
  ('test', 'Test',  false,
   'Fixtures, e2e runs, and anything a human tester creates to check a release. Never touches live books.'),
  /* ⭐ Athi, 2026-09-14: *"yes we need classification, especially the sandbox."* Seeded rather than left to be
     invented, so the first one somebody makes is a copy of a row that already carries a note explaining what
     a population is for. An empty registry teaches nothing. */
  ('sandbox', 'Sandbox', false,
   'A shop trying the product out for themselves, or a partner integrating against it. Real people, real '
   'intent, no commercial meaning — so it is kept out of the live numbers and out of live books.')
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, is_live = EXCLUDED.is_live, note = EXCLUDED.note;

-- ⚠️ ONE LIVE WORLD. Two would mean "real" had two meanings and every commercial number would need to say which.
CREATE UNIQUE INDEX IF NOT EXISTS ops_population_one_live ON ops.population ((is_live)) WHERE is_live;

REVOKE ALL ON ops.population FROM PUBLIC;

/**
 * ⭐ Athi: *"we should be able to create through cbincroot."* So SELECT and INSERT — the operator adds a
 * population from the Platform screen, which is root-gated in the API.
 *
 * ⚠️ AND DELIBERATELY NOT UPDATE OR DELETE. A population is stamped on every identity that joins it, so
 * renaming its code would orphan them and deleting it is already refused by the foreign key. The one thing
 * worse than not being able to remove a population is removing one that entities still point at. If one is
 * genuinely a mistake, that is an operator at a psql prompt deciding it deliberately, not a route.
 *
 * ⚠️ `is_live` is not settable in practice: the unique index below permits exactly one live world, so an
 * INSERT claiming to be live simply fails. One less thing for the route to have to remember to forbid.
 */
GRANT SELECT, INSERT ON ops.population TO cb_app;

-- ── ② THE VALUE ────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE identities ADD COLUMN IF NOT EXISTS population text NOT NULL DEFAULT 'live';

UPDATE identities SET population = 'test' WHERE is_test AND population <> 'test';

-- ⚠️ a foreign key, not a CHECK: the list of populations is DATA, and a CHECK would put it back in the schema —
--    which is the whole thing this migration is undoing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identities_population_fk') THEN
    ALTER TABLE identities
      ADD CONSTRAINT identities_population_fk FOREIGN KEY (population) REFERENCES ops.population(code);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS identities_population_kind_idx ON identities (population, entity_kind);

-- ── ③ is_test BECOMES DERIVED — every reader keeps working, and can never disagree ──────────────────────────────
-- ⚠️ The triggers from b246/b248 reference it, so they go first and come back below against `population`.
DROP TRIGGER IF EXISTS identities_is_test_one_way ON identities;
DROP TRIGGER IF EXISTS identities_population_inheritance ON identities;

ALTER TABLE identities DROP COLUMN is_test;
ALTER TABLE identities
  ADD COLUMN is_test boolean GENERATED ALWAYS AS (population <> 'live') STORED;

COMMENT ON COLUMN identities.is_test IS
  'Derived from population, kept so existing readers keep working. ⚠️ Never written — set `population`.';

-- ── ④ POPULATION-NEUTRAL ENTITIES — Athi''s option (a) ──────────────────────────────────────────────────────────
ALTER TABLE identities ADD COLUMN IF NOT EXISTS serves_all_populations boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN identities.serves_all_populations IS
  'Infrastructure, not a counterparty: the platform operator and the standards. Exempt from the transaction '
  'boundary in both directions, so a test shop can raise a support incident to us. Internal entities only.';

-- ⚠️ THE GUARD. Without it this column is a hole anybody could climb through: a shop that set it would be able
--    to trade across every population at once. Restricted to entities that are already internal — which is a
--    decision only an operator can make.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identities_serves_all_is_internal') THEN
    ALTER TABLE identities ADD CONSTRAINT identities_serves_all_is_internal
      CHECK (NOT serves_all_populations OR coalesce(entity_visibility,'public') = 'internal');
  END IF;
END $$;

UPDATE identities
   SET serves_all_populations = true
 WHERE coalesce(entity_visibility,'public') = 'internal'
   AND NOT serves_all_populations;

-- ── ⑤ THE RULES, RE-EXPRESSED FOR N POPULATIONS ────────────────────────────────────────────────────────────────

-- ⭐ one-way: only the live world may be left. Everything else is identity.
CREATE OR REPLACE FUNCTION identities_population_is_one_way() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.population = NEW.population THEN RETURN NEW; END IF;
  IF OLD.population <> 'live' THEN
    RAISE EXCEPTION 'an entity cannot leave the % population (%)', OLD.population,
      coalesce(OLD.user_id, OLD.display_name)
      USING HINT = 'Population is identity once it is not live. Create a new entity instead.',
            ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;   /* live → anything is how noise gets reclassified */
END
$fn$;

-- ⚠️ its header says idempotent; without this line it was not. A migration that cannot be re-run is one
--    nobody can safely re-run to VERIFY, which is the whole reason these files end in proofs.
DROP TRIGGER IF EXISTS identities_population_one_way ON identities;
CREATE TRIGGER identities_population_one_way
  BEFORE UPDATE OF population ON identities
  FOR EACH ROW WHEN (OLD.population IS DISTINCT FROM NEW.population)
  EXECUTE FUNCTION identities_population_is_one_way();

-- ⭐ a child belongs to the population of its parent (b248, on the new column)
CREATE OR REPLACE FUNCTION identities_inherit_population() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE parent_pop text;
BEGIN
  IF NEW.parent_entity_id IS NULL THEN RETURN NEW; END IF;
  SELECT population INTO parent_pop FROM identities WHERE identity_id = NEW.parent_entity_id;
  /* ⚠️ a parent we cannot find is not a reason to refuse the child — it is a reason to leave it alone. */
  IF parent_pop IS NOT NULL THEN NEW.population := parent_pop; END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS identities_population_inheritance ON identities;
CREATE TRIGGER identities_population_inheritance
  BEFORE INSERT ON identities
  FOR EACH ROW EXECUTE FUNCTION identities_inherit_population();

-- ⭐ both parties to a chit share a population — unless one of them is infrastructure (b247, generalised)
CREATE OR REPLACE FUNCTION chit_populations_must_match() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  mine text; theirs text; mine_all boolean; theirs_all boolean;
BEGIN
  IF NEW.sender_entity_id IS NULL OR NEW.entity_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.sender_entity_id = NEW.entity_id THEN RETURN NEW; END IF;

  SELECT population, serves_all_populations INTO mine,   mine_all   FROM identities WHERE identity_id = NEW.entity_id;
  SELECT population, serves_all_populations INTO theirs, theirs_all FROM identities WHERE identity_id = NEW.sender_entity_id;

  IF mine IS NULL OR theirs IS NULL THEN RETURN NEW; END IF;
  /* ⭐ the operator and the standards are infrastructure, not counterparties — a test shop must be able to
     raise a support incident to us, and that is the whole reason this exemption exists. */
  IF coalesce(mine_all, false) OR coalesce(theirs_all, false) THEN RETURN NEW; END IF;

  IF mine IS DISTINCT FROM theirs THEN
    RAISE EXCEPTION 'a % entity cannot trade with a % entity', theirs, mine
      USING HINT = 'Two entities may only transact inside one population. Use a counterparty in the same one.',
            ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ⭐ READ IT
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
SELECT p.code, p.label, p.is_live,
       count(i.identity_id) FILTER (WHERE i.identity_type = 'entity') AS entities,
       count(i.identity_id)                                            AS identities
  FROM ops.population p
  LEFT JOIN identities i ON i.population = p.code AND coalesce(i.status,'active') <> 'erased'
 GROUP BY 1,2,3 ORDER BY p.is_live DESC, p.code;

SELECT coalesce(user_id, display_name) AS serves_every_population, entity_kind
  FROM identities WHERE serves_all_populations ORDER BY 1;

-- ⚠️ PROVE THE THREE RULES, and roll every probe back. Raises ONLY if something got through.
DO $$
DECLARE
  live_id uuid; test_id uuid; infra_id uuid;
  leaked_trade boolean := false; leaked_promote boolean := false; blocked_support boolean := false;
  /* ⚠️ chit_header is FORCE RLS and FORCE applies to the owner, so a probe INSERT can be refused by the POLICY
     (42501) before the trigger under test is reached. Unprobeable is an UNKNOWN, not a failure. */
  unprobeable boolean := false;
BEGIN
  SELECT identity_id INTO live_id FROM identities
   WHERE identity_type='entity' AND population='live' AND NOT serves_all_populations
     AND coalesce(status,'active')<>'erased' LIMIT 1;
  SELECT identity_id INTO test_id FROM identities
   WHERE identity_type='entity' AND population='test' AND coalesce(status,'active')<>'erased' LIMIT 1;
  SELECT identity_id INTO infra_id FROM identities WHERE serves_all_populations LIMIT 1;

  IF live_id IS NULL OR test_id IS NULL OR infra_id IS NULL THEN
    RAISE NOTICE 'b249: need a live entity, a test entity and an infrastructure entity — UNPROVEN.';
    RETURN;
  END IF;

  BEGIN
    INSERT INTO chit_header (chit_id, entity_id, sender_entity_id,
                             sender_entity_bridge_id, sender_entity_display_name, purpose)
    SELECT gen_random_uuid(), live_id, test_id, coalesce(bridge_id, 'PROBE'),
           coalesce(display_name, 'probe'), 'b249 probe'
      FROM identities WHERE identity_id = test_id;
    leaked_trade := true;
    RAISE EXCEPTION USING ERRCODE='22000', MESSAGE='rollback';
  EXCEPTION
    WHEN check_violation THEN RAISE NOTICE 'b249: ✓ test → live refused.';
    WHEN data_exception  THEN RAISE NOTICE 'b249: ✗ test → live WAS ALLOWED.';
    WHEN others          THEN unprobeable := true;
                              RAISE NOTICE 'b249: ⚠ could not probe test → live (%).', SQLERRM;
  END;

  -- ⭐ and the exemption: a test shop raising a support incident to the operator MUST get through
  BEGIN
    INSERT INTO chit_header (chit_id, entity_id, sender_entity_id,
                             sender_entity_bridge_id, sender_entity_display_name, purpose)
    SELECT gen_random_uuid(), infra_id, test_id, coalesce(bridge_id, 'PROBE'),
           coalesce(display_name, 'probe'), 'b249 probe'
      FROM identities WHERE identity_id = test_id;
    RAISE EXCEPTION USING ERRCODE='22000', MESSAGE='rollback';   -- it worked; undo it
  EXCEPTION
    WHEN data_exception  THEN RAISE NOTICE 'b249: ✓ test → operator allowed (support still reaches us).';
    WHEN check_violation THEN blocked_support := true;
    WHEN others          THEN unprobeable := true;
                              RAISE NOTICE 'b249: ⚠ could not probe test → operator (%).', SQLERRM;
  END;

  BEGIN
    UPDATE identities SET population = 'live' WHERE identity_id = test_id;
    leaked_promote := true;
    RAISE EXCEPTION USING ERRCODE='22000', MESSAGE='rollback';
  EXCEPTION
    WHEN check_violation THEN RAISE NOTICE 'b249: ✓ test → live promotion refused.';
    WHEN data_exception  THEN RAISE NOTICE 'b249: ✗ a test entity WAS PROMOTED.';
  END;

  IF leaked_trade OR leaked_promote THEN
    RAISE EXCEPTION 'b249: THE BOUNDARY DOES NOT HOLD (trade=%, promote=%)', leaked_trade, leaked_promote;
  END IF;
  IF blocked_support THEN
    RAISE EXCEPTION 'b249: SUPPORT IS BLOCKED — a test shop cannot reach the operator. The exemption failed.';
  END IF;
  IF unprobeable THEN
    RAISE NOTICE 'b249: installed, but the chit probes could not run here — the promotion rule above still ran.';
  ELSE
    RAISE NOTICE 'b249: all three rules hold, and support still reaches us.';
  END IF;
END $$;
