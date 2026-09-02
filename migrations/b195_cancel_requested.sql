-- b195 · CANCEL REQUESTED — a flag on the recipient's copy, not a message they have to go and find.
--
-- Athi, 2026-09-02: *"if it is a cancel message, the message has to be populated as an external message and it
-- has to be flagged against the order right away, so we need a flag to show cancel requested."*
--
-- ── WHAT WAS THERE, AND WHY IT WAS NOT ENOUGH ────────────────────────────────────────────────────────────────
-- Withdrawing already delivered an EXTERNAL message reading `[cancel requested] <reason>` to every recipient.
-- That is the right channel and it is per-copy — but it lands in the Messages tab, behind a click, in a list
-- with everything else. The one fact that changes what a supplier should do next arrived looking like chatter.
--
-- ⚠️ AND IT COULD NOT BE DERIVED ON THE READ PATH. `msg_type` is CHECK-constrained to eight values and none of
-- them means "cancel request" (b_baseline_part2), so the only marker was a `[cancel requested]` PREFIX IN THE
-- TEXT. Every screen wanting the flag would have had to string-match message bodies — the same fragility the
-- dispute byline already carries, repeated. A fact this load-bearing gets a column.
--
-- ── ⚠️⚠️ IS THIS A CROSS-ENTITY WRITE? NO, AND THE DISTINCTION IS THE WHOLE DESIGN ───────────────────────────
-- `routes/chits.js` is emphatic that void "never" writes across entities, and it is right: the sender must not
-- set the RECIPIENT's `current_status`, because that would decide their answer for them — a supplier who cut the
-- stock at 6am has to be able to refuse.
--
-- ⭐ But `postMessageCopies` ALREADY writes into every recipient's copy. Delivering INTO someone's copy is what
-- this rail does; it is inbound mail. What it must never do is change their DECISION. So:
--     cancel_requested_at   — a notification marker. Someone has asked. Written by the sender.  ✅
--     current_status        — their answer. Only they may write it.                             ❌ untouched
-- The flag says "you have been asked", never "you have agreed".
--
-- ⚠️ NOTHING CLEARS IT, DELIBERATELY. "They asked me to cancel on the 2nd" stays true after the answer, and a
-- marker that erases itself takes the reason for a status change with it. The SCREEN stops showing it once the
-- copy reaches a terminal state — a render rule, not a delete.
--
-- ⚠️ WITH RLS. `chit_status` carries the b49 per-entity policy, so this column is protected exactly as the rest
-- of the row is. The write in routes/chits.js runs under the SENDER's context and targets the recipients' rows
-- by chit_id — see the note there for how that is scoped.
--
-- Code deploys BEFORE this runs and is guarded by lib/schema.js hasColumn, so both orders are safe.
-- Run in the Supabase SQL editor. ONE result set.

ALTER TABLE chit_status ADD COLUMN IF NOT EXISTS cancel_requested_at timestamp without time zone;
ALTER TABLE chit_status ADD COLUMN IF NOT EXISTS cancel_requested_by  character varying(255);
ALTER TABLE chit_status ADD COLUMN IF NOT EXISTS cancel_reason        text;

-- Only the rows that carry a request are read, and only while the copy is still live, so the index matches the
-- question the screen asks rather than the shape of the table.
CREATE INDEX IF NOT EXISTS idx_chit_status_cancel_req
  ON chit_status (entity_id, cancel_requested_at)
  WHERE cancel_requested_at IS NOT NULL;

SELECT 1 AS ord, 'columns added' AS check,
       count(*)::text AS value
  FROM information_schema.columns
 WHERE table_name = 'chit_status'
   AND column_name IN ('cancel_requested_at', 'cancel_requested_by', 'cancel_reason')
UNION ALL
SELECT 2, 'index present',
       count(*)::text FROM pg_indexes WHERE indexname = 'idx_chit_status_cancel_req'
UNION ALL
SELECT 3, 'rows already flagged (expect 0)',
       (SELECT count(*)::text FROM chit_status WHERE cancel_requested_at IS NOT NULL)
 ORDER BY 1;

-- Expect: 3 · 1 · 0.
-- Rollback:  ALTER TABLE chit_status DROP COLUMN cancel_requested_at, DROP COLUMN cancel_requested_by,
--            DROP COLUMN cancel_reason;  DROP INDEX IF EXISTS idx_chit_status_cancel_req;
