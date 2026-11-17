-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b156 — read state on a message, and a reason to keep one in view.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-08-15: *"is there any way we can bring all the external messages under one tab, which are not read
-- yet … maybe we have to make an icon to retain the message in the tab. Read, reply etc should be done there
-- only."* And then: *"can we bring external new messages under rail?"*
--
-- ── ⭐ READ STATE IS PER COPY, AND THAT IS FREE HERE ────────────────────────────────────────────────────────────
-- b67 already replicates a message into one row PER ENTITY in its audience. So "have I read it" is a column on my
-- own row and cannot be affected by whether the counterparty has read theirs — no join, no per-user table, no
-- risk of one party's reading state leaking as a read receipt to the other.
--
-- ⚠️ AND THAT IS A DELIBERATE NON-FEATURE. Because the column lives on MY copy, the sender cannot see it: there
-- are no read receipts on this rail. If they are ever wanted they must be an explicit, mutual thing, not a
-- side-effect of a column that happened to be visible.
--
-- ── ⭐ "KEPT" IS NOT "UNREAD" ───────────────────────────────────────────────────────────────────────────────────
-- The obvious shortcut is to let someone mark a message unread again to keep it in the tab. That overloads one
-- flag with two meanings — "I have not seen this" and "I am not finished with this" — and the tab then cannot
-- tell a genuinely new message from one you are sitting on. They are separate columns because they answer
-- separate questions, and the inbox shows both.
--
-- Safe to re-run. Every existing message is unread and unkept, which is what it already was.

ALTER TABLE chit_messages ADD COLUMN IF NOT EXISTS read_at timestamptz;
ALTER TABLE chit_messages ADD COLUMN IF NOT EXISTS kept    boolean NOT NULL DEFAULT false;

/* The inbox asks one question — "my external messages, unread or kept, newest first" — and asks it on every
   paint of that screen. Partial, because the answered-and-done ones are the majority and never appear. */
CREATE INDEX IF NOT EXISTS chit_messages_inbox
  ON chit_messages (entity_id, created_at DESC)
  WHERE thread_type = 'external' AND (read_at IS NULL OR kept);

-- ── mark read / keep · SECURITY DEFINER only to be sure it touches MY row and no other ─────────────────────────
-- ⚠️ THE ENTITY IS TAKEN FROM THE SESSION, NEVER FROM A PARAMETER. b67's whole point is one row per party; a
-- function that accepted an entity_id would let a caller mark the COUNTERPARTY's copy read, which is both a lie
-- about what they have seen and a way to make a message disappear from someone else's inbox. This is the exact
-- "server trusts the client's claim about identity" pattern the reviewer named in July.
CREATE OR REPLACE FUNCTION chit_message_mark(p_message_id uuid, p_read boolean, p_kept boolean)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid;
  v_n  integer := 0;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'chit_message_mark: no entity context — call inside withEntity(me)';
  END IF;
  UPDATE chit_messages
     SET read_at = CASE WHEN p_read IS NULL THEN read_at
                        WHEN p_read THEN COALESCE(read_at, now())
                        ELSE NULL END,
         kept    = COALESCE(p_kept, kept)
   WHERE message_id = p_message_id
     AND entity_id  = v_me;          -- my copy, and only mine
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

GRANT EXECUTE ON FUNCTION chit_message_mark(uuid, boolean, boolean) TO cb_app;

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM chit_messages WHERE thread_type = 'external';
  RAISE NOTICE 'b156: read_at + kept added. % external message copies, all currently unread — which is what they already were.', n;
  RAISE NOTICE 'b156: read state is per COPY and never visible to the sender. No read receipts on this rail.';
END $$;
