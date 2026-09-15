-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b254 — A WORLD: ONE POPULATION, ONE INSTALLATION, ONE SET OF LIMITS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-09-15:
--
--   *"I create one sandbox for India region and another one for UAE. The entity created under India regions
--    should follow India governance layer and its rules and regulation, UAE to follow UAE region and its
--    regulation, so we can have multiple things run in parallel in isolation mode… we can simulate the global
--    using the same engine but for different region, vertical and so on."*
--
--   *"we should be able to create multiple IN layer, multiple UAE etc… we can set the boundary, vertical and so
--    on. That is why we called it an installation. This can be a completely different new machinery or a part of
--    an existing engine — THE BEHAVIOUR SHOULD BE THE SAME."*
--
-- ── ⭐⭐⭐ ALMOST NONE OF THIS IS NEW, AND THAT IS THE POINT ───────────────────────────────────────────────────────
--
-- b74's own header, written 2026-08: *"makes 'spin platform-N in <cloud> for <vertical> in <zone>' ONE ROW."*
-- The `installation` table already carries region · zone · currency · timezone · languages · vertical, and
-- lib/govresolve.js already cascades universe → constitution → installation → entity with `bounded()` enforcing
-- TIGHTEN-ONLY. A Mexican service-desk installation has sat there since August as proof.
--
-- ⚠️⚠️ AND `entity_governance` HAS ZERO ROWS. Nothing has ever stamped an entity, so every resolve falls back to
-- base + platform-0 and the whole cascade has only ever returned its default. The machinery was built, seeded
-- with a second region, and connected to nothing. This migration connects it.
--
-- ── ⭐ WHAT A WORLD IS ──────────────────────────────────────────────────────────────────────────────────────────
--
--     population    the BOUNDARY   — who may transact with whom (b247 refuses a chit across it, at the database)
--     installation  the CHARACTER  — region, currency, timezone, languages, vertical
--
-- One of each, paired. Two sandboxes for the same region are two worlds, not one: "UAE trial A" and "UAE trial B"
-- share a character and must never share books. So the pairing is population → installation, many-to-one in the
-- schema and one-to-one in practice.
--
-- ⚠️⚠️ THE RULE ATHI STATED, WHICH EVERYTHING BELOW OBEYS: *"this can be a completely different new machinery or
-- a part of an existing engine — the behaviour should be the same."* So NOTHING may ask "am I a sandbox?" and
-- branch. There is no sandbox mode. A world differs from the live one only in CONFIGURATION VALUES the cascade
-- already reads, plus a boundary the database already enforces. That is what makes a world liftable: the day one
-- of these deserves its own machine, it moves without a line of behaviour changing.
-- [[feedback-stay-in-the-construct]]
--
-- ⚠️ REQUIRES b249 (ops.population) and b74 (installation, entity_governance).
-- Supabase → SQL Editor → paste → Run — ⭐ WITHOUT RLS (as `postgres`).
-- ⚠️ Structure needs OWNERSHIP. Being the owner is NOT the same as bypassing RLS — a table marked FORCE ROW
--    LEVEL SECURITY applies its policies to its owner too, which is why the stamp trigger below is a
--    SECURITY DEFINER function and not merely owner-run.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='ops' AND table_name='population') THEN
    RAISE EXCEPTION 'b254 needs b249 — ops.population does not exist. Run b249 first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='installation') THEN
    RAISE EXCEPTION 'b254 needs b74 — the installation table does not exist. Run b74 first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='entity_governance') THEN
    RAISE EXCEPTION 'b254 needs b73 — entity_governance does not exist. Run b73 first.';
  END IF;
END $$;

-- ── ① A POPULATION NAMES ITS WORLD ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE ops.population ADD COLUMN IF NOT EXISTS installation_key text;

COMMENT ON COLUMN ops.population.installation_key IS
  'The installation whose region, currency, timezone, languages and vertical this population runs under. Null '
  'means platform-0, the live installation — so nothing changes for a population that names none.';

/**
 * ⚠️ NOT A FOREIGN KEY, DELIBERATELY. `installation` is shared config with no RLS and `ops.population` is
 * operator data; an FK between them would be fine today and would become the reason a world cannot be lifted out
 * to its own deployment tomorrow. The trigger below gives the same protection and says something useful when it
 * refuses. ⚠️ It also checks `active`, which an FK could not.
 */
CREATE OR REPLACE FUNCTION ops_population_installation_exists() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE ok boolean;
BEGIN
  IF NEW.installation_key IS NULL THEN RETURN NEW; END IF;
  SELECT active INTO ok FROM installation WHERE installation_key = NEW.installation_key;
  IF ok IS NULL THEN
    RAISE EXCEPTION 'no installation called %', NEW.installation_key
      USING HINT = 'Create the installation first — it carries the region, currency and vertical this world runs under.',
            ERRCODE = 'check_violation';
  END IF;
  IF NOT ok THEN
    RAISE EXCEPTION 'installation % is not active', NEW.installation_key
      USING HINT = 'A retired installation cannot take new worlds. Reactivate it, or name another.',
            ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS ops_population_installation ON ops.population;
CREATE TRIGGER ops_population_installation
  BEFORE INSERT OR UPDATE OF installation_key ON ops.population
  FOR EACH ROW EXECUTE FUNCTION ops_population_installation_exists();

-- ── ② LIMITS AND A CLOCK ────────────────────────────────────────────────────────────────────────────────────────
--
-- Athi: *"we have not set the limit for each sandbox, otherwise each one will keep growing, so how do we set the
-- limits and validity?"*
--
-- ⭐ ON THE POPULATION, because the population is the thing that grows. An installation is a character and costs
-- nothing; a world full of entities and chits is what fills a database.
--
-- ⚠️ NULL MEANS NO LIMIT, and `live` must always read null. A quota on the real world is a way to stop real trade
-- at three in the morning because a number somebody typed in August turned out to be too small.
ALTER TABLE ops.population ADD COLUMN IF NOT EXISTS max_entities  integer;
ALTER TABLE ops.population ADD COLUMN IF NOT EXISTS max_chits     integer;
ALTER TABLE ops.population ADD COLUMN IF NOT EXISTS expires_at    timestamptz;
ALTER TABLE ops.population ADD COLUMN IF NOT EXISTS read_only     boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN ops.population.expires_at IS
  'When this world stops accepting new work. ⚠️ Expiry makes it READ-ONLY, it does not delete it — a sandbox '
  'that vanishes at midnight loses somebody''s demo preparation the morning they need it. Destroying is a '
  'separate, deliberate act.';

/**
 * ⚠️⚠️ THE LIVE WORLD CAN NEVER BE LIMITED, EXPIRED OR FROZEN. Everything above is for sandboxes, and the one
 * way this feature could do real harm is by being pointed at the real books — by a typo, a copied row, or a
 * screen that forgot to exclude it. The database refuses, so no screen has to remember.
 */
ALTER TABLE ops.population DROP CONSTRAINT IF EXISTS ops_population_live_is_unbounded;
ALTER TABLE ops.population ADD CONSTRAINT ops_population_live_is_unbounded CHECK (
  NOT is_live OR (max_entities IS NULL AND max_chits IS NULL AND expires_at IS NULL AND read_only = false)
);

-- ── ③ THE STAMP — what actually switches the cascade on ─────────────────────────────────────────────────────────
/**
 * ⭐⭐⭐ AN ENTITY IS STAMPED WITH ITS WORLD AT BIRTH, BY THE DATABASE.
 *
 * `entity_governance` is the row lib/govresolve reads to know which constitution and which installation apply.
 * It has never had a single row, so every entity on the platform resolves to base + platform-0 by fallback.
 *
 * ⚠️ A TRIGGER, NOT A ROUTE. The one thing this session has proved repeatedly is that a value written by exactly
 * one route is a value that is missing the day a second route creates the same thing — b248 already learnt this
 * for `population` itself, and there are five INSERT sites into `identities` that would each have to remember.
 * The stamp follows the population, the population is already inherited, so the stamp is inherited too.
 *
 * ⚠️ SECURITY DEFINER: entity_governance is per-entity and RLS-forced (b73), and this fires inside whatever
 * transaction created the identity — which may hold a different tenant's context, or none.
 *
 * ⚠️ AND IT NEVER FAILS A REGISTRATION. A missing stamp costs a fallback to base + platform-0, which is exactly
 * today's behaviour; a raised exception here would cost a person their sign-up. [[feedback-silence-is-the-bug]]
 * — but it is not silent either: ops.f_unstamped() below counts what it missed.
 */
CREATE OR REPLACE FUNCTION identities_stamp_world() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, ops, pg_temp AS $fn$
DECLARE ik text; vk text;
BEGIN
  IF NEW.identity_type IS DISTINCT FROM 'entity' THEN RETURN NEW; END IF;
  BEGIN
    SELECT p.installation_key INTO ik
      FROM ops.population p WHERE p.code = coalesce(NEW.population, 'live');
    IF ik IS NULL THEN RETURN NEW; END IF;            /* no world named → the fallback, exactly as before */

    SELECT i.vertical_key INTO vk FROM installation i WHERE i.installation_key = ik;

    INSERT INTO entity_governance (entity_id, constitution_key, installation_key)
    VALUES (NEW.identity_id, coalesce(vk, 'base'), ik)
    ON CONFLICT (entity_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    /* a stamp is a convenience; a lost registration is not. The count below makes the gap visible. */
    RAISE WARNING 'could not stamp % with its world: %', NEW.identity_id, SQLERRM;
  END;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS identities_world_stamp ON identities;
CREATE TRIGGER identities_world_stamp
  AFTER INSERT ON identities
  FOR EACH ROW EXECUTE FUNCTION identities_stamp_world();

/** ⭐ how many entities belong to a world that names an installation and carry no stamp — the silent-failure count */
CREATE OR REPLACE FUNCTION ops.f_unstamped()
RETURNS TABLE (population text, installation_key text, entities bigint, unstamped bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, ops, pg_temp AS $fn$
  SELECT p.code::text, p.installation_key::text,
         count(i.identity_id),
         count(i.identity_id) FILTER (WHERE g.entity_id IS NULL)
    FROM ops.population p
    JOIN identities i ON coalesce(i.population, 'live') = p.code AND i.identity_type = 'entity'
    LEFT JOIN entity_governance g ON g.entity_id = i.identity_id
   WHERE p.installation_key IS NOT NULL
   GROUP BY 1, 2 ORDER BY 1;
$fn$;

GRANT USAGE   ON SCHEMA ops                 TO cb_app;
GRANT EXECUTE ON FUNCTION ops.f_unstamped() TO cb_app;

-- ── ④ THE LIST BEHIND THE MENU ──────────────────────────────────────────────────────────────────────────────────
--
-- Athi: *"that list should be there with the platform of platform and we should be having a menu to drive that."*
-- One row per world: what it is, what it costs, how long it has left.
CREATE OR REPLACE FUNCTION ops.f_worlds()
RETURNS TABLE (
  population text, label text, is_live boolean, read_only boolean,
  installation_key text, installation_label text, region text, vertical_key text,
  currency text, timezone text, languages jsonb,
  entities bigint, max_entities integer, chits bigint, max_chits integer,
  expires_at timestamptz, days_left integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, ops, pg_temp AS $fn$
  SELECT p.code::text, p.label::text, p.is_live, p.read_only,
         p.installation_key::text, i.label::text, i.region::text, i.vertical_key::text,
         i.currency::text, i.timezone::text, coalesce(i.languages, '[]'::jsonb),
         (SELECT count(*) FROM identities e
           WHERE coalesce(e.population,'live') = p.code AND e.identity_type = 'entity'
             AND coalesce(e.status,'active') <> 'erased'),
         p.max_entities,
         /* ⚠️ chits are counted through the SENDER's population — chit_header has no population of its own, and
            b247 guarantees both parties share one, so the sender's is the world's. */
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

COMMENT ON FUNCTION ops.f_worlds() IS
  'One row per world — the boundary (population) joined to its character (installation), with usage against its '
  'limits and the days it has left. SECURITY DEFINER so it can count across FORCE-RLS tables. Counts only; never '
  'a name, a subject or a value from inside any world.';

GRANT EXECUTE ON FUNCTION ops.f_worlds() TO cb_app;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ⭐ READ IT
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ `unstamped` counts entities that were born before this trigger existed. They are not broken — they resolve
-- to base + platform-0 exactly as they did yesterday — but they are not yet IN their world. Backfilling them is
-- a separate, deliberate act and NOT part of this migration: stamping 2,485 existing test entities into a world
-- would change what govresolve answers for all of them at once, which is not a thing to do inside a migration
-- nobody is watching.
--
SELECT * FROM ops.f_worlds();
SELECT * FROM ops.f_unstamped();
