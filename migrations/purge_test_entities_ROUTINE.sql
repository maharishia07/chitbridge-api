-- purge_test_entities — ONE script, routine maintenance. Athi, 2026-09-04: "give me a single sql script to execute,
-- or maybe as routine maintenance".
--
-- What it does, every time it runs:
--   1. installs (or refreshes) the function purge_test_entities(dry boolean)
--   2. runs it in APPLY mode and returns ONE result set: every entity it removed (name · email) and every table it
--      cleared with the row count. Tables are discovered at run time (any public table with an entity_id column), so a
--      table from an unrun migration is simply absent — nothing here can throw 42P01.
--
-- A TEST entity is one the e2e suite minted, by pattern only:
--   email  …@test.example | …@test-cb.com      user_id / display_name  e2eco-… | e2e.pool… | E2E Pool …
-- A real business never matches these patterns. Change the pattern in ONE place: the CTE inside the function.
--
-- Routine: run this script whenever the list gets long, or from the editor:   SELECT * FROM purge_test_entities(false);
-- Look first without deleting:                                                 SELECT * FROM purge_test_entities(true);
-- (pg_cron, if you enable it in Supabase: SELECT cron.schedule('purge-test-entities', '0 3 * * 0', $$SELECT purge_test_entities(false)$$);)

CREATE OR REPLACE FUNCTION purge_test_entities(dry boolean DEFAULT true)
RETURNS TABLE (what text, detail text, rows bigint)
LANGUAGE plpgsql AS $fn$
DECLARE t text; n bigint; ids uuid[]; pass int; progressed boolean; pending text[]; nxt text[]; r record;
BEGIN
  SELECT array_agg(identity_id) INTO ids FROM identities
   WHERE identity_type = 'entity'
     AND ( email ILIKE '%@test.example' OR email ILIKE '%@test-cb.com'
        OR user_id ILIKE 'e2eco-%' OR display_name ILIKE 'e2eco-%'
        OR user_id ILIKE 'e2e.pool%' OR display_name ILIKE 'E2E Pool%' );
  IF ids IS NULL THEN what := 'nothing to purge'; detail := ''; rows := 0; RETURN NEXT; RETURN; END IF;

  /* the entities themselves, named — so the report says WHO went, not only how many */
  FOR r IN SELECT display_name, email, user_id FROM identities WHERE identity_id = ANY(ids) ORDER BY created_at LOOP
    what := CASE WHEN dry THEN 'would remove entity' ELSE 'removed entity' END;
    detail := coalesce(r.display_name, '') || ' · ' || coalesce(r.email, '') || ' · ' || coalesce(r.user_id, '');
    rows := 1; RETURN NEXT;
  END LOOP;

  SELECT array_agg(c.table_name::text ORDER BY c.table_name) INTO pending
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.column_name = 'entity_id' AND c.table_name <> 'identities';

  IF dry THEN
    FOREACH t IN ARRAY pending LOOP
      BEGIN
        EXECUTE format('SELECT count(*) FROM %I WHERE entity_id = ANY($1)', t) INTO n USING ids;
        IF n > 0 THEN what := 'would clear'; detail := t; rows := n; RETURN NEXT; END IF;
      EXCEPTION WHEN OTHERS THEN what := 'skipped'; detail := t || ' (' || SQLSTATE || ')'; rows := -1; RETURN NEXT;
      END;
    END LOOP;
    SELECT count(*) INTO n FROM identities WHERE identity_type = 'actor' AND parent_entity_id = ANY(ids);
    what := 'would remove'; detail := 'identities (actors of test entities)'; rows := n; RETURN NEXT;
    what := 'would remove'; detail := 'identities (test entities)'; rows := array_length(ids, 1); RETURN NEXT;
    RETURN;
  END IF;

  /* APPLY — multi-pass so a table blocked by a foreign key is retried after its dependants are gone */
  FOR pass IN 1..6 LOOP
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
  DELETE FROM identities WHERE identity_type = 'actor' AND parent_entity_id = ANY(ids);
  GET DIAGNOSTICS n = ROW_COUNT; what := 'removed'; detail := 'identities (actors of test entities)'; rows := n; RETURN NEXT;
  DELETE FROM identities WHERE identity_id = ANY(ids);
  GET DIAGNOSTICS n = ROW_COUNT; what := 'removed'; detail := 'identities (test entities)'; rows := n; RETURN NEXT;
  RETURN;
END $fn$;

-- ⚠️ THIS LINE DELETES. Change false → true to only look.
SELECT * FROM purge_test_entities(false);
