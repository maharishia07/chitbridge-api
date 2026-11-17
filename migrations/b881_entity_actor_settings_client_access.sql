-- b881_entity_actor_settings_client_access.sql — assign-1 (17 Nov 2026): the firm switch "which clients may a staff member open", all | assigned.
--
-- OWNER: cb-db (file) · cb-settings (the key and its FIELDS row) · read by lib/assign-register.js clientAccessSql (cb-rail).
-- ⚠️ DRAFT · NOT RUN anywhere · Athi runs it AS postgres (Supabase SQL editor), on SIT first, then production, EITHER SIDE of the api deploy.
--    Additive: one column with a constant default on a small per-shop table. No row is rewritten in a way a reader can see (PG 11+ fast default), no policy,
--    no grant and no index is touched. The api is correct BEFORE it runs: the switch is read through to_jsonb(row), so a missing column reads as absent = `all`
--    (today's behaviour for every shop); no route writes the switch yet (PUT /actors/settings does not accept it), so until a later slice adds that writer it is set only by SQL. AFTER it runs every existing shop reads `all`: nothing changes until an owner chooses `assigned`.
-- WHY. The switch is a shop's own CHOICE (entity layer, class chosen), the same kind and the same table as auto_assign_mode (assignment_model, default_max_tasks,
--    auto_assign_mode: Settings › Work, PUT /actors/settings). cb-settings' rule is "widen the construct, no new store, no ad-hoc key": so it is one column
--    beside its siblings, not a business_json key and not a new table. Working name `firm.client_access`; the column is `client_access`.
-- VALUES. 'all' (default; every staff member the grant lets in may open every client) | 'assigned' (a non-owner opens only a client they hold). The api reads absent as
--    `all` and any other word as `assigned` (fail closed); the CHECK below means a stored word is only ever one of the two, so the fail-closed branch is the last line, not the first.
-- RLS: unchanged. entity_actor_settings is ENABLE + FORCE + policy rls_entity since b842 (entity_id = app.current_entity); a new column is under the same policy.
-- ROLL BACK:   ALTER TABLE entity_actor_settings DROP COLUMN IF EXISTS client_access;   (the api then reads every shop as `all`)
-- CHECK (read-only, one row, expect 1 | all | true):
--    SELECT count(*) FILTER (WHERE column_name = 'client_access') AS col, max(column_default) FILTER (WHERE column_name = 'client_access') AS dflt,
--           EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entity_actor_settings_client_access_check') AS has_check
--      FROM information_schema.columns WHERE table_name = 'entity_actor_settings';
-- INDEX: none. The switch is read by entity_id (uq_entity_actor_settings, one row per shop). The practice-list index D1 names (ix_chit_header_job) is NOT in this file: see b881 notes in the PR.

BEGIN;
ALTER TABLE entity_actor_settings
  ADD COLUMN IF NOT EXISTS client_access text NOT NULL DEFAULT 'all'
  CONSTRAINT entity_actor_settings_client_access_check CHECK (client_access IN ('all', 'assigned'));
COMMIT;
