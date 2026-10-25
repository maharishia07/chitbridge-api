-- b794_installation_seen.sql — network control panel slice 1 (25 Oct 2026): what the master last SAW of each installation, and whether it is listed.
--
-- ⚠️⚠️ DRAFT — NOT RUN ANYWHERE · Athi runs it (Supabase SQL editor AS postgres; the SIT migrate job on the SIT VMs) after his yes. ADDITIVE ONLY: four nullable columns on `installation`,
--    safe to re-run (IF NOT EXISTS), no row is touched. Code reads them through to_jsonb(i) (lib/netmember.listMembers) and writes them inside a try (lib/netsync.noteSeen),
--    so an installation that has not run this behaves as before and the panel shows "not recorded" / "not seen".
--
-- WHY. The panel must say which version each installation runs and when the master last saw it, WITHOUT the page dialling anyone. The master's pull (lib/netsync.pullMaster)
-- already visits every member every minute; after it, it reads the member's /health once and records the answer here. The page reads the record.
--   version      "<package version>+<commit, 7 characters>" from the member's /health. A failed read leaves the old value.
--   last_seen    when /health last answered. NULL = never seen. A failed read leaves the old value, so "not seen since <date>" stays true.
--   seen_error   why the last read failed (words), NULL after a good one.
--   listed       is this installation in the public directory? NULL = NOT RECORDED. Nothing writes it yet: the panel paints NULL "not recorded", it never guesses.
-- OWNER: lib/netsync.js (writes version, last_seen, seen_error) · lib/netmember.js listMembers (reads all four). RLS: `installation` already has its policies; no new table.

BEGIN;

ALTER TABLE installation ADD COLUMN IF NOT EXISTS version text;
ALTER TABLE installation ADD COLUMN IF NOT EXISTS last_seen timestamptz;
ALTER TABLE installation ADD COLUMN IF NOT EXISTS seen_error text;
ALTER TABLE installation ADD COLUMN IF NOT EXISTS listed boolean;

COMMENT ON COLUMN installation.version IS 'PLT control panel b794: the version the master last read at this installation''s /health (version+commit7). Written only by lib/netsync.noteSeen; a failed read keeps it.';
COMMENT ON COLUMN installation.last_seen IS 'PLT control panel b794: when the master''s read of /health last answered. NULL = never seen. Kept on a failed read, so "not seen since" is true.';
COMMENT ON COLUMN installation.seen_error IS 'PLT control panel b794: why the last /health read failed, in words. NULL after a good read.';
COMMENT ON COLUMN installation.listed IS 'PLT control panel b794: is this installation in the public directory? NULL = not recorded (the default; nothing writes it yet).';

COMMIT;
