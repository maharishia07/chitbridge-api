-- Chit and Bridge — B3 PIN Migration
-- Run AFTER schema_b3_migration.sql
-- Run in Supabase SQL Editor
-- ============================================================

-- PIN columns for interactive login types
-- Human and Customer co-assist types only
-- Connector IoT Process AI use API key — no PIN

ALTER TABLE identities
  ADD COLUMN IF NOT EXISTS
  pin_hash VARCHAR(255) NULL;

ALTER TABLE identities
  ADD COLUMN IF NOT EXISTS
  pin_set_at TIMESTAMP NULL;

ALTER TABLE identities
  ADD COLUMN IF NOT EXISTS
  pin_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE identities
  ADD COLUMN IF NOT EXISTS
  pin_locked_at TIMESTAMP NULL;

-- Verify
SELECT
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name = 'identities'
AND column_name IN (
  'pin_hash',
  'pin_set_at',
  'pin_attempts',
  'pin_locked_at'
)
ORDER BY column_name;

-- Expected: 4 rows
