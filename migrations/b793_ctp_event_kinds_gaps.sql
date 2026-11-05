-- b793_ctp_event_kinds_gaps.sql — RAIL-106 part 3 (25 Oct 2026): the CTP return path carries the CANCEL FLAGS (a request, a confirmation) and ATTACHMENTS.
--
-- ⚠️⚠️ DRAFT — NOT RUN IN PRODUCTION · Athi runs it (Supabase SQL editor, AS postgres). Safe to re-run (DROP CONSTRAINT IF EXISTS, then ADD). Touches no rows.
--    The SIT kit's migrate job runs it on the SIT VMs.
-- OWNER: lib/ctpreturn.js (ctp_event_out)
--
-- WHY. b792 limited ctp_event_out.kind to status, message and the three dispute kinds. Part 3 adds: cancel_request (the flag "cancel requested" on a recipient's copy, b195),
-- cancel_confirm (the flag "cancel confirmed" on the sender's copy, b197) and attachment (a file on a chit or a message, carried by reference and pulled over the CTP door).
-- No new table. Until this has run the three are saved locally and the answer says "could not be queued" (the insert is refused), never silence.

BEGIN;

ALTER TABLE ctp_event_out DROP CONSTRAINT IF EXISTS ctp_event_out_kind_check;
ALTER TABLE ctp_event_out ADD CONSTRAINT ctp_event_out_kind_check
  CHECK (kind IN ('status', 'message', 'dispute_raise', 'dispute_message', 'dispute_resolve', 'cancel_request', 'cancel_confirm', 'attachment'));

COMMIT;
