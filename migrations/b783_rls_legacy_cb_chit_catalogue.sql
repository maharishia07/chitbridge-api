-- b783_rls_legacy_cb_chit_catalogue.sql — SEC-75 group A (29 Oct 2026): seven legacy cb_* tables that NO code reads or writes, RLS OFF in production.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres), AFTER b778 + b779 (api #338). Safe to re-run (ENABLE/FORCE idempotent, DROP POLICY IF EXISTS then CREATE).
--    Touches no rows, no grants.
--
-- WHY. They are the old cb_* prototype (docs/B1-RLS-DESIGN.md "dormant", migrations/MANIFEST.md #14 "cb_chit DORMANT, Q3"; the catalogue pair is "ARCHIVED 2026-08-06, tables are empty").
--    git grep over lib/ routes/ src/ middleware/ finds no statement that touches any of them, so closing them changes nothing a person sees; open, any cb_app statement reads every shop's rows.
--    Same pattern as b779 (rls_entity, key = app.current_entity, USING and WITH CHECK). Keys:
--      cb_catalogue_category(entity_id) · cb_catalogue_item(entity_id)             one shop's rows
--      cb_chit(from_entity OR to_entity) · cb_task(from_entity OR to_entity)        either side of the chit reads it
--      cb_transaction_history(info_entity OR to_entity)                             either side
--      cb_chit_item(chit_id) · cb_chit_log(chit_id)                                 follow cb_chit (EXISTS, so cb_chit's own policy applies)
--    These columns hold cb_entity.id values, which are not the identity ids the app binds, so until a reader maps one to the other every row is unreachable to cb_app: it fails CLOSED.
--    That is intended for tables nothing reads; the first reader maps cb_entity.id to the shop in its own change.
-- NOT IN THIS FILE (each needs a call site moved first, or a design call; listed in the PR): cb_entity, cb_edge, connections, connector_connection, catalogue_source, standard_source,
--    product_container, product_version, resolved_blueprint, container_region_override, source_penetration, media_blobs, entity_actor_settings, entity_schemas, schema_fields,
--    sim_leads, sim_feedback, dispute_participants (b830, PR #533), identities (b54 carve-out).
-- RLS: ENABLE + FORCE + policy rls_entity on each table below, written as literal statements (no format() loop, db-85 rule).

BEGIN;

ALTER TABLE cb_catalogue_category ENABLE ROW LEVEL SECURITY;
ALTER TABLE cb_catalogue_category FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON cb_catalogue_category;
CREATE POLICY rls_entity ON cb_catalogue_category
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

ALTER TABLE cb_catalogue_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE cb_catalogue_item FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON cb_catalogue_item;
CREATE POLICY rls_entity ON cb_catalogue_item
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

ALTER TABLE cb_chit ENABLE ROW LEVEL SECURITY;
ALTER TABLE cb_chit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON cb_chit;
CREATE POLICY rls_entity ON cb_chit
  USING      (NULLIF(current_setting('app.current_entity', true), '')::uuid IN (from_entity, to_entity))
  WITH CHECK (NULLIF(current_setting('app.current_entity', true), '')::uuid IN (from_entity, to_entity));

ALTER TABLE cb_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE cb_task FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON cb_task;
CREATE POLICY rls_entity ON cb_task
  USING      (NULLIF(current_setting('app.current_entity', true), '')::uuid IN (from_entity, to_entity))
  WITH CHECK (NULLIF(current_setting('app.current_entity', true), '')::uuid IN (from_entity, to_entity));

ALTER TABLE cb_transaction_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE cb_transaction_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON cb_transaction_history;
CREATE POLICY rls_entity ON cb_transaction_history
  USING      (NULLIF(current_setting('app.current_entity', true), '')::uuid IN (info_entity, to_entity))
  WITH CHECK (NULLIF(current_setting('app.current_entity', true), '')::uuid IN (info_entity, to_entity));

ALTER TABLE cb_chit_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE cb_chit_item FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON cb_chit_item;
CREATE POLICY rls_entity ON cb_chit_item
  USING      (EXISTS (SELECT 1 FROM cb_chit c WHERE c.id = cb_chit_item.chit_id))
  WITH CHECK (EXISTS (SELECT 1 FROM cb_chit c WHERE c.id = cb_chit_item.chit_id));

ALTER TABLE cb_chit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE cb_chit_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON cb_chit_log;
CREATE POLICY rls_entity ON cb_chit_log
  USING      (EXISTS (SELECT 1 FROM cb_chit c WHERE c.id = cb_chit_log.chit_id))
  WITH CHECK (EXISTS (SELECT 1 FROM cb_chit c WHERE c.id = cb_chit_log.chit_id));

COMMIT;
