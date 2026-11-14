-- READ-2026-10-28-3-rail137-folder-loops.sql · RAIL-137 (c) (api #456) · READ-ONLY. ONE result set. Paste every row back.
-- Before #456, PATCH /api/folders/:id refused only a folder as its own parent, so a folder could be moved under its own child or
-- grandchild. That makes a loop: the folders in it hang from each other and from nothing above, and the tree screen cannot reach them.
-- Row 0 is the count (0 = nothing to mend). Any other row is one folder that reaches itself walking up its parents.
-- The walk stops at 64 levels, so it ends on any loop, and it lists each folder in a loop once.
-- ⚠️ Nothing here changes data. If a row comes back, the mend (set one parent_id in each loop to NULL) is Athi's decision, as its own RUN- file.
WITH RECURSIVE up AS (
  SELECT f.folder_id AS start_id, f.entity_id, f.parent_id AS at_id, 1 AS depth
    FROM folder f
   WHERE f.parent_id IS NOT NULL
  UNION ALL
  SELECT up.start_id, up.entity_id, p.parent_id, up.depth + 1
    FROM up JOIN folder p ON p.folder_id = up.at_id
   WHERE up.at_id <> up.start_id AND p.parent_id IS NOT NULL AND up.depth < 64
),
looped AS (
  SELECT DISTINCT up.start_id AS folder_id, up.entity_id
    FROM up
   WHERE up.at_id = up.start_id
)
SELECT 0 AS n, 'COUNT · folders in a loop ' || count(*) || ' · shops ' || count(DISTINCT entity_id) AS what,
       NULL::uuid AS folder_id, NULL::uuid AS shop, NULL::text AS name, NULL::uuid AS parent_id
  FROM looped
UNION ALL
SELECT row_number() OVER (ORDER BY l.entity_id, f.name) AS n, 'folder' AS what, l.folder_id, l.entity_id AS shop, f.name, f.parent_id
  FROM looped l JOIN folder f ON f.folder_id = l.folder_id
ORDER BY n;
