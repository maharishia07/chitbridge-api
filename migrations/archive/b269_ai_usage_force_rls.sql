-- b269_ai_usage_force_rls.sql — RUN BY ATHI 2026-09-29 (Supabase editor).
-- The fourth table with row-level security switched on but not forced (critic/triage H3). b101 — also run by Athi on
-- 2026-09-29, after the night's check found it had never been applied — forces entity_profile, entity_wallet and
-- usage_ledger; it does not cover ai_usage. Nothing in routes/lib/middleware reads or writes ai_usage, so forcing it
-- cannot change what the app sees. Verified after: all four tables forced = true.
-- ⚠️ ENABLE is stated too, though Athi ran only the FORCE: production already had it enabled with one policy
-- (db/rls-baseline.json, read live 2026-09-26: rls true, policies 1), but no migration file ever said so — and FORCE
-- without ENABLE does nothing (tests/entity-cast-guard.test.cjs). Idempotent: on production it changes nothing.
-- SCHEMA-FIX1 (16 Oct): ai_usage exists on production but NO migration created it (b99 first held it, then became the usage_ledger
-- file). This is the table as the first b99 wrote it (git 620737a6): on production every statement here is a no-op.
CREATE TABLE IF NOT EXISTS ai_usage (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid NOT NULL,
  doc_type      text NOT NULL,
  model         text NOT NULL,
  input_tokens  int  NOT NULL DEFAULT 0,
  output_tokens int  NOT NULL DEFAULT 0,
  cost_usd      numeric(12,6) NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ai_usage') THEN
    CREATE POLICY rls_entity ON ai_usage
      USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
      WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
  END IF;
END $$;
GRANT SELECT, INSERT ON ai_usage TO cb_app;
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage FORCE ROW LEVEL SECURITY;
