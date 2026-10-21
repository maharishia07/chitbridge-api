-- b280_fixed_asset.sql — DRAFT — NOT RUN · Athi runs it.
--
-- WHY: engines year-book 2026-27 §9 gap 4 — "no asset register: depreciationFor needs the assets handed in". A purchase accepted as an
-- asset (or one added by hand) must leave a row that remembers its class, cost and the day it was put to use, so the year-end depreciation
-- runs from the register (POST /api/books/depreciation/run) and a sale / scrap (POST /api/books/assets/:id/dispose) can post.
-- lib/books-assets.js reads and writes it. Until this runs every asset route answers 503 BOOKS_NOT_MIGRATED and an Accept as "asset" keeps
-- queueing with the same plain reason ("An asset purchase needs the asset ledger — not posted yet").
--
-- RUN AS postgres IN THE SUPABASE SQL EDITOR (it creates a table, a policy and grants). Needs b272 + b273 first. Safe to re-run.
-- The cost and the accumulated depreciation are MINOR units. The register is a convenience over the journal, never a second ledger: the
-- journal (PPE cost and accumulated-depreciation ledgers) stays the truth, and GET /api/books/assets shows both beside each other.
--
-- Check row after:  SELECT count(*) FROM fixed_asset;   → 0
CREATE TABLE IF NOT EXISTS fixed_asset (
  asset_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id          uuid NOT NULL,
  name               text NOT NULL,
  asset_class        text NOT NULL,                 -- buildings · plant · furniture · vehicles · office · computers (the pack's asset_classes)
  cost_minor         bigint NOT NULL CHECK (cost_minor > 0),
  currency           text NOT NULL DEFAULT 'INR',
  put_to_use         date NOT NULL,                 -- the day it was ready for use: depreciation counts from here (half rate under 180 days)
  source_entry_id    uuid,                          -- the journal entry that bought it (journal_entry.entry_id)
  source_chit_id     uuid,                          -- the supplier bill it came in on, when it came on the rail
  accumulated_minor  bigint NOT NULL DEFAULT 0 CHECK (accumulated_minor >= 0),   -- depreciation posted so far (moves only when a depreciation run posts)
  last_dep_fy        text,                          -- the last fiscal year a depreciation run covered it
  disposed_on        date,
  disposal_entry_id  uuid,
  proceeds_minor     bigint,                        -- what a sale brought in (nil for a scrap)
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);
-- one asset of one entry is one row, however many times the same entry is retried (a bill may carry several assets, each its own name)
CREATE UNIQUE INDEX IF NOT EXISTS fixed_asset_src_uq ON fixed_asset (entity_id, source_entry_id, name) WHERE source_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fixed_asset_idx ON fixed_asset (entity_id, put_to_use);
ALTER TABLE fixed_asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_asset FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON fixed_asset;
CREATE POLICY rls_entity ON fixed_asset
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
REVOKE DELETE ON fixed_asset FROM cb_app;           -- an asset is disposed, never deleted
GRANT SELECT, INSERT, UPDATE ON fixed_asset TO cb_app;
