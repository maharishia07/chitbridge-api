-- READ-2026-10-24-1-sec100-folder-fk-census.sql · SEC-100 (api #397) · READ-ONLY. ONE result set. Paste every row back.
-- Before #397, three writes stored a folder id without looking it up under the caller's shop, and Postgres checks a foreign key
-- without row security, so a row of one shop could point at another shop's folder:
--   folder.parent_id (PATCH /api/folders/:id with parent_id; POST /api/folders already looked it up) · folder_rule.folder_id (POST /api/folders/:id/rules) · entity_work_routing.folder_id (PUT /api/entities/routing).
-- Row 0 is the count per kind (0 everywhere = nothing to clean). Any other row is one cross-shop link.
-- ⚠️ Nothing here changes data. If a row comes back, the cleanup is Athi's decision (cb-security writes it as its own RUN- file).
WITH crossed AS (
  SELECT 'folder parent' AS what, c.folder_id AS row_id, c.entity_id AS row_shop, p.folder_id AS folder_id, p.entity_id AS folder_shop
    FROM folder c JOIN folder p ON p.folder_id = c.parent_id
   WHERE p.entity_id <> c.entity_id
  UNION ALL
  SELECT 'folder rule', r.rule_id, r.entity_id, f.folder_id, f.entity_id
    FROM folder_rule r JOIN folder f ON f.folder_id = r.folder_id
   WHERE f.entity_id <> r.entity_id
  UNION ALL
  SELECT 'work routing (' || w.kind || ')', NULL, w.entity_id, f.folder_id, f.entity_id
    FROM entity_work_routing w JOIN folder f ON f.folder_id = w.folder_id
   WHERE f.entity_id <> w.entity_id
)
SELECT 0 AS n, 'COUNT · parents ' || count(*) FILTER (WHERE what = 'folder parent')
            || ' · rules ' || count(*) FILTER (WHERE what = 'folder rule')
            || ' · routing ' || count(*) FILTER (WHERE what LIKE 'work routing%') AS what,
       NULL::uuid AS row_id, NULL::uuid AS row_shop, NULL::uuid AS folder_id, NULL::uuid AS folder_shop
  FROM crossed
UNION ALL
SELECT row_number() OVER (ORDER BY what, row_shop) AS n, what, row_id, row_shop, folder_id, folder_shop
  FROM crossed
ORDER BY n;
