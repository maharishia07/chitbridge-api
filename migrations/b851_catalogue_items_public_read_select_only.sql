-- b851_catalogue_items_public_read_select_only.sql — DB-102 (11 Nov 2026): the public-catalogue read rule on catalogue_items covers SELECT only.
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres) after SIT has run it. Safe to repeat: DROP POLICY IF EXISTS, then CREATE. Touches no rows and no grants.
--
-- WHY. rls_entity on catalogue_items is one FOR ALL policy whose USING also lets a row through when its shop's default entity_schemas row is public (the shop window).
--    USING decides which rows UPDATE and DELETE may touch, so with the database alone shop B could DELETE shop A's public item (and UPDATE reaches it until WITH CHECK refuses the result).
--    The reader that needs the public clause is SELECT. Fix = same two-policy split as other read-wide / write-own tables: policies are permissive and OR together.
--      rls_entity                    FOR ALL     owner shop only (app.current_entity = entity_id), USING and WITH CHECK   -> insert / update / delete / own reads
--      catalogue_items_public_read   FOR SELECT  the old public-schema clause, unchanged text                              -> the shop window read, as before
--    A person sees no change: every write in the api already runs under its own shop (lib/catalogue-write.js, lib/mint-product.js, routes/assist.js).
-- RLS: catalogue_items stays ENABLED + FORCED; two policies, written as literal statements (db-85 rule).
-- ROLL BACK (restores the earlier single policy exactly):
--    DROP POLICY IF EXISTS catalogue_items_public_read ON catalogue_items;
--    DROP POLICY IF EXISTS rls_entity ON catalogue_items;
--    CREATE POLICY rls_entity ON catalogue_items
--      USING (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid
--             OR EXISTS (SELECT 1 FROM entity_schemas es WHERE es.entity_id = catalogue_items.entity_id AND es.is_default = true AND es.status::text = 'active' AND es.visibility::text = 'public'))
--      WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
-- CHECK (read-only): SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'catalogue_items'::regclass;   Expect rls_entity = '*' and catalogue_items_public_read = 'r'.

BEGIN;

ALTER TABLE catalogue_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_entity ON catalogue_items;
CREATE POLICY rls_entity ON catalogue_items
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

DROP POLICY IF EXISTS catalogue_items_public_read ON catalogue_items;
CREATE POLICY catalogue_items_public_read ON catalogue_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM entity_schemas es
                 WHERE es.entity_id = catalogue_items.entity_id AND es.is_default = true
                   AND es.status::text = 'active' AND es.visibility::text = 'public'));

COMMIT;
