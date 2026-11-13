-- b855_rls_shared_tables_sec75_db103.sql — SEC-75 (next group) + DB-103 (13 Nov 2026): row level security on six of the shared tables, in the shapes Athi ruled on 21 Oct
-- ("either side of the row" · "owner writes, subscribers read").
--
-- ⚠️⚠️ DRAFT — NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres) AFTER the api that carries this change is deployed, in this order:
--    1. deploy the api (routes/connections.js, routes/connectors.js, routes/assist.js, lib/container.js, lib/network-catalogue.js, lib/storage-object.js now bind the shop: withEntity)
--    2. run THIS file once on SIT, then on production (safe to re-run: ENABLE/FORCE are idempotent, every policy is DROP POLICY IF EXISTS then CREATE; touches no rows, no grants)
--    3. read-only CHECK below, then `node scripts/rls-census.cjs --save` (aimed at the database Athi names) so db/rls-baseline.json shows the six as RLS on
--    Run it BEFORE the deploy and the connection request/respond routes, the connector list/ingest/ping, the catalogue-source / container writes and the image upload fail closed.
--
-- WHO MAY SEE / WRITE A ROW (key: app.current_entity, set by withEntity; the shape of b778/b779/b831/b851)
--   connections          either side reads (from or to); only the sender inserts; only the receiver answers (UPDATE); nobody deletes (no api path does)
--   connector_connection the shop (entity_id) reads and writes; the counterparty reads its own side; only the shop inserts, updates, deletes
--   dispute_participants entity_id = me, read and write (retired table: no api statement names it, routes/chits.js:5957; the lock closes the door for good)
--   catalogue_source     everyone reads (shop window, adoption, brand picker); only the owning brand writes; an ownerless (platform-seeded) row may be claimed, as the app does today
--   product_container    same shape as catalogue_source (owner_entity_id)
--   media_blobs          everyone reads (public image links; the key is the secret and the api checks its owner); only the shop the row names writes or deletes
-- ⚠️ NOT IN THIS FILE (each needs a design, see the PR): identities (login looks an e-mail up before any shop is bound) · standard_source (lib/source.js mints it for a NEW source
--    entity, so the writer is not the owner) · entity_schemas + schema_fields (15 files read them, some across shops) · cb_edge, cb_entity, product_version, resolved_blueprint, container_region_override.
-- RLS: ENABLE + FORCE on each, literal statements (db-85 rule). Privileges unchanged (cb_app keeps SELECT, INSERT, UPDATE, DELETE; nothing is revoked).
--
-- ⚠️ scripts/reset-2-wipe.sql must be run AS postgres after b855: under FORCE the app role would touch 0 rows silently.
-- ROLL BACK (restores the open state exactly; catalogue_source keeps its original read_all policy):
--    ALTER TABLE connections NO FORCE ROW LEVEL SECURITY;          ALTER TABLE connections DISABLE ROW LEVEL SECURITY;
--    ALTER TABLE connector_connection NO FORCE ROW LEVEL SECURITY; ALTER TABLE connector_connection DISABLE ROW LEVEL SECURITY;
--    ALTER TABLE dispute_participants NO FORCE ROW LEVEL SECURITY; ALTER TABLE dispute_participants DISABLE ROW LEVEL SECURITY;
--    ALTER TABLE catalogue_source NO FORCE ROW LEVEL SECURITY;     ALTER TABLE catalogue_source DISABLE ROW LEVEL SECURITY;
--    ALTER TABLE product_container NO FORCE ROW LEVEL SECURITY;    ALTER TABLE product_container DISABLE ROW LEVEL SECURITY;
--    ALTER TABLE media_blobs NO FORCE ROW LEVEL SECURITY;          ALTER TABLE media_blobs DISABLE ROW LEVEL SECURITY;
--    (the policies may stay: with RLS disabled they do nothing.)
-- CHECK (read-only): SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, count(p.polname) AS policies
--      FROM pg_class c LEFT JOIN pg_policy p ON p.polrelid = c.oid
--     WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('connections','connector_connection','dispute_participants','catalogue_source','product_container','media_blobs') GROUP BY 1,2,3 ORDER BY 1;
--      Expect true, true on all six; policies: catalogue_source 3, connections 3, connector_connection 2, dispute_participants 1, media_blobs 2, product_container 3.

BEGIN;
SET LOCAL lock_timeout = '5s';   -- each ALTER takes ACCESS EXCLUSIVE: fail fast instead of queueing behind a long read; a failed run changed nothing and is safe to run again

-- connections: either side of the row
ALTER TABLE connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE connections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connections_read_either_side ON connections;
CREATE POLICY connections_read_either_side ON connections FOR SELECT
  USING (from_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid
         OR to_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
DROP POLICY IF EXISTS connections_insert_sender ON connections;
CREATE POLICY connections_insert_sender ON connections FOR INSERT
  WITH CHECK (from_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
DROP POLICY IF EXISTS connections_respond_receiver ON connections;
CREATE POLICY connections_respond_receiver ON connections FOR UPDATE
  USING      (to_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (to_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- connector_connection: the shop's rows; the counterparty may read its side
ALTER TABLE connector_connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_connection FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON connector_connection;
CREATE POLICY rls_entity ON connector_connection
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
DROP POLICY IF EXISTS connector_connection_read_counterparty ON connector_connection;
CREATE POLICY connector_connection_read_counterparty ON connector_connection FOR SELECT
  USING (counterparty_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- dispute_participants: one row per party, read and written as that party (retired table)
ALTER TABLE dispute_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispute_participants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON dispute_participants;
CREATE POLICY rls_entity ON dispute_participants
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- catalogue_source: read by all (read_all is already in the baseline), written by the owning brand
ALTER TABLE catalogue_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue_source FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS read_all ON catalogue_source;
CREATE POLICY read_all ON catalogue_source FOR SELECT USING (true);
DROP POLICY IF EXISTS rls_entity ON catalogue_source;
CREATE POLICY rls_entity ON catalogue_source
  USING      (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
DROP POLICY IF EXISTS catalogue_source_claim_unowned ON catalogue_source;
CREATE POLICY catalogue_source_claim_unowned ON catalogue_source FOR UPDATE
  USING      (owner_entity_id IS NULL)
  WITH CHECK (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- product_container: read by all, written by the owner
ALTER TABLE product_container ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_container FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_container_read_all ON product_container;
CREATE POLICY product_container_read_all ON product_container FOR SELECT USING (true);
DROP POLICY IF EXISTS rls_entity ON product_container;
CREATE POLICY rls_entity ON product_container
  USING      (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
DROP POLICY IF EXISTS product_container_claim_unowned ON product_container;
CREATE POLICY product_container_claim_unowned ON product_container FOR UPDATE
  USING      (owner_entity_id IS NULL)
  WITH CHECK (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- media_blobs: read by all (the api checks the key's owner), written and deleted by the shop the row names
ALTER TABLE media_blobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_blobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS media_blobs_read_all ON media_blobs;
CREATE POLICY media_blobs_read_all ON media_blobs FOR SELECT USING (true);
DROP POLICY IF EXISTS rls_entity ON media_blobs;
CREATE POLICY rls_entity ON media_blobs
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

COMMIT;
