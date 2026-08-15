-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b155 — a message can name the LINE it is about.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-08-15: *"can we bring another collapsable for messages, like internal messages — add, view."*
--
-- ── ⭐ WHY THIS IS A COLUMN AND NOT A NEW TABLE ─────────────────────────────────────────────────────────────────
-- The cheap route was a second store: chit_line_assignment already has a `note`, is already private, already
-- append-only, already attributed and timestamped. Writing a thread into it would have cost nothing and shipped
-- tonight.
--
-- ⚠️ AND IT WOULD HAVE BEEN A SECOND MESSAGING SYSTEM. `chit_messages` is where messages live — with their
-- per-copy replication, their internal/external threads, their attachments (routes/attachments.js reads
-- visibility off this very table) and their dispute linkage. A parallel thread in another table would have none
-- of that, would drift from it, and would leave "where are the messages" with two answers. The rule that has
-- caught three bugs this week is the same one here: a second answer to a question the system already answers.
--
-- So the message store stays the message store, and gains the one thing it lacked — which line it is about.
--
-- ⚠️ NULLABLE, AND THAT IS THE MIGRATION. Every existing message is about the CHIT, not a line, and stays that
-- way: null means chit-level, exactly as it always meant. Nothing is backfilled and nothing needs to be.
--
-- ⚠️ NO NEW PRIVACY SURFACE. The audience rules in chit_message_deliver are untouched: internal stays a single
-- copy visible to the author entity, external still fans out to participants, the dispute roster still governs
-- dispute messages. A line_id changes what a message is ABOUT, never who can read it — and this migration must
-- not be the one that quietly widens an audience.
--
-- Safe to re-run.

ALTER TABLE chit_messages ADD COLUMN IF NOT EXISTS line_id uuid;

/* Reading a line's thread is "this chit, this line, my copies" — RLS already supplies the last part. */
CREATE INDEX IF NOT EXISTS chit_messages_line ON chit_messages (entity_id, chit_id, line_id)
  WHERE line_id IS NOT NULL;

-- ── the definer gains the argument, and the 9-arg form stays ──────────────────────────────────────────────────
-- ⚠️ THE OLD SIGNATURE IS KEPT AND DELEGATES. Code already deployed calls the 9-argument form, and a migration
-- that drops it breaks every message posted between running this and the next deploy. One implementation, two
-- doors — the same shape as b152's chit_line_event.
CREATE OR REPLACE FUNCTION chit_message_deliver(
  p_message_id uuid, p_chit_id uuid, p_sender_entity_id uuid, p_sender_display_name text,
  p_thread_type text, p_message_text text, p_msg_type text, p_is_dispute boolean, p_dispute_id uuid,
  p_line_id uuid
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_created timestamptz;
BEGIN
  /* Delegate the whole audience decision to the existing function — the rules about who sees what are not
     restated here, because two copies of an audience rule is precisely how one of them ends up wrong. */
  v_created := chit_message_deliver(p_message_id, p_chit_id, p_sender_entity_id, p_sender_display_name,
                                    p_thread_type, p_message_text, p_msg_type, p_is_dispute, p_dispute_id);
  IF p_line_id IS NOT NULL THEN
    /* Stamp the line onto whatever copies that call created — however many entities it fanned out to. */
    UPDATE chit_messages SET line_id = p_line_id WHERE message_id = p_message_id;
  END IF;
  RETURN v_created;
END $$;

GRANT EXECUTE ON FUNCTION chit_message_deliver(uuid, uuid, uuid, text, text, text, text, boolean, uuid, uuid) TO cb_app;

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM chit_messages WHERE line_id IS NOT NULL;
  RAISE NOTICE 'b155: chit_messages.line_id added (nullable = chit-level, as every existing message is). % line-scoped so far.', n;
  RAISE NOTICE 'b155: audience rules UNCHANGED — internal is still one copy to the author entity.';
END $$;
