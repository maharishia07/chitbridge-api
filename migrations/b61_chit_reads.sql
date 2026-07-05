-- b61_chit_reads.sql — create the per-actor read-tracking table that was NEVER applied to prod.
-- Root cause of a live 500 (2026-07-05): opening a chit AS AN ACTOR runs an INSERT into chit_reads inside the
-- withEntity() transaction; the table was missing, the INSERT failed, and even though the code try/catches it,
-- the FAILED STATEMENT POISONS THE TRANSACTION — so the next query (the header fetch) errored with "current
-- transaction is aborted", which is NOT guarded -> 500. Creating the table removes the failure entirely.
-- Also fixes GET /chits/unread (unguarded LEFT JOIN chit_reads). Idempotent. Post-baseline (after 000_baseline).

CREATE TABLE IF NOT EXISTS chit_reads (
  chit_id   UUID NOT NULL,
  actor_id  UUID NOT NULL REFERENCES identities(identity_id),
  read_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chit_id, actor_id)
);
CREATE INDEX IF NOT EXISTS idx_chit_reads_actor ON chit_reads(actor_id);

-- The app runs as cb_app (NOSUPERUSER NOBYPASSRLS). New tables default to RLS-disabled, which is correct here:
-- chit_reads is a per-actor carve-out (not entity-RLS-scoped). cb_app just needs the grant.
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cb_app') THEN
  EXECUTE 'GRANT SELECT,INSERT,UPDATE,DELETE ON chit_reads TO cb_app';
END IF; END $$;

-- verify: expect chit_reads = a table name
SELECT to_regclass('public.chit_reads') AS chit_reads;
