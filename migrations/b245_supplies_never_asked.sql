-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b245 — "goods" HAS BEEN MEANING "nobody asked". Stop it saying that.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-09-14, settling the Platform filters: *"run b245"* — after I showed him that the Sells filter, the
-- one he would use most, could not be honest.
--
-- ── ⚠️⚠️ WHERE THE 2,498 CAME FROM ─────────────────────────────────────────────────────────────────────────────
--
--   b178:  ALTER TABLE identities ADD COLUMN supplies varchar(16) NOT NULL DEFAULT 'goods';
--
-- Every entity created from then until b238 was stamped `goods` on the way in. Nobody was asked — there was no
-- screen to ask with until Settings › Your business shipped on 2026-09-14. So the column has been recording a
-- DEFAULT and reporting it as an ANSWER, and the Platform screen showed 2,498 of 2,509 entities selling goods.
--
-- ⭐ b238 ALREADY FIXED THE FUTURE: `ALTER COLUMN supplies SET DEFAULT 'unknown'`. New registrations are honest.
-- This file fixes the past, which is the half that shows up on every screen.
--
-- ── ⚠️ AND IT CANNOT BE SURGICAL, SO IT IS HONEST INSTEAD ───────────────────────────────────────────────────────
--
-- There is no column recording WHO answered. `goods` written by b178 and `goods` chosen by a shopkeeper are the
-- same four bytes. So this cannot spare a genuine answer, and the question is whether any exist.
--
--   Chola Auto Care   'both'      — chosen on the settings screen, 2026-09-14
--   cbincroot         'services'  — set deliberately by b240
--   the 8 standards   'none'      — set deliberately by b237/b238
--   everything else   'goods'     — the b178 default, on 2,498 rows
--
-- The settings screen is one day old and exactly one shop has used it, and that shop did not choose goods. So
-- the blast radius is zero today and grows by one for every shop that answers "goods" before this runs.
-- ⚠️ RUN IT NOW RATHER THAN LATER — this is the cheapest this migration will ever be.
--
-- ⭐ AND 'unknown' IS NOT A GAP, IT IS A WORKLIST. It is the honest answer to "what does this shop sell?" when
-- nobody has asked, and it turns a filter that lied into a queue: 2,498 shops to ask.
--
-- Supabase → SQL Editor → paste → Run. Safe to re-run (the second run changes nothing).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ⭐ say what it was, so the change can be checked afterwards rather than believed
SELECT supplies, count(*)::int AS rows_before
  FROM identities
 WHERE identity_type = 'entity' AND coalesce(status,'active') <> 'erased'
 GROUP BY 1 ORDER BY 2 DESC;

UPDATE identities
   SET supplies = 'unknown'
 WHERE identity_type = 'entity'
   AND coalesce(status,'active') <> 'erased'
   AND supplies = 'goods';

-- ── the proof ──────────────────────────────────────────────────────────────────────────────────────────────────
-- ⚠️ EXPECT ZERO ROWS OF 'goods'. Not "a few" — every single one of them was the default, and if any survive,
--    the predicate above missed a case and the filter is still lying about that case.
SELECT supplies, count(*)::int AS rows_after
  FROM identities
 WHERE identity_type = 'entity' AND coalesce(status,'active') <> 'erased'
 GROUP BY 1 ORDER BY 2 DESC;

-- and the three that were deliberately set are untouched
SELECT coalesce(user_id, display_name) AS who, entity_kind, supplies
  FROM identities
 WHERE supplies <> 'unknown' AND identity_type = 'entity'
   AND coalesce(status,'active') <> 'erased'
 ORDER BY supplies, who
 LIMIT 20;

COMMIT;
