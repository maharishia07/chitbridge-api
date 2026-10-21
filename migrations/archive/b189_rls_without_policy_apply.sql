-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b189 — the register was never unseeded. RLS was filtering it. One script: fix, then audit.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⭐ THE BUG. register_attachable holds 12 rows and has RLS ENABLED WITH NO POLICY. A table in that state
-- returns ZERO ROWS to every non-owner, silently — no error, no permission denied. The owner is exempt unless
-- FORCE is set, so it reads correctly here (you are postgres) and empty in the app (it is cb_app).
--
-- ⚠️ READ THE SECOND HALF OF THE RESULT. Row 1 is the fix. Any row after it is ANOTHER table with the same
-- silent hole — unreadable to the app right now — and each needs its own decision, not this blanket policy.
-- If nothing follows row 1, nothing else is affected.
--
-- Safe to re-run.

-- ── the fix ────────────────────────────────────────────────────────────────────────────────────────────────────
-- ⭐ A POLICY, NOT `DISABLE ROW LEVEL SECURITY`. Both work today. The policy states the intent where the
-- database can see it — everyone reads this, nobody writes it through the app — so the next tidy-up that
-- re-enables RLS cannot silently break the register again. SELECT only, and no WITH CHECK: rows are added by
-- migration, on purpose, because a new attachable kind is a decision rather than user input.
ALTER TABLE register_attachable ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS register_attachable_read_all ON register_attachable;
CREATE POLICY register_attachable_read_all ON register_attachable FOR SELECT USING (true);
GRANT SELECT ON register_attachable TO cb_app;

-- ── the result — ONE set. Row 1 = the fix. Rows 2+ = still broken elsewhere. ───────────────────────────────────
SELECT 1 AS ord,
       'register_attachable' AS table_name,
       (SELECT count(*) FROM register_attachable)                                    AS rows_in_table,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = 'register_attachable'::regclass) AS policies,
       has_table_privilege('cb_app', 'register_attachable', 'SELECT')                AS cb_app_can_select,
       'FIXED - the app should see all 12 kinds now'                                 AS note
UNION ALL
SELECT 2,
       c.relname,
       (xpath('/row/c/text()',
              query_to_xml('SELECT count(*) AS c FROM public.' || quote_ident(c.relname),
                           false, true, '')))[1]::text::bigint,
       0,
       has_table_privilege('cb_app', c.oid, 'SELECT'),
       'STILL UNREADABLE TO THE APP - RLS on, no policy'
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind = 'r'
   AND c.relrowsecurity
   AND c.relname <> 'register_attachable'
   AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
 ORDER BY ord, table_name;
