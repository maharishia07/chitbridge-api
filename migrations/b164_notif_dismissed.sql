-- b164 · notif_dismissed — let a person clear an Activity item without touching the record it came from.
--
-- ⚠️⚠️ THE ACTIVITY FEED IS NOT A TABLE OF NOTIFICATIONS. It is a VIEW over `state_log` — the event trail that
-- traceability, disputes and every "who did what, when" answer are built on. So "clear" cannot mean "delete the
-- row": deleting from state_log destroys the audit trail to tidy a panel, which is the single worst trade this
-- product could make. A cleared notification must remain a true event that this entity has chosen not to look at.
--
-- Hence a separate, additive table of DISMISSALS. The event survives untouched; the reader's view of it changes.
--
-- ⚠️ PER ENTITY, NOT PER EVENT. Two parties see the same event through their own copies, and one clearing it
-- must never clear it for the other — the same per-copy rule the rest of the rail follows. The primary key is
-- (entity_id, log_id) precisely so one entity's dismissal cannot collide with another's.
--
-- ⚠️ NO FOREIGN KEY TO state_log, DELIBERATELY. Retention will one day purge old log rows (see the retention
-- work), and a cascade would be fine — but a RESTRICT would make a dismissal block a purge, which is a tidying
-- record standing in the way of a governed deletion. An orphan dismissal is harmless: nothing reads it once the
-- event is gone.
--
-- WITH RLS, following the b49 pattern exactly: an entity sees and writes only its own dismissals.

BEGIN;

CREATE TABLE IF NOT EXISTS notif_dismissed (
  entity_id   uuid        NOT NULL,
  log_id      uuid        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_id, log_id)
);

-- The read path is "all dismissals for this entity", which the PK already leads on; no second index needed.

ALTER TABLE notif_dismissed ENABLE ROW LEVEL SECURITY;
ALTER TABLE notif_dismissed FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON notif_dismissed;
CREATE POLICY rls_entity ON notif_dismissed
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

GRANT SELECT, INSERT, DELETE ON notif_dismissed TO cb_app;

COMMIT;

-- VERIFY (read-only, as cb_app with app.current_entity set):
--   SELECT count(*) FROM notif_dismissed;                     -- 0 on a fresh install
--   -- and that isolation actually holds: set app.current_entity to another entity and confirm 0 rows of yours.
