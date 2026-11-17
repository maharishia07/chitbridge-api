-- b275_check.sql — ONE ROW after running migrations/b275_folder_views.sql (as postgres).
-- Expected: has_kind = t | kind_default = 'filed'::text | has_check = t | rls_forced = t | nullif_policy = t | not_filed = 0
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'folder' AND column_name = 'kind')            AS has_kind,
  (SELECT column_default FROM information_schema.columns WHERE table_name = 'folder' AND column_name = 'kind')         AS kind_default,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'folder_kind_chk')                                              AS has_check,
  (SELECT relforcerowsecurity FROM pg_class WHERE relname = 'folder')                                                 AS rls_forced,
  EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'folder' AND policyname = 'rls_entity' AND qual LIKE '%NULLIF%') AS nullif_policy,
  (SELECT COUNT(*) FROM folder WHERE kind <> 'filed')                                                                 AS not_filed;
