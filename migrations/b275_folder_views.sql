-- b275_folder_views.sql — A SHOP'S OWN VIEW FOLDER: a folder whose contents are its rules' matches (the Bills folder work,
-- 2026-10-01). NOT YET RUN — the owner runs it (Supabase SQL editor, as postgres). Safe to re-run. Check: docs/drafts/b275_check.sql.
--
-- ⭐ WHAT NEEDS IT, AND WHAT DOES NOT. The SYSTEM folders (Bills · Received B-2100, Bills · Issued B-1300, Receipts R-1400,
--   Expenses E-6000, Returns RT-4090) need NO SQL: they are the inventory in lib/folder-inventory.js plus the shop's switch in
--   identities.policy_flags.system_folders, served with a fixed id per code. Bills leave the Task/Order lists without this.
--   Only a shop's OWN view folder ("everything from Mayur", without moving anything) needs a place to say "I am a view" — the
--   one column below. Until it runs, POST /api/folders { kind: 'view' } answers 503 "View folders need b275", every folder read
--   treats every folder as filed (read through to_jsonb), and nothing else changes.
--
-- ⭐ A VIEW FOLDER IS NEVER A PLACE: nothing is moved into it (routes/folders.js refuses FOLDER_IS_VIEW) and its rules never
--   file (lib/folder-rules fileArrival skips them) — its folder_rule rows define what it shows.

ALTER TABLE folder ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'filed';
ALTER TABLE folder DROP CONSTRAINT IF EXISTS folder_kind_chk;
ALTER TABLE folder ADD CONSTRAINT folder_kind_chk CHECK (kind IN ('filed', 'view'));
COMMENT ON COLUMN folder.kind IS
  'b275 — filed: holds what was moved into it (chit_status.folder_id) · view: shows what its folder_rule rows match; never a move target, its rules never file.';

-- ── RLS, re-asserted (b64 set it; FORCE + the NULLIF policy, so an unset entity matches nothing rather than erroring) ──
ALTER TABLE folder ENABLE ROW LEVEL SECURITY;
ALTER TABLE folder FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON folder;
CREATE POLICY rls_entity ON folder
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
-- (no new foreign keys: kind is a value, and folder.parent_id's FK is b63's)
