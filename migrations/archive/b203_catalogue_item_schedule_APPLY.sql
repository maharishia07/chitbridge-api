-- b203 APPLY — parked product changes with an effective time (BACKLOG "publish on a date"). WITH RLS.
--
-- The trader changes a price on Friday for Monday. The change is PARKED here as a merge-patch and APPLIED by the API
-- the first time anyone reads the catalogue after the moment (lib/schedule.js applyDue, called before the owner's list,
-- the storefront and the send path). No worker, no clock, no second copy of the product.
--
-- ⚠️ IDEMPOTENT (IF NOT EXISTS everywhere). ⚠️ IT COMMITS. ⚠️ Until this runs the API answers 409 "not enabled" to a
-- schedule and applies nothing — the feature is dark, nothing else changes.
-- ⚠️ RLS NOT FORCED — the same choice as catalogue_item_version (b146): migrations run as the owner.
-- Reversible: DROP TABLE catalogue_item_schedule;

BEGIN;

CREATE TABLE IF NOT EXISTS catalogue_item_schedule (
  schedule_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid NOT NULL,
  item_id       uuid NOT NULL,
  effective_at  timestamptz NOT NULL,
  patch         jsonb NOT NULL DEFAULT '{}'::jsonb,       -- RFC 7386 merge-patch of the keys that change
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  applied_at    timestamptz,                               -- set by applyDue; the row is then history
  applied_rows  integer,
  cancelled_at  timestamptz
);

-- the one probe applyDue runs on every read: "anything due for this entity?" — partial index keeps it tiny
CREATE INDEX IF NOT EXISTS idx_cis_due ON catalogue_item_schedule (entity_id, effective_at)
  WHERE applied_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cis_item ON catalogue_item_schedule (item_id);

ALTER TABLE catalogue_item_schedule ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS catalogue_item_schedule_isolation ON catalogue_item_schedule;
CREATE POLICY catalogue_item_schedule_isolation ON catalogue_item_schedule
  USING       (entity_id = current_setting('app.current_entity', true)::uuid)
  WITH CHECK  (entity_id = current_setting('app.current_entity', true)::uuid);

COMMIT;

-- VERIFICATION, after the commit. Expect one row: table present, rls on, 2 indexes, 1 policy.
-- Athi ran this 2026-09-05: true · true · 2 · 1 — DONE.
SELECT to_regclass('public.catalogue_item_schedule') IS NOT NULL                                            AS table_present,
       (SELECT relrowsecurity FROM pg_class WHERE relname = 'catalogue_item_schedule')                      AS rls_on,
       (SELECT count(*) FROM pg_indexes WHERE tablename = 'catalogue_item_schedule' AND indexname LIKE 'idx_cis%') AS indexes,
       (SELECT count(*) FROM pg_policies WHERE tablename = 'catalogue_item_schedule')                       AS policies;
