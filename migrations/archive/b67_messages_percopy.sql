-- b67: chit_messages become PER-ENTITY copies (mailing model). Each participant owns its OWN row per message, so
-- anyone can delete theirs without affecting others; nothing is shared. Mirrors chit_header (composite PK + entity_id).
--
-- AUDIENCE is fixed at post time (which entities get a replicated row):
--   internal → the author entity only (single copy);  external → every chit participant;  dispute → the dispute roster.
-- The read then simplifies to "my own copies" (RLS). One logical message_id, replicated per audience entity.
--
-- ⚠️ COUPLING RULE: enable only after every chit_messages access is on withEntity()/the deliver fn (b67 code pass).
-- Legacy pre-b67 rows are backfilled to the sender (non-destructive; they become the sender's single copy).
-- Rollback: restore PK (message_id); DISABLE ROW LEVEL SECURITY; DROP POLICY rls_entity; DROP FUNCTION chit_message_deliver.

ALTER TABLE chit_messages ADD COLUMN IF NOT EXISTS entity_id uuid;
UPDATE chit_messages SET entity_id = sender_entity_id WHERE entity_id IS NULL;   -- legacy rows → sender-owned
ALTER TABLE chit_messages ALTER COLUMN entity_id SET NOT NULL;

ALTER TABLE chit_messages DROP CONSTRAINT IF EXISTS chit_messages_pkey;
ALTER TABLE chit_messages ADD CONSTRAINT chit_messages_pkey PRIMARY KEY (message_id, entity_id);
CREATE INDEX IF NOT EXISTS chit_messages_entity_chit_idx ON chit_messages(entity_id, chit_id);

ALTER TABLE chit_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chit_messages FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON chit_messages;
CREATE POLICY rls_entity ON chit_messages
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- ── SECURITY DEFINER message-deliver ────────────────────────────────────────────────────────────────────────
-- Replicate a message to its AUDIENCE in ONE call, in or out of a transaction. Runs as the (superuser) owner, so it
-- bypasses FORCE-RLS to write every participant's own copy — exactly like chit_deliver fans out a chit.
--   internal → author only ·  external → all chit participants ·  dispute → dispute roster (chit-wide/no-roster = all).
-- One shared message_id + one shared created_at across the copies. Returns created_at.
CREATE OR REPLACE FUNCTION chit_message_deliver(
  p_message_id uuid, p_chit_id uuid, p_sender_entity_id uuid, p_sender_display_name text,
  p_thread_type text, p_message_text text, p_msg_type text, p_is_dispute boolean, p_dispute_id uuid
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_created timestamptz := now(); v_ent uuid; v_scope text;
BEGIN
  IF p_thread_type = 'internal' THEN   -- private to the author entity: single copy
    INSERT INTO chit_messages (message_id, entity_id, chit_id, sender_entity_id, sender_display_name,
        thread_type, visibility_entity_id, message_text, msg_type, is_dispute, dispute_id, created_at)
      VALUES (p_message_id, p_sender_entity_id, p_chit_id, p_sender_entity_id, p_sender_display_name,
        'internal', p_sender_entity_id, p_message_text, COALESCE(p_msg_type,'info'), COALESCE(p_is_dispute,false), p_dispute_id, v_created);
    RETURN v_created;
  END IF;

  IF COALESCE(p_is_dispute,false) AND p_dispute_id IS NOT NULL THEN   -- dispute → the roster (targeted)
    SELECT scope INTO v_scope FROM chit_disputes WHERE dispute_id = p_dispute_id LIMIT 1;
    IF COALESCE(v_scope,'targeted') <> 'chit_wide'
       AND EXISTS (SELECT 1 FROM dispute_participants WHERE dispute_id = p_dispute_id) THEN
      FOR v_ent IN SELECT DISTINCT entity_id FROM dispute_participants WHERE dispute_id = p_dispute_id LOOP
        INSERT INTO chit_messages (message_id, entity_id, chit_id, sender_entity_id, sender_display_name,
            thread_type, visibility_entity_id, message_text, msg_type, is_dispute, dispute_id, created_at)
          VALUES (p_message_id, v_ent, p_chit_id, p_sender_entity_id, p_sender_display_name,
            'external', NULL, p_message_text, COALESCE(p_msg_type,'info'), true, p_dispute_id, v_created);
      END LOOP;
      RETURN v_created;
    END IF;   -- chit-wide or no roster → fall through to all participants
  END IF;

  FOR v_ent IN SELECT DISTINCT entity_id FROM chit_status WHERE chit_id = p_chit_id LOOP   -- external / chit-wide
    INSERT INTO chit_messages (message_id, entity_id, chit_id, sender_entity_id, sender_display_name,
        thread_type, visibility_entity_id, message_text, msg_type, is_dispute, dispute_id, created_at)
      VALUES (p_message_id, v_ent, p_chit_id, p_sender_entity_id, p_sender_display_name,
        p_thread_type, NULL, p_message_text, COALESCE(p_msg_type,'info'), COALESCE(p_is_dispute,false), p_dispute_id, v_created);
  END LOOP;
  RETURN v_created;
END; $$;
GRANT EXECUTE ON FUNCTION chit_message_deliver(uuid,uuid,uuid,text,text,text,text,boolean,uuid) TO cb_app;
