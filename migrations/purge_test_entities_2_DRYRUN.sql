-- purge_test_entities · step 2 of 3 — COUNT the rows per table. Deletes nothing. ONE result set.
-- Discovers every public table with an entity_id column at run time (a table from an unrun migration is simply absent),
-- so nothing here can throw 42P01.
DROP TABLE IF EXISTS purge_counts;
CREATE TEMP TABLE purge_counts (tbl text, rows bigint);
DO $$
DECLARE t text; n bigint; ids uuid[];
BEGIN
  SELECT array_agg(identity_id) INTO ids FROM identities
   WHERE identity_type = 'entity'
     AND ( email ILIKE '%@test.example' OR email ILIKE '%@test-cb.com'
        OR user_id ILIKE 'e2eco-%' OR display_name ILIKE 'e2eco-%'
        OR user_id ILIKE 'e2e.pool%' OR display_name ILIKE 'E2E Pool%' );
  IF ids IS NULL THEN INSERT INTO purge_counts VALUES ('(no test entities)', 0); RETURN; END IF;
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.column_name = 'entity_id' AND c.table_name <> 'identities'
     ORDER BY c.table_name
  LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM %I WHERE entity_id = ANY($1)', t) INTO n USING ids;
      IF n > 0 THEN INSERT INTO purge_counts VALUES (t, n); END IF;
    EXCEPTION WHEN OTHERS THEN INSERT INTO purge_counts VALUES (t || ' (skipped: ' || SQLSTATE || ')', -1);
    END;
  END LOOP;
  SELECT count(*) INTO n FROM identities WHERE identity_type = 'actor' AND parent_entity_id = ANY(ids);
  INSERT INTO purge_counts VALUES ('identities (actors of test entities)', n);
  INSERT INTO purge_counts VALUES ('identities (test entities)', array_length(ids, 1));
END $$;
SELECT tbl, rows FROM purge_counts ORDER BY rows DESC, tbl;
