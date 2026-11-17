-- purge_test_entities · step 1 of 3 — LIST what would go. Read-only. ONE result set.
-- A test entity is one the e2e suite minted: e2e.<ts>.<n>@test.example, e2eco-<id>, <name>@test-cb.com, the pool accounts.
-- ⚠️ Read every row before step 3. A real business must NOT appear here. If one does, STOP and tell Claude.
WITH test_entities AS (
  SELECT identity_id, identity_type, user_id, display_name, email, created_at
    FROM identities
   WHERE identity_type = 'entity'
     AND ( email ILIKE '%@test.example' OR email ILIKE '%@test-cb.com'
        OR user_id ILIKE 'e2eco-%' OR display_name ILIKE 'e2eco-%'
        OR user_id ILIKE 'e2e.pool%' OR display_name ILIKE 'E2E Pool%' )
)
SELECT 'entity' AS what, identity_id, user_id, display_name, email, created_at FROM test_entities
UNION ALL
SELECT 'actor of a test entity', a.identity_id, a.user_id, a.display_name, a.email, a.created_at
  FROM identities a JOIN test_entities t ON a.parent_entity_id = t.identity_id
 WHERE a.identity_type = 'actor'
ORDER BY 1, 6;
