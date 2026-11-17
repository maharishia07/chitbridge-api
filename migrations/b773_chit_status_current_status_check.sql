-- b773_chit_status_current_status_check.sql — K-DB / DB-72 (21 Oct 2026): chit_status.current_status may only hold a status the rail knows.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres). Safe to re-run (DROP CONSTRAINT IF EXISTS, then ADD … NOT VALID,
--    then VALIDATE). Touches no rows. Two short transactions: the first adds the rule for NEW writes only (brief lock); the second checks
--    the rows already there (VALIDATE reads the table but does not block writes). If a row is outside the list, VALIDATE stops with its
--    name and the rule stays NOT VALID (new rows are already guarded): paste the error back, nothing is half-changed.
--
-- WHY. current_status was a free varchar(30): a typo or a status the rail does not know would be stored and then match no folder, no
--    bucket and no transition. Production (READ-2026-10-21-1, 499 rows, 0 NULL): pending 246 · delivered 182 · completed 48 ·
--    in_progress 14 · accepted 6 · cancelled 2 · partial 1. The list below is the rail's own: lib/rail-actions.js STATES (the keys of
--    lib/rail.js TRANSITIONS) = pending delivered read accepted in_progress partial completed rejected cancelled — a superset of
--    every value in production. tests/chit-status-check.test.cjs fails if this list and the code's ever differ.
--    NOT in the list on purpose: closed · disputed · expired. No code writes them (a dispute is a chit_disputes row, not a copy status;
--    expiry is retention_expires_at). If a later round adds one it adds it here in a new bNNN with the code, in the same PR.
-- NULL. The check lets NULL through (a CHECK is satisfied by NULL): the column is nullable with DEFAULT 'pending' and the SQL that reads
--    it already says coalesce(current_status, 'pending'). 0 NULLs today; making it NOT NULL is a separate decision, not taken here.
-- RLS: unchanged (chit_status keeps FORCE RLS and its entity policies; a CHECK is not a policy).

BEGIN;
ALTER TABLE chit_status DROP CONSTRAINT IF EXISTS chit_status_current_status_chk;
ALTER TABLE chit_status ADD CONSTRAINT chit_status_current_status_chk
  CHECK (current_status IN ('pending', 'delivered', 'read', 'accepted', 'in_progress', 'partial', 'completed', 'rejected', 'cancelled')) NOT VALID;
COMMIT;

BEGIN;
ALTER TABLE chit_status VALIDATE CONSTRAINT chit_status_current_status_chk;
COMMIT;
