-- READ-2026-10-28-2-rail137-orphan-filings.sql · RAIL-137 (b) (api #455) · READ-ONLY. ONE result set. Paste every row back.
-- Before #455, DELETE /api/folders/:id unfiled the folder and its DIRECT children only, while folder.parent_id ON DELETE CASCADE
-- removed every descendant and nothing constrains chit_status.folder_id. So a chit filed two or more levels below a deleted folder
-- kept a folder id no folder holds: hidden from the mailbox (which hides filed chits) and in no folder a person can open.
-- Row 0 is the count (0 copies = nothing to clean). Any other row is one shop: how many of its copies point at a missing folder.
-- ⚠️ Nothing here changes data. If a row comes back, the cleanup (unfile those copies) is Athi's decision, as its own RUN- file.
WITH orphaned AS (
  SELECT cs.entity_id, cs.chit_id, cs.direction, cs.folder_id
    FROM chit_status cs
   WHERE cs.folder_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM folder f WHERE f.folder_id = cs.folder_id)
)
SELECT 0 AS n, 'COUNT · copies ' || count(*) || ' · shops ' || count(DISTINCT entity_id) || ' · missing folders ' || count(DISTINCT folder_id) AS what,
       NULL::uuid AS shop, NULL::bigint AS copies, NULL::bigint AS missing_folders
  FROM orphaned
UNION ALL
SELECT row_number() OVER (ORDER BY count(*) DESC, entity_id) AS n, 'shop' AS what, entity_id AS shop, count(*) AS copies, count(DISTINCT folder_id) AS missing_folders
  FROM orphaned
 GROUP BY entity_id
ORDER BY n;
