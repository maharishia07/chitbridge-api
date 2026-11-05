-- READ-2026-10-24-2-sec103-assignee-census.sql · SEC-103 (api #N, stacked on #397) · READ-ONLY. ONE result set. Paste every row back.
-- Before this fix, PUT /api/entities/routing stored assignee_actor_id as it came: the column has no foreign key and no lookup under the caller's shop,
-- so a routing row of one shop could name a person of another shop (or of nobody).
-- Row 0 is the count (crossed = the person belongs to another shop · nobody = no such person; 0 and 0 = nothing to clean). Any other row is one routing row.
-- ⚠️ Nothing here changes data. If a row comes back, the cleanup is Athi's decision (cb-security writes it as its own RUN- file).
WITH crossed AS (
  SELECT w.entity_id AS row_shop, w.kind, w.assignee_actor_id,
         CASE WHEN i.identity_id IS NULL THEN 'nobody' ELSE 'another shop' END AS why,
         i.parent_entity_id AS person_shop
    FROM entity_work_routing w
    LEFT JOIN identities i ON i.identity_id = w.assignee_actor_id
   WHERE w.assignee_actor_id IS NOT NULL
     AND (i.identity_id IS NULL OR i.identity_type <> 'actor' OR i.parent_entity_id IS DISTINCT FROM w.entity_id)
)
SELECT 0 AS n, 'COUNT · another shop ' || count(*) FILTER (WHERE why = 'another shop')
            || ' · nobody ' || count(*) FILTER (WHERE why = 'nobody') AS what,
       NULL::uuid AS row_shop, NULL::uuid AS assignee_actor_id, NULL::uuid AS person_shop
  FROM crossed
UNION ALL
SELECT row_number() OVER (ORDER BY why, row_shop, kind) AS n, why || ' (' || kind || ')', row_shop, assignee_actor_id, person_shop
  FROM crossed
ORDER BY n;
