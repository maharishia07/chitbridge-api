-- RUN-2026-10-25-b794-b795.sql — Athi runs this in the Supabase SQL editor AS postgres (no RLS role). Both are additive and safe to re-run.
-- b794 (plat/control-panel-1): four nullable columns on installation; no row is touched.
-- b795 (crm/net-40-consent): customer_list.added_via accepts 'invite'; no row is touched.
-- The source files stay on their branches and land with them; this file is the production run, like RUN-2026-10-25-ctp-crossing-b790-b796.sql.

-- ═════ b794 ═════
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

-- ═════ b795 ═════
BEGIN;

ALTER TABLE customer_list DROP CONSTRAINT IF EXISTS customer_list_added_via_check;
ALTER TABLE customer_list ADD CONSTRAINT customer_list_added_via_check
  CHECK (added_via::text = ANY (ARRAY['transaction', 'manual', 'import', 'catalogue', 'system', 'lead', 'invite']));

COMMIT;

-- ═════ check: every row must say true ═════
SELECT 'b794 installation.version' AS what, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'installation' AND column_name = 'version') AS ok
UNION ALL SELECT 'b794 installation.last_seen', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'installation' AND column_name = 'last_seen')
UNION ALL SELECT 'b794 installation.seen_error', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'installation' AND column_name = 'seen_error')
UNION ALL SELECT 'b794 installation.listed', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'installation' AND column_name = 'listed')
UNION ALL SELECT 'b795 added_via allows invite', EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_list_added_via_check' AND pg_get_constraintdef(oid) LIKE '%invite%');
