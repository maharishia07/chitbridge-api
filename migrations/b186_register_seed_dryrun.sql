-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b186 (DRY RUN) — what b185 actually left in THIS database.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- READS ONLY. Nothing here changes anything.
--
-- ⚠️ CATALOG ONLY — it never says `FROM register_attachable`. The first version of this file did, and it died
-- with 42P01 on the very question it was asked to answer. A script that checks whether a table is usable must
-- not assume the table is there.
--
-- ⚠️⚠️ AND IT DISAGREES WITH THE APP, WHICH IS THE POINT. The deployed API ran a plain SELECT against
-- register_attachable and got zero rows back — no error. The SQL editor says the relation does not exist. Both
-- cannot be true of one database, so this reports the SCHEMA each table lives in and what the app role may read,
-- which is what tells the two apart.
--
-- ONE result set. One row per register table found, anywhere in the database.

SELECT
  c.relname                                             AS table_name,
  n.nspname                                             AS lives_in_schema,
  pg_get_userbyid(c.relowner)                           AS owned_by,
  c.relrowsecurity                                      AS rls_on,
  /* ⚠️ THE PRIVILEGE THAT DECIDES VISIBILITY. information_schema hides a table the role cannot read at all,
     which is how "never created" and "created but never granted" become the same answer to the app. */
  has_table_privilege('cb_app', c.oid, 'SELECT')        AS cb_app_can_select,
  /* Row count without naming the table in SQL — works whether or not it exists, and across schemas. */
  (xpath('/row/c/text()',
         query_to_xml('SELECT count(*) AS c FROM ' || quote_ident(n.nspname) || '.' || quote_ident(c.relname),
                      false, true, '')))[1]::text::bigint AS rows_now,
  CASE c.relname WHEN 'register_attachable' THEN 12 ELSE NULL END AS rows_expected,
  /* Does register_subject.type_key actually point at the registry? 0 = CREATE TABLE IF NOT EXISTS skipped it. */
  (SELECT count(*) FROM pg_constraint k
    WHERE k.conrelid = c.oid AND k.contype = 'f'
      AND k.confrelid = to_regclass('register_attachable'))          AS fk_to_registry
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND c.relname IN ('register_attachable', 'register_subject', 'register_entry',
                    'register_template', 'register_acceptance', 'register_entry_standard',
                    'register_template_standard', 'chit_line_raida')
ORDER BY c.relname, n.nspname;
