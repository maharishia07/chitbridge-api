-- migration_chit_actions.sql  (feat/chit-actions, 2026-06-27)
-- Archive: per-entity reversible archive, distinct from soft-delete (deleted_at).
-- NOTE: void needs NO column — chit_status.current_status is VARCHAR(30) with no CHECK,
-- so the terminal 'void' value is accepted as-is. Rollup + notifications are read-only.
-- Safe to re-run.

ALTER TABLE chit_status ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_chit_status_archived
  ON chit_status(entity_id) WHERE archived_at IS NOT NULL;
