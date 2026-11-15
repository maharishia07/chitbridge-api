-- b868_review_mark.sql — MARK & QUERY (CAP-25, 15 Nov 2026), the CORE: one INSERT-ONLY table of review marks, the thread subject 'mark' on chit_messages, and the two DB functions that are the only way in.
--
-- ⚠️ NOT RUN on production · Athi runs it (Supabase SQL editor, AS postgres); SIT first through the box's migrate step. Safe to repeat (IF NOT EXISTS / DROP ... IF EXISTS first). Run b869 AFTER this file.
--    It touches no existing row. The api is correct BEFORE and AFTER it runs: until it runs, every /api/marks route answers 503 MARK_NOT_SWITCHED_ON in words and the books lists leave the mark keys out.
-- NUMBER. b867 is the last file on sit-au; b868 this core, b869 its door. Rename before landing if another round took them.
-- WHAT IT IS (docs master capability/MARK-AND-QUERY-CAPABILITY.md section 5.1).
--    review_mark       one row per mark: who (the real person, their own entity, the policy that admitted them, via_kind/via_id = the door), what (kind = the adopter's word, class = one of five neutral classes), when (server clock),
--                      the subject as seen (seal jsonb = canon.seal's own {v, fields, hash}). The state of a subject is its LATEST row; nothing is updated or deleted. The question text lives in `note` and nowhere else.
--    review_mark_set   the ONE way to add a row (SECURITY DEFINER): the trusted entity context must be the writer's own entity, and the door must vouch (review_mark_via_ok). cb_app has NO insert on the table.
--    review_mark_post  the ONE way to add a reply to a mark's thread: one chit_messages copy in the subject owner's entity, subject_type 'mark', no chit. Refused when the latest mark is not open or hold.
--    chit_messages_subject_ck is widened by one clause: (subject_type = 'mark' AND chit_id IS NULL AND subject_id IS NOT NULL).
-- RLS: review_mark ENABLE + FORCE. SELECT where entity_id = the session's entity. No INSERT / UPDATE / DELETE for cb_app (insert only through review_mark_set), and the review_mark_insert_only trigger refuses UPDATE and DELETE for every role.
--      ⚠️ "only the setter sets" is enforced in the api AND by the door check of b869 (a live door, its two entities the row's two entities); under a door the session scope equals the owner's, so the table alone cannot tell the two apart.
-- OWNER: lib/review-mark.js · lib/message-post.js (reply) · routes/marks.js.
-- ROLL BACK (loses the marks and their history; the records marked are untouched):
--    DROP FUNCTION IF EXISTS review_mark_post(uuid, uuid, text, text, text, text, text, text, uuid);
--    DROP FUNCTION IF EXISTS review_mark_set(uuid, text, text, text, text, text, jsonb, text, uuid, text, uuid, text, text, text, text, uuid);
--    DROP FUNCTION IF EXISTS review_mark_via_ok(text, text, uuid, uuid, text);
--    DROP TABLE IF EXISTS review_mark;
-- CHECK (read-only, all-true multi-row block; every row must read ok = true):
--    SELECT 'table, forced RLS' AS what, (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE relname = 'review_mark') AS ok
--    UNION ALL SELECT 'cb_app: select only', has_table_privilege('cb_app', 'public.review_mark', 'SELECT') AND NOT has_table_privilege('cb_app', 'public.review_mark', 'INSERT') AND NOT has_table_privilege('cb_app', 'public.review_mark', 'UPDATE') AND NOT has_table_privilege('cb_app', 'public.review_mark', 'DELETE')
--    UNION ALL SELECT 'insert-only trigger', EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.review_mark'::regclass AND tgname = 'review_mark_insert_only')
--    UNION ALL SELECT 'the three functions', (SELECT count(*) FROM pg_proc WHERE proname IN ('review_mark_set', 'review_mark_post', 'review_mark_via_ok')) = 3
--    UNION ALL SELECT 'subject check widened', (SELECT pg_get_constraintdef(oid) LIKE '%mark%' FROM pg_constraint WHERE conname = 'chit_messages_subject_ck');

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS review_mark (
  mark_id        bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_id      uuid        NOT NULL,
  adopter        text        NOT NULL CHECK (length(adopter) BETWEEN 3 AND 60),
  subject_id     text        NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 120),
  thread_id      uuid        NOT NULL,
  kind           text        NOT NULL CHECK (length(kind) BETWEEN 1 AND 40),
  class          text        NOT NULL CHECK (class IN ('clear', 'open', 'hold', 'reject', 'removed')),
  note           text        CHECK (note IS NULL OR length(note) <= 4000),
  seal           jsonb,
  seal_how       text        NOT NULL CHECK (seal_how IN ('seal', 'version', 'successor')),
  by_identity_id uuid        NOT NULL,
  by_name        text,
  by_entity_id   uuid        NOT NULL,
  by_entity_name text,
  by_policy      text        NOT NULL,
  via_kind       text        NOT NULL CHECK (length(via_kind) BETWEEN 1 AND 30),
  via_id         text,
  batch_id       uuid,
  at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_mark_open_needs_words CHECK (class <> 'open' OR length(btrim(COALESCE(note, ''))) > 0));
-- WHY: the latest row of a subject (every list asks it) and the open list
CREATE INDEX IF NOT EXISTS review_mark_subject_idx ON review_mark (entity_id, adopter, subject_id, mark_id DESC);
CREATE INDEX IF NOT EXISTS review_mark_at_idx ON review_mark (entity_id, adopter, at);
CREATE INDEX IF NOT EXISTS review_mark_thread_idx ON review_mark (thread_id, mark_id);

ALTER TABLE review_mark ENABLE ROW LEVEL SECURITY;  ALTER TABLE review_mark FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS review_mark_read ON review_mark;
CREATE POLICY review_mark_read ON review_mark FOR SELECT
  USING (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

CREATE OR REPLACE FUNCTION public.review_mark_insert_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'review_mark is insert-only: % refused', TG_OP USING ERRCODE = '42501';
END; $$;
DROP TRIGGER IF EXISTS review_mark_insert_only ON review_mark;
CREATE TRIGGER review_mark_insert_only BEFORE UPDATE OR DELETE ON review_mark FOR EACH ROW EXECUTE FUNCTION public.review_mark_insert_only();

REVOKE ALL ON review_mark FROM cb_app, cb_backup;
GRANT SELECT ON review_mark TO cb_app;
GRANT SELECT ON review_mark TO cb_backup;
COMMENT ON TABLE review_mark IS 'MARK & QUERY: one row per review mark on a record of an adopter; insert-only, written only through review_mark_set; the latest row of a subject is its state';

-- the thread: a mark's replies are chit_messages rows with subject_type 'mark' (no chit)
ALTER TABLE chit_messages DROP CONSTRAINT IF EXISTS chit_messages_subject_ck;
ALTER TABLE chit_messages ADD CONSTRAINT chit_messages_subject_ck CHECK (
     (subject_type = 'chit'    AND chit_id IS NOT NULL AND subject_id IS NULL)
  OR (subject_type = 'product' AND chit_id IS NULL     AND subject_id IS NOT NULL)
  OR (subject_type = 'mark'    AND chit_id IS NULL     AND subject_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS chit_messages_mark_idx ON chit_messages (entity_id, subject_id, created_at) WHERE subject_type = 'mark';

-- the door check: does the door vouch for this writer? CORE form: a person writes for their own entity only (via_kind 'self').
-- b869 replaces this function with the doors that let another business in.
CREATE OR REPLACE FUNCTION public.review_mark_via_ok(p_via_kind text, p_via_id text, p_entity uuid, p_by_entity uuid, p_by_policy text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT p_via_kind = 'self' AND p_entity = p_by_entity
$$;

-- the one writer of a mark row
CREATE OR REPLACE FUNCTION public.review_mark_set(
  p_entity uuid, p_adopter text, p_subject_id text, p_kind text, p_class text, p_note text, p_seal jsonb, p_seal_how text,
  p_by_identity uuid, p_by_name text, p_by_entity uuid, p_by_entity_name text, p_by_policy text, p_via_kind text, p_via_id text, p_batch uuid)
RETURNS review_mark LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_caller uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid;
  v_thread uuid;
  v_row    review_mark;
BEGIN
  -- authority from the trusted session context, never from a parameter (the b50 / b103 standard)
  IF v_caller IS NULL THEN RAISE EXCEPTION 'review_mark_set: no entity context' USING ERRCODE = '42501'; END IF;
  IF p_by_entity IS DISTINCT FROM v_caller THEN RAISE EXCEPTION 'review_mark_set: claimed writer % is not the caller %', p_by_entity, v_caller USING ERRCODE = '42501'; END IF;
  IF NOT public.review_mark_via_ok(p_via_kind, p_via_id, p_entity, p_by_entity, p_by_policy) THEN
    RAISE EXCEPTION 'review_mark_set: the door does not vouch for this writer' USING ERRCODE = '42501';
  END IF;
  -- one thread per subject and adopter, minted with the first mark
  SELECT thread_id INTO v_thread FROM review_mark WHERE entity_id = p_entity AND adopter = p_adopter AND subject_id = p_subject_id ORDER BY mark_id DESC LIMIT 1;
  IF v_thread IS NULL THEN v_thread := gen_random_uuid(); END IF;
  INSERT INTO review_mark (entity_id, adopter, subject_id, thread_id, kind, class, note, seal, seal_how, by_identity_id, by_name, by_entity_id, by_entity_name, by_policy, via_kind, via_id, batch_id)
  VALUES (p_entity, p_adopter, p_subject_id, v_thread, p_kind, p_class, p_note, p_seal, p_seal_how, p_by_identity, p_by_name, p_by_entity, p_by_entity_name, p_by_policy, p_via_kind, p_via_id, p_batch)
  RETURNING * INTO v_row;
  RETURN v_row;
END; $$;

-- the one writer of a reply in a mark's thread
CREATE OR REPLACE FUNCTION public.review_mark_post(
  p_thread uuid, p_sender_entity uuid, p_sender_name text, p_text text, p_msg_type text, p_via_kind text, p_via_id text, p_by_policy text, p_message_id uuid)
RETURNS TABLE (message_id uuid, created_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_caller  uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid;
  v_latest  review_mark;
  v_id      uuid := COALESCE(p_message_id, gen_random_uuid());
  v_now     timestamptz := now();
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'review_mark_post: no entity context' USING ERRCODE = '42501'; END IF;
  IF p_sender_entity IS DISTINCT FROM v_caller THEN RAISE EXCEPTION 'review_mark_post: claimed sender % is not the caller %', p_sender_entity, v_caller USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_latest FROM review_mark WHERE thread_id = p_thread ORDER BY mark_id DESC LIMIT 1;
  -- the same words for "no such thread" and "not yours": the door check decides, so a stranger learns nothing
  IF v_latest.mark_id IS NULL OR NOT public.review_mark_via_ok(p_via_kind, p_via_id, v_latest.entity_id, p_sender_entity, p_by_policy) THEN
    RAISE EXCEPTION 'review_mark_post: no such thread, or it is not yours' USING ERRCODE = '42501';
  END IF;
  IF v_latest.class NOT IN ('open', 'hold') THEN RAISE EXCEPTION 'review_mark_post: the thread is closed' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO chit_messages (message_id, entity_id, chit_id, subject_type, subject_id, sender_entity_id, sender_display_name, thread_type, visibility_entity_id, message_text, msg_type, is_dispute, dispute_id, created_at)
  VALUES (v_id, v_latest.entity_id, NULL, 'mark', p_thread, p_sender_entity, COALESCE(p_sender_name, ''), 'external', NULL, p_text, COALESCE(p_msg_type, 'info'), false, NULL, v_now);
  RETURN QUERY SELECT v_id, v_now;
END; $$;

REVOKE ALL ON FUNCTION public.review_mark_set(uuid, text, text, text, text, text, jsonb, text, uuid, text, uuid, text, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_mark_post(uuid, uuid, text, text, text, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_mark_via_ok(text, text, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_mark_set(uuid, text, text, text, text, text, jsonb, text, uuid, text, uuid, text, text, text, text, uuid) TO cb_app;
GRANT EXECUTE ON FUNCTION public.review_mark_post(uuid, uuid, text, text, text, text, text, text, uuid) TO cb_app;
GRANT EXECUTE ON FUNCTION public.review_mark_via_ok(text, text, uuid, uuid, text) TO cb_app;
COMMIT;
