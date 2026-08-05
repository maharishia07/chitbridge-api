-- WIPE.sql — clean slate. THE ONLY FILE TO RUN. Paste it whole, in one session.
--
-- v2, 2026-08-05, after v1 failed on:
--   ERROR 23503: update or delete on "identities" violates foreign key constraint
--                "customer_list_customer_identity_id_fkey" on table "customer_list"
--
-- ── WHY v1 FAILED, and why the old reset-2-wipe.sql would have failed the same way ─────────────────────────────
-- Both swept "every table with an `entity_id` column", found dynamically. That sounds general and is not: FIVE
-- tables reference identities through a DIFFERENTLY-NAMED column and were therefore never touched —
--
--   chit_disputes   raised_by_entity_id · resolved_by_entity_id · target_entity_id
--   chit_messages   sender_entity_id · visibility_entity_id
--   connections     from_entity_id · to_entity_id
--   customer_list   customer_identity_id · owner_entity_id
--   supplier_list   supplier_entity_id · owner_entity_id
--
-- Their rows then blocked `DELETE FROM identities`. Nothing was lost — the whole thing is one transaction and the
-- exception rolled it back — but it could not succeed.
--
-- v2 does not sweep by COLUMN NAME. It asks the catalogue which tables actually have a foreign key pointing at
-- identities, whatever the column is called, so a table added next month is covered without editing this file.
--
-- ── WHAT SURVIVES ──────────────────────────────────────────────────────────────────────────────────────────────
--   assist_qa (the assistant's 54-row library) · catalogue_source (every blueprint) · boilerplate · ai_skill ·
--   constitution · standard_document · work_pattern · capability · region_layer · installation · jurisdiction.
--   A copy of the assistant library was taken via the API anyway and is committed at
--   C:\dev\assistant-backup-2026-08-05\.
--
--   ⚠️ YOUR OWN LOGIN IS DELETED. Intentional. Re-register afterwards, dev OTP 123456.
--
-- ── SAFETY ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- No phrase to type. It runs in one transaction and RAISES — rolling everything back — if a protected table lost
-- rows or if the wipe did not complete. It verifies the OUTCOME rather than asking whether you meant it.

BEGIN;
SET LOCAL row_security = off;

DO $$
DECLARE
  tbl          text;
  pass         int;
  failed       int;
  n_identities int;
  n_entities   int;
  qa_before    int;  qa_after   int;
  src_before   int;  src_after  int;
  leftover     int;
  targets      text[];
BEGIN
  -- ── PRE-FLIGHT ───────────────────────────────────────────────────────────────────────────────────────────
  SELECT count(*) INTO n_identities FROM identities;
  SELECT count(*) INTO n_entities   FROM identities WHERE identity_type = 'entity';
  SELECT count(*) INTO qa_before    FROM assist_qa;
  SELECT count(*) INTO src_before   FROM catalogue_source;

  RAISE NOTICE '──────────────────────────────────────────────────';
  RAISE NOTICE 'BEFORE:     % identities (% entities)', n_identities, n_entities;
  RAISE NOTICE 'PROTECTED:  assist_qa=%  catalogue_source=%', qa_before, src_before;

  IF qa_before = 0 THEN
    RAISE EXCEPTION 'REFUSING: assist_qa is empty (expected ~54). Wrong database, or the library is already gone — do not wipe on top of that.';
  END IF;
  IF n_identities = 0 THEN
    RAISE EXCEPTION 'REFUSING: no identities to delete. Either this already ran, or you are connected somewhere unexpected.';
  END IF;

  -- ── BUILD THE TARGET LIST ────────────────────────────────────────────────────────────────────────────────
  -- Two sources, unioned: anything with an `entity_id` column, AND anything with a real foreign key to
  -- identities under any column name. The second is what v1 was missing.
  SELECT array_agg(DISTINCT t) INTO targets FROM (
    SELECT table_name::text AS t
      FROM information_schema.columns
     WHERE column_name = 'entity_id' AND table_schema = 'public' AND table_name <> 'identities'
    UNION
    SELECT c.conrelid::regclass::text
      FROM pg_constraint c
     WHERE c.contype = 'f'
       AND c.confrelid = 'identities'::regclass
       AND c.conrelid <> 'identities'::regclass
  ) s;

  RAISE NOTICE 'SWEEPING:   % tables', COALESCE(array_length(targets, 1), 0);

  -- schema_fields hangs off entity_schemas by schema_id and has no reference to identities at all, so it is
  -- invisible to both queries above and must be cleared explicitly.
  BEGIN DELETE FROM schema_fields; EXCEPTION WHEN undefined_table THEN NULL; END;

  -- ── DELETE, IN PASSES ────────────────────────────────────────────────────────────────────────────────────
  -- Some targets reference each other (chit_detail → chit_header, chit_disputes → chit_header), so a single
  -- ordered pass would need a dependency sort. Repeating until nothing fails converges without one, and does not
  -- silently skip a table the way ON DELETE CASCADE assumptions would.
  FOR pass IN 1..6 LOOP
    failed := 0;
    FOREACH tbl IN ARRAY targets LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I', tbl);
      EXCEPTION
        WHEN foreign_key_violation THEN failed := failed + 1;   -- a child still holds it; next pass
        WHEN undefined_table       THEN NULL;                   -- dropped since; ignore
      END;
    END LOOP;
    EXIT WHEN failed = 0;
    IF pass = 6 THEN
      RAISE EXCEPTION 'ROLLING BACK: % table(s) still blocked by foreign keys after 6 passes. There is a dependency cycle this script cannot resolve — investigate rather than forcing it.', failed;
    END IF;
  END LOOP;

  -- Identities last: children first (actors and storefront customers hang off parent_entity_id), then the rest.
  DELETE FROM identities WHERE parent_entity_id IS NOT NULL;
  DELETE FROM identities;

  -- ── VERIFY THE OUTCOME, still inside the transaction ─────────────────────────────────────────────────────
  SELECT count(*) INTO qa_after  FROM assist_qa;
  SELECT count(*) INTO src_after FROM catalogue_source;
  SELECT count(*) INTO leftover  FROM identities;

  IF qa_after <> qa_before THEN
    RAISE EXCEPTION 'ROLLING BACK: assist_qa went from % to %. The assistant library must survive a wipe.', qa_before, qa_after;
  END IF;
  IF src_after <> src_before THEN
    RAISE EXCEPTION 'ROLLING BACK: catalogue_source went from % to %. Blueprints must survive a wipe.', src_before, src_after;
  END IF;
  IF leftover <> 0 THEN
    RAISE EXCEPTION 'ROLLING BACK: % identities still present — the wipe did not complete.', leftover;
  END IF;

  RAISE NOTICE '──────────────────────────────────────────────────';
  RAISE NOTICE 'DONE.       % identities deleted', n_identities;
  RAISE NOTICE 'INTACT:     assist_qa=%  catalogue_source=%  (unchanged)', qa_after, src_after;
  RAISE NOTICE 'Blueprints are now UNOWNED — the seed re-points them.';
  RAISE NOTICE 'Say "done" and seeding is automatic from here.';
  RAISE NOTICE '──────────────────────────────────────────────────';
END $$;

COMMIT;

-- ── VERIFY (runs after the commit; all four should read as noted) ───────────────────────────────────────────────
SELECT (SELECT count(*) FROM identities)       AS identities_left,   -- 0
       (SELECT count(*) FROM chit_header)      AS chits_left,        -- 0
       (SELECT count(*) FROM catalogue_items)  AS items_left,        -- 0
       (SELECT count(*) FROM assist_qa)        AS assistant_kept,    -- ~54, UNCHANGED
       (SELECT count(*) FROM catalogue_source) AS blueprints_kept;   -- UNCHANGED

-- Optional, and it cannot run inside a transaction — run it on its own afterwards to reclaim disk:
--   VACUUM (ANALYZE) identities, chit_header, chit_detail, chit_messages, cb_attachment, catalogue_items;
