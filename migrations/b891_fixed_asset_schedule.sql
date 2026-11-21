-- b891_fixed_asset_schedule.sql — ASSETS-1121 (F-32, F-34, F-36): the asset register remembers what the year's depreciation runs have charged, and the day an asset was bought.
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres) after SIT has run it. Additive and safe to repeat (ADD COLUMN IF NOT EXISTS). Touches no rows beyond the defaults, no policy, no grant.
--
-- WHY. Depreciation can now be posted month by month (POST /depreciation/run { fy, through }), so each run posts only what the earlier ones of the year did not. The register keeps
--    fy_charged_minor = what the runs of last_dep_fy have charged this asset (a new year starts it over), so the next run's opening written-down value is cost less the depreciation at the START
--    of the year. purchased_on = the day it was bought (an asset owned before the books began is added with its purchase day; put_to_use stays the day depreciation counts from).
--    The register stays a convenience over the journal: GET /assets still shows the ledger's own figure beside it (agrees).
-- Both columns' units: fy_charged_minor is a MINOR-unit integer like accumulated_minor.
-- Existing rows: fy_charged_minor = 0 (a year already depreciated at its end carries its charge in accumulated_minor and the year's own entry; the run refuses that year as already done), purchased_on = NULL (read as put_to_use).
-- RLS: fixed_asset is already ENABLED + FORCED with rls_entity (b280); no change.
-- ROLL BACK:  ALTER TABLE fixed_asset DROP COLUMN IF EXISTS fy_charged_minor, DROP COLUMN IF EXISTS purchased_on, DROP COLUMN IF EXISTS dep_log;
ALTER TABLE fixed_asset ADD COLUMN IF NOT EXISTS fy_charged_minor bigint NOT NULL DEFAULT 0 CHECK (fy_charged_minor >= 0);
ALTER TABLE fixed_asset ADD COLUMN IF NOT EXISTS purchased_on date;
-- dep_log: what each depreciation run (by its journal source_ref) charged this asset, so reversing that entry takes exactly it back (the run can then be made again)
ALTER TABLE fixed_asset ADD COLUMN IF NOT EXISTS dep_log jsonb NOT NULL DEFAULT '[]'::jsonb;
