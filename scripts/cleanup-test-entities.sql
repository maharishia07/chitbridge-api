-- cleanup-test-entities.sql — audit + sweep the data our test drivers create. DESTRUCTIVE (Part 3 only).
-- Run in the Supabase SQL Editor as the postgres role.
--
-- HOW TO USE, in order:
--   PART 0 · WEIGHT     — what is actually heavy in this database (read it, nothing changes)
--   PART 1 · DRY RUN    — how many test entities, by domain, and what hangs off them (nothing changes)
--   PART 2 · EYEBALL    — list every matched identity so you can confirm none is real (nothing changes)
--   PART 3 · DELETE     — the sweep. Only after Parts 1 and 2 look right.
--   PART 4 · RECLAIM    — optional VACUUM, only if Part 0 showed something genuinely heavy.
--
-- ⚠️ CONFIRM WHICH DATABASE YOU ARE POINTED AT before Part 3. The Railway host is named
--    "…-production…" but is wired to the dev database — the name is not the proof. Check the connection.
-- ⚠️ THE TEST PREDICATE is the domain list repeated in each part below. It is deliberately NOT factored into a
--    view: a postgres-owned view over `identities` left behind in `public` is an RLS-bypass footgun. Copy-paste
--    is the safer trade here. If you edit the list, edit it in ALL FOUR places (Parts 1a, 1c, 2, 3).
-- ⚠️ Only domains our own fixtures and script harnesses use are listed. Never add a domain a real customer
--    could plausibly own. Sources: tests/run-tests.js + scripts/*.js (@test.com dominates), e2e (@test.example).

-- ⚠️ `SET row_security = off` lasts only for the SESSION that runs it. The Supabase SQL Editor may use a fresh
--    pooled connection per execution, so it is repeated at the top of every part that needs it (1c and 3).
--    Do NOT rely on setting it once at the top and running the parts separately — FORCE-RLS tables would be missed.
-- ⚠️ If PART 3 fails on a foreign-key violation, STOP — do not force it. It means a REAL entity holds a row that
--    references a test entity (e.g. a real entity received a chit from one). That row is not ours to delete;
--    bring the error back and we decide per case.

-- ============================ PART 0 · WEIGHT (what is heavy, regardless of test data) ============================
-- Top 20 tables by total size on disk (heap + indexes + TOAST). Read this BEFORE deciding whether a sweep is even
-- worth it, and which tables deserve a retention policy of their own rather than a one-off delete.
-- est_rows is the planner's estimate (reltuples) — it is approximate and reads -1 on a never-analyzed table.
SELECT
  c.relname                                     AS table_name,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
  pg_size_pretty(pg_relation_size(c.oid))       AS heap_size,
  pg_size_pretty(pg_indexes_size(c.oid))        AS index_size,
  to_char(c.reltuples, 'FM999,999,999')         AS est_rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 20;

-- ============================ PART 1 · DRY RUN (counts — review before deleting) ============================
-- 1a. test identities by domain, so you can see WHICH driver made them.
SELECT split_part(email, '@', 2) AS domain, count(*) AS entities,
       min(created_at)::date AS first_seen, max(created_at)::date AS last_seen
FROM identities
WHERE email LIKE '%@test.example' OR email LIKE '%@test.com'  OR email LIKE '%@test-cb.com'
   OR email LIKE '%@demo-cb.com'  OR email LIKE '%@example.com' OR email LIKE '%@t.com'
   OR email LIKE '%@x.com'
GROUP BY 1 ORDER BY 2 DESC;

-- 1b. the blast radius: what hangs off those identities.
WITH e AS (
  SELECT identity_id FROM identities
  WHERE email LIKE '%@test.example' OR email LIKE '%@test.com'  OR email LIKE '%@test-cb.com'
     OR email LIKE '%@demo-cb.com'  OR email LIKE '%@example.com' OR email LIKE '%@t.com'
     OR email LIKE '%@x.com'
)
SELECT
  (SELECT count(*) FROM e)                                                              AS test_entities,
  (SELECT count(*) FROM identities     WHERE parent_entity_id IN (SELECT identity_id FROM e)) AS their_actors,
  (SELECT count(*) FROM chit_header    WHERE entity_id        IN (SELECT identity_id FROM e)) AS chits,
  (SELECT count(*) FROM entity_schemas WHERE entity_id        IN (SELECT identity_id FROM e)) AS schemas;

-- 1c. per-table row counts for EVERY entity_id-scoped table — exactly what Part 3 will delete.
--     Run this and KEEP THE OUTPUT: it is the before-picture of the sweep.
SET row_security = off;
DO $$
DECLARE tbl text; n bigint; eids uuid[];
BEGIN
  SELECT array_agg(identity_id) INTO eids FROM identities
  WHERE email LIKE '%@test.example' OR email LIKE '%@test.com'  OR email LIKE '%@test-cb.com'
     OR email LIKE '%@demo-cb.com'  OR email LIKE '%@example.com' OR email LIKE '%@t.com'
     OR email LIKE '%@x.com';
  IF eids IS NULL THEN RAISE NOTICE 'No test entities found.'; RETURN; END IF;
  RAISE NOTICE 'Test entities: %', array_length(eids, 1);
  FOR tbl IN
    SELECT table_name FROM information_schema.columns
    WHERE column_name = 'entity_id' AND table_schema = 'public' AND table_name <> 'identities'
    ORDER BY table_name
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE entity_id = ANY($1)', tbl) INTO n USING eids;
    IF n > 0 THEN RAISE NOTICE '  % -> % rows', rpad(tbl, 28), n; END IF;
  END LOOP;
END $$;

-- ============================ PART 2 · EYEBALL (confirm none of these is real) ============================
SELECT identity_id, bridge_id, display_name, email, created_at
FROM identities
WHERE email LIKE '%@test.example' OR email LIKE '%@test.com'  OR email LIKE '%@test-cb.com'
   OR email LIKE '%@demo-cb.com'  OR email LIKE '%@example.com' OR email LIKE '%@t.com'
   OR email LIKE '%@x.com'
ORDER BY created_at DESC;

-- ============================ PART 3 · DELETE (only after Parts 1 and 2 look right) ============================
SET row_security = off;
DO $$
DECLARE tbl text; eids uuid[];
BEGIN
  SELECT array_agg(identity_id) INTO eids FROM identities
  WHERE email LIKE '%@test.example' OR email LIKE '%@test.com'  OR email LIKE '%@test-cb.com'
     OR email LIKE '%@demo-cb.com'  OR email LIKE '%@example.com' OR email LIKE '%@t.com'
     OR email LIKE '%@x.com';
  IF eids IS NULL THEN RAISE NOTICE 'No test entities found — nothing to clean.'; RETURN; END IF;

  -- schema_fields hang off entity_schemas by schema_id (no entity_id) — clear them first to avoid a FK block.
  BEGIN
    DELETE FROM schema_fields WHERE schema_id IN (SELECT schema_id FROM entity_schemas WHERE entity_id = ANY(eids));
  EXCEPTION WHEN undefined_table THEN NULL; END;

  -- Schema-adaptive: delete from EVERY table that has an entity_id column, scoped to the test entities. Covers chit_header,
  -- chit_messages, cb_attachment, catalogue_items, entity_schemas, entity_governance, entity_wallet, usage_ledger,
  -- form_instance, idempotency_key, kyb_field_cache, relationships, connections, folders, connectors, captures, etc.
  FOR tbl IN
    SELECT table_name FROM information_schema.columns
    WHERE column_name = 'entity_id' AND table_schema = 'public' AND table_name <> 'identities'
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE entity_id = ANY($1)', tbl) USING eids;
  END LOOP;

  -- the co-assists (actors) that hang off these entities, then the entities themselves.
  DELETE FROM identities WHERE parent_entity_id = ANY(eids);
  DELETE FROM identities WHERE identity_id      = ANY(eids);

  RAISE NOTICE 'Cleaned % test entities (+ their actors and all their data).', array_length(eids, 1);
END $$;

-- ============================ PART 4 · RECLAIM (optional, after Part 3) ============================
-- DELETE marks rows dead; it does not return disk. Run this only if Part 0 showed a genuinely heavy table.
-- VACUUM (not FULL) is non-blocking and usually enough — it lets the freed space be reused:
--   VACUUM (ANALYZE) chit_header, chit_messages, cb_attachment, idempotency_key;
-- VACUUM FULL rewrites the table under an ACCESS EXCLUSIVE lock (table unavailable for the duration).
-- Only worth it on a big table with a lot of dead space, and only when nobody is using the system:
--   VACUUM FULL chit_header;
