-- b197 · CANCEL CONFIRMED — the return leg of the withdrawal.
--
-- Athi, 2026-09-02: *"on cancelling the requester should be notified as well and his flag to set as cancelled,
-- change from cancel requested to cancelled in the order copy as well."*
--
-- ── WHY b195 IS NOT ENOUGH ───────────────────────────────────────────────────────────────────────────────────
-- b195 answers "somebody asked ME to cancel" — the OUTBOUND half, stamped on each recipient. It cannot answer
-- the sender's question, which is the opposite one: **did they agree?** Until a recipient acts, a withdrawal is
-- a request with no reply, and the sender's screen had no way to tell "I asked" from "they accepted".
--
--     cancel_requested_at   on the RECIPIENT   — someone has asked me            (b195)
--     cancel_confirmed_at   on the SENDER      — they have cancelled their copy  (this)
--
-- ⚠️ TWO COLUMNS, NOT ONE REUSED. Stamping `cancel_requested_at` on the sender to mean "confirmed" would make
-- one column mean two opposite things depending on who is reading it — and the read path cannot tell, because a
-- copy does not know whether it is the sender's without another join.
--
-- ⭐ AND IT NAMES WHO CONFIRMED, because a chit may have several recipients. "Cancelled" with one of three
-- parties agreed is not the same fact as all three, and a bare boolean cannot tell them apart. v1 records the
-- most recent confirmer and the count is left to the message thread; if multi-party withdrawal becomes real work,
-- this is the column that grows a table rather than a second meaning.
--
-- ⚠️ Nothing clears it — same rule as b195. "They confirmed on the 2nd" stays true afterwards.
--
-- ⚠️ WITH RLS. chit_status carries the b49 per-entity policy. ⚠️⚠️ AND THE WRITE MUST RUN UNDER THE SENDER'S OWN
-- CONTEXT, not a null one: that policy is `entity_id = NULLIF(current_setting(...), '')::uuid`, so with no
-- context it is `entity_id = NULL` and the UPDATE matches NOTHING, silently. That exact mistake shipped in b195's
-- first version and only the end-to-end spec caught it.
--
-- Code deploys BEFORE this runs and is guarded by lib/schema.js hasColumn, so both orders are safe.
-- Run in the Supabase SQL editor. ONE result set.

ALTER TABLE chit_status ADD COLUMN IF NOT EXISTS cancel_confirmed_at timestamp without time zone;
ALTER TABLE chit_status ADD COLUMN IF NOT EXISTS cancel_confirmed_by character varying(255);

CREATE INDEX IF NOT EXISTS idx_chit_status_cancel_conf
  ON chit_status (entity_id, cancel_confirmed_at)
  WHERE cancel_confirmed_at IS NOT NULL;

-- ⭐ AND RETIRE `void` — Athi, 2026-09-02: *"go with cancelled, retire void."*
--
-- ⚠️⚠️ `void` WAS A STATUS THE FRONT END HAD NEVER HEARD OF. The list maps status → bucket with
-- `ST[current_status] || 'open'` and `void` is not in ST, so a withdrawn order fell through the default and went
-- on reading as OPEN in the sender's own list. The withdrawal worked and the screen said it had not.
--
-- The route now writes `cancelled`; these are the rows written before it did. Both words already mean the same
-- thing, and `cancelled` is the one every filter, rollup and bucket already understands.
UPDATE chit_status SET current_status = 'cancelled' WHERE current_status = 'void';

SELECT 1 AS ord, 'columns added (want 2)' AS check,
       count(*)::text AS value
  FROM information_schema.columns
 WHERE table_name = 'chit_status' AND column_name IN ('cancel_confirmed_at', 'cancel_confirmed_by')
UNION ALL
SELECT 2, 'index present (want 1)',
       count(*)::text FROM pg_indexes WHERE indexname = 'idx_chit_status_cancel_conf'
UNION ALL
SELECT 3, 'rows still saying void (want 0)',
       (SELECT count(*)::text FROM chit_status WHERE current_status = 'void')
UNION ALL
SELECT 4, 'rows now cancelled',
       (SELECT count(*)::text FROM chit_status WHERE current_status = 'cancelled')
 ORDER BY 1;

-- Expect: 2 · 1 · 0 · (a small number).
-- Rollback: ALTER TABLE chit_status DROP COLUMN cancel_confirmed_at, DROP COLUMN cancel_confirmed_by;
--           DROP INDEX IF EXISTS idx_chit_status_cancel_conf;
--           ⚠️ the void → cancelled conversion is NOT reversible from here: the rows no longer say which they
--           were. state_log keeps the history — `action = 'voided'` still marks every one of them.
