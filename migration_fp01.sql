-- migration_fp01.sql
-- RECONSTRUCTED 2026-06-27 from spine v2.34 (task_panel_live.fp01_migration_applied).
-- These columns were APPLIED to the legacy production Supabase on 2026-06-25; the canonical
-- original file was not in the repo, so this faithful reconstruction matches the documented
-- columns. SUPERSEDES the WRONG cb_*-messaging 001/002/003 set (do NOT use those). Safe to re-run.

-- Cross-edge CUSTOMER priority flag, write-once at send (distinct from the internal queue priority).
ALTER TABLE chit_status ADD COLUMN IF NOT EXISTS customer_priority        BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE chit_status ADD COLUMN IF NOT EXISTS customer_priority_locked BOOLEAN NOT NULL DEFAULT false;

-- Existing INTERNAL queue priority (kept; defensive add — no-op if it already exists).
ALTER TABLE chit_status ADD COLUMN IF NOT EXISTS priority_flag VARCHAR(10) NOT NULL DEFAULT 'normal'
  CHECK (priority_flag IN ('normal','high','urgent'));

-- Typed messages: info/query/action + RAID set (risk/assumption/issue/dependency/decision).
ALTER TABLE chit_messages ADD COLUMN IF NOT EXISTS msg_type VARCHAR(16) NOT NULL DEFAULT 'info'
  CHECK (msg_type IN ('info','query','action','risk','assumption','issue','dependency','decision'));

-- Per-entity message-type mode.
ALTER TABLE identities ADD COLUMN IF NOT EXISTS message_type_mode VARCHAR(12) NOT NULL DEFAULT 'lean'
  CHECK (message_type_mode IN ('lean','governance','custom'));
