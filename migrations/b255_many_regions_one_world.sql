-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b255 — MANY REGIONS IN ONE WORLD
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-09-15: *"so a single installation can have multiple sandbox… basically jurisdiction can be set and
-- tested"* — and, earlier: *"we can simulate the global using the same engine but for different region, vertical
-- and so on and see how it behaves for each one area."*
--
-- ── ⚠️⚠️ b254 GOT THIS WRONG, AND IT WOULD HAVE MADE THE POINT OF THE EXERCISE IMPOSSIBLE ────────────────────────
--
-- b254's stamp trigger reads the POPULATION's installation and gives it to every entity born in that population.
-- So a world could only ever be one region — and simulating an India↔UAE trade, which is the whole reason the
-- sandboxes exist, could not be done at all.
--
-- ⭐ THE LIVE WORLD ALREADY DISPROVES IT. `population = 'live'` spans platform-0 (India) and platform-1 (Mexico).
-- ONE population, MANY installations. That is not an accident of seeding — it is the only way cross-border trade
-- can exist, because b247 requires both parties to share a population and they plainly do not share a region.
--
--     population    the BOUNDARY   — one sealed set of books; b247 refuses a chit across it
--     installation  the CHARACTER  — region, currency, timezone, languages, vertical
--
-- A world is one boundary containing entities of MANY characters. b254 collapsed the two into one, which is the
-- same mistake as treating a region as a boundary. [[project-jurisdiction-pivot]]
--
-- ── ⭐ SO installation_key BECOMES A DEFAULT, NOT AN INHERITANCE ────────────────────────────────────────────────
--
--   · a population's `installation_key` is what a new entity gets WHEN NOTHING ELSE SAYS OTHERWISE
--   · an entity may be created against any ACTIVE installation, and keeps it
--   · b254's trigger no longer overwrites a stamp that is already there
--
-- ⚠️ b254 IS HARMLESS AS IT STANDS — `live` names no installation, so nothing has ever been stamped and nothing
-- changed. This corrects the shape before anything depends on it, which is the only cheap time to do it.
--
-- ⚠️ REQUIRES b254.
-- Supabase → SQL Editor → paste → Run — ⭐ WITHOUT RLS (as `postgres`).
-- ⚠️ Being the owner is NOT the same as bypassing RLS; entity_governance is FORCE RLS, which is why the stamp
--    function stays SECURITY DEFINER.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='ops' AND table_name='population' AND column_name='installation_key') THEN
    RAISE EXCEPTION 'b255 needs b254 — ops.population.installation_key does not exist. Run b254 first.';
  END IF;
END $$;

COMMENT ON COLUMN ops.population.installation_key IS
  'The installation a NEW entity in this population is given WHEN NOTHING ELSE SAYS OTHERWISE. It is a default, '
  'not a property of the world: one population may hold entities of many installations, which is how a single '
  'sealed world can simulate cross-border trade, and how the live world already spans India and Mexico.';

-- ── ① THE STAMP IS A DEFAULT ────────────────────────────────────────────────────────────────────────────────────
/**
 * ⚠️ `ON CONFLICT DO NOTHING` was already there and is what makes this safe: if something has ALREADY stamped
 * the entity — a join link naming a region, an operator placing a shop in UAE — this leaves it alone. The
 * trigger fills a gap; it never overrules an answer somebody gave on purpose.
 *
 * ⭐ AND IT FALLS BACK TO THE LIVE WORLD'S DEFAULT. A sandbox that names no installation should not leave its
 * entities unstamped and invisible to the cascade; it should behave like the live world, which is what an
 * unconfigured world is.
 */
CREATE OR REPLACE FUNCTION identities_stamp_world() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, ops, pg_temp AS $fn$
DECLARE ik text; vk text;
BEGIN
  IF NEW.identity_type IS DISTINCT FROM 'entity' THEN RETURN NEW; END IF;
  BEGIN
    SELECT p.installation_key INTO ik
      FROM ops.population p WHERE p.code = coalesce(NEW.population, 'live');

    /* the world names none → use the live world's default → still none → leave it to govresolve's fallback */
    IF ik IS NULL THEN
      SELECT p.installation_key INTO ik FROM ops.population p WHERE p.is_live;
    END IF;
    IF ik IS NULL THEN RETURN NEW; END IF;

    SELECT i.vertical_key INTO vk FROM installation i WHERE i.installation_key = ik;

    INSERT INTO entity_governance (entity_id, constitution_key, installation_key)
    VALUES (NEW.identity_id, coalesce(vk, 'base'), ik)
    ON CONFLICT (entity_id) DO NOTHING;      /* ⭐ a deliberate placement always wins */
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'could not stamp % with its world: %', NEW.identity_id, SQLERRM;
  END;
  RETURN NEW;
END
$fn$;

-- ── ② PLACING AN ENTITY IN A REGION, DELIBERATELY ───────────────────────────────────────────────────────────────
/**
 * ⭐⭐ THE ONE CALL THAT MAKES A CROSS-BORDER SIMULATION POSSIBLE: put this shop in UAE, that one in India, both
 * inside one sealed sandbox, and let them trade.
 *
 * ⚠️ IT REFUSES AN INSTALLATION THE UNIVERSE DOES NOT ALLOW. `lib/govresolve.bounded()` already silently falls
 * back when an installation names a region outside the constitution's `allowed.regions` — which means a shop
 * placed in an unpermitted region would look placed and behave as though it were not. Better to refuse the
 * placement than to accept it and quietly ignore it. [[feedback-silence-is-the-bug]]
 *
 * ⚠️ SECURITY DEFINER for the same reason as the trigger: entity_governance is FORCE RLS and this is called
 * from an operator context that is not the entity's own.
 */
CREATE OR REPLACE FUNCTION ops.f_place_entity(p_entity uuid, p_installation text)
RETURNS TABLE (entity_id uuid, installation_key text, constitution_key text, region text, why text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, ops, pg_temp AS $fn$
DECLARE inst record; allowed jsonb; pop text;
BEGIN
  SELECT i.installation_key, i.vertical_key, i.region, i.active INTO inst
    FROM installation i WHERE i.installation_key = p_installation;
  IF inst IS NULL THEN
    RAISE EXCEPTION 'no installation called %', p_installation USING ERRCODE = 'check_violation';
  END IF;
  IF NOT inst.active THEN
    RAISE EXCEPTION 'installation % is not active', p_installation USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(population, 'live') INTO pop FROM identities WHERE identity_id = p_entity;
  IF pop IS NULL THEN
    RAISE EXCEPTION 'no entity %', p_entity USING ERRCODE = 'check_violation';
  END IF;

  /* the universe's allowed regions — the tighten-only bound lib/govresolve applies at read time */
  SELECT c.governance -> 'allowed' -> 'regions' INTO allowed
    FROM constitution c WHERE c.constitution_key = 'base' AND c.active LIMIT 1;
  IF allowed IS NOT NULL AND inst.region IS NOT NULL
     AND NOT (allowed @> to_jsonb(inst.region)) THEN
    RAISE EXCEPTION 'region % is not in the universe''s allowed set', inst.region
      USING HINT = 'Widen constitution base → governance.allowed.regions first, or the placement would be '
                   'accepted and then silently ignored by govresolve.bounded().',
            ERRCODE = 'check_violation';
  END IF;

  INSERT INTO entity_governance (entity_id, constitution_key, installation_key)
  VALUES (p_entity, coalesce(inst.vertical_key, 'base'), p_installation)
  ON CONFLICT (entity_id) DO UPDATE
    SET constitution_key = EXCLUDED.constitution_key,
        installation_key = EXCLUDED.installation_key;

  RETURN QUERY SELECT p_entity, p_installation, coalesce(inst.vertical_key, 'base'), inst.region,
                      ('placed in ' || coalesce(inst.region, '?') || ', world ' || pop)::text;
END
$fn$;

GRANT EXECUTE ON FUNCTION ops.f_place_entity(uuid, text) TO cb_app;

-- ── ③ THE WORLD LIST SHOWS ITS REGIONS ──────────────────────────────────────────────────────────────────────────
-- A world is no longer one region, so a list that shows one region per world would be lying the moment this is used.
CREATE OR REPLACE FUNCTION ops.f_worlds()
RETURNS TABLE (
  population text, label text, is_live boolean, read_only boolean,
  installation_key text, installation_label text, region text, vertical_key text,
  currency text, timezone text, languages jsonb,
  regions_present text[],
  entities bigint, max_entities integer, chits bigint, max_chits integer,
  expires_at timestamptz, days_left integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, ops, pg_temp AS $fn$
  SELECT p.code::text, p.label::text, p.is_live, p.read_only,
         p.installation_key::text, i.label::text, i.region::text, i.vertical_key::text,
         i.currency::text, i.timezone::text, coalesce(i.languages, '[]'::jsonb),
         /* ⭐ every region actually present in this world, from the stamps — the honest answer, not the default */
         (SELECT coalesce(array_agg(DISTINCT i2.region ORDER BY i2.region), ARRAY[]::text[])
            FROM identities e2
            JOIN entity_governance g2 ON g2.entity_id = e2.identity_id
            JOIN installation i2 ON i2.installation_key = g2.installation_key
           WHERE coalesce(e2.population,'live') = p.code AND e2.identity_type = 'entity'),
         (SELECT count(*) FROM identities e
           WHERE coalesce(e.population,'live') = p.code AND e.identity_type = 'entity'
             AND coalesce(e.status,'active') <> 'erased'),
         p.max_entities,
         (SELECT count(*) FROM chit_header h
            JOIN identities e ON e.identity_id = h.sender_entity_id
           WHERE coalesce(e.population,'live') = p.code),
         p.max_chits,
         p.expires_at,
         CASE WHEN p.expires_at IS NULL THEN NULL
              ELSE greatest(0, extract(day FROM p.expires_at - now())::integer) END
    FROM ops.population p
    LEFT JOIN installation i ON i.installation_key = coalesce(p.installation_key, 'platform-0')
   ORDER BY p.is_live DESC, p.code;
$fn$;

GRANT EXECUTE ON FUNCTION ops.f_worlds() TO cb_app;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ⭐ READ IT — and how to place two regions in one sealed world.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
--   SELECT * FROM ops.f_place_entity('<an entity uuid>', 'platform-1');   -- put this one in Mexico
--
-- Both entities stay in the SAME population, so b247 lets them trade; they now resolve different currencies,
-- timezones, languages and tax regimes through lib/govresolve. That is a cross-border chit with no wire.
--
-- ⚠️ `regions_present` counts only entities that carry a STAMP. Everything born before b254 has none and shows
-- nowhere — that is the backfill b254 deliberately did not do.
--
SELECT population, label, is_live, installation_key, regions_present, entities, chits, days_left
  FROM ops.f_worlds();
