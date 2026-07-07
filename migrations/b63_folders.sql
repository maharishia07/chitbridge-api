-- b63: FOLDERS — a per-entity tree for organising ANY chit (mailing-model: file/redirect any chit into a folder).
-- Works for Task, Order, and any future mailbox (folders are a chit-organisation layer, not tied to one view).
-- Current vs Archive REUSES the existing chit_status.archived_at (no new archive machinery).
-- Isolation: every query filters by entity_id (same pattern as connector_connection / b62). Folders are private per entity.

CREATE TABLE IF NOT EXISTS folder (
  folder_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL,
  parent_id   uuid REFERENCES folder(folder_id) ON DELETE CASCADE,   -- parent_id => a TREE (recursive, nestable)
  name        text NOT NULL,
  sort        int  DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS folder_entity_idx ON folder(entity_id);
CREATE INDEX IF NOT EXISTS folder_parent_idx ON folder(parent_id);

-- File a chit copy into a folder (per-entity, per-copy). NULL = unfiled => stays in the main mailbox (Task/Order).
ALTER TABLE chit_status ADD COLUMN IF NOT EXISTS folder_id uuid;
CREATE INDEX IF NOT EXISTS chit_status_folder_idx ON chit_status(entity_id, folder_id) WHERE folder_id IS NOT NULL;
