-- b883_entity_actor_settings_staff_pick_up.sql — W17 (walk 19 Nov): the firm switch "may a staff seat assign clients nobody holds (to itself or a colleague)", on | off.
--
-- OWNER: cb-db (file) · cb-settings (the key and its FIELDS row) · read by lib/assign-register.js pickUpOn (cb-rail).
-- ⚠️ DRAFT · NOT RUN anywhere · Athi runs it AS postgres (Supabase SQL editor), on SIT first, then production, EITHER SIDE of the api deploy.
--    Additive: one nullable column with a constant default on a small per-shop table (PG 11+ fast default). No policy, grant or index is touched. The api is correct BEFORE it runs: the switch is read through
--    to_jsonb(row), so a missing column reads as absent = on (the default: pick-up works); only TURNING IT OFF needs the column (PUT /actors/settings fails for that one key until it runs, like client_access before b881).
-- VALUES. 'on' (default; absent and NULL read as on) | 'off' (a seat of the firm may not assign: only the partner or a manager). ANY other word reads as off (fail closed); the writer validates the two words (isIn).
-- RLS: unchanged (entity_actor_settings is ENABLE + FORCE + policy rls_entity since b842).
-- ROLL BACK:   ALTER TABLE entity_actor_settings DROP COLUMN IF EXISTS staff_pick_up;   (the api then reads every shop as on)
-- CHECK (read-only):  SELECT column_name, column_default FROM information_schema.columns WHERE table_name = 'entity_actor_settings' AND column_name = 'staff_pick_up';   (staff_pick_up | 'on'::text)

BEGIN;
ALTER TABLE entity_actor_settings
  ADD COLUMN IF NOT EXISTS staff_pick_up text DEFAULT 'on';
COMMIT;
