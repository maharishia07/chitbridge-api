-- READ-2026-10-19-1-rls-grants-census.sql · DB-1 (plan topic 7b) · census 1 of 4 · READ-ONLY.
--
-- WHAT IT DOES: one picture of row level security and of what the app's role (cb_app) may do, for EVERY table in public, ops and metrics:
--    RLS on? forced? how many policies? which of SELECT/INSERT/UPDATE/DELETE/TRUNCATE cb_app holds? can Supabase's `anon` read it?
--    Plus: the add-only tables (should be SELECT + INSERT only), the DEFAULT PRIVILEGES that arm new tables, and the three roles.
--    It widens C:/dev/sql-to-run/2026-10-18/grants-census-1-readonly.sql (14 tables) to all tables; that file is superseded by this one.
--    Its `tables` object has the shape of db/rls-baseline.json, so the paste refreshes that baseline (scripts/rls-census.cjs --from <file>).
--
-- READ-ONLY: SELECT on the catalog only. It writes nothing, creates nothing, reads no business rows. Safe to run any time, any number of times.
-- HOW: Supabase SQL editor, as postgres. One statement → ONE row, ONE column ("census"). Copy that JSON value and paste it back to Claude.
--
-- WHAT TO LOOK FOR (Claude reads it; nothing to judge by eye):
--    counts.no_rls_app_reads   tables with RLS OFF that cb_app can read = readable across every shop. Target 0 (the 26 Sep baseline had 59).
--    counts.rls_no_policy      RLS ON with no policy = the table answers ZERO rows to the app, silently (the b189 class). Target 0.
--    counts.rls_not_forced     RLS ON but not FORCED. Target 0 (every table: enabled + forced + an entity policy).
--    no_rls_anon_reads         RLS OFF and `anon` may SELECT = open through Supabase's REST api if the Data API is on. Target empty.
--    addonly.*.verdict         'ok' or 'EXTRA: UPDATE, DELETE' — an EXTRA row goes into b767 (DB-4, NOT for tonight).
--    default_privs             which privileges a NEW table hands cb_app / anon / authenticated the moment it is created.
WITH sch AS (SELECT oid, nspname FROM pg_namespace WHERE nspname IN ('public', 'ops', 'metrics')),
tbl AS (
  SELECT c.oid,
         CASE WHEN s.nspname = 'public' THEN '' ELSE s.nspname || '.' END || c.relname AS t,
         c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
    FROM pg_class c JOIN sch s ON s.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'p')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
),
per AS (
  SELECT t, rls, forced,
         (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = tbl.oid)                                         AS policies,
         has_table_privilege('cb_app', oid, 'SELECT')                                                               AS app_reads,
         concat_ws(', ', CASE WHEN has_table_privilege('cb_app', oid, 'SELECT')   THEN 'SELECT'   END,
                         CASE WHEN has_table_privilege('cb_app', oid, 'INSERT')   THEN 'INSERT'   END,
                         CASE WHEN has_table_privilege('cb_app', oid, 'UPDATE')   THEN 'UPDATE'   END,
                         CASE WHEN has_table_privilege('cb_app', oid, 'DELETE')   THEN 'DELETE'   END,
                         CASE WHEN has_table_privilege('cb_app', oid, 'TRUNCATE') THEN 'TRUNCATE' END)              AS app,
         CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
              THEN has_table_privilege('anon', oid, 'SELECT') ELSE false END                                        AS anon_reads
    FROM tbl
),
-- The add-only list of 18 Oct, each checked against the code on 19 Oct (origin/main a023ae8e).
-- want = what the table should hold. The last three are NOT add-only in practice: the app UPDATEs them (file:line in `why`).
addonly(t, want, why) AS (VALUES
  ('source_penetration',    'INSERT, SELECT', 'b79; written only by INSERT (routes/catalogue.js:1331)'),
  ('product_version',       'INSERT, SELECT', 'b80; immutable versions (lib/container.js:36)'),
  ('resolved_blueprint',    'INSERT, SELECT', 'b81; INSERT … ON CONFLICT DO NOTHING (lib/regional.js:55)'),
  ('erp_handoff',           'INSERT, SELECT', 'b82; INSERT only (routes/catalogue.js:1344)'),
  ('usage_ledger',          'INSERT, SELECT', 'b99; the meter, INSERT only (lib/meter.js:63, lib/ai.js:512, lib/kyb.js:272)'),
  ('kyb_field_cache',       'INSERT, SELECT', 'b107; INSERT only (lib/kyb.js:275)'),
  ('definition_status_log', 'INSERT, SELECT', 'b268; INSERT only (routes/definitions.js:333, :395)'),
  ('ai_usage',              'INSERT, SELECT', 'b269; no writer in the api today'),
  ('books_compare_part',    'INSERT, SELECT', 'b309; INSERT only (lib/books-store.js:871)'),
  ('fx_rate',               'INSERT, SELECT', 'b391; insert-only, newest row wins (lib/books-store.js:285)'),
  ('move_in_import',        'INSERT, SELECT', 'b765 + sql-to-run b765-4 REVOKE'),
  ('definition_version',    'see why',        'b160 says append-only BY GRANT, but lib/slab-cites.js:33 and routes/testing.js:231 UPDATE it'),
  ('signup_context',        'see why',        'b265 grants INSERT only, but routes/signin.js:538 UPDATEs country_source'),
  ('ops.population',        'see why',        'b249 grants SELECT, INSERT, but routes/entities.js:1511 UPDATEs desk_entity_id')
),
dacl AS (
  SELECT jsonb_agg(jsonb_build_object('for_role', pg_get_userbyid(d.defaclrole), 'schema', coalesce(n.nspname, '(all)'),
                                      'on', CASE d.defaclobjtype WHEN 'r' THEN 'tables' WHEN 'S' THEN 'sequences' WHEN 'f' THEN 'functions'
                                                 WHEN 'T' THEN 'types' WHEN 'n' THEN 'schemas' ELSE d.defaclobjtype::text END,
                                      'to', r.rolname, 'privs', x.privs)
                   ORDER BY pg_get_userbyid(d.defaclrole), n.nspname, d.defaclobjtype, r.rolname) AS j
    FROM pg_default_acl d
    LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL (SELECT a.grantee, string_agg(a.privilege_type, ', ' ORDER BY a.privilege_type) AS privs
                          FROM aclexplode(d.defaclacl) a GROUP BY a.grantee) x
    JOIN pg_roles r ON r.oid = x.grantee
   WHERE r.rolname IN ('cb_app', 'cb_metrics', 'cb_ops', 'anon', 'authenticated')
     AND (n.nspname IS NULL OR n.nspname IN ('public', 'ops', 'metrics'))
)
SELECT jsonb_build_object(
  'census',  'READ-2026-10-19-1 rls + grants',
  'at',      now(),
  'db',      current_database(),
  'counts',  (SELECT jsonb_build_object(
                 'tables',            count(*),
                 'rls_on',            count(*) FILTER (WHERE rls),
                 'rls_on_forced',     count(*) FILTER (WHERE rls AND forced),
                 'rls_not_forced',    count(*) FILTER (WHERE rls AND NOT forced),
                 'rls_no_policy',     count(*) FILTER (WHERE rls AND policies = 0),
                 'no_rls',            count(*) FILTER (WHERE NOT rls),
                 'no_rls_app_reads',  count(*) FILTER (WHERE NOT rls AND app_reads),
                 'no_rls_anon_reads', count(*) FILTER (WHERE NOT rls AND anon_reads)) FROM per),
  'no_rls_app_reads',  (SELECT jsonb_agg(t ORDER BY t) FROM per WHERE NOT rls AND app_reads),
  'no_rls_anon_reads', (SELECT jsonb_agg(t ORDER BY t) FROM per WHERE NOT rls AND anon_reads),
  'rls_not_forced',    (SELECT jsonb_agg(t ORDER BY t) FROM per WHERE rls AND NOT forced),
  'rls_no_policy',     (SELECT jsonb_agg(t ORDER BY t) FROM per WHERE rls AND policies = 0),
  'addonly',  (SELECT jsonb_object_agg(a.t, jsonb_build_object(
                  'exists',  p.t IS NOT NULL,
                  'app',     p.app,
                  'verdict', CASE WHEN p.t IS NULL THEN 'absent'
                                  WHEN a.want <> 'INSERT, SELECT' THEN 'app updates it: ' || coalesce(p.app, '')
                                  WHEN p.app ~ '(UPDATE|DELETE|TRUNCATE)'
                                    THEN 'EXTRA: ' || array_to_string(ARRAY(SELECT unnest(string_to_array(p.app, ', '))
                                                                               INTERSECT SELECT unnest(ARRAY['UPDATE', 'DELETE', 'TRUNCATE'])), ', ')
                                  ELSE 'ok' END,
                  'why',     a.why))
                 FROM addonly a LEFT JOIN per p ON p.t = a.t),
  'default_privs', (SELECT j FROM dacl),
  'roles',   (SELECT jsonb_object_agg(rolname, (CASE WHEN rolcanlogin THEN 'login' ELSE 'nologin' END)
                                              || CASE WHEN rolbypassrls THEN ' BYPASSRLS' ELSE '' END
                                              || CASE WHEN rolsuper THEN ' SUPERUSER' ELSE '' END)
                FROM pg_roles WHERE rolname IN ('cb_app', 'cb_metrics', 'cb_ops', 'anon', 'authenticated')),
  'tables',  (SELECT jsonb_object_agg(t, jsonb_build_object('rls', rls, 'forced', forced, 'policies', policies,
                                                            'app_reads', app_reads, 'app', app, 'anon_reads', anon_reads)) FROM per)
) AS census;
