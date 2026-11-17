-- b58_dispute_msg_fk.sql — add the missing FK chit_messages.dispute_id -> chit_disputes
-- First post-baseline migration (applies AFTER 000_baseline*). Idempotent: safe
-- to re-run (prod already has this constraint as of 2026-07-05).
--
-- Closes the referential-integrity inconsistency found 2026-07-05: dispute_participants
-- already FK'd dispute_id (ON DELETE CASCADE) but chit_messages.dispute_id did not.
-- Orphan pre-check returned 0 before applying (no dangling dispute_id rows).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chit_messages_dispute_id_fkey'
  ) THEN
    ALTER TABLE chit_messages
      ADD CONSTRAINT chit_messages_dispute_id_fkey
      FOREIGN KEY (dispute_id) REFERENCES chit_disputes(dispute_id) ON DELETE CASCADE;
  END IF;
END $$;
