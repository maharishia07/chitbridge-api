-- b304_schema_migrations.sql — HX1: THE MIGRATION LEDGER. Which migration files this database has had, when, and how they got here.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor or psql, AS postgres — the table owner; cb_app is never granted it).
--    Safe to re-run: CREATE … IF NOT EXISTS, no data change. Order: any time; the code of round HX1 does not read it at run time.
--
-- WHY. "No schema_migrations ledger yet — applied state is manual" (docs/DEPLOY-RUNBOOK.md). A fresh stack migrated itself once and a
--    second deploy could not tell what was new. tools/migrate.cjs now writes one row per file it runs and skips the rows it finds; the
--    owner's own SQL-editor runs are recorded with ONE command (no SQL is run by it):
--        node tools/migrate.cjs --db "$DATABASE_URL" --record b304_schema_migrations.sql        (one file, or several)
--        node tools/migrate.cjs --db "$DATABASE_URL" --record-through b304                      (every chain file up to b304: the backfill)
--    or, by hand in the SQL editor:  INSERT INTO schema_migrations (filename, source) VALUES ('b304_schema_migrations.sql', 'manual')
--                                    ON CONFLICT (filename) DO NOTHING;
--    Nothing runs on production by itself: the ledger makes the manual state VISIBLE (`node tools/migrate.cjs --status`).
--
-- COLUMNS (docs/FIELDS.md, schema_migrations): filename (the file's name in migrations/, the key) · sha256 (of the file's bytes when it
--    ran — null when recorded by hand; a later edit shows as "changed since it ran") · applied_at · applied_by (current_user) ·
--    source ('migrate' = tools/migrate.cjs ran it · 'recorded' = --record, the owner ran it · 'manual' = an INSERT by hand).
--
-- RLS: ENABLED + FORCED with ONE policy — platform bookkeeping, no tenant's data, and on Supabase a public table without RLS is
--    readable through its REST api by `anon`. The policy admits only the role that ran this file (the owner who runs migrations — FORCE
--    would otherwise lock the owner out too); cb_app and anon get no grant and no row. tests/migration-rls.test.js lists it as bookkeeping.

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    text        PRIMARY KEY,
  sha256      text,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  applied_by  text        NOT NULL DEFAULT current_user,
  source      text        NOT NULL DEFAULT 'migrate' CHECK (source IN ('migrate', 'recorded', 'manual'))
);
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON schema_migrations FROM PUBLIC;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'schema_migrations' AND policyname = 'schema_migrations_owner') THEN
    EXECUTE format('CREATE POLICY schema_migrations_owner ON schema_migrations USING (pg_has_role(current_user, %L, ''MEMBER'')) WITH CHECK (pg_has_role(current_user, %L, ''MEMBER''))', current_user, current_user);
  END IF;
END $$;
COMMENT ON TABLE schema_migrations IS 'HX1 migration ledger: one row per migrations/ file this database has had (tools/migrate.cjs)';
