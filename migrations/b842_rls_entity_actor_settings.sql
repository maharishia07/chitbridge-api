-- b842_rls_entity_actor_settings.sql — SEC-75 P1 slice (8 Nov 2026): entity_actor_settings holds ONE shop's task settings and had RLS OFF in production.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres) AFTER the api that reads and writes the table under withEntity is deployed
--    (routes/actors.js GET and PUT /settings, entityTaskCap; lib/workpattern.js resolveWorkPattern). Safe to re-run (DROP POLICY IF EXISTS,
--    then CREATE). Touches no rows. Run it before the deploy and the settings reads fail closed (an empty row, a default of 10 tasks), so deploy first.
--
-- WHY. The assignment model, the task ceiling, the auto-assign mode and the default assignee are that shop's own settings; with RLS off any statement
--    as cb_app could read or change every shop's. Every reader and writer now binds the shop (withEntity): actors.js (4 sites), chits.js (2, already
--    inside withEntity), workroute.js (1, already), workpattern.js (1, moved in this change). No cross-shop reader exists.
-- RLS: ENABLE + FORCE + policy rls_entity, the b778 shape (entity_id = app.current_entity, USING and WITH CHECK).
--    Privileges unchanged (cb_app keeps SELECT, INSERT, UPDATE, DELETE; add-only rule: nothing is revoked).
-- ROLL BACK: ALTER TABLE entity_actor_settings NO FORCE ROW LEVEL SECURITY; ALTER TABLE entity_actor_settings DISABLE ROW LEVEL SECURITY;
-- CHECK (read-only): SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'entity_actor_settings';   Expect true, true.
-- NOT IN THIS FILE: entity_schemas and schema_fields (18 files, some read across shops for visibility: their own PR) and the shared tables (other units).

ALTER TABLE entity_actor_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_actor_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON entity_actor_settings;
CREATE POLICY rls_entity ON entity_actor_settings
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
