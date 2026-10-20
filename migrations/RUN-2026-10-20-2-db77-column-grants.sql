-- RUN-2026-10-20-2 · DB-77 · the app may change ONE column in each of three tables, nothing more
-- Why: the code updates exactly these columns, but the grants do not allow it, so today the update fails and is only logged:
--   signup_context.country_source   routes/signin.js:636      (the app can only INSERT here; it cannot even read the row it updates)
--   ops.population.desk_entity_id   routes/entities.js:1694
--   definition_version.rules        lib/slab-cites.js:40, routes/testing.js:263
-- Column grants keep the rest of each table add-only. An UPDATE ... WHERE x = $1 also needs SELECT on x, hence the one SELECT below.
-- Run in the Supabase SQL editor as postgres. Safe to run again. Changes rights only, no rows.

GRANT SELECT (signup_context_id), UPDATE (country_source) ON public.signup_context  TO cb_app;
GRANT UPDATE (desk_entity_id)                             ON ops.population         TO cb_app;
GRANT UPDATE (rules)                                      ON public.definition_version TO cb_app;

-- PASTE THIS RESULT BACK (read-only): expect every can_* column true, and table_update false on all three
SELECT 'signup_context' AS tbl,
       has_column_privilege('cb_app', 'public.signup_context', 'country_source', 'UPDATE')     AS can_update_col,
       has_column_privilege('cb_app', 'public.signup_context', 'signup_context_id', 'SELECT') AS can_read_key,
       has_table_privilege ('cb_app', 'public.signup_context', 'UPDATE')                      AS table_update
UNION ALL
SELECT 'ops.population',
       has_column_privilege('cb_app', 'ops.population', 'desk_entity_id', 'UPDATE'),
       has_column_privilege('cb_app', 'ops.population', 'code', 'SELECT'),
       has_table_privilege ('cb_app', 'ops.population', 'UPDATE')
UNION ALL
SELECT 'definition_version',
       has_column_privilege('cb_app', 'public.definition_version', 'rules', 'UPDATE'),
       has_column_privilege('cb_app', 'public.definition_version', 'rules', 'SELECT'),
       has_table_privilege ('cb_app', 'public.definition_version', 'UPDATE');
-- table_update true on a row means the app already had UPDATE on the whole table (the grant above then changed nothing):
-- paste it anyway; Claude decides whether that table needs a REVOKE + column grant.
