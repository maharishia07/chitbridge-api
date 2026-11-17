-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b190 — the last two tables with RLS on and no policy. One script.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- b189 found these. Neither is a tenant table, and both were DESIGNED with RLS off — b61 says so in a comment
-- ("chit_reads is a per-actor carve-out, not entity-RLS-scoped"), and retention_config is a single config row
-- with no entity_id at all. Something enabled RLS on them afterwards, most likely the Supabase dashboard's
-- one-click "Enable RLS" on its unrestricted-table warning, which adds no policy.
--
-- ⚠️ NEITHER IS CRASHING, WHICH IS WHY THIS WENT UNNOTICED. Both had a defence:
--   · the chit_reads INSERT runs inside a SAVEPOINT, so the denial cannot poison the outer transaction
--   · the retention floor trigger is SECURITY DEFINER (b105a), written for exactly this case
-- What they lost is function, silently:
--   · read-tracking is DEAD — 0 rows, so unread never clears, and every actor opening a chit pays two wasted
--     round trips for an INSERT that always fails
--   · any direct read of retention_config returns nothing and falls back to defaults
--
-- ⭐ A POLICY, NOT `DISABLE ROW LEVEL SECURITY`. Both would work. The policy states the intent where the
-- database can see it, so the next dashboard warning that gets clicked cannot silently break these again —
-- which is the whole failure mode being repaired.
--
-- Safe to re-run.

-- ── chit_reads · per-actor read tracking ───────────────────────────────────────────────────────────────────────
-- ⚠️ PERMISSIVE, AND THAT IS THE ORIGINAL DESIGN, not a shortcut. The table holds (chit_id, actor_id, read_at)
-- and no business content, and every query already filters by actor_id. A tighter policy scoped to
-- `app.current_actor` is possible and would be better — but only if that setting is populated on EVERY path
-- that touches this table, which is unverified. Getting it wrong re-creates precisely this bug, silently, so
-- it is left as a deliberate decision rather than assumed. See the note at the end.
ALTER TABLE chit_reads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chit_reads_all ON chit_reads;
CREATE POLICY chit_reads_all ON chit_reads USING (true) WITH CHECK (true);

-- ── retention_config · one row of platform config ──────────────────────────────────────────────────────────────
-- ⚠️ SELECT ONLY. Nothing in the app writes this — b105 grants cb_app SELECT and nothing more, and the row is
-- seeded by migration. A write policy would grant more than anything asks for.
ALTER TABLE retention_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS retention_config_read_all ON retention_config;
CREATE POLICY retention_config_read_all ON retention_config FOR SELECT USING (true);

-- ── the result — ONE set. Anything left in rows 2+ still has the hole. ─────────────────────────────────────────
SELECT 1 AS ord,
       c.relname                                                   AS table_name,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
       'FIXED'                                                     AS note
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname IN ('chit_reads', 'retention_config')
UNION ALL
SELECT 2, c.relname,
       0,
       'STILL UNREADABLE TO THE APP - RLS on, no policy'
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
   AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
 ORDER BY ord, table_name;
