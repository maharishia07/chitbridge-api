-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b161 — a message can be about a PRODUCT, before any chit exists.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-08-16, choosing between a new table and this: *"generalise chit_messages"*.
--
-- The need: from a search result or a supplier's catalogue, ask about an item — is it available, what is the
-- lead time, does it come in 25kg — BEFORE committing to a chit. Today that conversation has nowhere to live,
-- because `chit_messages.chit_id` is NOT NULL (000_baseline.sql:461): a message cannot exist without a chit.
--
-- ── ⭐ WHY THIS IS A COLUMN AND NOT A `product_enquiry` TABLE ────────────────────────────────────────────────────
-- A separate table was the fast answer and the wrong one. `chit_messages` already carries per-copy delivery
-- (chit_message_deliver), internal/external/dispute threading, read state (b156), line scoping (b155) and FORCE
-- RLS. A second store would need every one of those again, and would drift: two inboxes, two unread counts, two
-- sets of per-copy rules, and a dispute that can only see half the conversation.
--
-- ⚠️ THE SAME ARGUMENT b155 MADE, ONE LEVEL UP. That migration refused to put a thread in
-- `chit_line_assignment.note` for exactly this reason. The anchor generalises; the messaging layer does not fork.
--
-- ── WHAT CHANGES ────────────────────────────────────────────────────────────────────────────────────────────────
--   subject_type  'chit' (every existing row, by default) | 'product'
--   subject_id    the product's catalogue_item id when subject_type='product'; NULL for a chit
--   chit_id       becomes NULLABLE — but ONLY for product-subject rows, enforced below
--
-- ⚠️ THE CHECK CONSTRAINT IS THE POINT OF THIS MIGRATION. Dropping NOT NULL on `chit_id` without it would let a
-- chit-subject message exist with no chit — a silently orphaned row that every existing query would skip and no
-- screen would ever show. The constraint keeps the old invariant exactly as strong as it was, and adds the new
-- one beside it.
--
-- ⚠️ NOTHING ELSE MOVES. Existing rows get `subject_type='chit'` from the DEFAULT, so every current query, index
-- and policy keeps working unchanged. `entity_id` still governs RLS; a product message is as per-copy as a chit
-- message. WITH RLS, unchanged.
--
-- Safe to re-run.

BEGIN;

ALTER TABLE chit_messages
  ADD COLUMN IF NOT EXISTS subject_type text NOT NULL DEFAULT 'chit';

ALTER TABLE chit_messages
  ADD COLUMN IF NOT EXISTS subject_id uuid;

-- Nullable only in the sense the constraint below allows. Idempotent: DROP NOT NULL on an already-nullable
-- column is a no-op.
ALTER TABLE chit_messages
  ALTER COLUMN chit_id DROP NOT NULL;

-- ⚠️ NOT VALID is deliberate — it enforces the rule for every new and updated row immediately, without taking a
-- full-table lock to re-check history. The VALIDATE below then checks the existing rows with a far weaker lock.
-- On a small table both are instant; on a large one this is the difference between a blip and an outage.
ALTER TABLE chit_messages DROP CONSTRAINT IF EXISTS chit_messages_subject_ck;
ALTER TABLE chit_messages ADD CONSTRAINT chit_messages_subject_ck CHECK (
      (subject_type = 'chit'    AND chit_id IS NOT NULL AND subject_id IS NULL)
   OR (subject_type = 'product' AND chit_id IS NULL     AND subject_id IS NOT NULL)
) NOT VALID;
ALTER TABLE chit_messages VALIDATE CONSTRAINT chit_messages_subject_ck;

-- The read path for a product conversation: "every message about this item, for this entity".
-- Partial, because product messages will be a small minority of the table for a long time.
CREATE INDEX IF NOT EXISTS chit_messages_subject_idx
  ON chit_messages (entity_id, subject_type, subject_id, created_at DESC)
  WHERE subject_type = 'product';

COMMIT;

DO $$
DECLARE n_chit bigint; n_prod bigint;
BEGIN
  SELECT count(*) INTO n_chit FROM chit_messages WHERE subject_type = 'chit';
  SELECT count(*) INTO n_prod FROM chit_messages WHERE subject_type = 'product';
  RAISE NOTICE 'b161: chit_messages.subject_type added. % chit-subject rows (unchanged), % product-subject.', n_chit, n_prod;
END $$;
