-- RUN-2026-10-20-10 · DB-80 · STEP 1 of 2: install the widened purge function (api PR #310, migrations/purge_test_entities_ROUTINE.sql)
-- and LOOK ONLY (dry run). Deletes nothing. Paste the result back; then run RUN-2026-10-20-11.
-- Expect: ENTITIES about 3,135 (3,125 test shops + 10 sub-shops), 'people and customers' about 115+, and small table counts.

-- purge_test_entities — ONE script, routine maintenance. Athi, 2026-09-04: "give me a single sql script to execute,
-- or maybe as routine maintenance".
--
-- What it does, every time it runs:
--   1. installs (or refreshes) the function purge_test_entities(dry boolean)
--   2. runs it in APPLY mode and returns ONE result set: every entity it removed (name · email) and every table it
--      cleared with the row count.
-- Tables are discovered at run time: every public table with an entity_id column, PLUS every table that hangs off one
-- of those through a foreign key without an entity_id of its own (schema_fields → entity_schemas was the one that
-- stopped the first run: 23503 on identities). Nothing here names a table, so nothing can throw 42P01.
--
-- A TEST entity is one the e2e suite minted, by pattern only:
--   email  …@test.example | …@test-cb.com      user_id / display_name  e2eco-… | e2e.pool… | E2E Pool …
-- A real business never matches these patterns. Change the pattern in ONE place: the CTE inside the function.
-- Widened 20 Oct (DB-80): a shop whose parent is a test shop is one too (any depth), and every non-entity identity under a test
-- shop goes with it (staff logins AND customers), after the rows that cite them. That run left 3,125 shop rows blocked by 115
-- customers and 10 sub-shops. NOT all-or-nothing: each table's error is caught and reported (rows = -1), the rest still goes.
--
-- Routine: run this script whenever the list gets long, or from the editor:   SELECT * FROM purge_test_entities(false);
-- Look first without deleting:                                                 SELECT * FROM purge_test_entities(true);
-- (pg_cron, if enabled: SELECT cron.schedule('purge-test-entities', '0 3 * * 0', $$SELECT purge_test_entities(false)$$);)

CREATE OR REPLACE FUNCTION purge_test_entities(dry boolean DEFAULT true)
RETURNS TABLE (what text, detail text, rows bigint)
LANGUAGE plpgsql AS $fn$
DECLARE t text; n bigint; ids uuid[]; kids uuid[]; more uuid[]; pass int; progressed boolean; pending text[]; nxt text[]; r record; fk record;
BEGIN
  SELECT array_agg(identity_id) INTO ids FROM identities
   WHERE identity_type = 'entity'
     AND ( email ILIKE '%@test.example' OR email ILIKE '%@test-cb.com'
        OR user_id ILIKE 'e2eco-%' OR display_name ILIKE 'e2eco-%'
        OR user_id ILIKE 'e2e.pool%' OR display_name ILIKE 'E2E Pool%' );
  IF ids IS NULL THEN what := 'nothing to purge'; detail := ''; rows := 0; RETURN NEXT; RETURN; END IF;

  /* a shop whose parent is a test shop is test data too, at any depth (20 Oct: 10 sub-shops kept their parents alive) */
  LOOP
    SELECT array_agg(identity_id) INTO more FROM identities
     WHERE identity_type = 'entity' AND parent_entity_id = ANY(ids) AND NOT identity_id = ANY(ids);
    EXIT WHEN more IS NULL;
    ids := ids || more;
  END LOOP;
  /* the test shops' own people: staff logins (actor) AND customers (20 Oct: 115 "Net Buyer" customers blocked the delete) */
  SELECT array_agg(identity_id) INTO kids FROM identities
   WHERE identity_type <> 'entity' AND parent_entity_id = ANY(ids);
  kids := coalesce(kids, ARRAY[]::uuid[]);

  /* the entities themselves, named — so the report says WHO went, not only how many */
  FOR r IN SELECT display_name, email, user_id FROM identities WHERE identity_id = ANY(ids) ORDER BY created_at LOOP
    what := CASE WHEN dry THEN 'would remove entity' ELSE 'removed entity' END;
    detail := coalesce(r.display_name, '') || ' · ' || coalesce(r.email, '') || ' · ' || coalesce(r.user_id, '');
    rows := 1; RETURN NEXT;
  END LOOP;

  SELECT array_agg(c.table_name::text ORDER BY c.table_name) INTO pending
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.column_name = 'entity_id' AND c.table_name <> 'identities';

  /* ── children WITHOUT an entity_id, reached through a single-column foreign key to a tenant table ── */
  FOR fk IN
    SELECT ch.relname AS child, pa.relname AS parent, ca.attname AS child_col, paa.attname AS parent_col
      FROM pg_constraint k
      JOIN pg_class ch ON ch.oid = k.conrelid JOIN pg_namespace nch ON nch.oid = ch.relnamespace
      JOIN pg_class pa ON pa.oid = k.confrelid JOIN pg_namespace npa ON npa.oid = pa.relnamespace
      JOIN pg_attribute ca ON ca.attrelid = ch.oid AND ca.attnum = k.conkey[1]
      JOIN pg_attribute paa ON paa.attrelid = pa.oid AND paa.attnum = k.confkey[1]
     WHERE k.contype = 'f' AND array_length(k.conkey, 1) = 1
       AND nch.nspname = 'public' AND npa.nspname = 'public'
       AND pa.relname = ANY(pending)
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns c2 WHERE c2.table_schema = 'public' AND c2.table_name = ch.relname AND c2.column_name = 'entity_id')
       AND ch.relname <> 'identities'
  LOOP
    BEGIN
      IF dry THEN
        EXECUTE format('SELECT count(*) FROM %I WHERE %I IN (SELECT %I FROM %I WHERE entity_id = ANY($1))', fk.child, fk.child_col, fk.parent_col, fk.parent) INTO n USING ids;
        IF n > 0 THEN what := 'would clear'; detail := fk.child || ' (via ' || fk.parent || ')'; rows := n; RETURN NEXT; END IF;
      ELSE
        EXECUTE format('DELETE FROM %I WHERE %I IN (SELECT %I FROM %I WHERE entity_id = ANY($1))', fk.child, fk.child_col, fk.parent_col, fk.parent) USING ids;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n > 0 THEN what := 'cleared'; detail := fk.child || ' (via ' || fk.parent || ')'; rows := n; RETURN NEXT; END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN what := 'skipped'; detail := fk.child || ' via ' || fk.parent || ' (' || SQLSTATE || ')'; rows := -1; RETURN NEXT;
    END;
  END LOOP;

  IF dry THEN
    FOREACH t IN ARRAY pending LOOP
      BEGIN
        EXECUTE format('SELECT count(*) FROM %I WHERE entity_id = ANY($1)', t) INTO n USING ids;
        IF n > 0 THEN what := 'would clear'; detail := t; rows := n; RETURN NEXT; END IF;
      EXCEPTION WHEN OTHERS THEN what := 'skipped'; detail := t || ' (' || SQLSTATE || ')'; rows := -1; RETURN NEXT;
      END;
    END LOOP;
    what := 'would remove'; detail := 'identities (people and customers of test entities)'; rows := coalesce(array_length(kids, 1), 0); RETURN NEXT;
    what := 'would remove'; detail := 'identities (test entities)'; rows := array_length(ids, 1); RETURN NEXT;
    RETURN;
  END IF;

  /* ── APPLY: multi-pass so a table blocked by a foreign key is retried after its dependants are gone ── */
  FOR pass IN 1..8 LOOP
    progressed := false; nxt := ARRAY[]::text[];
    FOREACH t IN ARRAY pending LOOP
      BEGIN
        EXECUTE format('DELETE FROM %I WHERE entity_id = ANY($1)', t) USING ids;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n > 0 THEN what := 'cleared'; detail := t || ' (pass ' || pass || ')'; rows := n; RETURN NEXT; END IF;
        progressed := true;
      EXCEPTION WHEN foreign_key_violation THEN nxt := nxt || t;
               WHEN OTHERS THEN what := 'skipped'; detail := t || ' (' || SQLSTATE || ')'; rows := -1; RETURN NEXT;
      END;
    END LOOP;
    pending := nxt;
    EXIT WHEN array_length(pending, 1) IS NULL OR NOT progressed;
  END LOOP;
  IF array_length(pending, 1) IS NOT NULL THEN
    FOREACH t IN ARRAY pending LOOP what := 'still blocked by a foreign key'; detail := t; rows := -1; RETURN NEXT; END LOOP;
  END IF;

  /* ── every foreign key that points AT identities, whatever the column is called (customer_list.owner_entity_id
     stopped the second run): rows in ANY table that cite a test entity are removed before the entity itself ── */
  FOR fk IN
    SELECT ch.relname AS child, ca.attname AS child_col
      FROM pg_constraint k
      JOIN pg_class ch ON ch.oid = k.conrelid JOIN pg_namespace nch ON nch.oid = ch.relnamespace
      JOIN pg_class pa ON pa.oid = k.confrelid
      JOIN pg_attribute ca ON ca.attrelid = ch.oid AND ca.attnum = k.conkey[1]
     WHERE k.contype = 'f' AND array_length(k.conkey, 1) = 1 AND nch.nspname = 'public' AND pa.relname = 'identities' AND ch.relname <> 'identities'
  LOOP
    BEGIN
      EXECUTE format('DELETE FROM %I WHERE %I = ANY($1)', fk.child, fk.child_col) USING ids || kids;
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN what := 'cleared'; detail := fk.child || '.' || fk.child_col || ' (cites a test entity or its people)'; rows := n; RETURN NEXT; END IF;
    EXCEPTION WHEN OTHERS THEN what := 'skipped'; detail := fk.child || '.' || fk.child_col || ' (' || SQLSTATE || ')'; rows := -1; RETURN NEXT;
    END;
  END LOOP;
  BEGIN
    DELETE FROM identities WHERE identity_id = ANY(kids);
    GET DIAGNOSTICS n = ROW_COUNT; what := 'removed'; detail := 'identities (people and customers of test entities)'; rows := n; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN what := 'still blocked'; detail := 'identities (people and customers): ' || SQLERRM; rows := -1; RETURN NEXT;
  END;
  BEGIN
    DELETE FROM identities WHERE identity_id = ANY(ids);
    GET DIAGNOSTICS n = ROW_COUNT; what := 'removed'; detail := 'identities (test entities)'; rows := n; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN what := 'still blocked'; detail := 'identities: ' || SQLERRM; rows := -1; RETURN NEXT;
  END;
  RETURN;
END $fn$;

SELECT what, lines, rows
  FROM (SELECT CASE WHEN what LIKE '%entity' THEN 'ENTITIES' ELSE detail END AS what, count(*) AS lines, sum(rows) AS rows
          FROM purge_test_entities(true)
         GROUP BY 1) s
 ORDER BY (what <> 'ENTITIES'), rows DESC;
