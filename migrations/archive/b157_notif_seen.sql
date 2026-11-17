-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b157 — a notification badge that can actually reach zero.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-08-15: *"notification — can you correct it and make it work? Where and what notification comes, does
-- it make sense?"*
--
-- ⚠️ IT COULD NEVER FALL. The feed has no read state of any kind — no read_at, no dismiss, nothing. The badge was
-- "how many recent events exist", capped by a LIMIT, so it read 30 forever whatever you did. A count that cannot
-- decrease is one people stop reading inside a week, and then the real event arrives wearing the same number as
-- the noise.
--
-- ── ⭐ A WATERMARK, NOT PER-ROW READ STATE ─────────────────────────────────────────────────────────────────────
-- The obvious build is a read flag per notification. It is also the wrong one here, for a reason worth writing
-- down: this feed is DERIVED. It is a query over state_log, not a table of notifications — there is no row to
-- mark. Materialising one per event per entity would create a second store that has to be kept in step with the
-- log forever, and the first time they disagreed the badge would be lying again.
--
-- One timestamp per entity answers the whole question: "how many events since you last looked". Opening the panel
-- moves the mark. That is the standard glance-at-a-feed model, and it needs no rows.
--
-- ⚠️ PER ENTITY, NOT PER ACTOR — deliberately, and it is a real limitation, stated rather than hidden. Two
-- co-assists share one watermark, so one of them opening the panel clears it for both. Making it per-identity is
-- a second column and a different question ("what have YOU seen"); it should be a decision, not a side effect of
-- whichever I happened to write first. Recorded in SPEC terms: fine for an owner-led business, wrong for a floor
-- with several people watching the same feed.
--
-- Safe to re-run. Nothing is deleted; a null watermark means "never looked", which is what every entity is today.

ALTER TABLE identities ADD COLUMN IF NOT EXISTS notif_seen_at timestamptz;

/* ⚠️ SECURITY DEFINER SO IT CAN ONLY EVER TOUCH THE CALLER'S OWN ROW. The entity comes from the session, never
   from a parameter — a function taking an entity_id would let any caller clear somebody else's badge, which is a
   small thing that makes a feed untrustworthy in exactly the way a badge must not be. */
CREATE OR REPLACE FUNCTION notif_mark_seen()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid;
  v_at timestamptz := now();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'notif_mark_seen: no entity context — call inside withEntity(me)';
  END IF;
  UPDATE identities SET notif_seen_at = v_at WHERE identity_id = v_me;
  RETURN v_at;
END $$;

GRANT EXECUTE ON FUNCTION notif_mark_seen() TO cb_app;

DO $$
BEGIN
  RAISE NOTICE 'b157: notif_seen_at added. Null = never looked, so every entity starts with the full count — which is honest.';
  RAISE NOTICE 'b157: the watermark is PER ENTITY. Two co-assists share it; per-actor is a separate decision.';
END $$;
