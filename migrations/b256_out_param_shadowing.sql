-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b256 — AN OUT PARAMETER THAT SHARES A COLUMN'S NAME WINS, SILENTLY
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Two bugs from b255, one cause, and the second one is the frightening kind.
--
-- ── ① ops.f_place_entity — LOUD ─────────────────────────────────────────────────────────────────────────────────
--
--     42702: column reference "entity_id" is ambiguous
--
-- `RETURNS TABLE (entity_id uuid, …)` declares an OUT parameter called `entity_id`, and the body then writes
-- `ON CONFLICT (entity_id)`. Postgres cannot tell the parameter from the column and refuses. Annoying, obvious,
-- fixed in a minute.
--
-- ── ② ops.f_worlds — THE OUT PARAMETER, AND A CORRECTION TO THIS VERY FILE ──────────────────────────────────────
--
-- ⚠️⚠️ WHAT THIS SECTION FIRST CLAIMED WAS WRONG, AND THE WAY IT WAS WRONG IS WORTH MORE THAN THE FIX.
--
-- I wrote that f_worlds "lied" about present_regions, on the evidence that entity_governance held 0 rows while
-- the function reported ["IN"]. entity_governance is FORCE ROW LEVEL SECURITY. My count ran as cb_app with no
-- app.current_entity, so it answered 0 no matter what was in the table. f_worlds is SECURITY DEFINER and was
-- telling the truth the whole time. Read back inside each entity's own context, every stamp is exactly where it
-- was placed.
--
-- ⭐ THE RENAME BELOW IS STILL RIGHT — an OUT parameter named after a column is a trap whether or not it fired
-- here, and ① was a genuine 42702. But the diagnosis in this file was reached with a blind instrument, and
-- tests/rls-context.test.cjs now exists because of it.
--
-- ⭐ THE RULE, AND IT IS WORTH STATING ONCE: in a `LANGUAGE sql` function, an OUT parameter name is in scope
-- throughout the body and beats a column of the same name. Qualifying (`i2.region`) does NOT reliably save you.
-- So OUT parameters must not be named after columns the body touches — and since a body grows, the safe habit is
-- that they are never named after columns at all.
--
-- ⚠️ REQUIRES b255. Idempotent.
-- Supabase → SQL Editor → paste → Run — ⭐ WITHOUT RLS (as `postgres`).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── ① PLACING AN ENTITY ─────────────────────────────────────────────────────────────────────────────────────────
-- ⚠️ DROP FIRST: renaming an OUT parameter is a new row type (42P13). And the GRANT goes with it — re-issued below.
DROP FUNCTION IF EXISTS ops.f_place_entity(uuid, text);
CREATE OR REPLACE FUNCTION ops.f_place_entity(p_entity uuid, p_installation text)
RETURNS TABLE (placed_entity uuid, placed_installation text, placed_constitution text,
               placed_region text, placed_world text, note text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, ops, pg_temp AS $fn$
DECLARE v_vertical text; v_region text; v_active boolean; v_allowed jsonb; v_world text;
BEGIN
  /* ⚠️ scalars, not a record: a record named `inst` was fine, but every field read back through an OUT parameter
     of the same name is how ② happened. Local names here share nothing with the output. */
  SELECT i.vertical_key, i.region, i.active INTO v_vertical, v_region, v_active
    FROM installation i WHERE i.installation_key = p_installation;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no installation called %', p_installation USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_active THEN
    RAISE EXCEPTION 'installation % is not active', p_installation USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(e.population, 'live') INTO v_world FROM identities e WHERE e.identity_id = p_entity;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no entity %', p_entity USING ERRCODE = 'check_violation';
  END IF;

  /* the universe's allowed regions — the tighten-only bound lib/govresolve applies at read time. Placing an
     entity in a region the universe refuses would look placed and behave as though it were not. */
  SELECT c.governance -> 'allowed' -> 'regions' INTO v_allowed
    FROM constitution c WHERE c.constitution_key = 'base' AND c.active LIMIT 1;
  IF v_allowed IS NOT NULL AND v_region IS NOT NULL AND NOT (v_allowed @> to_jsonb(v_region)) THEN
    RAISE EXCEPTION 'region % is not in the universe''s allowed set', v_region
      USING HINT = 'Widen constitution base → governance.allowed.regions first, or the placement would be '
                   'accepted and then silently ignored by govresolve.bounded().',
            ERRCODE = 'check_violation';
  END IF;

  INSERT INTO entity_governance AS eg (entity_id, constitution_key, installation_key)
  VALUES (p_entity, coalesce(v_vertical, 'base'), p_installation)
  ON CONFLICT (entity_id) DO UPDATE
    SET constitution_key = EXCLUDED.constitution_key,
        installation_key = EXCLUDED.installation_key;

  RETURN QUERY SELECT p_entity, p_installation, coalesce(v_vertical, 'base'), v_region, v_world,
                      ('placed in ' || coalesce(v_region, '?') || ', world ' || v_world)::text;
END
$fn$;

GRANT EXECUTE ON FUNCTION ops.f_place_entity(uuid, text) TO cb_app;

-- ── ② THE WORLD LIST ────────────────────────────────────────────────────────────────────────────────────────────
-- Every OUT parameter renamed away from the columns the body reads. `home_*` is the world's DEFAULT; `present_*`
-- is what is actually in it — which is the distinction the lie was hiding.
DROP FUNCTION IF EXISTS ops.f_worlds();
CREATE OR REPLACE FUNCTION ops.f_worlds()
RETURNS TABLE (
  world text, world_label text, live boolean, frozen boolean,
  home_installation text, home_installation_label text, home_region text, home_vertical text,
  home_currency text, home_timezone text, home_languages jsonb,
  present_regions text[],
  entity_count bigint, entity_limit integer, chit_count bigint, chit_limit integer,
  expiry timestamptz, days_left integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, ops, pg_temp AS $fn$
  SELECT p.code::text, p.label::text, p.is_live, p.read_only,
         p.installation_key::text, i.label::text, i.region::text, i.vertical_key::text,
         i.currency::text, i.timezone::text, coalesce(i.languages, '[]'::jsonb),
         /* ⭐ the regions actually PRESENT, from the stamps. Empty is the honest answer for a world nobody has
            placed anything in, and it must not borrow the world's default to fill the gap. */
         (SELECT coalesce(array_agg(DISTINCT inst2.region ORDER BY inst2.region), ARRAY[]::text[])
            FROM identities ent2
            JOIN entity_governance eg2 ON eg2.entity_id = ent2.identity_id
            JOIN installation inst2 ON inst2.installation_key = eg2.installation_key
           WHERE coalesce(ent2.population, 'live') = p.code AND ent2.identity_type = 'entity'),
         (SELECT count(*) FROM identities ent
           WHERE coalesce(ent.population, 'live') = p.code AND ent.identity_type = 'entity'
             AND coalesce(ent.status, 'active') <> 'erased'),
         p.max_entities,
         (SELECT count(*) FROM chit_header h
            JOIN identities snd ON snd.identity_id = h.sender_entity_id
           WHERE coalesce(snd.population, 'live') = p.code),
         p.max_chits,
         p.expires_at,
         CASE WHEN p.expires_at IS NULL THEN NULL
              ELSE greatest(0, extract(day FROM p.expires_at - now())::integer) END
    FROM ops.population p
    LEFT JOIN installation i ON i.installation_key = coalesce(p.installation_key, 'platform-0')
   ORDER BY p.is_live DESC, p.code;
$fn$;

COMMENT ON FUNCTION ops.f_worlds() IS
  'One row per world. home_* is the world''s DEFAULT character; present_regions is what is actually placed in '
  'it. ⚠️ Every OUT parameter is deliberately named away from the columns the body reads — b256.';

GRANT EXECUTE ON FUNCTION ops.f_worlds() TO cb_app;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ⭐ READ IT — present_regions must be EMPTY while nothing is placed, and the placement must now succeed.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
SELECT world, home_region, present_regions, entity_count FROM ops.f_worlds();
