-- b870_mark_notices.sql — MARK & QUERY (CAP-25, 15 Nov 2026): the bell hears the marks. ONE read function, no table, no row touched.
--
-- ⚠️ NOT RUN on production · Athi runs it, SIT first, AFTER b868 (review_mark). Safe to repeat (DROP IF EXISTS, CREATE, GRANT re-issued). Until it runs the bell answers exactly as before (the api treats a missing function as "no mark news").
-- WHAT IT DOES. mark_notices(days, max) returns the mark news for the CALLER'S OWN business (the trusted session scope, never a parameter):
--    · the books' owner: each QUERY an outside reviewer raised on their records, and each reply a reviewer wrote in a thread on their records
--    · the reviewer's firm: each reply the owner wrote in a thread the firm's own mark opened, while the grant the firm marked under (its preset) is live (a revoked or expired grant stops the news)
--    Each row names the entry (entry no, posting date, currency, total) so the bell can say "JV-0002 · 12 Oct 2026 · A$880.00". Nothing the caller wrote rings the caller's own bell.
--    SECURITY DEFINER because the firm cannot read the owner's rows under row security; the answer is limited to threads the caller owns or opened.
-- OWNER: lib/mark-notices.js · routes/notifications.js.
-- ROLL BACK: DROP FUNCTION public.mark_notices(integer, integer);
-- CHECK: SELECT 'function is there' AS what, EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'mark_notices') AS ok;

BEGIN;
SET LOCAL lock_timeout = '5s';

-- RETURNS TABLE: dropped first so a re-run can change its columns; the GRANT below is re-issued
DROP FUNCTION IF EXISTS public.mark_notices(integer, integer);
CREATE OR REPLACE FUNCTION public.mark_notices(p_days integer, p_max integer)
RETURNS TABLE (notice_id text, notice_kind text, at timestamptz, by_name text, note text, subject_id text, entry_no text, posting_date date, currency text, total_minor bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_caller uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid;
BEGIN
  IF v_caller IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT x.notice_id, x.notice_kind, x.at, x.by_name, x.note, x.subject_id, je.entry_no, je.posting_date, je.currency, je.total_minor
    FROM (
      SELECT 'mk:' || m.mark_id::text AS notice_id, 'query'::text AS notice_kind, m.at AS at, m.by_name AS by_name, m.note AS note, m.subject_id AS subject_id, m.entity_id AS rec_entity
        FROM review_mark m
       WHERE m.entity_id = v_caller AND m.by_entity_id <> v_caller AND m.class = 'open' AND m.adopter = 'acc.audit'
         AND m.at > now() - make_interval(days => GREATEST(p_days, 1))
      UNION ALL
      SELECT 'mr:' || c.message_id::text, 'reply'::text, c.created_at, NULLIF(c.sender_display_name, ''), c.message_text, t.subject_id, t.entity_id
        FROM chit_messages c
        JOIN LATERAL (SELECT r.entity_id, r.subject_id, r.by_entity_id FROM review_mark r WHERE r.thread_id = c.subject_id::uuid ORDER BY r.mark_id DESC LIMIT 1) t ON true
       WHERE c.subject_type = 'mark' AND c.sender_entity_id <> v_caller
         AND (t.entity_id = v_caller
              OR (c.sender_entity_id = t.entity_id AND EXISTS (SELECT 1 FROM review_mark o JOIN books_access_grant g ON g.grantor_entity = t.entity_id AND g.grantee_entity = v_caller AND g.preset = NULLIF(split_part(COALESCE(o.by_policy, ''), ':', 2), '') AND g.revoked_at IS NULL AND g.expires_at > now()
                          WHERE o.thread_id = c.subject_id::uuid AND o.by_entity_id = v_caller)))
         AND c.created_at > now() - make_interval(days => GREATEST(p_days, 1))
    ) x
    LEFT JOIN journal_entry je ON je.entity_id = x.rec_entity AND je.entry_id::text = x.subject_id
   ORDER BY x.at DESC
   LIMIT GREATEST(p_max, 1);
END; $$;

REVOKE ALL ON FUNCTION public.mark_notices(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_notices(integer, integer) TO cb_app;

COMMIT;
