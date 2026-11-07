-- b835_revoke_write_chit_line_assignment.sql — DB-86 (7 Nov 2026): chit_line_assignment is meant to be insert-only, so cb_app loses UPDATE, DELETE and TRUNCATE on it.
--
-- ⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres). Safe to re-run (a REVOKE of a right not held does nothing). Touches no rows.
--    No code waits for it: nothing in routes/, lib/, db/ or tools/ UPDATEs or DELETEs chit_line_assignment (census of 7 Nov, git grep on origin/main 6899014b).
--
-- WHY. b143: who holds a line is a CHAIN of rows, the latest seq wins and the earlier rows are the history of who held it (b154 reads that history for metrics). An UPDATE would destroy it.
--    The old default privileges (migration_b48) gave every table born before DB-78 SELECT, INSERT, UPDATE and DELETE, and this table's own
--    migration then granted all four, so production holds UPDATE and DELETE on it today (the baseline of 21 Oct is a dump of production).
--    A GRANT only adds; only a REVOKE takes away (b765-3 found the same thing on move_in_import, b767 fixed eleven tables, this is the rest).
--
-- ROLL BACK: GRANT UPDATE, DELETE ON chit_line_assignment TO cb_app;   (TRUNCATE was never held, so nothing to give back.)
-- CHECK (read-only): SELECT has_table_privilege('cb_app', 'public.chit_line_assignment', 'UPDATE') AS can_update, has_table_privilege('cb_app', 'public.chit_line_assignment', 'DELETE') AS can_delete;
--    Expect false, false.
-- RLS: unchanged. Retention: a future purge of this table runs as the owner, never as cb_app.

REVOKE UPDATE, DELETE, TRUNCATE ON chit_line_assignment FROM cb_app;
