-- migration_chit_reads.sql — per-actor read tracking (panel-fixes #5, baseline-11).
-- "Unread for me (the actor)" = no row here yet, OR the chit copy changed (chit_status.updated_at)
-- after I last opened it. Assignment/status/new-activity bumps updated_at, so a handed-off chit
-- re-flags as unread for the new actor automatically. Read state stays per-actor (not per-entity).
CREATE TABLE IF NOT EXISTS chit_reads (
  chit_id   UUID NOT NULL,
  actor_id  UUID NOT NULL REFERENCES identities(identity_id),
  read_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chit_id, actor_id)
);
CREATE INDEX IF NOT EXISTS idx_chit_reads_actor ON chit_reads(actor_id);
