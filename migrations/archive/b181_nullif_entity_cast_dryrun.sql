-- b181 · DRY RUN · which RLS policies would raise 22P02 when no entity is bound
--
-- READ-ONLY. This changes nothing. Run it in the Supabase SQL editor; it returns ONE result set.
--
-- WHY
--   withEntity(null, ...) is a deliberate, live path: it is how the PUBLIC storefront reads, because an
--   anonymous visitor has no tenant. routes/catalogue.js says so itself -- "withEntity(null) = no tenant
--   context, so the visibility-aware policy returns only public items".
--
--   set_config then stores '' for the entity. A policy written as
--       entity_id = current_setting('app.current_entity', true)::uuid
--   evaluates ''::uuid and Postgres raises 22P02 invalid input syntax for type uuid. The anonymous read does
--   not come back EMPTY -- it ERRORS.
--
--   NULLIF(current_setting('app.current_entity', true), '')::uuid fails CLOSED instead: entity_id = NULL is
--   NULL, not true, so the row is simply invisible. That is what "no tenant context" should mean, and what
--   the policies that already guard it do.
--
-- WHY IT IS A DRY RUN FIRST
--   The migration FILES say 30 unguarded casts in 13 files, but files are not the database. A policy may have
--   been replaced by a later migration, applied by hand, or never applied at all. This reads pg_policies, so
--   the answer is about the database that is actually serving.
--
--   And the fix DROPs and re-CREATEs RLS policies, which is the mechanism that keeps tenants apart. Nothing
--   should be generated and executed against that from a pattern match. The apply will be hand-written from
--   this output, one policy at a time, so every statement can be read before it runs.
--
-- READING IT
--   verdict = UNGUARDED  -> this policy raises 22P02 when no entity is bound
--   verdict = guarded    -> already correct, left alone
--   expression           -> the live USING / WITH CHECK text, which is what the apply must reproduce exactly

SELECT
  p.tablename                                                        AS table_name,
  p.policyname                                                       AS policy_name,
  p.cmd                                                              AS command,
  CASE
    WHEN COALESCE(p.qual, '') || COALESCE(p.with_check, '') LIKE '%NULLIF%' THEN 'guarded'
    ELSE 'UNGUARDED'
  END                                                                AS verdict,
  -- which half carries the cast, because a policy may guard USING and not WITH CHECK
  CASE
    WHEN COALESCE(p.qual, '')       LIKE '%current_setting%'
     AND COALESCE(p.with_check, '') LIKE '%current_setting%' THEN 'USING + WITH CHECK'
    WHEN COALESCE(p.qual, '')       LIKE '%current_setting%' THEN 'USING'
    ELSE 'WITH CHECK'
  END                                                                AS clause,
  COALESCE(p.qual, '')                                               AS using_expression,
  COALESCE(p.with_check, '')                                         AS with_check_expression
FROM pg_policies p
WHERE p.schemaname = 'public'
  AND (COALESCE(p.qual, '') LIKE '%current_setting%'
    OR COALESCE(p.with_check, '') LIKE '%current_setting%')
ORDER BY
  -- the ones that would break first, then alphabetically so a re-run is comparable line for line
  CASE WHEN COALESCE(p.qual, '') || COALESCE(p.with_check, '') LIKE '%NULLIF%' THEN 1 ELSE 0 END,
  p.tablename,
  p.policyname;
