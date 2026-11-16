-- b868_staff_area_grants.sql — W15-66 (16 Nov 2026): staff see no books unless the owner opens the accounts for them, person by person, for as long as the owner wants.
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres), SIT first, and BEFORE the owner is told he can open an area: until it runs the api is correct and closed (a person holds only what their preset opens;
--    PATCH /api/actors/:id/areas answers 503 AREAS_NOT_MIGRATED "arrives after the next update", never a 500). Safe to repeat (IF NOT EXISTS / DROP ... IF EXISTS first). No row is rewritten.
-- NUMBER. b867 is the last file on api main at this writing; rename before landing if another round took b868.
-- LOOKED AT (DISCIPLINES 4a): identities.can_see_costs (b145) is the per-person pattern this follows (one column, owner-only PATCH, audited in access_events); GOV is per shop and does not hold a person's grants.
-- WHAT IT DOES.
--    identities.area_grants   jsonb NOT NULL DEFAULT '{}' — a person's OWN grants only: { "<area>": { "level": "see" | "work", "until": "YYYY-MM-DD" | null, "by": <owner identity_id>, "at": <iso time> } }.
--                             The preset's own areas (Auditor, Reports / MIS: accounts see; Regional manager: accounts work) are computed in lib/access.js presetAreas and are never stored here. v1 enforces `accounts` only.
--                             Expiry is judged on every read by lib/areas.liveLevel (no job). RLS is unchanged: identities keeps its own policies and cb_app keeps its table grants (UPDATE on the table).
--    access_events            the action list gains `area_changed` (before and after, who, reason); every value allowed before stays allowed.
-- OWNER: lib/areas.js (the judgement) · lib/actor-areas.js (the owner's PATCH and read) · middleware/auth.js (reads the column when it exists).
-- ROLL BACK (run top to bottom as postgres; first delete the area_changed rows of access_events; the column holds only grants, so dropping it closes every personal grant and nothing else):
--    DELETE FROM access_events WHERE action = 'area_changed';
--    ALTER TABLE access_events DROP CONSTRAINT IF EXISTS access_events_action_check;
--    ALTER TABLE access_events ADD CONSTRAINT access_events_action_check CHECK (action IN ('created', 'hat_changed', 'costs_changed', 'break_changed', 'removed', 'reactivated', 'reach_changed', 'code_issued', 'books_grant_given', 'books_grant_changed', 'books_grant_revoked', 'books_delegated_first', 'books_delegated_unlock', 'books_delegated_year_close'));
--    ALTER TABLE identities DROP COLUMN IF EXISTS area_grants;
-- CHECK AFTER (read only):
--    SELECT 'area_grants column', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'identities' AND column_name = 'area_grants');
--    SELECT 'access_events allows area_changed', (SELECT pg_get_constraintdef(oid) LIKE '%area_changed%' FROM pg_constraint WHERE conname = 'access_events_action_check');

ALTER TABLE identities ADD COLUMN IF NOT EXISTS area_grants jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN identities.area_grants IS 'W15-66 — a person''s OWN area grants { area: { level: see|work, until: day|null, by, at } }; the owner writes it (PATCH /api/actors/:id/areas); presets are computed in code, never stored here; v1 enforces accounts only.';

ALTER TABLE access_events DROP CONSTRAINT IF EXISTS access_events_action_check;
ALTER TABLE access_events ADD CONSTRAINT access_events_action_check
  CHECK (action IN ('created', 'hat_changed', 'costs_changed', 'break_changed', 'removed', 'reactivated', 'reach_changed', 'code_issued', 'books_grant_given', 'books_grant_changed', 'books_grant_revoked', 'books_delegated_first', 'books_delegated_unlock', 'books_delegated_year_close', 'area_changed'));
