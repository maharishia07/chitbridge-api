-- b181 · VERIFY · run AFTER the apply. Read-only, one result set.
--
-- "It ran without an error" is not "it worked". This re-asks the dry run's question and expects an empty
-- UNGUARDED column -- and it also counts what was left alone, because a fix that quietly widened its blast
-- radius to the 31 already-correct policies would otherwise look identical to success.
--
-- EXPECTED
--   unguarded_remaining = 0
--   guarded_total       = 43   (31 that were already correct + the 12 this changed)
--   still_forced        = 12   (every altered table must still have RLS FORCED -- ALTER POLICY does not touch
--                               that, so a change here would mean something else went wrong)

SELECT
  (SELECT count(*) FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND (COALESCE(p.qual,'') LIKE '%current_setting%' OR COALESCE(p.with_check,'') LIKE '%current_setting%')
      AND COALESCE(p.qual,'') || COALESCE(p.with_check,'') NOT LIKE '%NULLIF%')            AS unguarded_remaining,
  (SELECT count(*) FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND (COALESCE(p.qual,'') LIKE '%current_setting%' OR COALESCE(p.with_check,'') LIKE '%current_setting%')
      AND COALESCE(p.qual,'') || COALESCE(p.with_check,'') LIKE '%NULLIF%')                AS guarded_total,
  (SELECT count(*) FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relrowsecurity AND c.relforcerowsecurity
      AND c.relname IN ('catalogue_item_version','chit_line','chit_line_amendment','chit_line_assignment',
                        'chit_line_cost','chit_line_delivery','chit_sla','chit_sla_pause','definition',
                        'definition_version','folder_rule','wholesaler_store'))            AS still_forced,
  CASE WHEN (SELECT count(*) FROM pg_policies p
              WHERE p.schemaname = 'public'
                AND (COALESCE(p.qual,'') LIKE '%current_setting%' OR COALESCE(p.with_check,'') LIKE '%current_setting%')
                AND COALESCE(p.qual,'') || COALESCE(p.with_check,'') NOT LIKE '%NULLIF%') = 0
       THEN 'done — a null entity now returns nothing instead of raising 22P02'
       ELSE 'INCOMPLETE — re-run the dry run to see which policies are still unguarded'
  END                                                                                       AS verdict;
