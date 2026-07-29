-- cleanup-2-delete.sql — DESTRUCTIVE. Keeps the entities you name; deletes every other entity and all their data.
-- Run scripts/cleanup-1-inspect.sql FIRST and choose the keep-list from what it shows.
--
-- ⚠️ Confirm which database you are connected to. The Railway host is named "…-production…" but is wired to dev.
--
-- ONE EDIT POINT. The keep-list is a TEMP table built at the top and read by every step below, so there is nothing
-- to keep in sync. (Temp, not a view: a postgres-owned view over `identities` left behind in `public` would be an
-- RLS-bypass footgun. pg_temp is private to this session and vanishes when it ends.)
-- This whole file is ONE paste, ONE session — do not run it in pieces or the temp table will not exist.

SET row_security = off;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
--  ✏️  EDIT ONLY THIS BLOCK.  Everything below reads from it.
--      Put YOUR OWN LOGIN first. Add blueprint owners you want to stay editable (inspect step 2).
--      Match by email OR bridge_id — either works, list as many as you like.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS _keep_spec;
CREATE TEMP TABLE _keep_spec (email text, bridge_id text);
INSERT INTO _keep_spec (email, bridge_id) VALUES
  ('CHANGE-ME@example.com',        NULL),   -- ← YOUR LOGIN. Required.
  ('document.store@test-cb.com',   NULL),   -- Document Services (the forms demo)
  ('alphatimbers@test-cb.com',     NULL),   -- Alpha Timbers (the B2B/supplier demo)
  (NULL,                           'CBXXXXXXXX')   -- ← e.g. the Royale Play blueprint owner
;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

-- resolve the spec to real ids
DROP TABLE IF EXISTS _keep;
CREATE TEMP TABLE _keep AS
SELECT i.identity_id, i.bridge_id, i.display_name, i.email
FROM identities i
JOIN _keep_spec k
  ON (k.email IS NOT NULL AND lower(i.email) = lower(k.email))
  OR (k.bridge_id IS NOT NULL AND i.bridge_id = k.bridge_id)
WHERE i.identity_type = 'entity';

-- ── LAST LOOK — this prints before anything is deleted ────────────────────────────────────────────────────
SELECT 'KEEPING' AS what, bridge_id, display_name, email FROM _keep ORDER BY display_name;

SELECT (SELECT count(*) FROM _keep)                                                          AS keeping,
       (SELECT count(*) FROM identities WHERE identity_type='entity')                        AS total_entities,
       (SELECT count(*) FROM identities WHERE identity_type='entity'
          AND identity_id NOT IN (SELECT identity_id FROM _keep))                            AS will_delete,
       (SELECT count(*) FROM catalogue_source s WHERE s.owner_entity_id IS NOT NULL
          AND s.owner_entity_id NOT IN (SELECT identity_id FROM _keep))                      AS blueprints_orphaned;

-- ── THE DELETE ────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE tbl text; eids uuid[]; keep_n int; orphan_n int;
BEGIN
  SELECT count(*) INTO keep_n FROM _keep;
  IF keep_n = 0 THEN
    RAISE EXCEPTION 'REFUSING: the keep-list matched 0 entities. Edit the _keep_spec block at the top — the placeholders are still in it.';
  END IF;

  SELECT count(*) INTO orphan_n FROM catalogue_source s
   WHERE s.owner_entity_id IS NOT NULL AND s.owner_entity_id NOT IN (SELECT identity_id FROM _keep);
  IF orphan_n > 0 THEN
    RAISE NOTICE 'NOTE: % blueprint(s) will survive but become permanently uneditable (owner deleted).', orphan_n;
  END IF;

  SELECT array_agg(identity_id) INTO eids FROM identities
   WHERE identity_type = 'entity' AND identity_id NOT IN (SELECT identity_id FROM _keep);
  IF eids IS NULL THEN RAISE NOTICE 'Nothing to delete — every entity is on the keep-list.'; RETURN; END IF;
  RAISE NOTICE 'Keeping % entities; deleting %.', keep_n, array_length(eids, 1);

  -- schema_fields hang off entity_schemas by schema_id (no entity_id) — clear first to avoid an FK block
  BEGIN
    DELETE FROM schema_fields WHERE schema_id IN (SELECT schema_id FROM entity_schemas WHERE entity_id = ANY(eids));
  EXCEPTION WHEN undefined_table THEN NULL; END;

  FOR tbl IN
    SELECT table_name FROM information_schema.columns
     WHERE column_name = 'entity_id' AND table_schema = 'public' AND table_name <> 'identities'
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE entity_id = ANY($1)', tbl) USING eids;
  END LOOP;

  DELETE FROM identities WHERE parent_entity_id = ANY(eids);   -- co-assists / actors under them
  DELETE FROM identities WHERE identity_id      = ANY(eids);

  RAISE NOTICE 'Done. % entities removed.', array_length(eids, 1);
END $$;

-- ── VERIFY ────────────────────────────────────────────────────────────────────────────────────────────────
SELECT identity_type, count(*) FROM identities GROUP BY 1 ORDER BY 1;
SELECT catalogue_visibility, count(*) FROM identities WHERE identity_type='entity' GROUP BY 1;   -- after b114
SELECT count(*) AS orphaned_blueprints FROM catalogue_source s
 WHERE s.owner_entity_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM identities i WHERE i.identity_id = s.owner_entity_id);

DROP TABLE IF EXISTS _keep;
DROP TABLE IF EXISTS _keep_spec;

-- Reclaim disk after a large delete — VACUUM cannot run inside a transaction, so run this on its own afterwards:
--   VACUUM (ANALYZE) identities, chit_header, chit_detail, chit_messages, cb_attachment, catalogue_items;
