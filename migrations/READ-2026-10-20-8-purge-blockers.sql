-- READ-2026-10-20-8 · DB-80 · which identities still point at a test shop (identities_parent_entity_id_fkey blocked the last step)
-- READ-ONLY. Paste the ONE json value back.
WITH e2e AS (SELECT identity_id FROM identities
              WHERE identity_type = 'entity'
                AND (email ILIKE '%@test.example' OR email ILIKE '%@test-cb.com' OR user_id ILIKE 'e2eco-%'
                  OR display_name ILIKE 'e2eco-%' OR user_id ILIKE 'e2e.pool%' OR display_name ILIKE 'E2E Pool%')),
     blockers AS (SELECT i.* FROM identities i
                   WHERE i.parent_entity_id IN (SELECT identity_id FROM e2e)
                     AND i.identity_id NOT IN (SELECT identity_id FROM e2e))
SELECT json_build_object(
  'test_shops_left', (SELECT count(*) FROM e2e),
  'blockers', (SELECT count(*) FROM blockers),
  'blockers_by_type', (SELECT json_agg(t) FROM (SELECT identity_type, count(*) n, count(DISTINCT parent_entity_id) shops
                                                  FROM blockers GROUP BY 1 ORDER BY 2 DESC) t),
  'sample', (SELECT json_agg(t) FROM (SELECT identity_type, user_id, display_name, email, to_char(created_at, 'YYYY-MM-DD') created
                                        FROM blockers ORDER BY created_at DESC LIMIT 8) t),
  -- would deleting the blockers too be safe? what else points at THEM
  'blockers_cited_by_other_identities', (SELECT count(*) FROM identities x WHERE x.parent_entity_id IN (SELECT identity_id FROM blockers))
) AS purge_blockers;
