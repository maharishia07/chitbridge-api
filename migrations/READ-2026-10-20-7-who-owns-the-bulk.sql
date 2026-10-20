-- READ-2026-10-20-7 · DB-80 · WHO owns the big tables: test shops (the e2e pattern) or real ones / the shared test accounts?
-- READ-ONLY. Changes nothing. Paste the ONE json value back.
-- is_e2e = matches purge_test_entities' pattern (would be purged by it). A big owner with is_e2e false needs a decision by name.
WITH tc AS (SELECT entity_id, count(*) n FROM definition WHERE kind = 'testcase' GROUP BY 1),
     dv AS (SELECT v.entity_id, count(*) n, round(sum(pg_column_size(v.rules)) / 1048576.0, 1) mb
              FROM definition_version v JOIN definition d ON d.definition_id = v.definition_id AND d.kind = 'testcase' GROUP BY 1),
     tr AS (SELECT entity_id, count(*) n FROM test_result GROUP BY 1),
     ci AS (SELECT entity_id, count(*) n FROM catalogue_items GROUP BY 1),
     cv AS (SELECT entity_id, count(*) n FROM catalogue_item_version GROUP BY 1),
     ul AS (SELECT entity_id, count(*) n FROM usage_ledger GROUP BY 1),
     owners AS (
       SELECT entity_id FROM (SELECT entity_id FROM dv ORDER BY n DESC LIMIT 12) a
       UNION SELECT entity_id FROM (SELECT entity_id FROM ci ORDER BY n DESC LIMIT 8) b
       UNION SELECT entity_id FROM (SELECT entity_id FROM cv ORDER BY n DESC LIMIT 8) c
       UNION SELECT entity_id FROM (SELECT entity_id FROM tr ORDER BY n DESC LIMIT 6) d
       UNION SELECT entity_id FROM (SELECT entity_id FROM ul ORDER BY n DESC LIMIT 6) e),
     e2e AS (SELECT identity_id FROM identities
              WHERE identity_type = 'entity'
                AND (email ILIKE '%@test.example' OR email ILIKE '%@test-cb.com' OR user_id ILIKE 'e2eco-%'
                  OR display_name ILIKE 'e2eco-%' OR user_id ILIKE 'e2e.pool%' OR display_name ILIKE 'E2E Pool%'))
SELECT json_build_object(
  'owners', (SELECT json_agg(x ORDER BY x.testcase_versions DESC NULLS LAST) FROM (
      SELECT o.entity_id,
             i.display_name, i.user_id, i.email,
             to_char(i.created_at, 'YYYY-MM-DD')               AS created,
             (o.entity_id IN (SELECT identity_id FROM e2e))     AS is_e2e,
             tc.n AS testcase_defs, dv.n AS testcase_versions, dv.mb AS testcase_mb,
             tr.n AS test_results, ci.n AS catalogue_items, cv.n AS item_versions, ul.n AS usage_rows
        FROM owners o
        LEFT JOIN identities i ON i.identity_id = o.entity_id
        LEFT JOIN tc ON tc.entity_id = o.entity_id LEFT JOIN dv ON dv.entity_id = o.entity_id
        LEFT JOIN tr ON tr.entity_id = o.entity_id LEFT JOIN ci ON ci.entity_id = o.entity_id
        LEFT JOIN cv ON cv.entity_id = o.entity_id LEFT JOIN ul ON ul.entity_id = o.entity_id) x),
  -- the totals the e2e pattern covers, so we know how far the existing purge gets us
  'e2e_share', json_build_object(
      'entities',          (SELECT count(*) FROM e2e),
      'testcase_versions', (SELECT coalesce(sum(n), 0) FROM dv WHERE entity_id IN (SELECT identity_id FROM e2e)),
      'testcase_mb',       (SELECT coalesce(sum(mb), 0) FROM dv WHERE entity_id IN (SELECT identity_id FROM e2e)),
      'catalogue_items',   (SELECT coalesce(sum(n), 0) FROM ci WHERE entity_id IN (SELECT identity_id FROM e2e)),
      'item_versions',     (SELECT coalesce(sum(n), 0) FROM cv WHERE entity_id IN (SELECT identity_id FROM e2e)),
      'test_results',      (SELECT coalesce(sum(n), 0) FROM tr WHERE entity_id IN (SELECT identity_id FROM e2e))),
  'testcase_entities_total', (SELECT count(*) FROM tc)
) AS who_owns_the_bulk;
