-- b912_books_access_grant_state_view.sql — the database twin of the TIME half of a books grant's state (drift cluster 1, exit bar 5, 28 Nov 2026).
--
-- ⚠️ NOT RUN IN PRODUCTION · Athi runs it (Supabase SQL editor, AS postgres), SIT first (applied on sit-ae2 for the proof). Safe to repeat (CREATE OR REPLACE VIEW, GRANT).
-- WHY  stateOf (lib/books-grant.js) decides revoked | expired | edge_off | live in code. A raw read of books_access_grant that wants "is it open" had to write its own revoked_at / expires_at test
--      (the drift UX-218 found). This view says the time half ONCE, on the database clock, and keeps the caller's row security: security_invoker = true, so the entity policy
--      (grant_read: grantor or grantee only) still narrows every row to the caller's own, and the view takes SELECT only (no DML through it, the b902 lesson).
--      The EDGE half (is the grantee the network parent) stays in lib/books-grant.js (isGrantParentSql): a second copy of it here would be a second definition.
-- RLS: touches no table, no policy; the base table keeps FORCE ROW LEVEL SECURITY and its three policies.
-- ORDER any time; nothing depends on it yet. The api guard (tests/one-reader-tables.test.cjs) keeps raw state predicates out of the code.
-- ROLL BACK: DROP VIEW IF EXISTS public.books_access_grant_state;
-- CHECK (read-only): SELECT to_regclass('public.books_access_grant_state');   as cb_app with app.current_entity set to a stranger: 0 rows.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE VIEW public.books_access_grant_state WITH (security_invoker = true) AS
SELECT g.grant_id, g.grantor_entity, g.grantee_entity, g.preset, g.granted_at, g.expires_at, g.revoked_at,
       (g.expires_at > now()) AS unexpired,
       CASE WHEN g.revoked_at IS NOT NULL THEN 'revoked'
            WHEN g.expires_at <= now() THEN 'expired'
            ELSE 'open' END AS state_time
  FROM public.books_access_grant g;
REVOKE ALL ON public.books_access_grant_state FROM PUBLIC;
GRANT SELECT ON public.books_access_grant_state TO cb_app;
COMMIT;
