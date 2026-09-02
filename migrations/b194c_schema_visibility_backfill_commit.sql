-- b194c · WRITES AND COMMITS. Align entity_schemas.visibility with the publish act the owner already made.
--
-- ⚠️⚠️ WHY THERE IS A THIRD FILE. b194b ends in `ROLLBACK;` by design — the standing rule for anything that
-- exposes data is that the apply file is safe until somebody deliberately edits one line. Athi ran it twice and
-- got the same preview both times, which is exactly what it was built to do and is NOT what he wanted the second
-- time. The output is identical either way (the SELECT runs before either verb), so nothing on screen said so.
--
-- ⭐ THE SHAPE HAS NOW BEEN APPROVED TWICE — the b194 dry run and the b194b preview both reported 106 schemas ·
-- 11 shops gaining products · 27 products, with the same eleven named. So this file does the write and commits,
-- and the "read it, then flip a verb" step is spent rather than repeated a third time.
--
-- WHAT IT DOES: for every entity whose OWN publish flag already says `catalogue_visibility = 'public'`, make its
-- default schema public too. Those are two columns holding one fact; the storefront reads the second and the app
-- only ever set the first. 95 of the 106 own no products, so for them this exposes nothing today and only stops
-- the same bug firing the day they add one. 11 gain visible products — alpha timers (16), Live Run Shop (2), and
-- nine test shops with one each.
--
-- ⚠️ WITHOUT RLS. `entity_schemas` has no row-level security at all — no ENABLE, no policy — so the write cannot
-- be filtered. Run it as the same role that ran b193 (the counts came back real, which proves it).
--
-- Supabase SQL editor. No psql meta-commands. ONE result set, and it reads the state AFTER the commit.

BEGIN;

/* ⭐ THE GUARD ABORTS IF THE DATA MOVED SINCE THE APPROVAL — and its number goes into the error text, because a
   guard whose input cannot be seen is not a guard. Approved shape: 106. The band is wide because ordinary use
   moves this a little; a big move means something happened that nobody reviewed. */
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM identities i
    JOIN entity_schemas es
      ON es.entity_id = i.identity_id AND es.status = 'active' AND es.is_default = true
   WHERE i.identity_type = 'entity'
     AND i.catalogue_visibility = 'public'
     AND es.visibility IS DISTINCT FROM 'public';
  IF n < 60 OR n > 160 THEN
    RAISE EXCEPTION 'b194c aborted — % schemas match, the approved shape was 106. Re-run b193 and look again.', n;
  END IF;
END $$;

UPDATE entity_schemas es
   SET visibility = 'public'
  FROM identities i
 WHERE es.entity_id = i.identity_id
   AND es.status = 'active'
   AND es.is_default = true
   AND i.identity_type = 'entity'
   AND i.catalogue_visibility = 'public'
   AND es.visibility IS DISTINCT FROM 'public';

COMMIT;

-- ── VERIFICATION, READ AFTER THE COMMIT ──────────────────────────────────────────────────────────────────────
-- ⭐ This runs OUTSIDE the transaction, so it reports what is actually stored rather than what the transaction
-- was about to store. That distinction is the whole reason the last two runs looked successful and were not.
SELECT 1 AS ord,
       'STILL MISALIGNED (want 0)'                                   AS check,
       count(*)::text                                                AS value,
       ''                                                            AS shop
  FROM identities i
  JOIN entity_schemas es
    ON es.entity_id = i.identity_id AND es.status = 'active' AND es.is_default = true
 WHERE i.identity_type = 'entity'
   AND i.catalogue_visibility = 'public'
   AND es.visibility IS DISTINCT FROM 'public'
UNION ALL
SELECT 2, 'PUBLIC SCHEMAS NOW', count(*)::text, ''
  FROM identities i
  JOIN entity_schemas es
    ON es.entity_id = i.identity_id AND es.status = 'active' AND es.is_default = true
 WHERE i.identity_type = 'entity' AND i.catalogue_visibility = 'public' AND es.visibility = 'public'
UNION ALL
-- The one shop this whole exercise came from, named so the answer is checkable at a glance.
SELECT 3, 'alpha timers schema',
       COALESCE((SELECT es.visibility FROM identities i
                   JOIN entity_schemas es ON es.entity_id = i.identity_id
                  WHERE i.bridge_id = 'CBG4U2T9DE' AND es.status = 'active' AND es.is_default = true
                  LIMIT 1), '(no default schema)'),
       'CBG4U2T9DE'
UNION ALL
SELECT 4, 'alpha timers own items',
       (SELECT count(*)::text FROM identities i
          JOIN catalogue_items ci ON ci.entity_id = i.identity_id AND ci.is_active = true
         WHERE i.bridge_id = 'CBG4U2T9DE'),
       'CBG4U2T9DE'
 ORDER BY 1;

-- Expect: row 1 = 0 · row 2 ≈ 159 · row 3 = public · row 4 = 16.
-- If row 1 is still 106, the transaction did not commit — say so and do not run anything else.
