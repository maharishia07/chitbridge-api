-- READ-2026-10-21-3 · K-DB / DB-65 · governed identities with no entity_governance row, and where the two constitution_version homes disagree
-- READ-ONLY. Paste the ONE json value back. Before identities.constitution_version / governed_by can be dropped, every governed shop needs
-- its entity_governance row (the sole home); the drop itself is Athi's call (MANIFEST.md, Needs Athi).
WITH gov AS (SELECT i.identity_id, i.identity_type, i.population, i.constitution_version AS id_ver, i.governed_by,
                    g.entity_id IS NOT NULL AS has_row, g.constitution_version AS eg_ver
               FROM identities i LEFT JOIN entity_governance g ON g.entity_id = i.identity_id
              WHERE i.governed_by IS NOT NULL OR i.constitution_version IS NOT NULL)
SELECT json_build_object(
  'governed_identities', (SELECT count(*) FROM gov),
  'without_governance_row', (SELECT count(*) FROM gov WHERE NOT has_row),
  'without_row_by_type', (SELECT json_agg(t) FROM (SELECT identity_type, population, count(*) n FROM gov WHERE NOT has_row GROUP BY 1, 2 ORDER BY 3 DESC) t),
  'versions_disagree', (SELECT count(*) FROM gov WHERE has_row AND id_ver IS DISTINCT FROM eg_ver),
  'disagree_pairs', (SELECT json_agg(t) FROM (SELECT id_ver, eg_ver, count(*) n FROM gov WHERE has_row AND id_ver IS DISTINCT FROM eg_ver GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10) t),
  'governance_rows_without_governed_by', (SELECT count(*) FROM entity_governance g JOIN identities i ON i.identity_id = g.entity_id WHERE i.governed_by IS NULL)
) AS db65_governance_rows;
