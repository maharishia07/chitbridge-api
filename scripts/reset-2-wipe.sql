-- reset-2-wipe.sql — CLEAN SLATE. Deletes EVERY identity (entities, actors, storefront customers) and all
-- entity-scoped data. Run scripts/reset-1-backup.sql first.
--
-- ⚠️⚠️  THIS DELETES YOUR OWN LOGIN TOO. That is intentional — it is a clean slate, not a cleanup. You re-register
--        afterwards (self-serve, dev OTP 123456) and then run scripts/seed-test-entities.js.
-- ⚠️     Confirm which database you are connected to. The Railway host is named "…-production…" but is wired to dev.
--
-- WHAT SURVIVES, and why you do not need to back it up:
--   catalogue_source (every blueprint incl. Royale Play) · boilerplate · ai_skill · constitution ·
--   standard_document · work_pattern · capability · blueprints · assist_qa
--   — none of these has an entity_id column, so the entity-scoped delete below cannot reach them.
--   Only `catalogue_source.owner_entity_id` is left dangling; re-point it after seeding (see the tail of this file).
--
-- This file is ONE paste, ONE session (the confirmation is a temp table).

SET row_security = off;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
--  ✏️  TO ARM THIS, change the word below to exactly:  WIPE EVERYTHING
--      Leave it as-is and the script refuses. There is no other safety on this one.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS _confirm;
CREATE TEMP TABLE _confirm(phrase text);
INSERT INTO _confirm VALUES ('NOT ARMED');
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE tbl text; n_ent int; n_all int; ok text;
BEGIN
  SELECT phrase INTO ok FROM _confirm LIMIT 1;
  IF ok IS DISTINCT FROM 'WIPE EVERYTHING' THEN
    RAISE EXCEPTION 'REFUSING: not armed. Change the phrase in the _confirm block to exactly: WIPE EVERYTHING';
  END IF;

  SELECT count(*) INTO n_ent FROM identities WHERE identity_type = 'entity';
  SELECT count(*) INTO n_all FROM identities;
  RAISE NOTICE 'Wiping % identities (% entities) and all entity-scoped data…', n_all, n_ent;

  -- schema_fields hang off entity_schemas by schema_id (no entity_id) — clear first to avoid an FK block
  BEGIN DELETE FROM schema_fields; EXCEPTION WHEN undefined_table THEN NULL; END;

  -- every table scoped by entity_id — unconditional, since nothing is being kept
  FOR tbl IN
    SELECT table_name FROM information_schema.columns
     WHERE column_name = 'entity_id' AND table_schema = 'public' AND table_name <> 'identities'
  LOOP
    EXECUTE format('DELETE FROM public.%I', tbl);
  END LOOP;

  -- children first (actors + storefront customers hang off parent_entity_id), then everything
  DELETE FROM identities WHERE parent_entity_id IS NOT NULL;
  DELETE FROM identities;

  -- the blueprints survive; their ownership pointer does not
  UPDATE catalogue_source SET owner_entity_id = NULL WHERE owner_entity_id IS NOT NULL;

  RAISE NOTICE 'Done. % identities removed. Blueprints kept, now unowned.', n_all;
END $$;

DROP TABLE IF EXISTS _confirm;

-- ── VERIFY ────────────────────────────────────────────────────────────────────────────────────────────────
SELECT (SELECT count(*) FROM identities)        AS identities_left,      -- expect 0
       (SELECT count(*) FROM chit_header)       AS chits_left,           -- expect 0
       (SELECT count(*) FROM catalogue_items)   AS items_left,           -- expect 0
       (SELECT count(*) FROM catalogue_source)  AS blueprints_kept;      -- expect UNCHANGED

SELECT source_key, title, active, owner_entity_id FROM catalogue_source ORDER BY source_key;

-- ── NEXT ──────────────────────────────────────────────────────────────────────────────────────────────────
--  1. Re-register your own login in the app (dev OTP 123456).
--  2. node scripts/seed-test-entities.js      → creates Alpha · Beta · Gamma · Delta
--  3. Re-point a blueprint's owner if you want it editable again, e.g.:
--       UPDATE catalogue_source SET owner_entity_id =
--         (SELECT identity_id FROM identities WHERE email = 'alpha@test-cb.com')
--       WHERE source_key = 'beta-royale-play@v1';
--  4. Reclaim disk (VACUUM cannot run inside a transaction — run it alone):
--       VACUUM (ANALYZE) identities, chit_header, chit_detail, chit_messages, cb_attachment, catalogue_items;
