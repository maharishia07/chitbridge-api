-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b133 — A FOLDER BELONGS TO ONE SIDE. Task folders hold Task copies; Order folders hold Order copies.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-08-10, on seeing the seeded folders: *"tasks and order cannot be on the same folder. folder are having
-- same characteristics as tasks, so all the icon is possible and arithmetic is possible."*
--
-- He is right, and it is the mailbox model being consistent with itself. Task (coming to you) and Order (going from
-- you) are different tracks with different actions — you ACT on a task, you CHASE an order. A folder that held both
-- would need two sets of controls on one list and could never inherit either. Declaring the side makes a folder a
-- SUB-LIST OF ITS TRACK: same row, same icons, same actions, plus arithmetic over a smaller set.
--
-- ── ⚠️ NON-DESTRUCTIVE, AND IT REFUSES TO GUESS ─────────────────────────────────────────────────────────────────
-- Existing folders are back-filled ONLY where the answer is unambiguous: a folder holding nothing but received
-- copies becomes 'task', nothing but sent becomes 'order'. A folder that is EMPTY or genuinely MIXED is left NULL —
-- "not yet declared" — because picking a side for it would silently unfile whichever copies lost, and losing
-- someone's filing to a migration is not a trade worth making. The API treats NULL as legacy: it still works, and
-- the UI asks for a side the next time it is touched.
--
-- Safe to re-run.

ALTER TABLE folder ADD COLUMN IF NOT EXISTS scope text
  CHECK (scope IS NULL OR scope IN ('task', 'order'));

-- Back-fill the unambiguous ones. `direction` on chit_status is the truth: 'received' = Task, 'sent' = Order.
UPDATE folder f SET scope = 'task'
 WHERE f.scope IS NULL
   AND EXISTS (SELECT 1 FROM chit_status cs WHERE cs.folder_id = f.folder_id AND cs.direction = 'received')
   AND NOT EXISTS (SELECT 1 FROM chit_status cs WHERE cs.folder_id = f.folder_id AND cs.direction = 'sent');

UPDATE folder f SET scope = 'order'
 WHERE f.scope IS NULL
   AND EXISTS (SELECT 1 FROM chit_status cs WHERE cs.folder_id = f.folder_id AND cs.direction = 'sent')
   AND NOT EXISTS (SELECT 1 FROM chit_status cs WHERE cs.folder_id = f.folder_id AND cs.direction = 'received');

COMMENT ON COLUMN folder.scope IS
  'b133 — task | order. A folder belongs to ONE track, so it inherits that track''s row actions. NULL = legacy/undeclared (empty or mixed at migration time); the API asks for a side on next use.';

-- What was left undeclared, and why — printed so nothing is silently ambiguous.
DO $$
DECLARE mixed int; empty_n int;
BEGIN
  SELECT COUNT(*) INTO mixed FROM folder f WHERE f.scope IS NULL
     AND EXISTS (SELECT 1 FROM chit_status cs WHERE cs.folder_id = f.folder_id AND cs.direction = 'received')
     AND EXISTS (SELECT 1 FROM chit_status cs WHERE cs.folder_id = f.folder_id AND cs.direction = 'sent');
  SELECT COUNT(*) INTO empty_n FROM folder f WHERE f.scope IS NULL
     AND NOT EXISTS (SELECT 1 FROM chit_status cs WHERE cs.folder_id = f.folder_id);
  RAISE NOTICE 'b133: % folder(s) left undeclared because they hold BOTH sides (nothing was unfiled — pick a side in the app)', mixed;
  RAISE NOTICE 'b133: % empty folder(s) left undeclared', empty_n;
END $$;
