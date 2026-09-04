-- purge_test_entities · step 3 of 3 — DELETE. ⚠️ IRREVERSIBLE. Run only after step 1 showed no real business.
-- Same discovery as the dry-run. Multi-pass: a table blocked by a foreign key is retried after its dependants are
-- gone; anything still blocked after 6 passes is reported, not forced. ONE result set at the end.
DROP TABLE IF EXISTS purge_done;
CREATE TEMP TABLE purge_done (tbl text, rows bigint, note text);
DO $$
DECLARE t text; n bigint; ids uuid[]; pass int; progressed boolean; pending text[]; nxt text[];
BEGIN
  SELECT array_agg(identity_id) INTO ids FROM identities
   WHERE identity_type = 'entity'
     AND ( email ILIKE '%@test.example' OR email ILIKE '%@test-cb.com'
        OR user_id ILIKE 'e2eco-%' OR display_name ILIKE 'e2eco-%'
        OR user_id ILIKE 'e2e.pool%' OR display_name ILIKE 'E2E Pool%' );
  IF ids IS NULL THEN INSERT INTO purge_done VALUES ('(no test entities)', 0, ''); RETURN; END IF;
  SELECT array_agg(c.table_name::text ORDER BY c.table_name) INTO pending
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.column_name = 'entity_id' AND c.table_name <> 'identities';
  FOR pass IN 1..6 LOOP
    progressed := false; nxt := ARRAY[]::text[];
    FOREACH t IN ARRAY pending LOOP
      BEGIN
        EXECUTE format('DELETE FROM %I WHERE entity_id = ANY($1)', t) USING ids;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n > 0 THEN INSERT INTO purge_done VALUES (t, n, 'pass ' || pass); END IF;
        progressed := true;
      EXCEPTION WHEN foreign_key_violation THEN nxt := nxt || t;
               WHEN OTHERS THEN INSERT INTO purge_done VALUES (t, -1, 'skipped: ' || SQLSTATE);
      END;
    END LOOP;
    pending := nxt;
    EXIT WHEN array_length(pending, 1) IS NULL OR NOT progressed;
  END LOOP;
  IF array_length(pending, 1) IS NOT NULL THEN
    FOREACH t IN ARRAY pending LOOP INSERT INTO purge_done VALUES (t, -1, 'still blocked by a foreign key'); END LOOP;
  END IF;
  DELETE FROM identities WHERE identity_type = 'actor' AND parent_entity_id = ANY(ids);
  GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO purge_done VALUES ('identities (actors)', n, '');
  DELETE FROM identities WHERE identity_id = ANY(ids);
  GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO purge_done VALUES ('identities (test entities)', n, '');
END $$;
SELECT tbl, rows, note FROM purge_done ORDER BY rows DESC, tbl;
