-- migration_user_id_identities.sql
-- ATH-114 external identity scheme. user_id placed on identities (the legacy model) per the
-- 2026-06-27 ruling (build on chit_header/legacy; cb_entity stays dormant).
-- entity user_id = 8+ chars or email; co-assist = handle@entity.user_id; bridge_id stays internal.
-- Safe to re-run.

ALTER TABLE identities ADD COLUMN IF NOT EXISTS user_id VARCHAR(255);

-- Unique per platform, case-insensitive, only when set.
CREATE UNIQUE INDEX IF NOT EXISTS idx_identities_user_id
  ON identities (LOWER(user_id)) WHERE user_id IS NOT NULL;

COMMENT ON COLUMN identities.user_id IS
  'External login/reference id (ATH-114): entity user_id (8+ chars or email); co-assist resolves as handle@entity.user_id. bridge_id stays internal.';
