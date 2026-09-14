-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b253 — SEPARATE QUEUES, ONE VIEW
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-09-14, on splitting the support desk per population: *"ok, think how this can be achieved, already
-- it is working but do not want to disturb, if we bring the result together."*
--
-- ⭐⭐⭐ THAT LAST CLAUSE IS THE WHOLE MIGRATION, AND IT IS THE OBJECTION I HAD NOT ANSWERED. b252 splits the
-- desk so a test finding cannot land beside a real shop's — and splitting the desk splits the REPORTING with it.
-- An operator who has to open two entities to learn how much support is outstanding will read one of them.
--
-- ⭐ SO THE SEPARATION IS IN THE DATA AND THE CROSSING IS IN THE VIEW, deliberately, once, operator-only. The
-- queues never mix; the numbers are added up.
--
-- ── ⚠️ WHY THIS NEEDS SECURITY DEFINER AT ALL ────────────────────────────────────────────────────────────────────
--
-- chit_status is FORCE ROW LEVEL SECURITY, which applies to the table OWNER too. cbincroot asking "how many open
-- tickets does the test desk have" is asking about rows in another tenant, and the honest answers are either a
-- function that may read across, or zero — and zero would look exactly like "the test desk is quiet".
-- [[feedback-silence-is-the-bug]] Same judgement, same shape and the same grants as ops.f_entity_counts (b241).
--
-- ⚠️⚠️ COUNTS, AND A DESK NAME. NEVER A SUBJECT, A SENDER OR A LINE. Athi's rule for the counting surface holds
-- here exactly: *"from any table we should be able to take the count, not the details — data cannot be read, but
-- the metrics should be."* A support ticket is somebody's complaint about their business; the operator needs to
-- know there are nine of them and that the oldest is eight days old, not what they say. [[reference-cb-core-principle]]
--
-- ⚠️ REQUIRES b249 (ops.population) and b252 (desk_entity_id).
-- Supabase → SQL Editor → paste → Run — ⭐ WITHOUT RLS (as `postgres`).
-- ⚠️ Structure and SECURITY DEFINER functions need OWNERSHIP. Being the owner is NOT the same as bypassing RLS:
--    a table marked FORCE ROW LEVEL SECURITY applies its policies to its owner too — which is exactly why the
--    function below must be SECURITY DEFINER and not merely owner-run.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='ops' AND table_name='population' AND column_name='desk_entity_id') THEN
    RAISE EXCEPTION 'b253 needs b252 — ops.population.desk_entity_id does not exist yet. Run b252 first.';
  END IF;
END $$;

/**
 * ⭐ ONE ROW PER POPULATION, whether or not it has a desk of its own.
 *
 * ⚠️ A POPULATION WITH NO DESK STILL APPEARS, with a null desk and null counts. Filtering it out would hide the
 * populations nobody has configured — which are precisely the ones whose findings are landing somewhere else,
 * and therefore the ones the operator most needs to see on this screen.
 *
 * ⚠️⚠️ THE TERMINAL STATES ARE NAMED, AND THEY WERE READ, NOT GUESSED. The first draft of this excluded
 * ('closed','cancelled','rejected') — two of which do not exist. lib/beckn-map.js has the canonical five
 * (pending · accepted · in_progress · completed · cancelled) and a read of the live table under a tenant
 * context confirms only 'pending' and 'in_progress' are in use. Writing a predicate against values I had not
 * read is the same mistake that cost a day on b237.
 *
 * ⭐ AND IT EXCLUDES THE FINISHED ONES rather than including the open ones, deliberately. If a sixth status
 * appears tomorrow it will be COUNTED AS OPEN — an over-count somebody notices — instead of silently dropping
 * out of the total, which nobody ever notices. Fail in the direction that gets seen.
 *
 * ⚠️ Deleted copies (Trash) are excluded: a ticket somebody binned is not outstanding work.
 */
CREATE OR REPLACE FUNCTION ops.f_support_load()
RETURNS TABLE (
  population       text,
  label            text,
  is_live          boolean,
  desk_entity_id   uuid,
  desk_name        text,
  entities         bigint,
  open_tickets     bigint,
  unassigned       bigint,
  oldest_days      integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT
    p.code::text,
    p.label::text,
    p.is_live,
    p.desk_entity_id,
    d.display_name::text,
    (SELECT count(*) FROM identities i
      WHERE coalesce(i.population, 'live') = p.code AND i.identity_type = 'entity'),
    /* ⚠️ the counts are NULL, not 0, when there is no desk — "no desk" and "a quiet desk" are different facts
       and a screen that shows 0 for both teaches the operator the wrong thing. */
    CASE WHEN p.desk_entity_id IS NULL THEN NULL ELSE (
      SELECT count(*) FROM chit_status cs
       WHERE cs.entity_id = p.desk_entity_id
         AND cs.direction = 'received'
         AND cs.deleted_at IS NULL
         AND coalesce(cs.current_status, 'pending') NOT IN ('completed', 'cancelled')) END,
    CASE WHEN p.desk_entity_id IS NULL THEN NULL ELSE (
      SELECT count(*) FROM chit_status cs
       WHERE cs.entity_id = p.desk_entity_id
         AND cs.direction = 'received'
         AND cs.deleted_at IS NULL
         AND cs.assigned_to_actor_id IS NULL
         AND coalesce(cs.current_status, 'pending') NOT IN ('completed', 'cancelled')) END,
    CASE WHEN p.desk_entity_id IS NULL THEN NULL ELSE (
      SELECT extract(day FROM now() - min(ch.created_at))::integer
        FROM chit_status cs JOIN chit_header ch ON ch.chit_id = cs.chit_id
       WHERE cs.entity_id = p.desk_entity_id
         AND cs.direction = 'received'
         AND cs.deleted_at IS NULL
         AND coalesce(cs.current_status, 'pending') NOT IN ('completed', 'cancelled')) END
  FROM ops.population p
  LEFT JOIN identities d ON d.identity_id = p.desk_entity_id
  ORDER BY p.is_live DESC, p.code;
$fn$;

COMMENT ON FUNCTION ops.f_support_load() IS
  'Support outstanding at each population''s desk. SECURITY DEFINER so it reads through FORCE RLS. Returns '
  'counts, a desk name and an age — never a subject, a sender, a line or any content of a ticket.';

-- ⚠️ EXECUTE ON ONE FUNCTION IS THE ENTIRE SURFACE. cb_app cannot reach ops.population or chit_status through
--    it, and cb_metrics stays walled out of the schema exactly as b241 left it.
GRANT USAGE   ON SCHEMA ops                    TO cb_app;
GRANT EXECUTE ON FUNCTION ops.f_support_load() TO cb_app;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ⭐ READ IT — the whole support position, across desks that never mix.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- A populated deployment reads something like:
--
--   live     Live      t   cbincroot   24   3   1   2
--   sandbox  Sandbox   f   (null)       0   —   —   —      ← no desk: findings fall back to the live one
--   test     Test      f   CBINCTST  2485   7   7   0
--
-- ⚠️ A DASH IS NOT A ZERO. The sandbox row above says nobody has named a desk, not that nobody has asked for
-- help — and those two need different actions from the person reading the screen.
--
SELECT * FROM ops.f_support_load();
