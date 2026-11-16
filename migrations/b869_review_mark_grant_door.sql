-- b869_review_mark_grant_door.sql — MARK & QUERY (CAP-25, 15 Nov 2026), the DOOR of the books' access grant: review_mark_via_ok learns the via_kind 'grant' (critic 3 and 6 of the design: the setter check lives in SQL, and the core file b868 holds no books word).
--
-- ⚠️ NOT RUN on production · Athi runs it, SIT first, AFTER b863 (books_access_grant), b866 (the adviser preset) and b868 (the core). Safe to repeat (CREATE OR REPLACE). It touches no row.
--    Until it runs, only via_kind 'self' is vouched for: a reviewer from another business is refused by review_mark_set (the api answers 503 MARK_NOT_SWITCHED_ON when this file is absent and a grant door is asked).
-- WHAT IT DOES. A write through a grant (via_kind 'grant', via_id = the grant id) is vouched for only when, at this very statement:
--    the grant is LIVE (not revoked, not expired by the database clock) · grantor_entity = the row's entity (the books' owner) · grantee_entity = the writer's own entity (the trusted session scope, checked by the caller)
--    · the grant's preset is the one the policy names ('grant:auditor' needs an auditor grant, 'grant:adviser' an adviser grant).
--    A 'self' door for a policy that names a grant is refused: an owner cannot write a reviewer's mark by calling the function himself.
--    ⚠️ The network edge (the parent link the grant is live under) is read by the api look (lib/books-grant), in the SAME transaction as the insert; this function does not re-read the edge.
-- OWNER: lib/review-mark.js · lib/mark-policies.js · middleware/books-grant.js (the marks front).
-- ROLL BACK: re-run the function body of b868 (review_mark_via_ok, self only).
-- CHECK (read-only, all-true multi-row block):
--    SELECT 'door function is the grant one' AS what, (SELECT prosrc LIKE '%books_access_grant%' FROM pg_proc WHERE proname = 'review_mark_via_ok') AS ok;

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.review_mark_via_ok(p_via_kind text, p_via_id text, p_entity uuid, p_by_entity uuid, p_by_policy text) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_preset text := NULLIF(split_part(COALESCE(p_by_policy, ''), ':', 2), '');
  v_ok     boolean;
BEGIN
  IF p_via_kind = 'self' THEN
    RETURN p_entity = p_by_entity AND COALESCE(p_by_policy, '') NOT LIKE 'grant:%';
  END IF;
  IF p_via_kind = 'grant' THEN
    IF v_preset IS NULL OR p_via_id IS NULL OR p_via_id !~ '^[0-9a-fA-F-]{36}$' THEN RETURN false; END IF;
    SELECT true INTO v_ok FROM books_access_grant g
     WHERE g.grant_id = p_via_id::uuid AND g.grantor_entity = p_entity AND g.grantee_entity = p_by_entity
       AND g.preset = v_preset AND g.revoked_at IS NULL AND g.expires_at > now();
    RETURN COALESCE(v_ok, false);
  END IF;
  RETURN false;
END; $$;
REVOKE ALL ON FUNCTION public.review_mark_via_ok(text, text, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_mark_via_ok(text, text, uuid, uuid, text) TO cb_app;
COMMIT;
