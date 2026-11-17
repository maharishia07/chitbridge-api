-- b877_firm_messaging.sql — FIRM MESSAGING slices D (colleague bell) and A (firm-internal thread on a private note), 17 Nov 2026 (REQ-FIRM-MESSAGING eb21449b, critic 5a0a9b37 findings D1-D5, A1-A3).
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres), SIT first through the box's migrate step. Safe to repeat. RUN AFTER b868, b870 and b876. New nullable column, one trigger, two functions replaced; no existing row is touched (no backfill).
-- The api is correct BEFORE and AFTER this file runs: before it, a colleague's reply does not ring (as today), the badge stays per organisation, and a reply on a note answers 503 in words.
-- WHAT IT DOES
--   1. chit_messages.sender_identity_id (nullable uuid) + trigger chit_messages_stamp_person: for subject_type 'mark' and 'flag' ONLY, a BEFORE INSERT trigger overwrites it with the session's person (app.current_actor, blank = NULL). A caller can never name another person;
--      review_mark_post and every writer stay as they are; the document (chit) thread is untouched. Old rows keep NULL: they behave by the organisation rule (no flood of old notices on the day this lands).
--   2. chit_messages_subject_ck widened by the flag clause, which is also the database's wall: a flag message is internal, in its writer's own organisation, with no chit
--      (subject_type = 'flag' AND chit_id IS NULL AND subject_id IS NOT NULL AND thread_type = 'internal' AND sender_entity_id = entity_id). GUARDED: skipped when the present definition already holds 'flag';
--      b868's own block is guarded the same way, so a re-run of b868 can no longer narrow the check.
--   3. mark_notices(days, max, p_internal) replaces the two-parameter b870 function (RETURNS TABLE gains client_name, client_id and label):
--      · the reader's OWN words never ring (the person rule: a row from the reader's organisation rings only when its person is known, is not the reader, and the reader is in the thread or is the organisation's owner login); a row without a person falls to the old organisation rule
--      · the firm side widens to a colleague's reply, still only while the grant the firm marked under is live
--      · the notice names the client (identities.display_name of the record's owner) when it is not the reader's own organisation
--      · the flag arm (internal notes) is INSIDE this function, one notice path: it runs only when the api says p_internal (the api's own right to read notes) AND restates the walls itself, because a definer skips row security:
--        entity = the reader's, visibility 'org', note not removed, a person present. It rings the note's author, the people who replied, and the owner login; never the writer of the row.
--   4. notif_mark_seen() stamps the PERSON's own identities.notif_seen_at (the actor's row when it is the organisation or one of its people, else the organisation's row); the api reads COALESCE(person, organisation), so no badge floods on landing day.
--      Known edge: the owner login IS the organisation's row, so the owner opening the bell also moves the fallback of a colleague who has never opened it (that colleague's own first open then takes over).
-- RLS: no table is added. chit_messages keeps its rls_entity wall; the trigger and the constraint are the extra walls. rls-census: unchanged (no new table, no policy touched).
-- OWNER: lib/mark-notices.js · routes/notifications.js (bell) · lib/message-post.js · lib/private-flag.js (flag replies).
-- ROLL BACK (loses nothing else; flag replies, if any were written, must be deleted first because the old constraint refuses them):
--    DELETE FROM chit_messages WHERE subject_type = 'flag';   -- as postgres, only if rolling back after replies exist
--    DROP TRIGGER IF EXISTS chit_messages_stamp_person ON chit_messages;  DROP FUNCTION IF EXISTS public.chit_messages_stamp_person();
--    ALTER TABLE chit_messages DROP CONSTRAINT chit_messages_subject_ck;
--    ALTER TABLE chit_messages ADD CONSTRAINT chit_messages_subject_ck CHECK ((subject_type = 'chit' AND chit_id IS NOT NULL AND subject_id IS NULL) OR (subject_type = 'product' AND chit_id IS NULL AND subject_id IS NOT NULL) OR (subject_type = 'mark' AND chit_id IS NULL AND subject_id IS NOT NULL));
--    ALTER TABLE chit_messages DROP COLUMN IF EXISTS sender_identity_id;   DROP INDEX IF EXISTS chit_messages_flag_idx;
--    then re-run b870 (the two-parameter mark_notices) and restore notif_mark_seen() from migrations/000_baseline_2026-10-21.sql (one watermark per organisation).
-- CHECK (read-only, all-true block; every row must read ok = true):
--    SELECT 'column' AS what, count(*) = 1 AS ok FROM information_schema.columns WHERE table_name = 'chit_messages' AND column_name = 'sender_identity_id'
--    UNION ALL SELECT 'stamp trigger', count(*) = 1 FROM pg_trigger WHERE tgrelid = 'public.chit_messages'::regclass AND tgname = 'chit_messages_stamp_person'
--    UNION ALL SELECT 'check holds flag and mark', (SELECT pg_get_constraintdef(oid) LIKE '%''flag''%' AND pg_get_constraintdef(oid) LIKE '%''mark''%' FROM pg_constraint WHERE conname = 'chit_messages_subject_ck' AND conrelid = 'public.chit_messages'::regclass)
--    UNION ALL SELECT 'check validated', (SELECT convalidated FROM pg_constraint WHERE conname = 'chit_messages_subject_ck' AND conrelid = 'public.chit_messages'::regclass)
--    UNION ALL SELECT 'mark_notices has p_internal', count(*) = 1 FROM pg_proc WHERE proname = 'mark_notices' AND pronargs = 3
--    UNION ALL SELECT 'no old two-parameter mark_notices', count(*) = 0 FROM pg_proc WHERE proname = 'mark_notices' AND pronargs = 2
--    UNION ALL SELECT 'notif_mark_seen is per person', (SELECT prosrc LIKE '%current_actor%' FROM pg_proc WHERE proname = 'notif_mark_seen');

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. the person on a mark or flag message, stamped by the database
ALTER TABLE chit_messages ADD COLUMN IF NOT EXISTS sender_identity_id uuid;
COMMENT ON COLUMN chit_messages.sender_identity_id IS 'The PERSON who wrote a mark or flag message: stamped by the chit_messages_stamp_person trigger from app.current_actor, never by a caller. NULL on older rows and on a session with no person.';

CREATE OR REPLACE FUNCTION public.chit_messages_stamp_person() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.subject_type IN ('mark', 'flag') THEN
    NEW.sender_identity_id := NULLIF(current_setting('app.current_actor', true), '')::uuid;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS chit_messages_stamp_person ON chit_messages;
CREATE TRIGGER chit_messages_stamp_person BEFORE INSERT ON chit_messages FOR EACH ROW EXECUTE FUNCTION public.chit_messages_stamp_person();

-- 2. the check, widened for the flag, guarded (never narrowed, never rewritten when it already holds 'flag')
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chit_messages_subject_ck' AND conrelid = 'public.chit_messages'::regclass AND pg_get_constraintdef(oid) LIKE '%''flag''%') THEN
    ALTER TABLE chit_messages DROP CONSTRAINT IF EXISTS chit_messages_subject_ck;
    ALTER TABLE chit_messages ADD CONSTRAINT chit_messages_subject_ck CHECK (
         (subject_type = 'chit'    AND chit_id IS NOT NULL AND subject_id IS NULL)
      OR (subject_type = 'product' AND chit_id IS NULL     AND subject_id IS NOT NULL)
      OR (subject_type = 'mark'    AND chit_id IS NULL     AND subject_id IS NOT NULL)
      OR (subject_type = 'flag'    AND chit_id IS NULL     AND subject_id IS NOT NULL AND thread_type = 'internal' AND sender_entity_id = entity_id)) NOT VALID;
  END IF;
END $$;
ALTER TABLE chit_messages VALIDATE CONSTRAINT chit_messages_subject_ck;
CREATE INDEX IF NOT EXISTS chit_messages_flag_idx ON chit_messages (entity_id, subject_id, created_at) WHERE subject_type = 'flag';

-- 3. the bell: one read function, the person rule, the client's name, the internal arm
DROP FUNCTION IF EXISTS public.mark_notices(integer, integer);
DROP FUNCTION IF EXISTS public.mark_notices(integer, integer, boolean);
CREATE OR REPLACE FUNCTION public.mark_notices(p_days integer, p_max integer, p_internal boolean DEFAULT false)
RETURNS TABLE (notice_id text, notice_kind text, at timestamptz, by_name text, note text, subject_id text, entry_no text, posting_date date, currency text, total_minor bigint, client_name text, client_id text, label text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_caller uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid;
  v_actor  uuid := NULLIF(current_setting('app.current_actor', true), '')::uuid;
BEGIN
  IF v_caller IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT x.notice_id, x.notice_kind, x.at, x.by_name, x.note, x.subject_id, je.entry_no, je.posting_date, je.currency, je.total_minor,
         CASE WHEN x.name_entity IS DISTINCT FROM v_caller THEN (SELECT i.display_name::text FROM identities i WHERE i.identity_id = x.name_entity) END,
         CASE WHEN x.name_entity IS DISTINCT FROM v_caller THEN x.name_entity::text END,  -- the client's entity id beside its name (the bell opens the client's Day book by it, never by a name two clients may share); null on my own books
         x.label
    FROM (
      -- a Query an outside reviewer raised on MY books
      SELECT 'mk:' || m.mark_id::text AS notice_id, 'query'::text AS notice_kind, m.at AS at, m.by_name AS by_name, m.note AS note, m.subject_id AS subject_id,
             m.entity_id AS rec_entity, m.entity_id AS name_entity, NULL::text AS label
        FROM review_mark m
       WHERE m.entity_id = v_caller AND m.by_entity_id <> v_caller AND m.class = 'open' AND m.adopter = 'acc.audit'
         AND m.at > now() - make_interval(days => GREATEST(p_days, 1))
      UNION ALL
      -- a reply in a thread: never my own words (the person rule); a colleague's only when I am in the thread or I am the owner login
      SELECT 'mr:' || c.message_id::text, 'reply'::text, c.created_at, NULLIF(c.sender_display_name, ''), c.message_text, t.subject_id, t.entity_id, t.entity_id, NULL::text
        FROM chit_messages c
        JOIN LATERAL (SELECT r.entity_id, r.subject_id, r.by_entity_id FROM review_mark r WHERE r.thread_id = c.subject_id ORDER BY r.mark_id DESC LIMIT 1) t ON true
       WHERE c.subject_type = 'mark'
         AND c.entity_id = t.entity_id  -- the reply copy lives in the thread owner's entity (review_mark_post): a definer reads every entity, so a row another organisation planted in its own entity is no notice (17 Nov attack run)
         AND (c.sender_entity_id <> v_caller
              OR (c.sender_identity_id IS NOT NULL AND v_actor IS NOT NULL AND c.sender_identity_id <> v_actor
                  AND (v_actor = v_caller
                       OR EXISTS (SELECT 1 FROM review_mark o WHERE o.thread_id = c.subject_id AND o.by_identity_id = v_actor)
                       OR EXISTS (SELECT 1 FROM chit_messages p WHERE p.subject_type = 'mark' AND p.subject_id = c.subject_id AND p.sender_identity_id = v_actor))))
         AND (t.entity_id = v_caller
              OR ((c.sender_entity_id = t.entity_id OR c.sender_entity_id = v_caller)
                  AND EXISTS (SELECT 1 FROM review_mark o JOIN books_access_grant g ON g.grantor_entity = t.entity_id AND g.grantee_entity = v_caller AND g.preset = NULLIF(split_part(COALESCE(o.by_policy, ''), ':', 2), '') AND g.revoked_at IS NULL AND g.expires_at > now()
                               WHERE o.thread_id = c.subject_id AND o.by_entity_id = v_caller)))
         AND c.created_at > now() - make_interval(days => GREATEST(p_days, 1))
      UNION ALL
      -- a reply on my firm's own internal note: only when the api says the caller may read notes; the walls restated here, a definer skips row security
      SELECT 'fl:' || c.message_id::text, 'internal'::text, c.created_at, NULLIF(c.sender_display_name, ''), c.message_text, f.subject_id,
             NULL::uuid, f.subject_entity, f.label
        FROM chit_messages c
        JOIN private_flag f ON f.thread_id = c.subject_id
       WHERE p_internal AND v_actor IS NOT NULL
         AND c.subject_type = 'flag' AND c.entity_id = v_caller AND c.sender_entity_id = v_caller
         AND f.entity_id = v_caller AND f.kind = 'note' AND f.visibility = 'org' AND f.state <> 'removed'
         AND (c.sender_identity_id IS NULL OR c.sender_identity_id <> v_actor)
         AND (v_actor = v_caller
              OR f.author_identity_id = v_actor
              OR EXISTS (SELECT 1 FROM chit_messages p WHERE p.subject_type = 'flag' AND p.subject_id = c.subject_id AND p.sender_identity_id = v_actor))
         AND c.created_at > now() - make_interval(days => GREATEST(p_days, 1))
    ) x
    LEFT JOIN journal_entry je ON je.entity_id = x.rec_entity AND je.entry_id::text = x.subject_id
   ORDER BY x.at DESC
   LIMIT GREATEST(p_max, 1);
END; $$;

REVOKE ALL ON FUNCTION public.mark_notices(integer, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_notices(integer, integer, boolean) TO cb_app;

-- 4. "seen" per person: the actor's own row when it is the organisation or one of its people, else the organisation's row (a blank actor = today's behaviour)
CREATE OR REPLACE FUNCTION public.notif_mark_seen() RETURNS timestamp with time zone
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_me    uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid;
  v_actor uuid := NULLIF(current_setting('app.current_actor', true), '')::uuid;
  v_who   uuid;
  v_at    timestamptz := now();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'notif_mark_seen: no entity context — call inside withEntity(me)';
  END IF;
  v_who := v_me;
  IF v_actor IS NOT NULL AND v_actor <> v_me AND EXISTS (SELECT 1 FROM identities i WHERE i.identity_id = v_actor AND i.parent_entity_id = v_me) THEN
    v_who := v_actor;
  END IF;
  UPDATE identities SET notif_seen_at = v_at WHERE identity_id = v_who;
  RETURN v_at;
END $$;

COMMIT;
