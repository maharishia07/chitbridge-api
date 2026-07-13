-- b105: RETENTION — PHASE 1 (NON-DESTRUCTIVE schema prep + dispute-floor). Deletes NOTHING. Safe to run.
-- Per the discipline (a retention job IS a deletion job): this migration ONLY prepares + enables the DRY-RUN. The actual
-- retirement (soft-delete → purge) is a SEPARATE, deliberately-gated PHASE 2 migration (b106) that must be reviewed against
-- the dry-run output before it is ever run. See SPEC-retention-lifecycle.md + CB-CLI-PROOF-REQUEST-retention-lifecycle.
--
-- What this does:
--   1. Every per-copy row MUST carry a retention period (proof #1): backfill nulls, then NOT NULL.
--   2. retire_at = the computed retirement instant (defaults to retention_expires_at; the dispute FLOOR lifts it).
--   3. retired_at = when retention fired (start of the 7-day internal soft-delete window). NULL = live.
--   4. A trigger applies the FLOOR on dispute resolution: retire_at = MAX(retention_expires_at, resolved_at + grace).
--      FLOOR, never a restart (a late dispute must NOT add another full period).

-- 1 · retention period is mandatory
UPDATE chit_status SET retention_expires_at = now() + interval '90 days' WHERE retention_expires_at IS NULL;
ALTER TABLE chit_status ALTER COLUMN retention_expires_at SET NOT NULL;
ALTER TABLE chit_status ALTER COLUMN retention_expires_at SET DEFAULT (now() + interval '90 days');

-- 2 + 3 · the computed retirement instant + the soft-delete marker
ALTER TABLE chit_status ADD COLUMN IF NOT EXISTS retire_at  timestamptz;
ALTER TABLE chit_status ADD COLUMN IF NOT EXISTS retired_at timestamptz;
UPDATE chit_status SET retire_at = retention_expires_at WHERE retire_at IS NULL;   -- default: retire_at = retention end
ALTER TABLE chit_status ALTER COLUMN retire_at SET DEFAULT (now() + interval '90 days');
CREATE INDEX IF NOT EXISTS cs_retire_due ON chit_status (retire_at) WHERE deleted_at IS NULL AND retired_at IS NULL;

-- configured grace period (NOT hard-coded) — one row.
CREATE TABLE IF NOT EXISTS retention_config (id int PRIMARY KEY DEFAULT 1, grace_days int NOT NULL DEFAULT 30, soft_delete_days int NOT NULL DEFAULT 7, CHECK (id = 1));
INSERT INTO retention_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 4 · the dispute FLOOR, applied as an isolated trigger (does NOT touch the security-critical resolve definer).
-- When a dispute copy resolves, lift that copy's retire_at to MAX(retention_end, resolved_at + grace). MAX = a floor.
CREATE OR REPLACE FUNCTION retention_apply_dispute_floor() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_grace int;
BEGIN
  IF NEW.status = 'resolved' AND COALESCE(OLD.status,'') <> 'resolved' THEN
    SELECT grace_days INTO v_grace FROM retention_config WHERE id = 1;
    UPDATE chit_status cs
       SET retire_at = GREATEST(cs.retention_expires_at, COALESCE(NEW.resolved_at, now()) + make_interval(days => COALESCE(v_grace,30)))
     WHERE cs.chit_id = NEW.chit_id AND cs.entity_id = NEW.entity_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_retention_dispute_floor ON chit_disputes;
CREATE TRIGGER trg_retention_dispute_floor AFTER UPDATE ON chit_disputes
  FOR EACH ROW EXECUTE FUNCTION retention_apply_dispute_floor();

-- PHASE 2 (b106, NOT in this file, human-gated): a context-scoped SECURITY DEFINER `retire_copy(chit_id, entity_id)`
-- (b50 standard) that SOFT-deletes the per-copy rows (chit_status/detail/messages/attachments/disputes) → sets
-- retired_at; then a second stage purges rows whose retired_at is older than soft_delete_days. Plus the daily schedule.
-- Do NOT write/enable b106 until the b105 dry-run (scripts/prove-retention or lib/retention.planRetirement) has been
-- reviewed on real data and the guardrails (threshold %, row cap, alert) are confirmed.
