-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b243 — WHICH NETWORK IS THIS SHOP IN? A column, not a walk.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-09-14: *"our network architecture keeps the shop under ltree, but we may have to keep one more
-- field to hold which one is the root entity, so it is easier to pick it up without travelling the path."*
--
-- Right, and worth doing. ⭐⭐ BUT NOT AS A COLUMN SOMEBODY FILLS IN.
--
-- ── ⚠️⚠️ A HAND-MAINTAINED ROOT IS A SECOND SOURCE OF TRUTH ────────────────────────────────────────────────────
--
-- `path` already says which network a shop is in — it is the first label of the ltree. A plain `root_id` column
-- beside it would say the same thing a second time, and the two would agree only for as long as everybody who
-- ever moves a node remembers to update both. The first re-parent that forgets leaves a shop filed under a
-- network it is no longer in, and NOTHING would report it: the tree would be right, the column would be wrong,
-- and every screen reads the column. That is the worst shape a bug can have. [[feedback-silence-is-the-bug]]
--
-- ⭐ SO IT IS GENERATED. Postgres computes it from `path` on every insert and every update, there is no code
-- path that can set it, and no re-parent can leave it stale — because moving a node IS an update to `path`.
-- Athi gets the field he asked for and it cannot drift, which a trigger could not promise as cheaply.
--
--     ALTER TABLE cb_entity ADD COLUMN root_path ltree GENERATED ALWAYS AS (subpath(path, 0, 1)) STORED
--
-- ⚠️ subpath() must be IMMUTABLE for a generated column, and the ltree extension marks it so. If this errors
--    with "generation expression is not immutable", the extension is older than expected — say so rather than
--    reaching for a trigger, which would reintroduce exactly the drift this avoids.
--
-- ── ⭐ A ROOT IS ITS OWN ROOT ───────────────────────────────────────────────────────────────────────────────────
--
-- subpath(path, 0, 1) on a one-label path returns that path. So a root's root_path is itself, and "every shop in
-- this network, including its head" is one equality — no CASE, no union, no special case at the top of the tree.
--
-- ── ⚠️ WHAT THIS DOES AND DOES NOT BUY, HONESTLY ────────────────────────────────────────────────────────────────
--
-- It does NOT make the Platform screen's join faster. That join is `root.path = subpath(c.path,0,1)`, and the
-- indexed side is already `root.path` — the function runs on the other operand. Claiming a speed-up there would
-- be marketing.
--
-- What it does buy is the query shape Athi actually described:
--
--     GROUP BY root_path                              -- how big is each network?          (was: a function call)
--     WHERE  root_path = 'alpha_timers'               -- every shop in one network         (was: path <@ …)
--     ORDER BY root_path, path                        -- the platform listed BY network    (was: not expressible)
--
-- The last one is the point. "Showcase the shops under the network name" is an ORDER BY on a column, and you
-- cannot ORDER BY something you have to compute per row without the planner sorting on an expression.
--
-- Supabase → SQL Editor → paste → Run. Idempotent; changes no behaviour by itself.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ⚠️ NOT `IF NOT EXISTS` on its own: if the column is somehow already there as a PLAIN column, adding it again
--    is a no-op and we would silently keep the drifting version. Check what is actually there first.
DO $$
DECLARE gen char;
BEGIN
  SELECT attgenerated INTO gen
    FROM pg_attribute
   WHERE attrelid = 'cb_entity'::regclass AND attname = 'root_path' AND NOT attisdropped;

  IF gen IS NULL THEN
    ALTER TABLE cb_entity
      ADD COLUMN root_path ltree GENERATED ALWAYS AS (subpath(path, 0, 1)) STORED;
    RAISE NOTICE 'b243: cb_entity.root_path added (generated, stored).';
  ELSIF gen = 's' THEN
    RAISE NOTICE 'b243: cb_entity.root_path already exists and is generated — nothing to do.';
  ELSE
    -- ⚠️ a plain column with this name is the exact hazard this migration exists to prevent. Stop; do not
    --    quietly leave a hand-maintained root in place beside a generated one.
    RAISE EXCEPTION 'cb_entity.root_path exists but is NOT generated. Drop it deliberately, then re-run b243.';
  END IF;
END $$;

-- ⭐ btree, not GiST: this column is only ever compared with '=' and grouped by. The GiST index on `path` stays
--    where it is and keeps serving the ancestor operators (<@, @>).
CREATE INDEX IF NOT EXISTS cb_entity_root_path_idx ON cb_entity (root_path);

COMMENT ON COLUMN cb_entity.root_path IS
  'The network this entity belongs to: the first label of `path`, generated. A root''s root_path is itself. '
  'Never written by application code — moving a node updates `path`, and this follows automatically.';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ⭐ READ IT — every network, its head, and how many shops are in it.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
SELECT e.root_path::text                          AS network,
       max(head.name)                             AS owner,
       count(*)                                   AS shops,
       count(*) FILTER (WHERE nlevel(e.path) > 1) AS branches
  FROM cb_entity e
  LEFT JOIN cb_entity head ON head.path = e.root_path
 WHERE coalesce(e.status, 'active') <> 'erased'
 GROUP BY e.root_path
HAVING count(*) > 1
 ORDER BY shops DESC, network;

-- ⚠️ THE PROOF THAT IT CANNOT DRIFT: this must return zero rows, now and after any re-parent.
SELECT count(*) AS mismatched_rows
  FROM cb_entity WHERE root_path IS DISTINCT FROM subpath(path, 0, 1);
