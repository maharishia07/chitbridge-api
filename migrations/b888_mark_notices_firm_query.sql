-- b888_mark_notices_firm_query.sql — THE FIRM HEARS ITS OWN QUERIES (VOLUME walk 20 Nov, C-06 / B-06-partnerB / B-06-partnerC; 20 Nov 2026).
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres), SIT first. Safe to repeat (CREATE OR REPLACE of the one function, no table, no row touched). RUN AFTER b877.
-- The api is correct BEFORE and AFTER: before it the bell is as it was (the client side hears a Query; the firm side does not).
-- WHAT IT DOES. mark_notices(days, max, p_internal) gains ONE arm, 'mq:<mark_id>' (shaped as the existing query notice, so the bell paints it as a Query and names the client):
--   a Query (class open, adopter acc.audit) raised on a client's books, where the reader's organisation holds a LIVE grant on that client, rings
--     · the organisation's owner login (the firm PARTNER: v_actor = v_caller), and
--     · the person who HOLDS that client (an open 'client' job chit of the firm, assigned to the reader: the same read as lib/assign-register heldFrom),
--   never the raiser (by_identity_id <> reader). Clearing and removal use the same md5(notice_id) / 'removed' rules as the client-side query notice (the id is 3 characters + the mark id).
-- Everything else in the function is b877's body, unchanged.
-- ROLL BACK: re-run migrations/b877_firm_messaging.sql section 3 (it drops and recreates the function without this arm).
-- CHECK: SELECT 'has firm arm' AS what, prosrc LIKE '%''mq:''%' AS ok FROM pg_proc WHERE proname = 'mark_notices' AND pronargs = 3;

BEGIN;
SET LOCAL lock_timeout = '5s';

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
      -- ⭐ b888: a Query raised on a CLIENT's books by a person of a firm that holds a live grant on that client (this firm's reviewer, or another firm's) rings the firm's PARTNER (the organisation's owner login) and the person who HOLDS that client (the open 'client' job chit's holder); never the raiser's own bell
      UNION ALL
      SELECT 'mq:' || m.mark_id::text, 'query'::text, m.at, m.by_name, m.note, m.subject_id, m.entity_id, m.entity_id, NULL::text
        FROM review_mark m
       WHERE m.entity_id <> v_caller AND m.class = 'open' AND m.adopter = 'acc.audit'
         AND m.at > now() - make_interval(days => GREATEST(p_days, 1))
         AND v_actor IS NOT NULL AND m.by_identity_id <> v_actor
         AND NOT EXISTS (SELECT 1 FROM review_mark rm WHERE rm.entity_id = m.entity_id AND rm.adopter = 'acc.audit' AND rm.subject_id = m.subject_id AND rm.class = 'removed' AND rm.mark_id > m.mark_id)  -- a removed Query is no news (the shared leftOutSql runs on the reader's own books, a definer reads the client's)
         AND EXISTS (SELECT 1 FROM books_access_grant g WHERE g.grantor_entity = m.entity_id AND g.grantee_entity = v_caller AND g.revoked_at IS NULL AND g.expires_at > now())
         AND (v_actor = v_caller
              OR EXISTS (SELECT 1 FROM chit_status cs
                           JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id
                           CROSS JOIN LATERAL jsonb_array_elements(ch.all_recipients) r
                          WHERE cs.entity_id = v_caller AND cs.direction = 'sent' AND cs.assigned_to_actor_id = v_actor AND cs.deleted_at IS NULL
                            AND cs.current_status NOT IN ('completed', 'cancelled', 'rejected')
                            AND ch.business_json -> 'job' ->> 'plug' = 'client' AND r ->> 'role' IS DISTINCT FROM 'sender' AND r ->> 'entity_id' = m.entity_id::text))
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

COMMIT;
