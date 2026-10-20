-- RUN-2026-10-20-4 · DB-77 (part 2) · definition_version: the app keeps UPDATE on `rules` only
-- Why: RUN-2026-10-20-2's read-back showed cb_app already held UPDATE on the WHOLE table (table_update true).
-- The api changes only `rules` (lib/slab-cites.js:40, routes/testing.js:263); every other write is an INSERT of a new
-- version, and nothing deletes. Checked on origin/main 676a5c44, 20 Oct.
-- Order matters: revoking the table-level UPDATE also removes column UPDATE grants, so the column grant comes after.
-- Run in the Supabase SQL editor as postgres. Safe to run again. Changes rights only, no rows.

REVOKE UPDATE, DELETE, TRUNCATE ON public.definition_version FROM cb_app;
GRANT  UPDATE (rules)           ON public.definition_version TO   cb_app;

-- PASTE THIS RESULT BACK (read-only): expect can_update_rules true, can_update_note false, table_update false, can_delete false
SELECT has_column_privilege('cb_app', 'public.definition_version', 'rules', 'UPDATE') AS can_update_rules,
       has_column_privilege('cb_app', 'public.definition_version', 'note',  'UPDATE') AS can_update_note,
       has_table_privilege ('cb_app', 'public.definition_version', 'UPDATE')          AS table_update,
       has_table_privilege ('cb_app', 'public.definition_version', 'DELETE')          AS can_delete;
