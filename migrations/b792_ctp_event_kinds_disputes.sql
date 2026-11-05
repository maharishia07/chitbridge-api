-- b792_ctp_event_kinds_disputes.sql — RAIL-106 part 2 (25 Oct 2026): the CTP return path carries DISPUTES (raise, a dispute message, resolve).
--
-- ⚠️⚠️ DRAFT — NOT RUN IN PRODUCTION · Athi runs it (Supabase SQL editor, AS postgres). Safe to re-run (DROP CONSTRAINT IF EXISTS, then ADD). Touches no rows.
--    The SIT kit's migrate job runs it on the SIT VMs.
-- OWNER: lib/ctpreturn.js (ctp_event_out)
--
-- WHY. b791 limited ctp_event_out.kind to ('status', 'message'). A dispute event is a third and fourth and fifth kind. No new table: chit_disputes, its roster and the dispute-tagged
-- message copies already hold a remote party (it is a stub row here, exactly as for status and messages); only the CHECK on the queue's kind column has to learn the new words.
-- Until this has run, a dispute on a chit with a party elsewhere is saved here and the answer says "could not be queued" (queue insert refused), never silence.

BEGIN;

ALTER TABLE ctp_event_out DROP CONSTRAINT IF EXISTS ctp_event_out_kind_check;
ALTER TABLE ctp_event_out ADD CONSTRAINT ctp_event_out_kind_check
  CHECK (kind IN ('status', 'message', 'dispute_raise', 'dispute_message', 'dispute_resolve'));

COMMIT;
