-- RUN-2026-10-20-3 · DB-78 · a NEW table starts add-only for the app
-- Why: migration_b48 set default privileges so every new public table gives cb_app UPDATE and DELETE. A later
-- "GRANT SELECT, INSERT" never takes them away, so add-only tables were born changeable (DB-4 had to revoke 10 of them).
-- After this: a new table gives cb_app SELECT and INSERT only. A migration that needs UPDATE or DELETE grants it
-- explicitly for that table (cb-db checks this, DB-79). Existing tables are NOT changed.
-- Run in the Supabase SQL editor as postgres. Safe to run again. Changes rights only, no rows.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE UPDATE, DELETE, TRUNCATE ON TABLES FROM cb_app;

-- PASTE THIS RESULT BACK (read-only): one row per default rule for cb_app. Expect the public/tables row to read
-- privileges = 'ar' (a = INSERT, r = SELECT) with no w (UPDATE) or d (DELETE).
SELECT pg_get_userbyid(d.defaclrole) AS for_role,
       n.nspname                      AS schema,
       CASE d.defaclobjtype WHEN 'r' THEN 'tables' WHEN 'S' THEN 'sequences' WHEN 'f' THEN 'functions' ELSE d.defaclobjtype::text END AS kind,
       substring(a::text from 'cb_app=([a-zA-Z*]*)/')  AS privileges
  FROM pg_default_acl d
  LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
  CROSS JOIN LATERAL unnest(d.defaclacl) AS a
 WHERE a::text LIKE 'cb_app=%'
 ORDER BY 1, 2, 3;
