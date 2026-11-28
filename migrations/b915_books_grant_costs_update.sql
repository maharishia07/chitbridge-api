-- b915_books_grant_costs_update.sql — firm-connect-1138 (UX-220, 28 Nov 2026): the owner may change, on a LIVE grant, whether the firm sees costs and margins.
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres), SIT first, AFTER b863 and b866. Safe to repeat (GRANT is idempotent). It adds no column, no table and rewrites no row.
--    The api is correct BEFORE and AFTER this file runs: until it runs, a costs change answers 503 BOOKS_GRANT_NOT_SWITCHED_ON in words ("Changing what your firm sees is not switched on yet") and nothing changes;
--    the end date and who posts keep working. A change in the other direction is not blocked by anything else: the same UPDATE, the same privilege.
-- NUMBER. b911 is the last file on main (b910 chit_summary index, b911 signin provider bind); the number b915 was named by the coordinator (b912-b914 are not on main: git ls-tree origin/main, 28 Nov). Rename before landing if another round took it.
-- LOOKED AT (DISCIPLINES 4a): books_access_grant (b863 + b866, the same table: no new table, no new column); access_events (the change is recorded by the existing 'books_grant_changed' row, before and after, in the SAME
--    transaction: lib/access-events.record), so the CHECK on access_events.action is NOT touched.
-- WHAT IT DOES. GRANT UPDATE (can_see_costs) ON books_access_grant TO cb_app. The grantor-only row policy grant_update (b863) already decides WHO may write; this only opens the column.
--    A RISE (no to yes) is enforced on the SERVER (lib/books-grant.js changeCosts: consent: true, else 422 BOOKS_GRANT_CONSENT_NEEDED); the database does not know the consent, it only opens the column.
-- PRIVILEGE MATRIX AFTER b863 + b866 + b915 (cb_app, column UPDATE on books_access_grant): expires_at, revoked_at, revoked_by, posting, posting_cap_minor, posting_cap_currency, can_see_costs — and NO table-level UPDATE,
--    never grantor_entity, grantee_entity, preset, purpose, granted_by, granted_at. The self-test below is the b863 test WIDENED to the whole matrix (it also runs as tests/firm-connect-1138.realstack.cjs).
-- ROLL BACK: REVOKE UPDATE (can_see_costs) ON books_access_grant FROM cb_app;
-- CHECK (read-only, all-true multi-row block; every row must read ok = true):
--    SELECT 'grant: no table-level UPDATE for cb_app' AS what, NOT has_table_privilege('cb_app', 'public.books_access_grant', 'UPDATE') AS ok
--    UNION ALL SELECT 'grant: UPDATE on can_see_costs', has_column_privilege('cb_app', 'public.books_access_grant', 'can_see_costs', 'UPDATE')
--    UNION ALL SELECT 'grant: UPDATE on the end date and the revoke columns', has_column_privilege('cb_app', 'public.books_access_grant', 'expires_at', 'UPDATE') AND has_column_privilege('cb_app', 'public.books_access_grant', 'revoked_at', 'UPDATE') AND has_column_privilege('cb_app', 'public.books_access_grant', 'revoked_by', 'UPDATE')
--    UNION ALL SELECT 'grant: UPDATE on the posting columns (b866)', has_column_privilege('cb_app', 'public.books_access_grant', 'posting', 'UPDATE') AND has_column_privilege('cb_app', 'public.books_access_grant', 'posting_cap_minor', 'UPDATE') AND has_column_privilege('cb_app', 'public.books_access_grant', 'posting_cap_currency', 'UPDATE')
--    UNION ALL SELECT 'grant: NO UPDATE on who, what role, why', NOT has_column_privilege('cb_app', 'public.books_access_grant', 'grantor_entity', 'UPDATE') AND NOT has_column_privilege('cb_app', 'public.books_access_grant', 'grantee_entity', 'UPDATE') AND NOT has_column_privilege('cb_app', 'public.books_access_grant', 'preset', 'UPDATE') AND NOT has_column_privilege('cb_app', 'public.books_access_grant', 'purpose', 'UPDATE') AND NOT has_column_privilege('cb_app', 'public.books_access_grant', 'granted_by', 'UPDATE') AND NOT has_column_privilege('cb_app', 'public.books_access_grant', 'granted_at', 'UPDATE')
--    UNION ALL SELECT 'grant: no DELETE', NOT has_table_privilege('cb_app', 'public.books_access_grant', 'DELETE')
--    UNION ALL SELECT 'log still insert-only', NOT has_table_privilege('cb_app', 'public.books_access_log', 'UPDATE') AND NOT has_table_privilege('cb_app', 'public.books_access_log', 'DELETE');
-- RLS: unchanged (b863: ENABLE + FORCE; grant_update is for the grantor only). No new table.

BEGIN;
GRANT UPDATE (can_see_costs) ON books_access_grant TO cb_app;
COMMIT;
