-- scripts/rls-readiness-check.sql — B1 RLS readiness dashboard (one-shot).
-- Run as postgres in the Supabase SQL editor. READ-ONLY — checks nothing, changes nothing; safe anytime.
-- It's a live "how ready is the DB?" dashboard: run it before the migrations (mostly PENDING), and again after each
-- one (rows flip to PASS). Read the `verdict` column:
--    PASS    = ready.
--    PENDING = expected at this stage — run the noted migration (b48 / b49 / b50-b52), then re-run this.
--    WARN    = advisory (performance / catalogue visibility) — not a blocker.
--    FAIL    = wrong; fix before enabling RLS on that table.
--
-- Covers: (1) no orphan scope rows, (2) index on the scope column, (3) default-schema visibility set,
--         (4) cb_app role is non-bypass, (5) RLS enabled+forced per table, (6) a policy per table,
--         (7) the delivery-agent definer functions are SECURITY DEFINER + owned by a BYPASSRLS role.

WITH
orphans AS (
  SELECT 'chit_header'::text tbl, count(*) n FROM chit_header     WHERE entity_id       IS NULL
  UNION ALL SELECT 'chit_status',     count(*) FROM chit_status     WHERE entity_id       IS NULL
  UNION ALL SELECT 'chit_detail',     count(*) FROM chit_detail     WHERE entity_id       IS NULL
  UNION ALL SELECT 'state_log',       count(*) FROM state_log       WHERE entity_id       IS NULL
  UNION ALL SELECT 'catalogue_items', count(*) FROM catalogue_items WHERE entity_id       IS NULL
  UNION ALL SELECT 'customer_list',   count(*) FROM customer_list   WHERE owner_entity_id IS NULL
),
tbl(t, col) AS (VALUES
  ('chit_header','entity_id'), ('chit_status','entity_id'), ('chit_detail','entity_id'),
  ('state_log','entity_id'), ('catalogue_items','entity_id'), ('customer_list','owner_entity_id')),
fns(f) AS (VALUES
  ('chit_deliver'), ('chit_participants'), ('chit_log_all'), ('chit_set_status_all'),
  ('chit_log_targets'), ('chit_set_customer_priority_all'), ('chit_participant_parity'))
SELECT * FROM (
  -- 1. no orphan (NULL scope) rows — an orphan is invisible to everyone once RLS is on
  SELECT 10 AS ord, ('1. no orphan rows ('||tbl||')') AS check_name, n::text AS finding,
         CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL — backfill the scope column before enabling' END AS verdict
  FROM orphans

  UNION ALL
  -- 2. an index on the scope column (RLS adds it to every WHERE — index it)
  SELECT 20, ('2. index on scope ('||t||'.'||col||')'),
         COALESCE((SELECT string_agg(indexname, ', ') FROM pg_indexes i WHERE i.tablename = t AND i.indexdef LIKE '%'||col||'%'), '(none)'),
         CASE WHEN EXISTS (SELECT 1 FROM pg_indexes i WHERE i.tablename = t AND i.indexdef LIKE '%'||col||'%')
              THEN 'PASS' ELSE 'WARN — add an index on the scope column for performance' END
  FROM tbl

  UNION ALL
  -- 3. active default schemas have a visibility value (the catalogue_items policy reads it)
  SELECT 30, '3. default-schema visibility set',
         (count(*) FILTER (WHERE visibility IS NULL))::text||' of '||count(*)||' active default schemas missing visibility',
         CASE WHEN count(*) FILTER (WHERE visibility IS NULL) = 0 THEN 'PASS'
              ELSE 'WARN — set public/private on default schemas' END
  FROM entity_schemas WHERE is_default = true AND status = 'active'

  UNION ALL
  -- 4. cb_app role exists and is NOSUPERUSER NOBYPASSRLS (else RLS is a no-op — the whole point)
  SELECT 40, '4. cb_app role (non-bypass)',
         COALESCE((SELECT 'super='||rolsuper||' bypassrls='||rolbypassrls FROM pg_roles WHERE rolname = 'cb_app'), '(role not found)'),
         CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cb_app' AND NOT rolsuper AND NOT rolbypassrls) THEN 'PASS'
              WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cb_app') THEN 'FAIL — must be NOSUPERUSER NOBYPASSRLS'
              ELSE 'PENDING — run migration b48' END

  UNION ALL
  -- 5. RLS ENABLED + FORCED per table
  SELECT 50, ('5. RLS enabled+forced ('||t||')'),
         COALESCE((SELECT 'enabled='||relrowsecurity||' forced='||relforcerowsecurity FROM pg_class WHERE relname = t AND relkind = 'r'), '(table not found)'),
         CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relname = t AND relrowsecurity AND relforcerowsecurity) THEN 'PASS'
              ELSE 'PENDING — run b49 for this table (enable in order, prove GREEN first)' END
  FROM tbl

  UNION ALL
  -- 6. a policy exists per table
  SELECT 60, ('6. policy present ('||t||')'),
         COALESCE((SELECT string_agg(policyname, ', ') FROM pg_policies p WHERE p.tablename = t), '(none)'),
         CASE WHEN EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = t) THEN 'PASS' ELSE 'PENDING — run b49' END
  FROM tbl

  UNION ALL
  -- 7. the delivery-agent definers: SECURITY DEFINER, owned by a BYPASSRLS role (so they can cross under FORCE)
  SELECT 70, ('7. definer fn ('||f||')'),
         COALESCE((SELECT 'secdef='||p.prosecdef||' owner='||r.rolname||' owner_bypass='||r.rolbypassrls
                     FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE p.proname = f LIMIT 1), '(not found)'),
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE p.proname = f AND p.prosecdef AND r.rolbypassrls) THEN 'PASS'
              WHEN EXISTS (SELECT 1 FROM pg_proc p WHERE p.proname = f) THEN 'FAIL — must be SECURITY DEFINER owned by a BYPASSRLS role'
              ELSE 'PENDING — run b50/b51/b52' END
  FROM fns
) checks
ORDER BY ord, check_name;
