-- migration_chit_header_role.sql
-- Phase-1 consolidation (2026-06-27): per-copy role on chit_header for the
-- Compose To/CC/For fan-out. Ruling: chit writes live on chit_header (cb_chit retired).
--
-- Design check: chit_header already carries per-party copies (PK (chit_id, entity_id))
-- and a thread root (chit_ref). The ONLY missing piece for fan-out is a per-copy role.
-- This is the minimal additive change — no cb_chit fallback.
--
-- Role mapping at Compose time: To -> Act, CC -> Info, For -> For, draft -> Draft.
-- Resolves the is_draft question: there is no is_draft column anywhere -> use role='Draft'.
-- Safe to re-run.

ALTER TABLE chit_header
  ADD COLUMN IF NOT EXISTS role VARCHAR(10) NOT NULL DEFAULT 'Act'
  CHECK (role IN ('Act', 'Info', 'For', 'Draft'));

-- Existing rows default to 'Act' (the sender/receiver Act copy). Backfill of CC->Info /
-- For->For for historical chits is intentionally NOT done here (no reliable source);
-- new chits set role explicitly per copy at /api/chits/send.

COMMENT ON COLUMN chit_header.role IS
  'Per-copy role for fan-out: Act (To) | Info (CC) | For (on-behalf/origin) | Draft. One chit_header row per party, threaded by chit_ref.';
