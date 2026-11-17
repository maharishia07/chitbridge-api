-- READ-2026-10-21-2 · K-DB / DB-44 · definitions that would break UNIQUE (entity_id, kind, parent, name): same shop, same kind, same
-- parent (rules.parent of the CURRENT version, where it lives today; lib/tax-slab.js reads it there), same name ignoring case and spaces.
-- READ-ONLY. Paste the ONE json value back. Which copy survives is cb-catalogue's (categories, slabs) and cb-accounting's (tax slabs) call.
WITH cur AS (SELECT d.definition_id, d.entity_id, d.kind, d.status, lower(btrim(d.name)) AS name_key, d.name, d.updated_at,
                    nullif(btrim(v.rules->>'parent'), '') AS parent
               FROM definition d
               LEFT JOIN definition_version v ON v.definition_id = d.definition_id AND v.version = d.current_version
              WHERE d.kind <> 'testcase'),
     dup AS (SELECT entity_id, kind, parent, name_key, count(*) n, json_agg(json_build_object('id', definition_id, 'name', name,
                    'status', status, 'updated', to_char(updated_at, 'YYYY-MM-DD')) ORDER BY updated_at) AS copies
               FROM cur GROUP BY 1, 2, 3, 4 HAVING count(*) > 1)
SELECT json_build_object(
  'definitions_read', (SELECT count(*) FROM cur),
  'with_parent', (SELECT count(*) FROM cur WHERE parent IS NOT NULL),
  'duplicate_groups', (SELECT count(*) FROM dup),
  'extra_rows', (SELECT coalesce(sum(n - 1), 0) FROM dup),
  'by_kind', (SELECT json_agg(t) FROM (SELECT kind, count(*) groups, sum(n - 1) extra FROM dup GROUP BY 1 ORDER BY 2 DESC) t),
  'shops', (SELECT count(DISTINCT entity_id) FROM dup),
  'sample', (SELECT json_agg(t) FROM (SELECT kind, parent, name_key, n, copies FROM dup ORDER BY n DESC, kind LIMIT 15) t)
) AS db44_duplicate_names;
