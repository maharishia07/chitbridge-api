-- tools/schema-fingerprint.sql — THE SCHEMA FINGERPRINT (DB-REBASE, 18 Oct 2026): one row per object (k) with its detail (d) and a short hash (h).
-- Objects: tables in public/metrics/ops (columns, constraints, indexes, RLS enable/force, policies, triggers, grants to cb_app/cb_metrics/cb_ops),
-- views, sequences, our functions (full text), enums, our extensions, our roles. Read-only. tools/schema-fingerprint.cjs appends the SELECT.
-- Keep it identical on both sides: the prod paste-back query embeds the hashes this text makes.
-- A function's text is compared WITHOUT carriage returns: a body pasted from a Windows checkout carries CRLF, which changes nothing it does.
WITH sch AS (SELECT oid, nspname FROM pg_namespace WHERE nspname IN ('public','metrics','ops')),
rel AS (
  SELECT c.oid, c.relkind, CASE WHEN s.nspname = 'public' THEN '' ELSE s.nspname || '.' END || c.relname AS nm
  FROM pg_class c JOIN sch s ON s.oid = c.relnamespace
  WHERE c.relkind IN ('r','p','v','m','S')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
),
tbl AS (SELECT * FROM rel WHERE relkind IN ('r','p')),
fp(k, d) AS (
  SELECT 'tab:' || nm || ':rls', to_jsonb((SELECT CASE WHEN relrowsecurity THEN 'E' ELSE '-' END || CASE WHEN relforcerowsecurity THEN 'F' ELSE '-' END FROM pg_class WHERE oid = tbl.oid)) FROM tbl
  UNION ALL
  SELECT 'tab:' || nm || ':col', (SELECT jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NN' ELSE '' END
          || coalesce(' =' || pg_get_expr(ad.adbin, ad.adrelid), '') || CASE WHEN a.attgenerated <> '' THEN ' GEN' ELSE '' END
          || CASE WHEN a.attidentity <> '' THEN ' ID' ELSE '' END ORDER BY a.attname)
     FROM pg_attribute a LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
     WHERE a.attrelid = tbl.oid AND a.attnum > 0 AND NOT a.attisdropped) FROM tbl
  UNION ALL
  SELECT 'tab:' || nm || ':con', (SELECT jsonb_agg(conname || ': ' || pg_get_constraintdef(oid) ORDER BY conname) FROM pg_constraint WHERE conrelid = tbl.oid) FROM tbl
  UNION ALL
  SELECT 'tab:' || nm || ':idx', (SELECT jsonb_agg(regexp_replace(pg_get_indexdef(indexrelid), ' ON (ONLY )?public\.', ' ON \1') ORDER BY pg_get_indexdef(indexrelid)) FROM pg_index WHERE indrelid = tbl.oid) FROM tbl
  UNION ALL
  SELECT 'tab:' || nm || ':pol', (SELECT jsonb_agg(polname || ' ' || polcmd::text || CASE WHEN polpermissive THEN '' ELSE ' RESTRICTIVE' END
          || ' to ' || coalesce((SELECT string_agg(CASE WHEN r = 0 THEN 'public' ELSE r::regrole::text END, ',' ORDER BY CASE WHEN r = 0 THEN 'public' ELSE r::regrole::text END) FROM unnest(polroles) r), '')
          || coalesce(' using ' || pg_get_expr(polqual, polrelid), '') || coalesce(' check ' || pg_get_expr(polwithcheck, polrelid), '') ORDER BY polname)
     FROM pg_policy WHERE polrelid = tbl.oid) FROM tbl
  UNION ALL
  SELECT 'tab:' || nm || ':trg', (SELECT jsonb_agg(regexp_replace(pg_get_triggerdef(oid), ' ON public\.', ' ON ') ORDER BY tgname) FROM pg_trigger WHERE tgrelid = tbl.oid AND NOT tgisinternal) FROM tbl
  UNION ALL
  SELECT 'tab:' || nm || ':acl', (SELECT jsonb_agg(r.rolname || '=' || x.p ORDER BY r.rolname) FROM (
       SELECT a.grantee, string_agg(DISTINCT a.privilege_type, ',' ORDER BY a.privilege_type) p FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = tbl.oid GROUP BY a.grantee) x
       JOIN pg_roles r ON r.oid = x.grantee WHERE r.rolname IN ('cb_app','cb_metrics','cb_ops')) FROM tbl
  UNION ALL
  SELECT 'view:' || nm, to_jsonb(relkind::text || ' ' || pg_get_viewdef(oid)) FROM rel WHERE relkind IN ('v','m')
  UNION ALL
  SELECT 'seq:' || nm, to_jsonb('S'::text) FROM rel WHERE relkind = 'S'
  UNION ALL
  SELECT 'fn:' || CASE WHEN s.nspname = 'public' THEN '' ELSE s.nspname || '.' END || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         to_jsonb(CASE WHEN p.prosecdef THEN 'DEFINER ' ELSE '' END || replace(pg_get_functiondef(p.oid), chr(13), ''))
  FROM pg_proc p JOIN sch s ON s.oid = p.pronamespace
  WHERE p.prokind IN ('f','p') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  UNION ALL
  SELECT 'enum:' || ty.typname, to_jsonb((SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) FROM pg_enum WHERE enumtypid = ty.oid))
  FROM pg_type ty JOIN sch s ON s.oid = ty.typnamespace WHERE ty.typtype = 'e'
  UNION ALL
  SELECT 'ext:' || extname, to_jsonb(extversion) FROM pg_extension WHERE extname IN ('ltree','pgcrypto','pg_trgm','uuid-ossp','plpgsql','citext','btree_gist')
  UNION ALL
  SELECT 'role:' || rolname, to_jsonb(CASE WHEN rolcanlogin THEN 'login' ELSE 'nologin' END || CASE WHEN rolbypassrls THEN ' BYPASSRLS' ELSE '' END)
  FROM pg_roles WHERE rolname IN ('cb_app','cb_metrics','cb_ops')
),
fph AS (SELECT k, d, left(md5(coalesce(d::text, 'null')), 12) AS h FROM fp)
