-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b189 (APPLY) — give register_attachable a read-all policy, so the app can see it again.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ RUN b189_rls_without_policy_dryrun.sql FIRST. If it lists any table other than register_attachable with
-- needs_policy = true, STOP and say so — that table is silently empty to the app too, and each one needs its
-- own decision. Do not let this script stand in for that.
--
-- ⭐ WHY A POLICY AND NOT `DISABLE ROW LEVEL SECURITY`. Turning RLS off would also work today and is arguably
-- truer to what this table is — a platform registry holding no entity's data. A policy is chosen because it
-- STATES THE INTENT where the database can see it: "everyone reads this, nobody writes it through the app."
-- Disabling would leave a table that reads as an oversight, and the next person to tidy it up re-enables RLS
-- and silently breaks the register again — which is precisely the failure this repairs.
--
-- ⚠️ SELECT ONLY, and no WITH CHECK. Nothing writes this table but a migration. Rows are added by hand, on
-- purpose: a new attachable kind is a decision, not user input.
--
-- Safe to re-run.

ALTER TABLE register_attachable ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS register_attachable_read_all ON register_attachable;
CREATE POLICY register_attachable_read_all ON register_attachable
  FOR SELECT
  USING (true);

-- ⚠️ NOT FORCED, deliberately. FORCE would apply the policy to the owner as well, which is right for a tenant
-- table and pointless here — this policy is already true for everyone. Leaving FORCE off also keeps migrations
-- run as postgres working exactly as they do now.

GRANT SELECT ON register_attachable TO cb_app;

-- ── what it looks like now — ONE result set ────────────────────────────────────────────────────────────────────
SELECT
  'register_attachable'                                                     AS table_name,
  (SELECT count(*) FROM register_attachable)                                AS rows_total,
  (SELECT count(*) FROM register_attachable WHERE active)                   AS rows_active,
  (SELECT count(*) FROM pg_policy p
     WHERE p.polrelid = 'register_attachable'::regclass)                    AS policies,
  has_table_privilege('cb_app', 'register_attachable', 'SELECT')            AS cb_app_can_select,
  /* ⚠️ Still true elsewhere? If this is not 0, another table is silently empty to the app. */
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
      AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid))  AS other_tables_still_unreadable;
