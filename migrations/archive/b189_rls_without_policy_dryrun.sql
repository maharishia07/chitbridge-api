-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b189 (DRY RUN) — every table where RLS is ON and NO POLICY EXISTS. Read-only.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠️⚠️ THE FAILURE THIS FINDS IS SILENT, WHICH IS WHY IT IS WORTH A WHOLE MIGRATION.
--
-- A table with row level security ENABLED and no policy on it returns ZERO ROWS to every role except the owner
-- — no error, no warning, no permission denied. The owner is exempt unless FORCE is also set, so it looks
-- perfect in the SQL editor (you connect as postgres) and is empty in the app (it connects as cb_app).
--
-- That is exactly what happened to register_attachable on 2026-08-30: 12 rows in the editor, an empty list in
-- the product, and a day spent looking for a seed that had run all along. b185 never enabled RLS on it — so
-- something outside our migrations did, and anything else it touched has the same silent hole.
--
-- ⭐ TWO KINDS OF ROW COME BACK, and only one is a bug:
--     needs_policy = true   → RLS on, no policy. Unreadable to the app. THIS IS THE BUG.
--     needs_policy = false  → RLS on with policies. Working as intended.
--
-- A table that legitimately holds no entity data (a platform registry like this one) wants EITHER rls off OR a
-- read-all policy. It must not sit enabled and policy-less.
--
-- ONE result set.

SELECT
  c.relname                                                   AS table_name,
  c.relrowsecurity                                            AS rls_on,
  c.relforcerowsecurity                                       AS rls_forced,
  (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
  /* ⚠️ THE COLUMN TO READ. True = the app sees nothing in this table and is told nothing. */
  (c.relrowsecurity AND NOT EXISTS
     (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid))    AS needs_policy,
  (xpath('/row/c/text()',
         query_to_xml('SELECT count(*) AS c FROM ' || quote_ident(n.nspname) || '.' || quote_ident(c.relname),
                      false, true, '')))[1]::text::bigint     AS rows_in_table
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity                       -- only tables with RLS on at all
ORDER BY needs_policy DESC, c.relname;
